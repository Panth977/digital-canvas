/**
 * Sharing a design: the Drive v3 permissions API on its `.dcanvas` file
 * (https://developers.google.com/drive/api/reference/rest/v3/permissions).
 * `drive.file` covers permissions on files the app created (the user's own
 * designs and assets), so no other scope is needed.
 *
 *   people with access   permissions.list / create (user, with sendNotificationEmail
 *                        + emailMessage) / update (role) / delete
 *   link access          a `type: anyone` permission (reader or writer), allowFileDiscovery false
 *   owner, "shared by"   files.get owners / sharingUser / capabilities
 *
 * Linked assets (pictures, clips, fonts in `assets/`) become "anyone with the
 * link: reader" while the design is shared, so the recipient's app can read
 * them with the API key (driveapi.ts). Their ids are content-hash file names
 * behind random Drive ids: nobody finds them without the design.
 */
import { API, driveCall, readVia, type ReadVia, type TokenSource } from './driveapi.ts';

/** Drive roles a design can be shared with ("Can edit", "Can comment", "Can view"). */
export type ShareRole = 'writer' | 'commenter' | 'reader';
export const SHARE_ROLES: { role: ShareRole; label: string }[] = [
  { role: 'writer', label: 'Can edit' },
  { role: 'commenter', label: 'Can comment' },
  { role: 'reader', label: 'Can view' },
];

export interface Person {
  /** Permission id (permissions.update / delete take it). */
  id: string;
  type: 'user' | 'group' | 'domain' | 'anyone';
  role: 'owner' | 'organizer' | 'fileOrganizer' | 'writer' | 'commenter' | 'reader';
  email?: string;
  name?: string;
  photo?: string;
  domain?: string;
  /** The account was deleted. */
  deleted?: boolean;
  pendingOwner?: boolean;
}

/** "Only people added" or "Anyone with the link" with a role. */
export type LinkAccess = 'restricted' | 'reader' | 'commenter' | 'writer';

export interface UserRef { name?: string; email?: string; photo?: string }

/** Who owns the file and what you may do with it (files.get). */
export interface FileAccess {
  fileId: string;
  name?: string;
  ownedByMe: boolean;
  shared: boolean;
  owner?: UserRef;
  /** Who shared it with you (files shared with you only). */
  sharedBy?: UserRef;
  canEdit: boolean;
  canComment: boolean;
  canShare: boolean;
  canCopy: boolean;
  canDownload: boolean;
}

const PERSON_FIELDS = 'id,type,role,emailAddress,displayName,photoLink,domain,deleted,pendingOwner';
export const ACCESS_FIELDS = 'id,name,ownedByMe,shared,owners(displayName,emailAddress,photoLink),sharingUser(displayName,emailAddress,photoLink),capabilities(canEdit,canComment,canShare,canCopy,canDownload)';

interface RawPermission { id: string; type: Person['type']; role: Person['role']; emailAddress?: string; displayName?: string; photoLink?: string; domain?: string; deleted?: boolean; pendingOwner?: boolean }
interface RawUser { displayName?: string; emailAddress?: string; photoLink?: string }
interface RawFile {
  id: string; name?: string; ownedByMe?: boolean; shared?: boolean; owners?: RawUser[]; sharingUser?: RawUser;
  capabilities?: { canEdit?: boolean; canComment?: boolean; canShare?: boolean; canCopy?: boolean; canDownload?: boolean };
}

function person(p: RawPermission): Person {
  return {
    id: p.id, type: p.type, role: p.role,
    ...(p.emailAddress ? { email: p.emailAddress } : {}),
    ...(p.displayName ? { name: p.displayName } : {}),
    ...(p.photoLink ? { photo: p.photoLink } : {}),
    ...(p.domain ? { domain: p.domain } : {}),
    ...(p.deleted ? { deleted: true } : {}),
    ...(p.pendingOwner ? { pendingOwner: true } : {}),
  };
}

