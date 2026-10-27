// Bundle and deploy the remote MCP server: functions codebase "mcp" (functions `mcp` and `mcpExport`).
// Separate from IceBase's default codebase (deploy-functions.mjs), so neither deploy touches the other.
//
//   node backend/scripts/deploy-mcp.mjs              bundle + firebase deploy --only functions:mcp
//   node backend/scripts/deploy-mcp.mjs --build-only bundle only (backend/.icebase/mcp-functions)
import { build } from 'esbuild';
import { execFileSync } from 'node:child_process';
import { copyFileSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const repo = resolve(root, '..');
const work = join(root, '.icebase');
const out = join(work, 'mcp-functions');
const backendPkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
const mcpPkg = JSON.parse(readFileSync(join(repo, 'packages/mcp/package.json'), 'utf8'));
// Native/wasm or big runtime packages stay real npm dependencies of the deployed function.
const deps = {
  'firebase-admin': backendPkg.dependencies['firebase-admin'],
  'firebase-functions': backendPkg.dependencies['firebase-functions'],
  'canvaskit-wasm': mcpPkg.dependencies['canvaskit-wasm'],
  // GPL ffmpeg binary, run server-side only (not distributed with @digital-canvas/mcp).
  'ffmpeg-static': '^5.3.0',
};

rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });
await build({
  entryPoints: [join(root, 'mcp/src/index.ts')],
  outfile: join(out, 'index.js'),
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  external: Object.keys(deps).flatMap((d) => [d, `${d}/*`]),
  banner: { js: "import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);" },
  logLevel: 'warning',
});
// Files packages/mcp/src/paths.ts looks for next to the bundle.
mkdirSync(join(out, 'fonts'), { recursive: true });
for (const f of readdirSync(join(repo, 'apps/web/public/fonts'))) if (/^Inter-.*\.ttf$/.test(f) || f === 'OFL.txt') copyFileSync(join(repo, 'apps/web/public/fonts', f), join(out, 'fonts', f));
mkdirSync(join(out, 'templates'), { recursive: true });
for (const f of readdirSync(join(repo, 'apps/web/src/templates'))) if (f.endsWith('.json')) copyFileSync(join(repo, 'apps/web/src/templates', f), join(out, 'templates', f));
writeFileSync(join(out, 'package.json'), JSON.stringify({ name: 'digital-canvas-mcp-functions', private: true, type: 'module', main: 'index.js', engines: { node: '22' }, dependencies: deps }, null, 2) + '\n');
const fb = join(work, 'firebase.mcp.json');
writeFileSync(fb, JSON.stringify({ functions: [{ source: 'mcp-functions', codebase: 'mcp', runtime: 'nodejs22' }] }, null, 2) + '\n');
console.log(`bundled → ${out}/index.js (+ fonts, templates)`);
if (!process.argv.includes('--build-only')) {
  execFileSync(join(repo, 'node_modules/.bin/firebase'), ['deploy', '--only', 'functions:mcp', '--project', 'digital-canvas-p977', '--config', fb, '--non-interactive', '--force'], { cwd: work, stdio: 'inherit' });
}
