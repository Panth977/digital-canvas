/**
 * The remote MCP server (OAuth 2.1 + Streamable HTTP), with a fake Google and
 * an in-memory store: discovery from the 401, DCR, authorize → Google →
 * callback, PKCE, refresh rotation with reuse detection, revocation, the
 * Drive-token door the local CLI uses, and a real MCP SDK client round trip.
 * Follows TaskManager's oauth-mcp.emu.test.ts.
 */
import { createHash, randomBytes } from 'node:crypto';
import { mkdtempSync, statSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createRemoteHandler } from '../src/remote/http.ts';
import { decrypt, REFRESH_RETRY_GRACE_MS } from '../src/remote/oauth.ts';
import { MemoryOAuthStore } from '../src/remote/store.ts';
import { loadLogin, login, saveLogin, serverTokenSource, loginFile } from '../src/remote/client.ts';
import { FolderWorkspace } from '../src/workspace.ts';

const CLIENT_ID = 'test-google-client.apps.googleusercontent.com';
const TOKEN_KEY = randomBytes(32).toString('base64');
const REDIRECT = 'https://claude.ai/api/mcp/auth_callback';

// ---- a fake Google token endpoint
const google = { refreshToken: 'g-refresh-1' as string | null, n: 0, invalid: false, sub: '1234567890', scope: 'openid email profile https://www.googleapis.com/auth/drive.file' };
const jwt = (payload: object) => `e30.${Buffer.from(JSON.stringify(payload)).toString('base64url')}.sig`;
const fakeFetch: typeof fetch = async (input, init) => {
  const url = String(input);
  if (url !== 'https://oauth2.googleapis.com/token') throw new Error(`unexpected fetch ${url}`);
  const p = new URLSearchParams(String(init?.body));
  const json = (b: object, status = 200) => new Response(JSON.stringify(b), { status, headers: { 'content-type': 'application/json' } });
  if (p.get('client_secret') !== 'shh') return json({ error: 'invalid_client' }, 401);
  if (p.get('grant_type') === 'authorization_code') {
    return json({ access_token: `g-access-${++google.n}`, expires_in: 3599, scope: google.scope, id_token: jwt({ sub: google.sub, email: 'ada@example.com', name: 'Ada', aud: CLIENT_ID }), ...(google.refreshToken ? { refresh_token: google.refreshToken } : {}) });
  }
  if (p.get('grant_type') === 'refresh_token') {
    if (google.invalid) return json({ error: 'invalid_grant' }, 400);
    return json({ access_token: `g-access-${++google.n}`, expires_in: 3599, scope: google.scope });
  }
  return json({ error: 'unsupported_grant_type' }, 400);
};

let server: Server;
let base = '';
let store: MemoryOAuthStore;
let skew = 0;
const dir = mkdtempSync(join(tmpdir(), 'dc-remote-'));

beforeAll(async () => {
  store = new MemoryOAuthStore();
  const handler = createRemoteHandler({
    store,
    google: { clientId: CLIENT_ID, clientSecret: 'shh', tokenKey: TOKEN_KEY, fetch: fakeFetch },
    workspaceFor: () => new FolderWorkspace(join(dir, 'designs')),
    now: () => Date.now() + skew,
  });
  server = createServer((req, res) => void handler(req, res));
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
  base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
});
afterAll(() => new Promise<void>((r) => server.close(() => r())));
beforeEach(() => { skew = 0; google.invalid = false; google.refreshToken = 'g-refresh-1'; });

const req = (path: string, init: RequestInit = {}) => fetch(path.startsWith('http') ? path : base + path, { redirect: 'manual', ...init });
const form = (body: Record<string, string>) => ({ method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(body).toString() });

/** The person's browser on our consent page: GET authorize, then press a button (with the page's cookie). */
async function consentAt(url: string, action: 'allow' | 'deny' = 'allow', opts: { cookie?: boolean } = {}): Promise<Response> {
  const page = await req(url);
  expect(page.status).toBe(200);
  expect(page.headers.get('x-frame-options')).toBe('DENY');
  const html = await page.text();
  const field = (n: string) => new RegExp(`name="${n}" value="([^"]+)"`).exec(html)![1]!;
  const cookie = page.headers.get('set-cookie')!.split(';')[0]!;
  expect(cookie).toMatch(/^__session=/);
  const f = form({ pending: field('pending'), nonce: field('nonce'), action });
  return req('/oauth/authorize/decide', { ...f, headers: { ...f.headers, ...(opts.cookie === false ? {} : { cookie }) } });
}

function pkce() {
  const verifier = randomBytes(32).toString('base64url');
  return { verifier, challenge: createHash('sha256').update(verifier).digest('base64url') };
}

