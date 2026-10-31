/**
 * Google OAuth for installed apps: authorization code + PKCE (RFC 7636), the
 * consent screen in the system browser, the code back through a one-shot
 * loopback listener (RFC 8252). No Electron here, so it is unit tested.
 */
import { createHash, randomBytes } from 'node:crypto';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';

export interface OAuthEndpoints { auth: string; token: string; revoke: string }
export const GOOGLE_ENDPOINTS: OAuthEndpoints = {
  auth: 'https://accounts.google.com/o/oauth2/v2/auth',
  token: 'https://oauth2.googleapis.com/token',
  revoke: 'https://oauth2.googleapis.com/revoke',
};

export interface OAuthClient { clientId: string; clientSecret: string }

const b64url = (b: Buffer) => b.toString('base64url');

/** RFC 7636: 32 random bytes → a 43-character verifier; challenge = BASE64URL(SHA256(verifier)). */
export function pkcePair(): { verifier: string; challenge: string } {
  const verifier = b64url(randomBytes(32));
  return { verifier, challenge: challengeOf(verifier) };
}
export const challengeOf = (verifier: string): string => b64url(createHash('sha256').update(verifier).digest());

export function authUrl(ep: OAuthEndpoints, o: { clientId: string; redirectUri: string; scopes: string[]; state: string; challenge: string; hint?: string }): string {
  const q = new URLSearchParams({
    client_id: o.clientId, redirect_uri: o.redirectUri, response_type: 'code', scope: o.scopes.join(' '), state: o.state,
    code_challenge: o.challenge, code_challenge_method: 'S256', access_type: 'offline', prompt: 'consent',
  });
  if (o.hint) q.set('login_hint', o.hint);
  return `${ep.auth}?${q}`;
}

export interface TokenReply { access_token: string; expires_in: number; refresh_token?: string; id_token?: string; scope?: string }
export class OAuthError extends Error {
  constructor(readonly code: string, message: string) { super(message); }
}

async function tokenCall(ep: OAuthEndpoints, body: Record<string, string>): Promise<TokenReply> {
  const r = await fetch(ep.token, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(body) });
  const j = (await r.json().catch(() => ({}))) as TokenReply & { error?: string; error_description?: string };
  if (!r.ok || !j.access_token) throw new OAuthError(j.error ?? `http_${r.status}`, j.error_description ?? j.error ?? `Google answered ${r.status}`);
  return j;
}

export const exchangeCode = (ep: OAuthEndpoints, c: OAuthClient, code: string, verifier: string, redirectUri: string) =>
  tokenCall(ep, { grant_type: 'authorization_code', code, code_verifier: verifier, redirect_uri: redirectUri, client_id: c.clientId, client_secret: c.clientSecret });

export const refreshAccess = (ep: OAuthEndpoints, c: OAuthClient, refreshToken: string) =>
  tokenCall(ep, { grant_type: 'refresh_token', refresh_token: refreshToken, client_id: c.clientId, client_secret: c.clientSecret });

/** The id token came straight from Google over TLS, so its claims are read without checking the signature (OIDC core 3.1.3.7). */
export function idClaims(idToken: string | undefined): { sub?: string; email?: string; name?: string; picture?: string } {
  try { return JSON.parse(Buffer.from(idToken!.split('.')[1]!, 'base64url').toString('utf8')); } catch { return {}; }
}

const PAGE = (title: string, text: string) => `<!doctype html><meta charset="utf-8"><title>${title}</title><style>body{font:16px system-ui;display:grid;place-items:center;height:90vh;color:#222}</style><div><h2>${title}</h2><p>${text}</p></div>`;

export interface Flow { abort(): void; result: Promise<TokenReply> }

/**
 * Listen on 127.0.0.1:<any free port>, send the user to Google, take the one
 * redirect whose `state` matches, exchange the code. Requests with another
 * state are ignored, so a stray page can't end or poison the flow.
 */
export function runLoopbackFlow(o: { endpoints: OAuthEndpoints; client: OAuthClient; scopes: string[]; hint?: string; open: (url: string) => void; timeoutMs?: number }): Flow {
  const { verifier, challenge } = pkcePair();
  const state = b64url(randomBytes(24));
  let abort = () => {};
  const result = new Promise<TokenReply>((resolve, reject) => {
    let redirectUri = '';
    const server = createServer((req, res) => {
      const u = new URL(req.url ?? '/', 'http://127.0.0.1');
      if (u.pathname !== '/callback' || u.searchParams.get('state') !== state) { res.writeHead(404).end(); return; }
      const error = u.searchParams.get('error'), code = u.searchParams.get('code');
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', connection: 'close' });
      if (error || !code) {
        res.end(PAGE('Not connected', 'You can close this tab and go back to Digital Canvas.'));
        finish(() => reject(new OAuthError(error ?? 'no_code', error === 'access_denied' ? 'Google access was not granted.' : `Google said: ${error ?? 'no code'}`)));
        return;
      }
      res.end(PAGE('Connected', 'You can close this tab and go back to Digital Canvas.'));
      finish(() => exchangeCode(o.endpoints, o.client, code, verifier, redirectUri).then(resolve, reject));
    });
    const timer = setTimeout(() => finish(() => reject(new OAuthError('timeout', 'Google sign-in timed out. Please try again.'))), o.timeoutMs ?? 5 * 60_000);
    let done = false;
    function finish(then: () => void): void {
      if (done) return;
      done = true;
      clearTimeout(timer);
      server.close();
      server.closeAllConnections?.();
      then();
    }
    abort = () => finish(() => reject(new OAuthError('cancelled', 'Cancelled.')));
    server.on('error', (e) => finish(() => reject(e)));
    server.listen(0, '127.0.0.1', () => {
      redirectUri = `http://127.0.0.1:${(server.address() as AddressInfo).port}/callback`;
      o.open(authUrl(o.endpoints, { clientId: o.client.clientId, redirectUri, scopes: o.scopes, state, challenge, ...(o.hint ? { hint: o.hint } : {}) }));
    });
  });
  return { result, abort: () => abort() };
}
