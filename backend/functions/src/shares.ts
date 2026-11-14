// "Shared with you" without listing Drive: drive.file can't see "Shared with me", so the backend
// keeps a small inbox per email. Entries mirror real Drive permissions, read with the caller's
// own token (pure helpers here; Firestore and fetch are passed in so tests need neither).
import { createHash } from 'node:crypto';

export const emailKey = (email: string) => createHash('sha256').update(email.trim().toLowerCase()).digest('hex');

/** Google's OpenID userinfo answer for the caller's access token (openid + email scopes, both always granted at sign-in). */
export interface UserInfo { email?: string; email_verified?: boolean | string; error?: string; error_description?: string }

/** The token's verified account email, lower-cased, or null. */
export function tokenEmail(u: UserInfo): string | null {
  if (u.error || u.error_description) return null;
  if (!u.email || !(u.email_verified === true || u.email_verified === 'true')) return null;
  return u.email.toLowerCase();
}

export interface DrivePerm { type: string; role: string; emailAddress?: string; deleted?: boolean }
export interface DriveFileInfo {
  id: string; name?: string; trashed?: boolean;
  owners?: { displayName?: string; emailAddress?: string }[];
  appProperties?: Record<string, string>;
  permissions?: DrivePerm[];
}

export interface InboxEntry { fileId: string; docId?: string; title: string; role: string; ownerName?: string; ownerEmail?: string }

/** Who should see this design in "Shared with you": every person with access except its owners. */
export function inboxFor(f: DriveFileInfo): Map<string, InboxEntry> {
  const out = new Map<string, InboxEntry>();
  if (f.trashed) return out;
  const owners = new Set((f.owners ?? []).map((o) => o.emailAddress?.toLowerCase()).filter(Boolean));
  const owner = f.owners?.[0];
  const title = (f.name ?? 'Design').replace(/\.dcanvas$/i, '');
  for (const p of f.permissions ?? []) {
    if (p.type !== 'user' || p.deleted || !p.emailAddress || p.role === 'owner') continue;
    const email = p.emailAddress.toLowerCase();
    if (owners.has(email)) continue;
    out.set(email, {
      fileId: f.id, title, role: p.role,
      ...(f.appProperties?.dcDocId ? { docId: f.appProperties.dcDocId } : {}),
      ...(owner?.displayName ? { ownerName: owner.displayName } : {}),
      ...(owner?.emailAddress ? { ownerEmail: owner.emailAddress } : {}),
    });
  }
  return out;
}

/** A design file of ours (not a picture, a folder or someone's Google Doc). */
export const isDesign = (f: DriveFileInfo) => !!f.appProperties?.dcDocId || /\.dcanvas$/i.test(f.name ?? '');
