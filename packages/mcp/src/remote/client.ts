/**
 * Signing the LOCAL server (npx @digital-canvas/mcp) in through the Digital
 * Canvas server, so the user's machine never holds the Google client secret:
 *
 *   const login = (await loadLogin(base)) ?? await login(base, { scopes: ['drive.readonly'] });
 *   const src = serverTokenSource(base, login);
 *   new DriveWorkspace(src.token, await src.scope());
 *
 * `login` runs the native-app OAuth flow against our authorization server
 * (dynamic client registration with a loopback redirect, PKCE S256, browser,
 * one-shot local callback server, code exchange). Our tokens are kept in
 * `<config>/mcp-login.json` (mode 0600, folder 0700), where <config> is
 * $DC_CONFIG_DIR, else $XDG_CONFIG_HOME/digital-canvas, else ~/.config/digital-canvas.
 * `serverTokenSource` refreshes our access token (saving the rotated refresh
 * token) and swaps it for a Google Drive access token at /oauth/drive-token,
 * cached until a minute before it expires.
 */
import { spawn } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { TokenSource } from '@digital-canvas/storage';

export const DEFAULT_SERVER = 'https://digital-canvas-p977.web.app';

export interface StoredLogin {
  server: string;
  clientId: string;
  accessToken: string;
  refreshToken: string;
  /** ms epoch */
  expiresAt: number;
  scope: string;
}

export function configDir(): string {
  if (process.env.DC_CONFIG_DIR) return process.env.DC_CONFIG_DIR;
  if (process.env.XDG_CONFIG_HOME) return join(process.env.XDG_CONFIG_HOME, 'digital-canvas');
  return join(homedir(), '.config', 'digital-canvas');
}

export const loginFile = () => join(configDir(), 'mcp-login.json');

export function saveLogin(l: StoredLogin): void {
  const dir = configDir();
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const f = loginFile();
  writeFileSync(f, JSON.stringify(l, null, 1), { mode: 0o600 });
  chmodSync(f, 0o600);
}

export function loadLogin(server?: string): StoredLogin | null {
  try {
    const l = JSON.parse(readFileSync(loginFile(), 'utf8')) as StoredLogin;
    if (!l.refreshToken || (server && l.server.replace(/\/$/, '') !== server.replace(/\/$/, ''))) return null;
    return l;
  } catch { return null; }
}

export function clearLogin(): void {
  if (existsSync(loginFile())) rmSync(loginFile());
}

function defaultOpen(url: string): void {
  const cmd = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'cmd' : 'xdg-open';
  const args = process.platform === 'win32' ? ['/c', 'start', '', url] : [url];
  try { spawn(cmd, args, { stdio: 'ignore', detached: true }).unref(); } catch { /* the URL is printed too */ }
}

async function post(url: string, body: Record<string, string>, f: typeof fetch): Promise<Record<string, unknown>> {
  const r = await f(url, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(body).toString() });
  const j = (await r.json().catch(() => ({}))) as Record<string, unknown>;
  if (!r.ok) throw new Error(`${url}: ${String(j.error_description ?? j.error ?? r.status)}`);
  return j;
}

const DONE = `<!doctype html><meta charset="utf-8"><title>Digital Canvas</title><body style="font:16px system-ui;text-align:center;margin-top:20vh">
<h2>Signed in to Digital Canvas</h2><p>You can close this tab and go back to your AI app.</p></body>`;