async function registerClient(name = 'Claude', redirect = REDIRECT): Promise<string> {
  const r = await req('/oauth/register', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ client_name: name, redirect_uris: [redirect] }) });
  expect(r.status).toBe(201);
  return ((await r.json()) as { client_id: string }).client_id;
}

/** authorize → (fake) Google → callback; returns our code. */
async function signIn(clientId: string, challenge: string, scope = 'designs'): Promise<string> {
  const a = await consentAt(`/oauth/authorize?${new URLSearchParams({ client_id: clientId, redirect_uri: REDIRECT, response_type: 'code', code_challenge: challenge, code_challenge_method: 'S256', scope, state: 'st8' })}`);
  expect(a.status).toBe(302);
  const g = new URL(a.headers.get('location')!);
  const cb = await req(`/oauth/google/callback?${new URLSearchParams({ code: 'google-code', state: g.searchParams.get('state')! })}`);
  expect(cb.status).toBe(302);
  const back = new URL(cb.headers.get('location')!);
  expect(back.origin + back.pathname).toBe(REDIRECT);
  expect(back.searchParams.get('state')).toBe('st8');
  return back.searchParams.get('code')!;
}

async function tokens(clientId?: string) {
  const cid = clientId ?? (await registerClient());
  const { verifier, challenge } = pkce();
  const code = await signIn(cid, challenge);
  const r = await req('/oauth/token', form({ grant_type: 'authorization_code', code, client_id: cid, redirect_uri: REDIRECT, code_verifier: verifier }));
  expect(r.status).toBe(200);
  return { clientId: cid, ...((await r.json()) as { access_token: string; refresh_token: string; expires_in: number; scope: string }) };
}

const driveToken = (access: string) => req('/oauth/drive-token', { method: 'POST', headers: { authorization: `Bearer ${access}` } });

describe('discovery', () => {
  it('/mcp without a token answers 401 naming the metadata chain', async () => {
    const r = await req('/mcp', { method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }) });
    expect(r.status).toBe(401);
    const challenge = r.headers.get('www-authenticate') ?? '';
    expect(challenge).not.toMatch(/error=/);
    const m = /resource_metadata="([^"]+)"/.exec(challenge);
    expect(new URL(m![1]!).pathname).toBe('/.well-known/oauth-protected-resource/mcp');
    const prm = (await (await req(new URL(m![1]!).pathname)).json()) as { resource: string; authorization_servers: string[] };
    expect(prm.resource).toBe(`${base}/mcp`);
    expect(prm.authorization_servers).toEqual([base]);
    const as = (await (await req('/.well-known/oauth-authorization-server')).json()) as Record<string, unknown>;
    expect(as).toMatchObject({ issuer: base, code_challenge_methods_supported: ['S256'], grant_types_supported: ['authorization_code', 'refresh_token'], registration_endpoint: `${base}/oauth/register` });
    expect(await (await req('/.well-known/openid-configuration')).json()).toEqual(as);
    const bad = await req('/mcp', { method: 'POST', headers: { authorization: 'Bearer dca_nope', 'content-type': 'application/json' }, body: '{}' });
    expect(bad.status).toBe(401);
    expect(bad.headers.get('www-authenticate')).toMatch(/error="invalid_token"/);
  });
});

