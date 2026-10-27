/**
 * npx @digital-canvas/mcp [command] [options]
 *
 *   (no command)            stdio MCP server on your Google Drive (signs in on first run)
 *   --store folder <dir>    work on a local folder instead (no Google account)
 *   --http <port>           serve MCP over Streamable HTTP on localhost instead of stdio
 *   login [--whole-drive]   sign in (opens the browser); --whole-drive also asks to read all of Drive
 *   logout                  forget the sign-in
 *   status                  who is signed in, where designs go, whether ffmpeg is there
 *
 * Environment: DC_SERVER (default https://digital-canvas-p977.web.app), DC_CONFIG_DIR,
 * DC_GOOGLE_ACCESS_TOKEN (use this Drive token as is: testing), DC_FFMPEG.
 * Logs go to stderr; stdout belongs to the MCP protocol.
 */
import { spawn } from 'node:child_process';
import { createServer as httpServer } from 'node:http';
import { resolve } from 'node:path';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { createServer, VERSION } from './server.ts';
import { DriveWorkspace, FolderWorkspace, type Workspace } from './workspace.ts';
import { DEFAULT_SERVER, clearLogin, loadLogin, login, loginFile, serverTokenSource } from './remote/client.ts';
import { ffmpeg } from './media.ts';

const log = (...a: unknown[]) => console.error('[digital-canvas]', ...a);

function args(argv: string[]) {
  const out: { cmd?: string; store?: string; dir?: string; http?: number; wholeDrive?: boolean; server: string; help?: boolean } = { server: (process.env.DC_SERVER ?? DEFAULT_SERVER).replace(/\/$/, '') };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === '--store') { out.store = argv[++i]; if (out.store === 'folder') out.dir = argv[++i]; }
    else if (a.startsWith('--store=')) out.store = a.slice(8);
    else if (a === '--folder' || a === '--dir') { out.store = 'folder'; out.dir = argv[++i]; }
    else if (a === '--http') out.http = Number(argv[++i]);
    else if (a === '--whole-drive') out.wholeDrive = true;
    else if (a === '--server') out.server = argv[++i]!.replace(/\/$/, '');
    else if (a === '-h' || a === '--help') out.help = true;
    else if (a === '-v' || a === '--version') out.cmd = 'version';
    else if (!a.startsWith('-') && !out.cmd) out.cmd = a;
  }
  return out;
}

function openBrowser(url: string): void {
  const cmd = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'cmd' : 'xdg-open';
  const a = process.platform === 'win32' ? ['/c', 'start', '', url] : [url];
  try { spawn(cmd, a, { stdio: 'ignore', detached: true }).unref(); } catch { /* printed below */ }
  log(`Sign in with Google in your browser. If it did not open, visit:\n${url}`);
}

async function workspace(o: ReturnType<typeof args>): Promise<Workspace> {
  if (o.store === 'folder') {
    if (!o.dir) throw new Error('--store folder needs a directory: --store folder ~/Designs');
    return new FolderWorkspace(resolve(o.dir.replace(/^~(?=\/|$)/, process.env.HOME ?? '~')));
  }
  if (process.env.DC_GOOGLE_ACCESS_TOKEN) {
    const t = process.env.DC_GOOGLE_ACCESS_TOKEN;
    return new DriveWorkspace(async () => t);
  }
  let saved = loadLogin(o.server);
  if (!saved) {
    log('First run: signing you in to Digital Canvas (Google Drive)…');
    saved = await login(o.server, { openBrowser, scopes: o.wholeDrive ? ['drive.readonly'] : [], clientName: 'Digital Canvas MCP (local)' });
    log(`Signed in. Token saved to ${loginFile()}`);
  }
  const src = serverTokenSource(o.server, saved);
  return new DriveWorkspace(src.token, await src.scope().catch(() => saved!.scope));
}

const HELP = `Digital Canvas MCP server ${VERSION}

  npx @digital-canvas/mcp                      stdio server on your Google Drive (first run opens the browser to sign in)
  npx @digital-canvas/mcp --store folder DIR   work on a local folder instead (no account needed)
  npx @digital-canvas/mcp --http 8787          Streamable HTTP on http://127.0.0.1:8787/mcp
  npx @digital-canvas/mcp login [--whole-drive]
  npx @digital-canvas/mcp logout | status

Claude Code:     claude mcp add digital-canvas -- npx -y @digital-canvas/mcp
Claude Desktop:  { "mcpServers": { "digital-canvas": { "command": "npx", "args": ["-y", "@digital-canvas/mcp"] } } }
Remote (Claude.ai custom connector): https://digital-canvas-p977.web.app/mcp
Video export needs ffmpeg (brew install ffmpeg / apt install ffmpeg / npm i -g ffmpeg-static).`;

export async function main(argv = process.argv.slice(2)): Promise<void> {
  const o = args(argv);
  if (o.help) { console.error(HELP); return; }
  if (o.cmd === 'version') { console.log(VERSION); return; }
  if (o.cmd === 'login') {
    const l = await login(o.server, { openBrowser, scopes: o.wholeDrive ? ['drive.readonly'] : [], clientName: 'Digital Canvas MCP (local)' });
    log(`Signed in (${l.scope || 'drive'}). Saved to ${loginFile()}`);
    return;
  }
  if (o.cmd === 'logout') { clearLogin(); log('Signed out.'); return; }
  if (o.cmd === 'status') {
    const l = loadLogin(o.server);
    console.error(JSON.stringify({ server: o.server, signedIn: !!l, loginFile: loginFile(), scope: l?.scope, ffmpeg: ffmpeg() ?? 'missing (video export disabled)' }, null, 2));
    return;
  }
  if (o.cmd && o.cmd !== 'serve') { console.error(`unknown command "${o.cmd}"\n\n${HELP}`); process.exitCode = 2; return; }

  const ws = await workspace(o);
  if (o.http) {
    const srv = httpServer(async (req, res) => {
      if (!req.url?.startsWith('/mcp')) { res.writeHead(404).end(); return; }
      const server = createServer(ws, { mode: 'local' });
      const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
      res.on('close', () => { void transport.close(); void server.close(); });
      await server.connect(transport);
      await transport.handleRequest(req, res);
    });
    srv.listen(o.http, '127.0.0.1', () => log(`MCP on http://127.0.0.1:${o.http}/mcp (${ws.label})`));
    return;
  }
  const server = createServer(ws, { mode: 'local' });
  await server.connect(new StdioServerTransport());
  log(`ready (${ws.label}${ffmpeg() ? '' : '; ffmpeg not found: video export disabled'})`);
}
