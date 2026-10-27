/**
 * OAuth 2.1 authorization server for the remote MCP endpoint (the same shape
 * as TaskManager's, see tracker/backend/src/platform/oauth.ts), with Google as
 * the identity: /oauth/authorize sends the person to Google, the Google
 * callback keeps their Drive refresh token (encrypted) and hands the MCP
 * client an authorization code of ours.
 *
 *   code     60 s, single use, bound to client + redirect_uri + PKCE S256
 *   access   1 h
 *   refresh  30 d, rotated on every use; a rotated one presented again after
 *            REFRESH_RETRY_GRACE_MS is theft → the whole grant is revoked.
 */
import { createCipheriv, createDecipheriv, createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import type { OAuthStore, ClientRow, TokenRow } from './store.ts';

export const TTL = { code: 60_000, access: 3600_000, refresh: 30 * 86400_000, pending: 15 * 60_000 };
export const REFRESH_RETRY_GRACE_MS = 60_000;
export const PREFIX = { access: 'dca_', refresh: 'dcr_', code: 'dcc_', client: 'dcl_', secret: 'dcs_' } as const;

/** Scopes this server understands. `designs` = everything the tools do; `drive.readonly` also searches the whole Drive. */
export const SCOPES = ['designs', 'drive.readonly'] as const;
export const GOOGLE_SCOPES = ['openid', 'email', 'profile', 'https://www.googleapis.com/auth/drive.file'];
export const DRIVE_READONLY = 'https://www.googleapis.com/auth/drive.readonly';
export const GOOGLE_AUTH = 'https://accounts.google.com/o/oauth2/v2/auth';
export const GOOGLE_TOKEN = 'https://oauth2.googleapis.com/token';

export class OAuthError extends Error {
  constructor(readonly error: string, readonly description: string, readonly status = 400) {
    super(description);
  }
}

// ---- crypto ----

const ALNUM = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
export const base62 = (n: number) => Array.from(randomBytes(n), (b) => ALNUM[b % 62]).join('');
export const sha256hex = (s: string) => createHash('sha256').update(s).digest('hex');
export const sha256b64url = (s: string) => createHash('sha256').update(s).digest('base64url');
export function safeEqual(a: string, b: string): boolean {
  const x = Buffer.from(a), y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

function key(tokenKey: string): Buffer {
  const k = Buffer.from(tokenKey, 'base64');
  if (k.length !== 32) throw new Error('TOKEN_KEY is not set (32 bytes, base64)');
  return k;
}

/** Same format as backend/functions googleSignIn: base64url iv.tag.body, AES-256-GCM. */
export function encrypt(text: string, tokenKey: string): string {
  const iv = randomBytes(12);
  const c = createCipheriv('aes-256-gcm', key(tokenKey), iv);
  const body = Buffer.concat([c.update(text, 'utf8'), c.final()]);
  return [iv, c.getAuthTag(), body].map((b) => b.toString('base64url')).join('.');
}

export function decrypt(blob: string, tokenKey: string): string {
  const [iv, tag, body] = blob.split('.').map((s) => Buffer.from(s, 'base64url'));
  const d = createDecipheriv('aes-256-gcm', key(tokenKey), iv!);
  d.setAuthTag(tag!);
  return Buffer.concat([d.update(body!), d.final()]).toString('utf8');
}

// ---- requests ----

/** https, loopback http (native apps), or a private-use scheme. */
export function isAllowedRedirectUri(u: string): boolean {
  let url: URL;
  try { url = new URL(u); } catch { return false; }
  if (url.hash) return false;
  if (url.protocol === 'https:') return true;
  if (url.protocol === 'http:') return ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  return /^[a-z][a-z0-9+.-]*:$/.test(url.protocol) && !['javascript:', 'data:', 'file:', 'vbscript:', 'blob:'].includes(url.protocol);
}

/** Known scopes from a `scope` string; generic OIDC ones and unknown words are ignored. Empty = designs. */
export function parseScopes(s: string | null | undefined): string[] {
  const words = (s ?? '').split(/[\s,+]+/).filter(Boolean);
  const out = new Set<string>(['designs']);
  for (const w of words) if (w === 'drive.readonly' || w === 'drive:all' || w === DRIVE_READONLY) out.add('drive.readonly');
  return [...out];
}

export async function loadClient(store: OAuthStore, clientId: string | null | undefined): Promise<ClientRow> {
  if (!clientId || clientId.includes('/')) throw new OAuthError('invalid_client', 'Unknown client', 401);
  const c = await store.getClient(clientId);
  if (!c) throw new OAuthError('invalid_client', 'Unknown client', 401);
  return c;
}

export function authenticateClient(client: ClientRow, secret: string | null | undefined): void {
  if (client.public) return;
  if (!secret || !client.secretHash || !safeEqual(sha256hex(secret), client.secretHash)) throw new OAuthError('invalid_client', 'Client authentication failed', 401);
}

export async function registerClient(store: OAuthStore, input: { name: string; redirectUris: string[]; confidential: boolean; logoUri?: string }, now: number): Promise<{ clientId: string; clientSecret?: string }> {
  const clientId = PREFIX.client + base62(24);
  const clientSecret = input.confidential ? PREFIX.secret + base62(40) : undefined;
  await store.putClient({
    id: clientId, name: input.name, redirectUris: input.redirectUris, public: !input.confidential,
    ...(clientSecret ? { secretHash: sha256hex(clientSecret) } : {}), ...(input.logoUri ? { logoUri: input.logoUri } : {}), createdAt: now,
  });
  return { clientId, ...(clientSecret ? { clientSecret } : {}) };
}

/** Thrown for a bad client or redirect: shown as an error page, never redirected (no open redirector). */
export class AuthorizePageError extends Error {}

export async function checkAuthorizeRequest(store: OAuthStore, p: Record<string, string | undefined>): Promise<{ client: ClientRow; redirectUri: string; scopes: string[] }> {
  const client = await store.getClient(p.client_id ?? '');
  if (!client) throw new AuthorizePageError('Unknown client_id: the app must register first.');
  const redirectUri = p.redirect_uri ?? (client.redirectUris.length === 1 ? client.redirectUris[0]! : '');
  if (!client.redirectUris.includes(redirectUri)) throw new AuthorizePageError('redirect_uri is not registered for this client.');
  if (p.response_type !== undefined && p.response_type !== 'code') throw new OAuthError('unsupported_response_type', 'Only response_type=code is supported');
  if (!p.code_challenge || (p.code_challenge_method ?? 'S256') !== 'S256' || !/^[A-Za-z0-9_-]{43}$/.test(p.code_challenge)) throw new OAuthError('invalid_request', 'PKCE with code_challenge_method=S256 is required');
  return { client, redirectUri, scopes: parseScopes(p.scope) };
}

export function redirectWith(uri: string, params: Record<string, string | null | undefined>): string {
  const u = new URL(uri);
  for (const [k, v] of Object.entries(params)) if (v !== null && v !== undefined) u.searchParams.set(k, v);
  return u.toString();
}

/** The person signed in with Google: upsert the grant and mint a 60 s code. */
export async function approve(store: OAuthStore, o: { uid: string; client: ClientRow; scopes: string[]; redirectUri: string; codeChallenge: string; now: number }): Promise<string> {
  const grantId = o.client.id;
  const prev = await store.getGrant(o.uid, grantId);
  await store.putGrant(o.uid, grantId, { clientId: o.client.id, clientName: o.client.name, scopes: o.scopes, createdAt: prev?.createdAt ?? o.now, lastUsedAt: o.now });
  const code = PREFIX.code + base62(32);
  await store.putToken(sha256hex(code), { kind: 'code', uid: o.uid, grantId, clientId: o.client.id, scopes: o.scopes, codeChallenge: o.codeChallenge, redirectUri: o.redirectUri, expiresAt: o.now + TTL.code, createdAt: o.now });
  return code;
}

export interface TokenPair { access_token: string; token_type: 'Bearer'; expires_in: number; refresh_token: string; scope: string }

async function mintPair(store: OAuthStore, base: Pick<TokenRow, 'uid' | 'grantId' | 'clientId' | 'scopes'>, now: number): Promise<TokenPair> {
  const access = PREFIX.access + base62(40), refresh = PREFIX.refresh + base62(48);
  await store.putToken(sha256hex(access), { ...base, kind: 'access', expiresAt: now + TTL.access, createdAt: now });
  await store.putToken(sha256hex(refresh), { ...base, kind: 'refresh', expiresAt: now + TTL.refresh, createdAt: now });
  return { access_token: access, token_type: 'Bearer', expires_in: TTL.access / 1000, refresh_token: refresh, scope: base.scopes.join(' ') };
}

export async function exchangeCode(store: OAuthStore, o: { code: string; clientId: string; redirectUri: string | null; verifier: string | null; now: number }): Promise<TokenPair> {
  if (!o.verifier || !/^[A-Za-z0-9\-._~]{43,128}$/.test(o.verifier)) throw new OAuthError('invalid_request', 'code_verifier is required (PKCE S256)');
  const row = await store.takeToken(sha256hex(o.code)); // single use, whatever happens next
  if (!row || row.kind !== 'code') throw new OAuthError('invalid_grant', 'Unknown or used authorization code');
  if (row.expiresAt <= o.now) throw new OAuthError('invalid_grant', 'Authorization code expired');
  if (row.clientId !== o.clientId) throw new OAuthError('invalid_grant', 'Code was issued to another client');
  if (row.redirectUri && o.redirectUri !== row.redirectUri) throw new OAuthError('invalid_grant', 'redirect_uri does not match the authorization request');
  if (!row.codeChallenge || !safeEqual(sha256b64url(o.verifier), row.codeChallenge)) throw new OAuthError('invalid_grant', 'PKCE verification failed');
  if (!(await store.getGrant(row.uid, row.grantId))) throw new OAuthError('invalid_grant', 'The grant was revoked');
  return mintPair(store, row, o.now);
}

export async function refresh(store: OAuthStore, o: { token: string; clientId: string; scope: string | null; now: number }): Promise<TokenPair> {
  const hash = sha256hex(o.token);
  const row = await store.getToken(hash);
  if (!row || row.kind !== 'refresh') throw new OAuthError('invalid_grant', 'Unknown refresh token');
  if (row.clientId !== o.clientId) throw new OAuthError('invalid_grant', 'Token was issued to another client');
  const before = await store.markTokenUsed(hash, o.now);
  if (!before) throw new OAuthError('invalid_grant', 'Unknown refresh token');
  const retry = before.usedAt !== undefined && o.now - before.usedAt <= REFRESH_RETRY_GRACE_MS;
  if (before.usedAt !== undefined && !retry) {
    // THEFT DETECTION: an already-rotated refresh token came back.
    await store.deleteGrantTokens(row.uid, row.grantId);
    await store.deleteGrant(row.uid, row.grantId);
    throw new OAuthError('invalid_grant', 'Refresh token reuse detected: the app must be connected again');
  }
  if (row.expiresAt <= o.now) throw new OAuthError('invalid_grant', 'Refresh token expired');
  const grant = await store.getGrant(row.uid, row.grantId);
  if (!grant) throw new OAuthError('invalid_grant', 'The grant was revoked');
  const asked = o.scope ? parseScopes(o.scope) : row.scopes;
  if (asked.some((s) => !row.scopes.includes(s))) throw new OAuthError('invalid_scope', 'A refresh cannot add scopes');
  await store.putGrant(row.uid, row.grantId, { ...grant, lastUsedAt: o.now });
  return mintPair(store, { uid: row.uid, grantId: row.grantId, clientId: row.clientId, scopes: asked }, o.now);
}

/** RFC 7009: unknown tokens are not an error; a refresh token takes its grant's tokens with it. */
export async function revokeToken(store: OAuthStore, token: string, clientId: string | null): Promise<void> {
  const hash = sha256hex(token);
  const row = await store.getToken(hash);
  if (!row) return;
  if (clientId && row.clientId !== clientId) return;
  if (row.kind === 'refresh') await store.deleteGrantTokens(row.uid, row.grantId);
  else await store.deleteToken(hash);
}

/** A bearer access token → who it acts for, or null. */
export async function verifyAccess(store: OAuthStore, token: string, now: number): Promise<TokenRow | null> {
  if (!token.startsWith(PREFIX.access)) return null;
  const row = await store.getToken(sha256hex(token));
  if (!row || row.kind !== 'access' || row.expiresAt <= now) return null;
  if (!(await store.getGrant(row.uid, row.grantId))) return null;
  return row;
}

/** ID token claims (it comes straight from Google's token endpoint over TLS, as in googleSignIn). */
export function idClaims(idToken: string): { sub: string; email: string; email_verified?: boolean; name?: string; picture?: string; aud: string } {
  return JSON.parse(Buffer.from(idToken.split('.')[1] ?? '', 'base64url').toString('utf8'));
}
