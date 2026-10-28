/**
 * The remote MCP server as one Node request handler (works as a Firebase
 * `onRequest` handler and in a plain `node:http` server):
 *
 *   GET  /.well-known/oauth-protected-resource[/mcp]   RFC 9728
 *   GET  /.well-known/oauth-authorization-server       RFC 8414 (+ /openid-configuration)
 *   POST /oauth/register        RFC 7591 dynamic client registration
 *   GET  /oauth/authorize       → Google sign-in
 *   GET  /oauth/google/callback ← Google; → the client's redirect_uri with our code
 *   POST /oauth/token           authorization_code + PKCE S256 | refresh_token
 *   POST /oauth/revoke          RFC 7009
 *   POST /oauth/drive-token     our access token → a Google Drive access token (the local CLI signs in through us)
 *   POST /mcp                   MCP Streamable HTTP, stateless, JSON responses
 *
 * An MCP client's first call to /mcp gets 401 + WWW-Authenticate naming the
 * protected-resource metadata → AS metadata → DCR → authorize (Google) →
 * token. Nobody pastes a key.
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import '../node/index.ts';
import { createServer } from '../server.ts';
import type { JobRunner } from '../jobs.ts';
import { DriveWorkspace, type Workspace } from '../workspace.ts';
import {
  AuthorizePageError, GOOGLE_AUTH, GOOGLE_SCOPES, GOOGLE_TOKEN, OAuthError, SCOPES, TTL, approve, authenticateClient, base62,
  checkAuthorizeRequest, decrypt, encrypt, exchangeCode, idClaims, isAllowedRedirectUri, loadClient, redirectWith, refresh, registerClient, revokeToken, verifyAccess,
} from './oauth.ts';
import type { OAuthStore } from './store.ts';
import { Relay } from '../bridge/relay.ts';
import type { BridgeStore } from '../bridge/store.ts';

export interface GoogleConfig {
  clientId: string;
  clientSecret: string;
  /** base64 of 32 bytes (Secret Manager TOKEN_KEY). */
  tokenKey: string;
  /** Injectable for tests. */
  fetch?: typeof fetch;
}

export interface RemoteOptions {
  /** e.g. https://digital-canvas-p977.web.app (default: from x-forwarded-host / host). */
  publicBase?: string;
  store: OAuthStore;
  google: GoogleConfig;
  /** Default: the user's Google Drive. */
  workspaceFor?: (uid: string, driveToken: () => Promise<string>, scope: string) => Workspace;
  /** Long exports; a function gets the signed-in uid (task queues need it). */
  jobs?: JobRunner | ((uid: string) => JobRunner);
  editorUrl?: string;
  now?: () => number;
  /**
   * Device bridge: tool calls run on the user's own device (relayed through
   * this mailbox) unless the user is allowlisted for cloud processing and
   * chose it. Without it every call runs here (the local CLI, older setups).
   */
  bridge?: { store: BridgeStore; allowlist: readonly string[]; pickupMs?: number; callMs?: number };
}

type Req = IncomingMessage & { body?: unknown; rawBody?: Buffer };

const CORS: Record<string, string> = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET, POST, DELETE, OPTIONS',
  'access-control-allow-headers': 'authorization, content-type, mcp-protocol-version, mcp-session-id',
  'access-control-expose-headers': 'www-authenticate, mcp-session-id',
  'access-control-max-age': '600',
};

function send(res: ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}): void {
  const isText = typeof body === 'string';
  res.writeHead(status, { ...CORS, 'cache-control': 'no-store', 'content-type': isText ? 'text/html; charset=utf-8' : 'application/json', ...headers });
  res.end(body === null ? undefined : isText ? body : JSON.stringify(body));
}

function redirect(res: ServerResponse, to: string): void {
  res.writeHead(302, { location: to, 'cache-control': 'no-store' });
  res.end();
}

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
const page = (title: string, msg: string) => `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>${esc(title)}</title>
<body style="font:16px system-ui;max-width:520px;margin:12vh auto;padding:0 20px;color:#1f2328"><h1 style="font-size:22px">${esc(title)}</h1><p>${esc(msg)}</p>
<p style="color:#666;font-size:14px">Digital Canvas · connect your AI</p></body>`;