describe('OAuth 2.1 with Google sign-in', () => {
  it('DCR refuses unsafe redirect URIs', async () => {
    const r = await req('/oauth/register', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ redirect_uris: ['http://evil.example/cb'] }) });
    expect(r.status).toBe(400);
    expect(await r.json()).toMatchObject({ error: 'invalid_redirect_uri' });
    await registerClient('loopback', 'http://127.0.0.1:9999/callback');
  });

  it('authorize validates, then sends the browser to Google with the right request', async () => {
    const cid = await registerClient();
    const { challenge } = pkce();
    const unknown = await req(`/oauth/authorize?${new URLSearchParams({ client_id: 'dcl_nope', redirect_uri: REDIRECT, code_challenge: challenge })}`);
    expect(unknown.status).toBe(400);
    expect(await unknown.text()).toMatch(/register/);
    const evil = await req(`/oauth/authorize?${new URLSearchParams({ client_id: cid, redirect_uri: 'https://evil.example/cb', code_challenge: challenge })}`);
    expect(evil.status).toBe(400);
    const noPkce = await req(`/oauth/authorize?${new URLSearchParams({ client_id: cid, redirect_uri: REDIRECT, response_type: 'code' })}`);
    expect(noPkce.status).toBe(302);
    expect(new URL(noPkce.headers.get('location')!).searchParams.get('error')).toBe('invalid_request');

    const ok = await consentAt(`/oauth/authorize?${new URLSearchParams({ client_id: cid, redirect_uri: REDIRECT, response_type: 'code', code_challenge: challenge, code_challenge_method: 'S256', scope: 'designs drive.readonly' })}`);
    expect(ok.status).toBe(302);
    const g = new URL(ok.headers.get('location')!);
    expect(g.origin + g.pathname).toBe('https://accounts.google.com/o/oauth2/v2/auth');
    expect(g.searchParams.get('client_id')).toBe(CLIENT_ID);
    expect(g.searchParams.get('redirect_uri')).toBe(`${base}/oauth/google/callback`);
    expect(g.searchParams.get('access_type')).toBe('offline');
    expect(g.searchParams.get('prompt')).toBe('select_account');
    expect(g.searchParams.get('scope')!.split(' ')).toEqual(expect.arrayContaining(['openid', 'email', 'https://www.googleapis.com/auth/drive.file']));
    // an old client asking for the whole Drive still gets drive.file only
    expect(g.searchParams.get('scope')).not.toMatch(/drive\.readonly/);
  });

  it('our consent page names the app; it needs this browser\'s cookie; Cancel goes back with access_denied; Google callback needs approval', async () => {
    const cid = await registerClient('Sneaky App', 'https://sneaky.example/cb');
    const { challenge } = pkce();
    const url = `/oauth/authorize?${new URLSearchParams({ client_id: cid, redirect_uri: 'https://sneaky.example/cb', code_challenge: challenge, state: 'z' })}`;
    const page = await req(url);
    const html = await page.text();
    expect(html).toContain('Sneaky App');
    expect(html).toMatch(/sneaky\.example.*Only continue if you started this/s);
    expect(page.headers.get('content-security-policy')).toMatch(/frame-ancestors 'none'/);
    // a forged submit from another site has no __session cookie
    expect((await consentAt(url, 'allow', { cookie: false })).status).toBe(403);
    const no = await consentAt(url, 'deny');
    expect(no.status).toBe(302);
    const back = new URL(no.headers.get('location')!);
    expect(back.host).toBe('sneaky.example');
    expect(back.searchParams.get('error')).toBe('access_denied');
    expect(back.searchParams.get('state')).toBe('z');
    // skipping our page and going straight to the Google callback does nothing
    const html2 = await (await req(url)).text();
    const pending = /name="pending" value="([^"]+)"/.exec(html2)![1]!;
    expect((await req(`/oauth/google/callback?${new URLSearchParams({ code: 'g', state: pending })}`)).status).toBe(400);
  });

  it('no refresh token from Google and none stored → asks Google again with consent; then keeps it encrypted', async () => {
    google.sub = 'consent-user';
    google.refreshToken = null;
    const cid = await registerClient();
    const { challenge } = pkce();
    const a = await consentAt(`/oauth/authorize?${new URLSearchParams({ client_id: cid, redirect_uri: REDIRECT, code_challenge: challenge, state: 's' })}`);
    const state = new URL(a.headers.get('location')!).searchParams.get('state')!;
    const again = await req(`/oauth/google/callback?${new URLSearchParams({ code: 'c1', state })}`);
    const g = new URL(again.headers.get('location')!);
    expect(g.hostname).toBe('accounts.google.com');
    expect(g.searchParams.get('prompt')).toBe('consent');
    expect(g.searchParams.get('login_hint')).toBe('ada@example.com');
    google.refreshToken = 'g-refresh-consented';
    const done = await req(`/oauth/google/callback?${new URLSearchParams({ code: 'c2', state })}`);
    expect(new URL(done.headers.get('location')!).searchParams.get('code')).toMatch(/^dcc_/);
    const row = await store.getDrive('google:consent-user');
    expect(row!.refreshToken).not.toContain('g-refresh');
    expect(decrypt(row!.refreshToken, TOKEN_KEY)).toBe('g-refresh-consented');
    expect(store.users.get('google:consent-user')).toMatchObject({ email: 'ada@example.com', loginCount: 1 });
    google.sub = '1234567890';
  });

  it('code → tokens with PKCE; a wrong verifier fails and consumes the code', async () => {
    const cid = await registerClient();
    const { verifier, challenge } = pkce();
    const code = await signIn(cid, challenge);
    const wrong = await req('/oauth/token', form({ grant_type: 'authorization_code', code, client_id: cid, redirect_uri: REDIRECT, code_verifier: pkce().verifier }));
    expect(wrong.status).toBe(400);
    expect(await wrong.json()).toMatchObject({ error: 'invalid_grant' });
    const late = await req('/oauth/token', form({ grant_type: 'authorization_code', code, client_id: cid, redirect_uri: REDIRECT, code_verifier: verifier }));
    expect(await late.json()).toMatchObject({ error: 'invalid_grant' });
    const t = await tokens(cid);
    expect(t).toMatchObject({ expires_in: 3600, scope: 'designs' });
    expect(t.access_token).toMatch(/^dca_/);
  });

  it('refresh rotates; a used refresh token after the grace window revokes the whole grant', async () => {
    const t = await tokens();
    const r1 = await req('/oauth/token', form({ grant_type: 'refresh_token', refresh_token: t.refresh_token, client_id: t.clientId }));
    expect(r1.status).toBe(200);
    const t2 = (await r1.json()) as { access_token: string; refresh_token: string };
    expect(t2.refresh_token).not.toBe(t.refresh_token);
    expect((await driveToken(t2.access_token)).status).toBe(200);
    // within the grace window the same token is a retry
    expect((await req('/oauth/token', form({ grant_type: 'refresh_token', refresh_token: t.refresh_token, client_id: t.clientId }))).status).toBe(200);
    skew = REFRESH_RETRY_GRACE_MS + 1000;
    const reuse = await req('/oauth/token', form({ grant_type: 'refresh_token', refresh_token: t.refresh_token, client_id: t.clientId }));
    expect(await reuse.json()).toMatchObject({ error: 'invalid_grant' });
    expect((await driveToken(t2.access_token)).status).toBe(401);
    const r3 = await req('/oauth/token', form({ grant_type: 'refresh_token', refresh_token: t2.refresh_token, client_id: t.clientId }));
    expect(await r3.json()).toMatchObject({ error: 'invalid_grant' });
  });

  it('revoke kills the token', async () => {
    const t = await tokens();
    expect((await driveToken(t.access_token)).status).toBe(200);
    expect((await req('/oauth/revoke', form({ token: t.access_token, client_id: t.clientId }))).status).toBe(200);
    expect((await driveToken(t.access_token)).status).toBe(401);
    // a refresh token takes its grant's tokens with it
    const t2 = await tokens();
    await req('/oauth/revoke', form({ token: t2.refresh_token, client_id: t2.clientId }));
    expect((await driveToken(t2.access_token)).status).toBe(401);
  });

  it('drive-token swaps our token for a Google Drive token; a revoked Google grant asks to sign in again', async () => {
    const t = await tokens();
    const r = await driveToken(t.access_token);
    expect(r.status).toBe(200);
    const j = (await r.json()) as { accessToken: string; expiresIn: number; scope: string };
    expect(j.accessToken).toMatch(/^g-access-/);
    expect(j.scope).toContain('drive.file');
    expect(j.expiresIn).toBeGreaterThan(3000);
    google.invalid = true;
    const gone = await driveToken(t.access_token);
    expect(gone.status).toBe(401);
    expect(await store.getDrive('google:1234567890')).toBeNull();
  });
});

