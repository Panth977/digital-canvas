/**
 * What the remote server keeps. Everything is behind this interface so the
 * Cloud Function uses Firestore (backend/mcp/src/store.ts) and tests use memory.
 *
 * Tokens are stored by sha256 only. The drive row holds the Google refresh
 * token ENCRYPTED (same format and place, users/{uid}/private/drive, as the
 * web app's googleSignIn function, so both share one Drive connection).
 */

export interface ClientRow {
  id: string;
  name: string;
  redirectUris: string[];
  public: boolean;
  secretHash?: string;
  logoUri?: string;
  createdAt: number;
}

/** An /oauth/authorize request waiting for Google sign-in to come back. */
export interface PendingRow {
  id: string;
  clientId: string;
  redirectUri: string;
  codeChallenge: string;
  state?: string;
  scopes: string[];
  /** Already sent the person back to Google with prompt=consent once. */
  consentTried?: boolean;
  /** Ties the consent form to the browser that saw it (also in the __session cookie). */
  nonce?: string;
  /** The person approved this app on our consent page. */
  approved?: boolean;
  expiresAt: number;
}

export interface TokenRow {
  kind: 'code' | 'access' | 'refresh';
  uid: string;
  grantId: string;
  clientId: string;
  scopes: string[];
  codeChallenge?: string;
  redirectUri?: string;
  expiresAt: number;
  createdAt: number;
  usedAt?: number;
}

export interface GrantRow {
  clientId: string;
  clientName: string;
  scopes: string[];
  createdAt: number;
  lastUsedAt: number;
}

export interface UserInfo {
  email: string;
  name?: string;
  photo?: string;
}

export interface DriveRow {
  /** AES-256-GCM `iv.tag.body` (base64url), see crypto in oauth.ts. */
  refreshToken: string;
  scope: string;
}

export interface OAuthStore {
  getClient(id: string): Promise<ClientRow | null>;
  putClient(row: ClientRow): Promise<void>;

  putPending(row: PendingRow): Promise<void>;
  getPending(id: string): Promise<PendingRow | null>;
  deletePending(id: string): Promise<void>;

  getToken(hash: string): Promise<TokenRow | null>;
  putToken(hash: string, row: TokenRow): Promise<void>;
  deleteToken(hash: string): Promise<void>;
  /** Atomically read and delete (single-use codes). */
  takeToken(hash: string): Promise<TokenRow | null>;
  /** Atomically read and set usedAt when not set yet; returns the row as it was before. */
  markTokenUsed(hash: string, now: number): Promise<TokenRow | null>;
  /** Delete every token issued under a grant. */
  deleteGrantTokens(uid: string, grantId: string): Promise<void>;

  getGrant(uid: string, grantId: string): Promise<GrantRow | null>;
  putGrant(uid: string, grantId: string, row: GrantRow): Promise<void>;
  deleteGrant(uid: string, grantId: string): Promise<void>;

  /** Create or update users/{uid} (like the web sign-in does: login count, last login). */
  upsertUser(uid: string, info: UserInfo): Promise<void>;
  getDrive(uid: string): Promise<DriveRow | null>;
  putDrive(uid: string, row: DriveRow): Promise<void>;
  deleteDrive(uid: string): Promise<void>;
}

/** Everything in memory (tests, a single local server). */
export class MemoryOAuthStore implements OAuthStore {
  clients = new Map<string, ClientRow>();
  pending = new Map<string, PendingRow>();
  tokens = new Map<string, TokenRow>();
  grants = new Map<string, GrantRow>();
  users = new Map<string, UserInfo & { loginCount: number }>();
  drive = new Map<string, DriveRow>();

  async getClient(id: string) { return this.clients.get(id) ?? null; }
  async putClient(row: ClientRow) { this.clients.set(row.id, row); }
  async putPending(row: PendingRow) { this.pending.set(row.id, row); }
  async getPending(id: string) { return this.pending.get(id) ?? null; }
  async deletePending(id: string) { this.pending.delete(id); }
  async getToken(hash: string) { const t = this.tokens.get(hash); return t ? { ...t } : null; }
  async putToken(hash: string, row: TokenRow) { this.tokens.set(hash, { ...row }); }
  async deleteToken(hash: string) { this.tokens.delete(hash); }
  async takeToken(hash: string) { const t = this.tokens.get(hash) ?? null; this.tokens.delete(hash); return t; }
  async markTokenUsed(hash: string, now: number) {
    const t = this.tokens.get(hash);
    if (!t) return null;
    const before = { ...t };
    if (t.usedAt === undefined) t.usedAt = now;
    return before;
  }
  async deleteGrantTokens(uid: string, grantId: string) {
    for (const [k, t] of this.tokens) if (t.uid === uid && t.grantId === grantId) this.tokens.delete(k);
  }
  async getGrant(uid: string, grantId: string) { return this.grants.get(`${uid}/${grantId}`) ?? null; }
  async putGrant(uid: string, grantId: string, row: GrantRow) { this.grants.set(`${uid}/${grantId}`, row); }
  async deleteGrant(uid: string, grantId: string) { this.grants.delete(`${uid}/${grantId}`); }
  async upsertUser(uid: string, info: UserInfo) {
    const u = this.users.get(uid);
    this.users.set(uid, { ...u, ...info, loginCount: (u?.loginCount ?? 0) + 1 });
  }
  async getDrive(uid: string) { return this.drive.get(uid) ?? null; }
  async putDrive(uid: string, row: DriveRow) { this.drive.set(uid, row); }
  async deleteDrive(uid: string) { this.drive.delete(uid); }
}