/** "<app> wants to use Digital Canvas" — shown before Google sign-in. */
function consentPage(client: string, host: string, pending: string, nonce: string): string {
  const known = /(^|\.)(claude\.ai|anthropic\.com)$/.test(host) || /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/.test(host);
  return `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Connect ${esc(client)} to Digital Canvas</title>
<body style="font:16px/1.5 system-ui;max-width:520px;margin:10vh auto;padding:0 20px;color:#1f2328">
<h1 style="font-size:22px">Connect <b>${esc(client)}</b> to Digital Canvas?</h1>
<p>It will be able to:</p>
<ul><li>create, edit, export and delete designs in your <b>Digital Canvas</b> folder in Google Drive</li><li>use your uploads, brand kit and the Drive files you picked in Digital Canvas</li></ul>
<p style="color:${known ? '#555' : '#b42318'}">It will return to <b>${esc(host)}</b>.${known ? '' : ' Only continue if you started this from that app.'}</p>
<form method="post" action="/oauth/authorize/decide" style="display:flex;gap:12px;margin-top:24px">
<input type="hidden" name="pending" value="${esc(pending)}"><input type="hidden" name="nonce" value="${esc(nonce)}">
<button name="action" value="allow" style="font:inherit;padding:10px 20px;border:0;border-radius:8px;background:#5b3df5;color:#fff;cursor:pointer">Continue with Google</button>
<button name="action" value="deny" style="font:inherit;padding:10px 20px;border:1px solid #ccc;border-radius:8px;background:#fff;cursor:pointer">Cancel</button>
</form>
<p style="color:#666;font-size:14px;margin-top:32px">You can disconnect any time in the AI app, or remove Digital Canvas at myaccount.google.com/permissions.</p></body>`;
}

async function rawBody(req: Req): Promise<string> {
  if (req.rawBody) return req.rawBody.toString('utf8');
  if (req.body !== undefined) return typeof req.body === 'string' ? req.body : Buffer.isBuffer(req.body) ? req.body.toString('utf8') : JSON.stringify(req.body);
  const chunks: Buffer[] = [];
  let n = 0;
  for await (const c of req) { n += (c as Buffer).length; if (n > 4 * 1024 * 1024) throw new OAuthError('invalid_request', 'Body too large', 413); chunks.push(c as Buffer); }
  return Buffer.concat(chunks).toString('utf8');
}

/** Form-encoded or JSON body as a flat string map. */
async function params(req: Req): Promise<Record<string, string>> {
  if (req.body && typeof req.body === 'object' && !Buffer.isBuffer(req.body) && !req.rawBody) {
    return Object.fromEntries(Object.entries(req.body as Record<string, unknown>).map(([k, v]) => [k, typeof v === 'string' ? v : JSON.stringify(v)]));
  }
  const text = await rawBody(req);
  if ((req.headers['content-type'] ?? '').includes('application/json')) {
    try {
      const j = JSON.parse(text || '{}') as Record<string, unknown>;
      return Object.fromEntries(Object.entries(j).map(([k, v]) => [k, typeof v === 'string' ? v : JSON.stringify(v)]));
    } catch { throw new OAuthError('invalid_request', 'Body is not valid JSON'); }
  }
  return Object.fromEntries(new URLSearchParams(text));
}

function clientCredentials(req: Req, p: Record<string, string>): { clientId: string | null; secret: string | null } {
  const basic = /^Basic\s+(.+)$/i.exec(req.headers.authorization ?? '');
  if (basic) {
    const [id, secret] = Buffer.from(basic[1]!, 'base64').toString('utf8').split(':');
    return { clientId: decodeURIComponent(id ?? ''), secret: decodeURIComponent(secret ?? '') };
  }
  return { clientId: p.client_id ?? null, secret: p.client_secret ?? null };
}

const bearer = (req: Req) => /^Bearer\s+(.+)$/i.exec(req.headers.authorization ?? '')?.[1]?.trim() ?? null;

