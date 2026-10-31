/**
 * The Google Drive connection, all on this machine: consent in the system
 * browser, the refresh token encrypted with the OS keychain (safeStorage),
 * access tokens straight from Google. Nothing passes through our backend.
 */
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { safeStorage, shell } from 'electron';
import { DRIVE_FILE_SCOPE } from '@digital-canvas/backend/google';
import { GOOGLE_ENDPOINTS, OAuthError, idClaims, refreshAccess, runLoopbackFlow, type Flow, type OAuthClient } from './oauth.ts';

declare const __DC_GOOGLE_CLIENT_ID__: string;
declare const __DC_GOOGLE_CLIENT_SECRET__: string;

const client: OAuthClient = { clientId: __DC_GOOGLE_CLIENT_ID__, clientSecret: __DC_GOOGLE_CLIENT_SECRET__ };
/** Identity plus drive.file. drive.install is only for Drive's web "Open with", which can't reach this app. */
const SCOPES = ['openid', 'email', 'profile', DRIVE_FILE_SCOPE];

export interface DriveAccount { uid: string; email: string; name: string; photo?: string }
interface Saved { enc?: string; account: DriveAccount }

export class DriveAuth {
  account: DriveAccount | null = null;
  /** False where the OS has no keychain: the connection then lasts until the app quits. */
  persisted = true;
  private refresh: string | null = null;
  private access: { value: string; expires: number } | null = null;
  private flow: Flow | null = null;
  private enc: string | undefined;
  private file: string;

  constructor(dir: string, private onChange: () => void) {
    this.file = join(dir, 'drive.json');
    try {
      const s = JSON.parse(readFileSync(this.file, 'utf8')) as Saved;
      this.account = s.account;
      this.enc = s.enc;
    } catch { /* not connected */ }
  }

  get configured(): boolean { return !!(client.clientId && client.clientSecret); }
  get connected(): boolean { return !!this.account; }
  get connecting(): boolean { return !!this.flow; }

  private canEncrypt(): boolean {
    if (!safeStorage.isEncryptionAvailable()) return false;
    return process.platform !== 'linux' || safeStorage.getSelectedStorageBackend() !== 'basic_text';
  }

  private save(): void {
    this.persisted = this.canEncrypt();
    this.enc = this.persisted && this.refresh ? safeStorage.encryptString(this.refresh).toString('base64') : undefined;
    if (!this.persisted) { rmSync(this.file, { force: true }); return; }
    writeFileSync(this.file, JSON.stringify({ enc: this.enc, account: this.account } satisfies Saved), { mode: 0o600 });
  }

  async connect(hint?: string): Promise<DriveAccount> {
    if (!this.configured) throw new Error('This build has no Google client, so it can’t connect to Drive. Your folder keeps working.');
    this.flow?.abort();
    const flow = runLoopbackFlow({ endpoints: GOOGLE_ENDPOINTS, client, scopes: SCOPES, ...(hint ? { hint } : {}), open: (u) => void shell.openExternal(u) });
    this.flow = flow;
    this.onChange();
    try {
      const t = await flow.result;
      if (!(t.scope ?? '').split(' ').includes(DRIVE_FILE_SCOPE)) throw new Error('Google did not give Digital Canvas access to its files in your Drive. Connect again and tick the box “See, edit, create and delete only the specific Google Drive files you use with this app”.');
      if (!t.refresh_token) throw new Error('Google sent no refresh token. Please connect again.');
      const c = idClaims(t.id_token);
      this.refresh = t.refresh_token;
      this.access = { value: t.access_token, expires: Date.now() + t.expires_in * 1000 };
      this.account = { uid: `google:${c.sub ?? 'me'}`, email: c.email ?? '', name: c.name ?? c.email ?? 'You', ...(c.picture ? { photo: c.picture } : {}) };
      this.save();
      return this.account;
    } finally {
      if (this.flow === flow) this.flow = null;
      this.onChange();
    }
  }

  cancel(): void { this.flow?.abort(); }

  private refreshToken(): string {
    if (!this.refresh && this.enc) this.refresh = safeStorage.decryptString(Buffer.from(this.enc, 'base64'));
    if (!this.refresh) throw new Error('Google Drive is not connected.');
    return this.refresh;
  }

  /** An access token, renewed a minute before it expires. */
  async token(force = false): Promise<string> {
    if (!force && this.access && this.access.expires - 60_000 > Date.now()) return this.access.value;
    try {
      const t = await refreshAccess(GOOGLE_ENDPOINTS, client, this.refreshToken());
      this.access = { value: t.access_token, expires: Date.now() + t.expires_in * 1000 };
      return t.access_token;
    } catch (e) {
      if (e instanceof OAuthError && e.code === 'invalid_grant') {
        await this.disconnect(false);
        throw new Error('Google Drive access was revoked. Connect it again in Settings.');
      }
      throw e;
    }
  }

  async disconnect(revoke = true): Promise<void> {
    let token: string | null = null;
    try { token = this.refreshToken(); } catch { /* nothing to revoke */ }
    this.refresh = null;
    this.enc = undefined;
    this.access = null;
    this.account = null;
    if (existsSync(this.file)) rmSync(this.file, { force: true });
    this.onChange();
    if (revoke && token) await fetch(`${GOOGLE_ENDPOINTS.revoke}?token=${encodeURIComponent(token)}`, { method: 'POST' }).catch(() => {});
  }
}
