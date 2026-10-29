import type { Page, Route } from '@playwright/test';

/**
 * A small in-memory Google Drive v3 behind page.route, enough for the app's
 * design store (app folder, assets folder, multipart uploads) and for picked
 * files (metadata, downloads, thumbnails).
 */
export interface FakeFile {
  id: string;
  name: string;
  mimeType: string;
  parents?: string[];
  appProperties?: Record<string, string>;
  trashed?: boolean;
  owned?: boolean;
  modifiedTime?: string;
  thumbnailLink?: string;
  imageMediaMetadata?: { width: number; height: number };
  body?: Buffer;
  /** Earlier contents, oldest first (Drive revisions). */
  revisions?: { id: string; modifiedTime: string; body: Buffer }[];
  /** Sharing (permissions API). Owned files start with the signed-in tester as owner. */
  perms?: FakePerm[];
  /** drive.file: the app may not see this file with OAuth yet (shared with you, never opened); the Picker grants it. */
  noAccess?: boolean;
  /** Your role on a file shared with you (capabilities). */
  myRole?: 'writer' | 'commenter' | 'reader';
  /** Owner of a file shared with you. */
  ownerName?: string;
  ownerEmail?: string;
  /**
   * Two-user mode: the owner's email. When set, access is per caller (the
   * bearer token picks the user): the file is visible only to users in
   * `grants` (drive.file: the app created it for them, or they picked it /
   * opened it with the app) who also have a permission on it; anything else
   * is a 404, like Drive. Writes need owner or writer (403 otherwise).
   */
  owner?: string;
  grants?: string[];
}

/** A signed-in person in two-user tests. */
export interface FakeUser { uid: string; email: string; name: string; token: string }

export const OWNER: FakeUser = { uid: 'google:100', email: 'panth@example.com', name: 'Panth', token: 'token-owner' };
export const RECIPIENT: FakeUser = { uid: 'google:200', email: 'harshil@example.com', name: 'Harshil', token: 'token-recipient' };

export interface FakePerm { id: string; type: 'user' | 'anyone'; role: string; emailAddress?: string; displayName?: string; allowFileDiscovery?: boolean }

/** The fake signed-in user (fakeSignIn). */
export const ME = { name: 'Tester', email: 'tester@example.com' };

export const FOLDER = 'application/vnd.google-apps.folder';

export class FakeDrive {
  files = new Map<string, FakeFile>();
  /** Requests seen, "METHOD path?q". */
  log: string[] = [];
  /** permissions.* calls with their query (sendNotificationEmail, emailMessage) and body. */
  permCalls: { method: string; fileId: string; query: Record<string, string>; body?: any }[] = [];
  /** Drive reads made with the API key (`?key=`), by file id. */
  keyReads: string[] = [];
  private n = 0;
  thumb: Buffer = Buffer.alloc(0);
  /** token → user (two-user mode). Unknown tokens act as the legacy single tester. */
  users = new Map<string, FakeUser>();
  /** Like `log`, prefixed with the caller's email ('key' for API-key reads). */
  calls: string[] = [];
  /** ms to wait before each file download (progress screenshots). */
  mediaDelay = 0;
  /** Requests answered 404/403 because the caller had no access, "email METHOD fileId status". */
  denied: string[] = [];

  addUser(u: FakeUser): FakeUser {
    this.users.set(u.token, u);
    return u;
  }

  /** drive.file grant: the user picked the file in the Picker or opened it with the app from Drive. */
  grant(email: string, fileId: string): void {
    const f = this.files.get(fileId);
    if (f && !(f.grants ??= []).includes(email)) f.grants.push(email);
  }

  /** The caller's role on a two-user file (null: no permission at all). */
  roleOf(f: FakeFile, email: string | null): string | null {
    if (!email) return null;
    if (f.owner === email) return 'owner';
    const perms = this.permsOf(f);
    const mine = perms.find((p) => p.type === 'user' && p.emailAddress === email);
    if (mine) return mine.role;
    return perms.find((p) => p.type === 'anyone')?.role ?? null;
  }

  /** The app may see this two-user file with this user's OAuth token. */
  visible(f: FakeFile, email: string | null): boolean {
    return !!email && (f.grants ?? []).includes(email) && this.roleOf(f, email) !== null;
  }

  /** Files of one user (two-user mode), e.g. their designs. */
  ownedBy(email: string): FakeFile[] {
    return [...this.files.values()].filter((f) => f.owner === email);
  }