export async function login(base = DEFAULT_SERVER, opts: { openBrowser?: (url: string) => void; scopes?: string[]; port?: number; fetch?: typeof fetch; timeoutMs?: number; clientName?: string } = {}): Promise<StoredLogin> {
  const f = opts.fetch ?? fetch;
  base = base.replace(/\/$/, '');
  const verifier = randomBytes(32).toString('base64url');
  const challenge = createHash('sha256').update(verifier).digest('base64url');
  const state = randomBytes(16).toString('base64url');
  let server: Server | null = null;
  try {
    const got = new Promise<string>((resolve, reject) => {
      server = createServer((req, res) => {
        const u = new URL(req.url ?? '/', 'http://127.0.0.1');
        if (u.pathname !== '/callback') { res.writeHead(404); res.end(); return; }
        const err = u.searchParams.get('error');
        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
        res.end(err ? `<p>Sign-in failed: ${err.replace(/[<>&]/g, '')}</p>` : DONE);
        if (err) reject(new Error(`sign-in failed: ${u.searchParams.get('error_description') ?? err}`));
        else if (u.searchParams.get('state') !== state) reject(new Error('sign-in could not be verified (state mismatch)'));
        else resolve(u.searchParams.get('code') ?? '');
      });
      setTimeout(() => reject(new Error('sign-in timed out')), opts.timeoutMs ?? 5 * 60_000).unref();
    });
    const port = await new Promise<number>((resolve, reject) => {
      server!.once('error', reject);
      server!.listen(opts.port ?? 0, '127.0.0.1', () => resolve((server!.address() as { port: number }).port));
    });
    const redirectUri = `http://127.0.0.1:${port}/callback`;
    const reg = await f(`${base}/oauth/register`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ client_name: opts.clientName ?? 'Digital Canvas MCP (local)', redirect_uris: [redirectUri], token_endpoint_auth_method: 'none' }) });
    const client = (await reg.json()) as { client_id?: string; error_description?: string };
    if (!client.client_id) throw new Error(`could not register with ${base}: ${client.error_description ?? reg.status}`);
    const scope = ['designs', ...(opts.scopes ?? [])].join(' ');
    const auth = `${base}/oauth/authorize?${new URLSearchParams({ client_id: client.client_id, redirect_uri: redirectUri, response_type: 'code', code_challenge: challenge, code_challenge_method: 'S256', scope, state })}`;
    process.stderr.write(`\nDigital Canvas: sign in with Google in your browser.\nIf it didn't open, visit:\n${auth}\n\n`);
    (opts.openBrowser ?? defaultOpen)(auth);
    const code = await got;
    const t = await post(`${base}/oauth/token`, { grant_type: 'authorization_code', code, client_id: client.client_id, redirect_uri: redirectUri, code_verifier: verifier }, f);
    const l: StoredLogin = { server: base, clientId: client.client_id, accessToken: String(t.access_token), refreshToken: String(t.refresh_token), expiresAt: Date.now() + Number(t.expires_in ?? 3600) * 1000, scope: String(t.scope ?? '') };
    saveLogin(l);
    return l;
  } finally {
    (server as Server | null)?.close();
  }
}

export interface ServerTokens {
  /** A Google Drive access token (pass to DriveWorkspace / DriveStore). */
  token: TokenSource;
  /** The Google scopes it carries (space separated). */
  scope(): Promise<string>;
}

export function serverTokenSource(base: string, l: StoredLogin, opts: { fetch?: typeof fetch; persist?: boolean } = {}): ServerTokens {
  const f = opts.fetch ?? fetch;
  base = base.replace(/\/$/, '');
  let cur = { ...l };
  let drive: { token: string; exp: number; scope: string } | null = null;
  let busy: Promise<{ token: string; exp: number; scope: string }> | null = null;

  async function access(force: boolean): Promise<string> {
    if (!force && cur.expiresAt - 60_000 > Date.now()) return cur.accessToken;
    const t = await post(`${base}/oauth/token`, { grant_type: 'refresh_token', refresh_token: cur.refreshToken, client_id: cur.clientId }, f)
      .catch((e: unknown) => { throw new Error(`Digital Canvas sign-in expired (${e instanceof Error ? e.message : String(e)}): run \`npx @digital-canvas/mcp login\``); });
    cur = { ...cur, accessToken: String(t.access_token), refreshToken: String(t.refresh_token), expiresAt: Date.now() + Number(t.expires_in ?? 3600) * 1000 };
    if (opts.persist !== false) saveLogin(cur);
    return cur.accessToken;
  }

  async function fetchDrive(): Promise<{ token: string; exp: number; scope: string }> {
    for (let attempt = 0; attempt < 2; attempt++) {
      const at = await access(attempt > 0);
      const r = await f(`${base}/oauth/drive-token`, { method: 'POST', headers: { authorization: `Bearer ${at}` } });
      if (r.status === 401 && attempt === 0) continue;
      const j = (await r.json().catch(() => ({}))) as { accessToken?: string; expiresIn?: number; scope?: string; error_description?: string };
      if (!r.ok || !j.accessToken) throw new Error(`Google Drive token: ${j.error_description ?? r.status} (run \`npx @digital-canvas/mcp login\` again)`);
      return { token: j.accessToken, exp: Date.now() + (j.expiresIn ?? 3600) * 1000, scope: j.scope ?? '' };
    }
    throw new Error('Google Drive token: not signed in');
  }

  const get = async (force = false) => {
    if (!force && drive && drive.exp - 60_000 > Date.now()) return drive;
    busy ??= fetchDrive().then((d) => (drive = d)).finally(() => (busy = null));
    return busy;
  };

  return {
    token: async (force?: boolean) => (await get(!!force)).token,
    scope: async () => (await get()).scope,
  };
}