describe('MCP over Streamable HTTP', () => {
  it('a real MCP client lists tools and calls one', async () => {
    const t = await tokens();
    const client = new Client({ name: 'test', version: '1.0.0' });
    await client.connect(new StreamableHTTPClientTransport(new URL(`${base}/mcp`), { requestInit: { headers: { authorization: `Bearer ${t.access_token}` } } }));
    const { tools } = await client.listTools();
    expect(tools.map((x) => x.name)).toEqual(expect.arrayContaining(['list_designs', 'create_design', 'render_page']));
    const r = await client.callTool({ name: 'list_designs', arguments: {} });
    expect(r.isError).toBeFalsy();
    await client.close();
  });
});

describe('local CLI sign-in through the server', () => {
  it('login() runs DCR + PKCE on a loopback port, stores the login 0600, and the token source gets Drive tokens', async () => {
    process.env.DC_CONFIG_DIR = mkdtempSync(join(tmpdir(), 'dc-cfg-'));
    const l = await login(base, {
      // the "browser": follow our authorize → Google (faked) → our callback → the loopback redirect
      openBrowser: (url) => void (async () => {
        const a = await consentAt(url);
        const state = new URL(a.headers.get('location')!).searchParams.get('state')!;
        const cb = await req(`/oauth/google/callback?${new URLSearchParams({ code: 'g', state })}`);
        await fetch(cb.headers.get('location')!);
      })(),
    });
    expect(l.accessToken).toMatch(/^dca_/);
    expect(statSync(loginFile()).mode & 0o777).toBe(0o600);
    expect(statSync(process.env.DC_CONFIG_DIR).mode & 0o777).toBe(0o700);
    expect(loadLogin(base)?.clientId).toBe(l.clientId);
    expect(loadLogin('https://other.example')).toBeNull();
    // an expired access token is refreshed (and the rotated refresh token saved) before asking for Drive
    saveLogin({ ...l, expiresAt: 0 });
    const src = serverTokenSource(base, loadLogin(base)!);
    expect(await src.token()).toMatch(/^g-access-/);
    expect(await src.scope()).toContain('drive.file');
    expect(loadLogin(base)!.refreshToken).not.toBe(l.refreshToken);
    delete process.env.DC_CONFIG_DIR;
  });
});