  add(f: Omit<FakeFile, 'id'> & { id?: string }): FakeFile {
    const file: FakeFile = { id: f.id ?? `f${++this.n}`, owned: true, trashed: false, modifiedTime: new Date().toISOString(), appProperties: {}, ...f };
    this.files.set(file.id, file);
    return file;
  }

  private match(f: FakeFile, q: string, caller: string | null = null): boolean {
    if (f.owner !== undefined && !this.visible(f, caller)) return false; // drive.file: lists only files granted to the app
    if (/trashed\s*=\s*false/.test(q) && f.trashed) return false;
    const parent = /'([^']+)' in parents/.exec(q)?.[1];
    if (parent && !(f.parents ?? []).includes(parent)) return false;
    const mine = f.owner !== undefined ? f.owner === caller : f.owned;
    if (/'me' in owners/.test(q) && !mine) return false;
    if (/^sharedWithMe/.test(q) && mine) return false;
    const media = [...q.matchAll(/mimeType contains '([^']+)'/g)].map((m) => m[1]!);
    const exact = /mimeType\s*=\s*'([^']+)'/.exec(q)?.[1];
    if (media.length) {
      // browsing: usable media, plus folders when the query asks for them
      if (!media.some((m) => f.mimeType.startsWith(m)) && !(exact === FOLDER && f.mimeType === FOLDER)) return false;
    } else if (exact && f.mimeType !== exact) return false;
    const name = /name contains '((?:[^'\\]|\\.)*)'/.exec(q)?.[1];
    if (name && !f.name.toLowerCase().includes(name.replace(/\\(.)/g, '$1').toLowerCase())) return false;
    for (const m of q.matchAll(/key='([^']+)' and value='([^']*)'/g)) if (f.appProperties?.[m[1]!] !== m[2]) return false;
    return true;
  }

  private meta(f: FakeFile) {
    const { body, owned, trashed, grants, owner, revisions, perms, ...rest } = f;
    return { ...rest, ...(body ? { size: String(body.length) } : {}) };
  }

  private userName(email: string): string {
    return [...this.users.values()].find((u) => u.email === email)?.name ?? email.split('@')[0]!;
  }

  permsOf(f: FakeFile): FakePerm[] {
    if (f.owner !== undefined) {
      f.perms ??= [{ id: 'p-owner', type: 'user', role: 'owner', emailAddress: f.owner, displayName: this.userName(f.owner) }];
      return f.perms;
    }
    f.perms ??= f.owned ? [{ id: 'p-owner', type: 'user', role: 'owner', emailAddress: ME.email, displayName: ME.name }] : [{ id: 'p-owner', type: 'user', role: 'owner', emailAddress: f.ownerEmail ?? 'ann@example.com', displayName: f.ownerName ?? 'Ann' }];
    return f.perms;
  }

  /** The file has a `type: anyone` permission (readable with the API key). */
  isPublic(f: FakeFile): boolean {
    return (f.perms ?? []).some((p) => p.type === 'anyone');
  }

  private access(f: FakeFile, caller: string | null = null) {
    const perms = this.permsOf(f);
    const owner = perms.find((p) => p.role === 'owner')!;
    const two = f.owner !== undefined;
    const owned = two ? f.owner === caller : !!f.owned;
    const role = two ? this.roleOf(f, caller) ?? 'reader' : f.owned ? 'owner' : f.myRole ?? (this.isPublic(f) ? perms.find((p) => p.type === 'anyone')!.role : 'reader');
    return {
      id: f.id, name: f.name, ownedByMe: owned, shared: perms.some((p) => p.role !== 'owner'),
      owners: [{ displayName: owner.displayName, emailAddress: owner.emailAddress }],
      ...(owned ? {} : { sharingUser: { displayName: owner.displayName, emailAddress: owner.emailAddress } }),
      capabilities: { canEdit: role === 'owner' || role === 'writer', canComment: role !== 'reader', canShare: role === 'owner' || role === 'writer', canCopy: true, canDownload: true },
    };
  }

  async install(page: Page): Promise<void> {
    await page.route('https://lh3.googleusercontent.com/**', (r) => r.fulfill({ body: this.thumb, contentType: 'image/png' }));
    await page.route('https://www.googleapis.com/**', (r) => this.handle(r));
  }

  private parseMultipart(buf: Buffer, ct: string): { meta: Record<string, any>; body: Buffer } {
    const boundary = /boundary=(\S+)/.exec(ct)![1]!;
    const text = buf.toString('latin1');
    const first = text.indexOf('\r\n\r\n') + 4;
    const metaEnd = text.indexOf(`\r\n--${boundary}`, first);
    const meta = JSON.parse(Buffer.from(text.slice(first, metaEnd), 'latin1').toString('utf8'));
    const start = text.indexOf('\r\n\r\n', metaEnd) + 4;
    const end = text.lastIndexOf(`\r\n--${boundary}--`);
    return { meta, body: buf.subarray(start, end) };
  }

  private async handle(route: Route): Promise<void> {
    const req = route.request();
    const url = new URL(req.url());
    const json = (v: unknown, status = 200) => route.fulfill({ status, body: JSON.stringify(v), contentType: 'application/json', headers: { 'access-control-allow-origin': '*' } });
    this.log.push(`${req.method()} ${url.pathname}${url.searchParams.get('q') ? `?${url.searchParams.get('q')}` : ''}${url.searchParams.get('pageToken') ? ` page=${url.searchParams.get('pageToken')}` : ''}`);
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' } });
    const bearer = /^Bearer (.+)$/.exec(req.headers()['authorization'] ?? '')?.[1];
    const user = bearer ? this.users.get(bearer) : undefined;
    /** Two-user mode: who is calling (null = API key / no token). Legacy tokens: the single tester. */
    const caller = user?.email ?? (bearer ? ME.email : null);
    const fresh = user ? { owner: user.email, grants: [user.email] } : {};
    this.calls.push(`${caller ?? 'key'} ${this.log[this.log.length - 1]}`);
    const id = /\/files\/([^/?]+)/.exec(url.pathname)?.[1];
    if (url.pathname === '/drive/v3/drives') return json({ drives: [] });
    if (url.pathname === '/drive/v3/files' && req.method() === 'GET') {
      const q = url.searchParams.get('q') ?? '';
      let all = [...this.files.values()].filter((f) => this.match(f, q, caller));
      if ((url.searchParams.get('orderBy') ?? '').startsWith('folder')) all = [...all.filter((f) => f.mimeType === FOLDER), ...all.filter((f) => f.mimeType !== FOLDER)];
      const size = Number(url.searchParams.get('pageSize') ?? 100);
      const from = Number(url.searchParams.get('pageToken') ?? 0);
      const page = all.slice(from, from + size);
      return json({ files: page.map((f) => this.meta(f)), ...(from + size < all.length ? { nextPageToken: String(from + size) } : {}) });
    }
    if (url.pathname === '/drive/v3/files' && req.method() === 'POST') return json({ id: this.add({ parents: ['root'], ...req.postDataJSON(), ...fresh }).id });
    if (url.pathname.startsWith('/upload/drive/v3/files')) {
      const { meta, body } = this.parseMultipart(req.postDataBuffer()!, req.headers()['content-type']!);
      const modifiedTime = new Date(Date.now() + this.n++).toISOString();
      if (id) {
        const f = this.files.get(id);
        if (!f || (f.owner !== undefined && !this.visible(f, caller))) { this.denied.push(`${caller} PUT ${id} 404`); return json({ error: { message: `File not found: ${id}.` } }, 404); }
        const r = f.owner !== undefined ? this.roleOf(f, caller) : 'owner';
        if (r !== 'owner' && r !== 'writer') { this.denied.push(`${caller} PUT ${id} 403`); return json({ error: { message: 'The user does not have sufficient permissions for this file.' } }, 403); }
        Object.assign(f, meta, { body, modifiedTime, appProperties: { ...f.appProperties, ...meta.appProperties } });
        (f.revisions ??= []).push({ id: `r${this.n++}`, modifiedTime, body });
        return json({ id });
      }
      return json({ id: this.add({ parents: ['root'], ...meta, ...fresh, body, modifiedTime, revisions: [{ id: `r${this.n++}`, modifiedTime, body }] }).id });
    }
    const f = id ? this.files.get(id) : undefined;
    if (!f) return json({ error: { message: 'File not found' } }, 404);
    // the API key reads only files shared "anyone with the link"; OAuth only files the app may see (drive.file)
    const key = url.searchParams.get('key');
    if (key) {
      if (req.method() !== 'GET' || !this.isPublic(f)) return json({ error: { message: 'File not found' } }, 404);
      this.keyReads.push(f.id);
    } else if (f.noAccess) return json({ error: { message: `File not found: ${f.id}.` } }, 404);
    else if (f.owner !== undefined && !this.visible(f, caller)) {
      this.denied.push(`${caller} ${req.method()} ${f.id} 404`);
      return json({ error: { message: `File not found: ${f.id}.` } }, 404);
    }
    const role = f.owner !== undefined ? (key ? 'reader' : this.roleOf(f, caller)) : null;
    const perm = /\/permissions(?:\/([^/?]+))?$/.exec(url.pathname);
    if (perm) {
      const perms = this.permsOf(f);
      const query = Object.fromEntries(url.searchParams);
      const body = req.method() === 'POST' || req.method() === 'PATCH' ? req.postDataJSON() : undefined;
      if (req.method() !== 'GET') this.permCalls.push({ method: req.method(), fileId: f.id, query, body });
      const mayShare = f.owner !== undefined ? role === 'owner' || role === 'writer' : f.owned || f.myRole === 'writer';
      if (req.method() === 'GET' && !perm[1]) return json({ permissions: perms });
      if (!mayShare) return json({ error: { message: 'The user does not have sufficient permissions for this file.' } }, 403);
      if (req.method() === 'POST') {
        if (body.type === 'user' && !/^[^@\s]+@[^@\s]+\.\w+$/.test(body.emailAddress ?? '')) return json({ error: { message: 'Bad Request. User message: "Invalid email address."' } }, 400);
        const existing = perms.find((p) => (body.type === 'anyone' ? p.type === 'anyone' : p.emailAddress === body.emailAddress));
        if (existing) { existing.role = body.role; return json(existing); }
        const p: FakePerm = body.type === 'anyone'
          ? { id: 'anyoneWithLink', type: 'anyone', role: body.role, allowFileDiscovery: body.allowFileDiscovery }
          : { id: `p${++this.n}`, type: 'user', role: body.role, emailAddress: body.emailAddress, displayName: body.emailAddress.split('@')[0] };
        perms.push(p);
        return json(p);
      }
      const p = perms.find((x) => x.id === perm[1]);
      if (!p) return json({ error: { message: 'Permission not found' } }, 404);
      if (req.method() === 'PATCH') { p.role = body.role; return json(p); }
      if (req.method() === 'DELETE') { f.perms = perms.filter((x) => x !== p); return route.fulfill({ status: 204, headers: { 'access-control-allow-origin': '*' } }); }
    }
    const rev = /\/revisions(?:\/([^/?]+))?$/.exec(url.pathname);
    if (rev && !rev[1]) return json({ revisions: (f.revisions ?? []).map((r) => ({ id: r.id, modifiedTime: r.modifiedTime, size: String(r.body.length) })) });
    if (rev) {
      const r = f.revisions?.find((x) => x.id === rev[1]);
      return r ? route.fulfill({ body: r.body, headers: { 'access-control-allow-origin': '*' } }) : json({ error: { message: 'Revision not found' } }, 404);
    }
    if (url.searchParams.get('alt') === 'media') {
      if (this.mediaDelay) await new Promise((r) => setTimeout(r, this.mediaDelay));
      return route.fulfill({ body: f.body ?? Buffer.alloc(0), headers: { 'access-control-allow-origin': '*', 'access-control-expose-headers': 'content-length' } });
    }
    if (req.method() === 'PATCH') {
      if (f.owner !== undefined && role !== 'owner' && role !== 'writer') { this.denied.push(`${caller} PATCH ${f.id} 403`); return json({ error: { message: 'The user does not have sufficient permissions for this file.' } }, 403); }
      const { appProperties, ...rest } = req.postDataJSON();
      Object.assign(f, rest);
      for (const [k, v] of Object.entries((appProperties ?? {}) as Record<string, string | null>)) {
        if (v === null) delete f.appProperties![k];
        else f.appProperties![k] = v;
      }
      return json({ id });
    }
    if ((url.searchParams.get('fields') ?? '').includes('capabilities')) return json(this.access(f, key ? null : caller));
    return json(this.meta(f));
  }
}

/**
 * Pretend to be signed in (no Firebase, no Google): a user and a cached drive.file access token.
 * `who`: a two-user test's person (OWNER / RECIPIENT); default the single tester.
 * `scope`: the token's scopes (default drive.file + drive.install, as a fresh sign-in has).
 */
export async function fakeSignIn(page: Page, who?: FakeUser | string[], scope?: string): Promise<void> {
  const u = who && !Array.isArray(who) ? who : { uid: 'google:1', email: ME.email, name: ME.name, token: 'fake-token' };
  await page.waitForFunction(() => (window as any).__account?.known);
  await page.evaluate(([u, scope]) => {
    const a = (window as any).__account;
    a.token = { value: u.token, expires: Date.now() + 3600_000 };
    a.scope = scope;
    a.user = { uid: u.uid, email: u.email, name: u.name };
  }, [u, scope ?? 'openid email profile https://www.googleapis.com/auth/drive.file https://www.googleapis.com/auth/drive.install'] as const);
}