const user = (u?: RawUser): UserRef | undefined => u && {
  ...(u.displayName ? { name: u.displayName } : {}), ...(u.emailAddress ? { email: u.emailAddress } : {}), ...(u.photoLink ? { photo: u.photoLink } : {}),
};

export function fileAccess(f: RawFile): FileAccess {
  const c = f.capabilities ?? {};
  return {
    fileId: f.id,
    ...(f.name ? { name: f.name } : {}),
    ownedByMe: !!f.ownedByMe,
    shared: !!f.shared,
    ...(f.owners?.[0] ? { owner: user(f.owners[0]) } : {}),
    ...(f.sharingUser ? { sharedBy: user(f.sharingUser) } : {}),
    canEdit: !!c.canEdit,
    canComment: !!c.canComment,
    canShare: !!c.canShare,
    canCopy: c.canCopy !== false,
    canDownload: c.canDownload !== false,
  };
}

/** The link setting from the permission list. */
export function linkAccessOf(people: Person[]): LinkAccess {
  const anyone = people.find((p) => p.type === 'anyone');
  if (!anyone) return 'restricted';
  return anyone.role === 'writer' || anyone.role === 'commenter' ? anyone.role : 'reader';
}

/** Anyone besides the owner can open it (a person, a group, a domain or the link). */
export const isShared = (people: Person[]) => people.some((p) => p.role !== 'owner');

/** A plausible email address (Drive checks it for real). */
export const isEmail = (s: string) => /^[^\s@,;<>]+@[^\s@,;<>]+\.[^\s@,;<>]+$/.test(s.trim());

const enc = encodeURIComponent;
const JSON_HEAD = { 'content-type': 'application/json' };

/** The Drive permissions client for one signed-in user. */
export class DriveSharing {
  constructor(private token: TokenSource) {}

  /** Everyone with access, owner first (permissions.list, every page). */
  async people(fileId: string): Promise<Person[]> {
    const out: Person[] = [];
    let pageToken = '';
    do {
      const q = new URLSearchParams({ fields: `nextPageToken,permissions(${PERSON_FIELDS})`, pageSize: '100' });
      if (pageToken) q.set('pageToken', pageToken);
      const r = (await (await driveCall(this.token, `${API}/files/${enc(fileId)}/permissions?${q}`)).json()) as { permissions?: RawPermission[]; nextPageToken?: string };
      for (const p of r.permissions ?? []) out.push(person(p));
      pageToken = r.nextPageToken ?? '';
    } while (pageToken);
    const rank = (p: Person) => (p.role === 'owner' ? 0 : p.type === 'anyone' ? 2 : 1);
    return out.sort((a, b) => rank(a) - rank(b));
  }

  /**
   * Add a person by email (permissions.create, type user). Drive emails them
   * (with `message`) unless `notify` is false.
   */
  async add(fileId: string, email: string, role: ShareRole, opts: { notify?: boolean; message?: string } = {}): Promise<Person> {
    const notify = opts.notify !== false;
    const q = new URLSearchParams({ sendNotificationEmail: String(notify), fields: PERSON_FIELDS });
    if (notify && opts.message?.trim()) q.set('emailMessage', opts.message.trim());
    const r = await driveCall(this.token, `${API}/files/${enc(fileId)}/permissions?${q}`, {
      method: 'POST', headers: JSON_HEAD, body: JSON.stringify({ type: 'user', role, emailAddress: email.trim() }),
    });
    return person((await r.json()) as RawPermission);
  }

  /** Change someone's role (permissions.update). */
  async setRole(fileId: string, permissionId: string, role: ShareRole): Promise<Person> {
    const r = await driveCall(this.token, `${API}/files/${enc(fileId)}/permissions/${enc(permissionId)}?fields=${enc(PERSON_FIELDS)}`, {
      method: 'PATCH', headers: JSON_HEAD, body: JSON.stringify({ role }),
    });
    return person((await r.json()) as RawPermission);
  }