export function createRemoteHandler(opts: RemoteOptions): (req: IncomingMessage, res: ServerResponse) => Promise<void> {
  const store = opts.store;
  const g = opts.google;
  const f = g.fetch ?? fetch;
  const now = opts.now ?? Date.now;
  const driveCache = new Map<string, { token: string; exp: number; scope: string }>();

  const baseOf = (req: Req) => {
    if (opts.publicBase) return opts.publicBase.replace(/\/$/, '');
    const host = String(req.headers['x-forwarded-host'] ?? req.headers.host ?? 'localhost').split(',')[0]!.trim();
    const proto = String(req.headers['x-forwarded-proto'] ?? (/^(localhost|127\.0\.0\.1)(:|$)/.test(host) ? 'http' : 'https')).split(',')[0]!.trim();
    return `${proto}://${host}`;
  };

  async function googleToken(p: Record<string, string>): Promise<Record<string, unknown>> {
    const r = await f(GOOGLE_TOKEN, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ client_id: g.clientId, client_secret: g.clientSecret, ...p }).toString() });
    return (await r.json()) as Record<string, unknown>;
  }

  function googleUrl(base: string, pendingId: string, consent: boolean, hint?: string): string {
    const scopes = GOOGLE_SCOPES;
    const q = new URLSearchParams({
      client_id: g.clientId, redirect_uri: `${base}/oauth/google/callback`, response_type: 'code', scope: scopes.join(' '),
      access_type: 'offline', include_granted_scopes: 'true', prompt: consent ? 'consent' : 'select_account', state: pendingId,
    });
    if (hint) q.set('login_hint', hint);
    return `${GOOGLE_AUTH}?${q}`;
  }

  class NeedsAuth extends Error {}

  /** A Google Drive access token for `uid` (cached until a minute before it expires). */
  async function driveToken(uid: string, force = false): Promise<{ token: string; exp: number; scope: string }> {
    const hit = driveCache.get(uid);
    if (hit && !force && hit.exp - 60_000 > now()) return hit;
    const row = await store.getDrive(uid);
    if (!row) throw new NeedsAuth('drive-not-connected');
    const t = await googleToken({ refresh_token: decrypt(row.refreshToken, g.tokenKey), grant_type: 'refresh_token' });
    if (t.error === 'invalid_grant') {
      await store.deleteDrive(uid);
      driveCache.delete(uid);
      throw new NeedsAuth('drive-revoked');
    }
    if (typeof t.access_token !== 'string') throw new Error(`Google token refresh failed: ${String(t.error_description ?? t.error ?? 'unknown')}`);
    const out = { token: t.access_token, exp: now() + Number(t.expires_in ?? 3600) * 1000, scope: String(t.scope ?? row.scope ?? '') };
    driveCache.set(uid, out);
    return out;
  }

  function unauthorized(req: Req, res: ServerResponse, invalid: boolean, desc?: string): void {
    const base = baseOf(req);
    const parts = [`resource_metadata="${base}/.well-known/oauth-protected-resource/mcp"`, `scope="${SCOPES.join(' ')}"`];
    if (invalid) parts.unshift('error="invalid_token"', `error_description="${(desc ?? 'The access token is invalid or expired').replace(/"/g, "'")}"`);
    send(res, 401, { error: invalid ? 'invalid_token' : 'unauthorized', error_description: desc ?? 'Sign in: see WWW-Authenticate' }, { 'www-authenticate': `Bearer ${parts.join(', ')}` });
  }

  const resourceMeta = (base: string) => ({
    resource: `${base}/mcp`, authorization_servers: [base], scopes_supported: [...SCOPES], bearer_methods_supported: ['header'],
    resource_name: 'Digital Canvas', resource_documentation: 'https://github.com/Panth977/digital-canvas/tree/main/packages/mcp',
  });
  const asMeta = (base: string) => ({
    issuer: base,
    authorization_endpoint: `${base}/oauth/authorize`,
    token_endpoint: `${base}/oauth/token`,
    registration_endpoint: `${base}/oauth/register`,
    revocation_endpoint: `${base}/oauth/revoke`,
    scopes_supported: [...SCOPES],
    response_types_supported: ['code'],
    response_modes_supported: ['query'],
    grant_types_supported: ['authorization_code', 'refresh_token'],
    code_challenge_methods_supported: ['S256'],
    token_endpoint_auth_methods_supported: ['none', 'client_secret_post', 'client_secret_basic'],
    revocation_endpoint_auth_methods_supported: ['none', 'client_secret_post', 'client_secret_basic'],
  });

  async function oauthRoute(req: Req, res: ServerResponse, path: string, url: URL): Promise<boolean> {
    const base = baseOf(req);
    const m = req.method ?? 'GET';
    if (path.startsWith('/.well-known/oauth-protected-resource') && m === 'GET') { send(res, 200, resourceMeta(base)); return true; }
    if ((path.startsWith('/.well-known/oauth-authorization-server') || path === '/.well-known/openid-configuration') && m === 'GET') { send(res, 200, asMeta(base)); return true; }

    if (path === '/oauth/register' && m === 'POST') {
      let raw: Record<string, unknown>;
      try { raw = JSON.parse((await rawBody(req)) || '{}') as Record<string, unknown>; } catch { throw new OAuthError('invalid_client_metadata', 'Body is not valid JSON'); }
      const uris = raw.redirect_uris;
      if (!Array.isArray(uris) || !uris.length || uris.length > 10 || uris.some((u) => typeof u !== 'string' || u.length > 2000)) throw new OAuthError('invalid_client_metadata', 'redirect_uris: 1 to 10 URLs are required');
      const bad = (uris as string[]).filter((u) => !isAllowedRedirectUri(u));
      if (bad.length) throw new OAuthError('invalid_redirect_uri', `Not an allowed redirect URI: ${bad.join(', ')}`);
      const grants = raw.grant_types;
      if (Array.isArray(grants) && grants.some((x) => !['authorization_code', 'refresh_token'].includes(String(x)))) throw new OAuthError('invalid_client_metadata', 'Only authorization_code and refresh_token grants are supported');
      const method = typeof raw.token_endpoint_auth_method === 'string' ? raw.token_endpoint_auth_method : 'none';
      if (!['none', 'client_secret_post', 'client_secret_basic'].includes(method)) throw new OAuthError('invalid_client_metadata', 'Unsupported token_endpoint_auth_method');
      const name = (typeof raw.client_name === 'string' && raw.client_name.trim().slice(0, 120)) || new URL(uris[0] as string).host || 'Unnamed app';
      const logo = typeof raw.logo_uri === 'string' && raw.logo_uri.startsWith('https://') ? raw.logo_uri : undefined;
      const { clientId, clientSecret } = await registerClient(store, { name, redirectUris: uris as string[], confidential: method !== 'none', ...(logo ? { logoUri: logo } : {}) }, now());
      send(res, 201, {
        client_id: clientId, ...(clientSecret ? { client_secret: clientSecret, client_secret_expires_at: 0 } : {}), client_id_issued_at: Math.floor(now() / 1000),
        client_name: name, redirect_uris: uris, token_endpoint_auth_method: method, grant_types: ['authorization_code', 'refresh_token'], response_types: ['code'], ...(logo ? { logo_uri: logo } : {}),
      });
      return true;
    }

    if (path === '/oauth/authorize' && m === 'GET') {
      const q = Object.fromEntries(url.searchParams);
      let checked;
      try {
        checked = await checkAuthorizeRequest(store, q);
      } catch (e) {
        if (e instanceof AuthorizePageError) { send(res, 400, page('Cannot connect this app', e.message)); return true; }
        if (e instanceof OAuthError) {
          const client = await store.getClient(q.client_id ?? '');
          const ru = q.redirect_uri ?? (client?.redirectUris.length === 1 ? client.redirectUris[0] : undefined);
          if (client && ru && client.redirectUris.includes(ru)) { redirect(res, redirectWith(ru, { error: e.error, error_description: e.description, state: q.state, iss: base })); return true; }
          send(res, 400, page('Cannot connect this app', e.description));
          return true;
        }
        throw e;
      }
      const id = base62(32);
      const nonce = base62(32);
      await store.putPending({ id, clientId: checked.client.id, redirectUri: checked.redirectUri, codeChallenge: q.code_challenge!, ...(q.state ? { state: q.state } : {}), scopes: checked.scopes, nonce, expiresAt: now() + TTL.pending });
      // Our own consent step BEFORE Google: anyone can register a client (DCR), so the person must
      // see which app is asking (MCP security best practice for servers with a static upstream client).
      // The form is tied to this browser by a cookie (__session: the only cookie Firebase Hosting forwards).
      const secure = base.startsWith('https:') ? '; Secure' : '';
      send(res, 200, consentPage(checked.client.name, new URL(checked.redirectUri).host, id, nonce), {
        'set-cookie': `__session=${nonce}; Path=/oauth; HttpOnly; SameSite=Lax; Max-Age=900${secure}`,
        'x-frame-options': 'DENY',
        'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'; frame-ancestors 'none'",
        'referrer-policy': 'no-referrer',
      });
      return true;
    }

    if (path === '/oauth/authorize/decide' && m === 'POST') {
      const f = await params(req);
      const p = f.pending ? await store.getPending(f.pending) : null;
      if (!p || p.expiresAt <= now() || p.approved) { send(res, 400, page('Sign-in expired', 'This link has expired. Go back to your AI app and connect again.')); return true; }
      const cookie = /(?:^|;\s*)__session=([^;]+)/.exec(String(req.headers.cookie ?? ''))?.[1];
      if (!p.nonce || f.nonce !== p.nonce || cookie !== p.nonce) { send(res, 403, page('Cannot connect this app', 'Please start again from your AI app (this confirmation must come from the same browser that showed it).')); return true; }
      if (f.action !== 'allow') {
        await store.deletePending(p.id);
        redirect(res, redirectWith(p.redirectUri, { error: 'access_denied', error_description: 'The person declined', state: p.state, iss: base }));
        return true;
      }
      await store.putPending({ ...p, approved: true });
      redirect(res, googleUrl(base, p.id, false));
      return true;
    }

    if (path === '/oauth/google/callback' && m === 'GET') {
      const pendingId = url.searchParams.get('state') ?? '';
      const p = pendingId ? await store.getPending(pendingId) : null;
      if (!p || p.expiresAt <= now() || !p.approved) { send(res, 400, page('Sign-in expired', 'This sign-in link has expired. Go back to your AI app and connect again.')); return true; }
      const back = (params: Record<string, string | undefined>) => redirect(res, redirectWith(p.redirectUri, { ...params, state: p.state, iss: base }));
      const gErr = url.searchParams.get('error');
      if (gErr) { await store.deletePending(p.id); back({ error: 'access_denied', error_description: gErr === 'access_denied' ? 'Sign-in was cancelled' : gErr }); return true; }
      const code = url.searchParams.get('code');
      if (!code) { await store.deletePending(p.id); back({ error: 'server_error', error_description: 'Google sent no code' }); return true; }
      const t = await googleToken({ code, grant_type: 'authorization_code', redirect_uri: `${base}/oauth/google/callback` });
      if (typeof t.id_token !== 'string' || typeof t.access_token !== 'string') { await store.deletePending(p.id); back({ error: 'access_denied', error_description: String(t.error_description ?? t.error ?? 'Google rejected the sign-in') }); return true; }
      const claims = idClaims(t.id_token);
      if (claims.aud !== g.clientId || !claims.email) { await store.deletePending(p.id); back({ error: 'server_error', error_description: 'ID token is not for this app' }); return true; }
      const scope = String(t.scope ?? '');
      if (!scope.split(' ').includes(GOOGLE_SCOPES[3]!)) { await store.deletePending(p.id); back({ error: 'access_denied', error_description: 'Digital Canvas needs access to the files it creates in your Drive (tick the Drive box)' }); return true; }
      const uid = `google:${claims.sub}`;
      if (typeof t.refresh_token === 'string') {
        await store.putDrive(uid, { refreshToken: encrypt(t.refresh_token, g.tokenKey), scope });
        driveCache.delete(uid);
      } else if (!(await store.getDrive(uid))) {
        // Google returns a refresh token only with fresh consent: ask once more, with consent.
        if (!p.consentTried) {
          await store.putPending({ ...p, consentTried: true });
          redirect(res, googleUrl(base, p.id, true, claims.email));
          return true;
        }
        if (!(await store.getDrive(uid))) { await store.deletePending(p.id); back({ error: 'access_denied', error_description: 'Google did not grant offline Drive access' }); return true; }
      }
      await store.deletePending(p.id);
      await store.upsertUser(uid, { email: claims.email, ...(claims.name ? { name: claims.name } : {}), ...(claims.picture ? { photo: claims.picture } : {}) });
      const client = await store.getClient(p.clientId);
      if (!client) { send(res, 400, page('Cannot connect this app', 'The app is no longer registered.')); return true; }
      const ourCode = await approve(store, { uid, client, scopes: p.scopes, redirectUri: p.redirectUri, codeChallenge: p.codeChallenge, now: now() });
      back({ code: ourCode });
      return true;
    }

    if (path === '/oauth/token' && m === 'POST') {
      const p = await params(req);
      const { clientId, secret } = clientCredentials(req, p);
      const client = await loadClient(store, clientId);
      authenticateClient(client, secret);
      let pair;
      if (p.grant_type === 'authorization_code') {
        if (!p.code) throw new OAuthError('invalid_request', 'code is required');
        pair = await exchangeCode(store, { code: p.code, clientId: client.id, redirectUri: p.redirect_uri ?? null, verifier: p.code_verifier ?? null, now: now() });
      } else if (p.grant_type === 'refresh_token') {
        if (!p.refresh_token) throw new OAuthError('invalid_request', 'refresh_token is required');
        pair = await refresh(store, { token: p.refresh_token, clientId: client.id, scope: p.scope ?? null, now: now() });
      } else throw new OAuthError('unsupported_grant_type', 'Use authorization_code or refresh_token');
      send(res, 200, pair, { pragma: 'no-cache' });
      return true;
    }

    if (path === '/oauth/revoke' && m === 'POST') {
      const p = await params(req);
      if (!p.token) throw new OAuthError('invalid_request', 'token is required');
      const { clientId, secret } = clientCredentials(req, p);
      if (clientId) authenticateClient(await loadClient(store, clientId), secret);
      await revokeToken(store, p.token, clientId);
      send(res, 200, {});
      return true;
    }

    if (path === '/oauth/drive-token' && m === 'POST') {
      const tok = bearer(req);
      const row = tok ? await verifyAccess(store, tok, now()) : null;
      if (!row) { unauthorized(req, res, !!tok); return true; }
      try {
        const d = await driveToken(row.uid, true);
        send(res, 200, { accessToken: d.token, expiresIn: Math.max(0, Math.round((d.exp - now()) / 1000)), scope: d.scope });
      } catch (e) {
        if (e instanceof NeedsAuth) { unauthorized(req, res, true, 'Google Drive is no longer connected: sign in again'); return true; }
        throw e;
      }
      return true;
    }
    return false;
  }

  async function mcpRoute(req: Req, res: ServerResponse): Promise<void> {
    const tok = bearer(req);
    const row = tok ? await verifyAccess(store, tok, now()) : null;
    if (!row) return unauthorized(req, res, !!tok);
    const b = opts.bridge;
    const relay = b ? new Relay({ store: b.store, uid: row.uid, allowlist: b.allowlist, now, ...(b.pickupMs ? { pickupMs: b.pickupMs } : {}), ...(b.callMs ? { callMs: b.callMs } : {}) }) : undefined;
    const cloud = relay ? (await relay.mode()).mode === 'cloud' : true;
    // Cloud processing needs a Drive token now (and re-auth when it was revoked); in device mode the
    // device brings its own, and the relay only touches Drive for the rare design resource read.
    let scope: string | undefined;
    if (cloud) {
      try { scope = (await driveToken(row.uid)).scope; } catch (e) {
        if (e instanceof NeedsAuth) return unauthorized(req, res, true, 'Google Drive is no longer connected: sign in again');
        throw e;
      }
    }
    const tokenSource = async (force?: boolean) => (await driveToken(row.uid, !!force)).token;
    const ws = opts.workspaceFor ? opts.workspaceFor(row.uid, () => tokenSource(), scope ?? '') : new DriveWorkspace(tokenSource, scope);
    const jobs = typeof opts.jobs === 'function' ? opts.jobs(row.uid) : opts.jobs;
    const server = createServer(ws, { mode: 'remote', ...(jobs ? { jobs } : {}), ...(opts.editorUrl ? { editorUrl: opts.editorUrl } : {}), ...(relay ? { relay } : {}) });
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
    res.on('close', () => { void transport.close(); void server.close(); });
    await server.connect(transport);
    let body: unknown;
    if (req.method === 'POST') {
      const text = await rawBody(req);
      try { body = text ? JSON.parse(text) : undefined; } catch { body = undefined; }
    }
    for (const [k, v] of Object.entries(CORS)) res.setHeader(k, v);
    await transport.handleRequest(req, res, body);
  }

  return async (req0, res) => {
    const req = req0 as Req;
    const url = new URL(req.url ?? '/', 'http://x');
    const path = url.pathname.replace(/\/+$/, '') || '/';
    try {
      if (req.method === 'OPTIONS') return send(res, 204, null);
      if (path === '/mcp') return await mcpRoute(req, res);
      if (await oauthRoute(req, res, path, url)) return;
      send(res, 404, { error: 'not_found', error_description: `No route ${req.method} ${path}` });
    } catch (e) {
      if (e instanceof OAuthError) return send(res, e.status, { error: e.error, error_description: e.description }, e.status === 401 ? { 'www-authenticate': 'Basic realm="oauth"' } : {});
      console.error('[mcp]', e);
      if (!res.headersSent) send(res, 500, { error: 'server_error', error_description: e instanceof Error ? e.message : 'internal error' });
      else res.end();
    }
  };
}