  /** Take someone's access away (permissions.delete). */
  async remove(fileId: string, permissionId: string): Promise<void> {
    await driveCall(this.token, `${API}/files/${enc(fileId)}/permissions/${enc(permissionId)}`, { method: 'DELETE' });
  }

  /**
   * "Only people added" deletes the `anyone` permission; "Anyone with the link"
   * creates it (not discoverable in search) or changes its role.
   */
  async setLinkAccess(fileId: string, access: LinkAccess, people?: Person[]): Promise<void> {
    const anyone = (people ?? (await this.people(fileId))).filter((p) => p.type === 'anyone');
    if (access === 'restricted') {
      for (const p of anyone) await this.remove(fileId, p.id);
      return;
    }
    if (anyone[0]) {
      if (anyone[0].role !== access) await this.setRole(fileId, anyone[0].id, access);
      return;
    }
    await this.anyone(fileId, access);
  }

  private async anyone(fileId: string, role: LinkAccess): Promise<void> {
    await driveCall(this.token, `${API}/files/${enc(fileId)}/permissions?fields=id`, {
      method: 'POST', headers: JSON_HEAD, body: JSON.stringify({ type: 'anyone', role, allowFileDiscovery: false }),
    });
  }

  /** Make files "anyone with the link: reader" (a design's assets). Returns the ones that worked. */
  async publish(fileIds: string[], concurrency = 4): Promise<string[]> {
    const done: string[] = [];
    const queue = [...new Set(fileIds)];
    await Promise.all(Array.from({ length: Math.min(concurrency, queue.length) }, async () => {
      for (let id = queue.shift(); id; id = queue.shift()) {
        try {
          await this.anyone(id, 'reader');
          done.push(id);
        } catch { /* not ours (another editor's upload) or gone: the next save tries again */ }
      }
    }));
    return done;
  }

  /** Owner, sharer and what you may do (files.get). */
  access(fileId: string): Promise<FileAccess> {
    return readAccess(fileId, { token: this.token });
  }
}

/** files.get with the access fields, OAuth first then the API key (a public file signed out). */
export async function readAccess(fileId: string, via: ReadVia): Promise<FileAccess> {
  const r = await readVia(`${API}/files/${enc(fileId)}?fields=${enc(ACCESS_FIELDS)}`, via);
  return fileAccess((await r.json()) as RawFile);
}

// ---- links ----

/** The app's public address (share links point here, also from a dev server). */
export const SHARE_ORIGIN = 'https://digital-canvas-p977.web.app';

/**
 * Links to a shared design, by its Drive file id:
 *   edit      /d/<id>         opens it in the editor (Picker grants access the first time)
 *   view      /view/<id>      read-only pages, no sign-in (link access must be "anyone")
 *   template  /template/<id>  signs in and makes your own copy
 */
export function shareLink(kind: 'edit' | 'view' | 'template', fileId: string, origin = SHARE_ORIGIN): string {
  const path = kind === 'edit' ? 'd' : kind;
  return `${origin.replace(/\/$/, '')}/${path}/${enc(fileId)}`;
}

/**
 * The note in Drive's "shared with you" email. Drive's own button links to
 * drive.google.com (a zip it cannot preview), so the app link always comes
 * first, then the sharer's note.
 */
export function inviteMessage(link: string, note = ''): string {
  const n = note.trim();
  return `Open in Digital Canvas: ${link}${n ? `\n\n${n}` : ''}`;
}

/** A `mailto:` with the link (Quick actions ▸ Email). */
export function mailtoLink(title: string, link: string, from?: string): string {
  const subject = `${from ? `${from} shared` : 'Sharing'} “${title}” with you`;
  const body = `Here's the design “${title}” made in Digital Canvas:\n\n${link}\n`;
  return `mailto:?subject=${enc(subject)}&body=${enc(body)}`;
}
