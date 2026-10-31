// Builds everything the app runs into apps/desktop/dist: main + preload, the utility process
// (MCP, storage, CanvasKit bundled; the app has no node_modules), the web build, the font pack.
//   node scripts/build.mjs [--skip-web]
// DC_DESKTOP_GOOGLE_CLIENT_ID / _SECRET come from the environment (CI) or the repo's .env.local.
// A desktop OAuth secret is not confidential to Google, but it stays out of git all the same.
import { build } from 'esbuild';
import { execSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const root = resolve(dir, '../..');
const out = join(dir, 'dist');
const webDist = join(root, 'apps/web/dist');
const skipWeb = process.argv.includes('--skip-web');

function env(name) {
  if (process.env[name]) return process.env[name];
  const f = join(root, '.env.local');
  if (!existsSync(f)) return '';
  const m = new RegExp(`^${name}=(.*)$`, 'm').exec(readFileSync(f, 'utf8'));
  return m ? m[1].trim().replace(/^["']|["']$/g, '') : '';
}

if (!skipWeb) execSync('npm run build -w @digital-canvas/web', { cwd: root, stdio: 'inherit' });
if (!existsSync(join(webDist, 'index.html'))) throw new Error('apps/web/dist is missing: build without --skip-web');

// The font pack survives rebuilds: it only changes with the template library.
const keepPack = join(dir, '.fontpack');
if (existsSync(join(out, 'web/fontpack')) && !existsSync(keepPack)) cpSync(join(out, 'web/fontpack'), keepPack, { recursive: true });
rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });

const clientId = env('DC_DESKTOP_GOOGLE_CLIENT_ID'), clientSecret = env('DC_DESKTOP_GOOGLE_CLIENT_SECRET');
if (!clientId || !clientSecret) console.warn('no DC_DESKTOP_GOOGLE_CLIENT_ID/_SECRET: this build cannot connect to Drive');

const shared = { bundle: true, platform: 'node', target: 'node22', logLevel: 'warning', sourcemap: false };
await build({
  ...shared, entryPoints: { main: join(dir, 'src/main.ts'), preload: join(dir, 'src/preload.ts') }, outdir: out, format: 'cjs', outExtension: { '.js': '.cjs' }, external: ['electron'],
  define: { __DC_GOOGLE_CLIENT_ID__: JSON.stringify(clientId), __DC_GOOGLE_CLIENT_SECRET__: JSON.stringify(clientSecret) },
});
await build({
  ...shared, entryPoints: { server: join(dir, 'src/server-entry.ts') }, outdir: out, format: 'esm', outExtension: { '.js': '.mjs' }, external: ['ffmpeg-static'],
  banner: { js: "import { createRequire as __dcRequire } from 'node:module'; const require = __dcRequire(import.meta.url);" },
});

cpSync(webDist, join(out, 'web'), { recursive: true });
cpSync(join(root, 'apps/web/src/templates'), join(out, 'templates'), { recursive: true });
cpSync(join(root, 'node_modules/canvaskit-wasm/bin/full/canvaskit.js'), join(out, 'canvaskit.cjs'));
cpSync(join(root, 'node_modules/canvaskit-wasm/bin/full/canvaskit.wasm'), join(out, 'canvaskit.wasm'));
cpSync(join(root, 'apps/web/public/icons/icon-512.png'), join(out, 'icon.png'));

// ---- fonts for offline use: the families the built-in templates use, plus the font list.
const API = 'https://api.fontsource.org/v1/fonts';
const slug = (url) => url.replace(/^https:\/\//, '').replace(/[^\w.-]/g, '_');
const packDir = join(out, 'web/fontpack');
mkdirSync(packDir, { recursive: true });
if (existsSync(keepPack)) { cpSync(keepPack, packDir, { recursive: true }); rmSync(keepPack, { recursive: true, force: true }); }

async function keep(url) {
  const f = join(packDir, slug(url));
  if (existsSync(f)) return readFileSync(f);
  for (let i = 0; i < 3; i++) {
    try {
      const r = await fetch(url);
      if (r.ok) { const b = Buffer.from(await r.arrayBuffer()); writeFileSync(f, b); return b; }
    } catch { /* wait and retry */ }
    await new Promise((r) => setTimeout(r, 2000 * (i + 1)));
  }
  throw new Error(`could not fetch ${url}`);
}

try {
  const list = JSON.parse(await keep(API));
  const index = JSON.parse(readFileSync(join(root, 'apps/web/src/templates/index.json'), 'utf8'));
  const families = new Set(index.flatMap((t) => t.fonts));
  for (const f of list.filter((x) => families.has(x.family))) {
    const d = JSON.parse(await keep(`${API}/${f.id}`));
    const near = (w) => [...f.weights].sort((a, b) => Math.abs(a - w) - Math.abs(b - w) || b - a)[0];
    for (const w of new Set([near(400), near(700)])) for (const style of f.styles.filter((s) => s === 'normal' || s === 'italic')) {
      const url = d.variants[String(w)]?.[style]?.latin?.url.ttf;
      if (url) await keep(url);
    }
  }
} catch (e) {
  if (process.env.CI) throw e;
  console.warn(`font pack incomplete (${e.message}): those fonts will download on first use`);
}
// SIL OFL 1.1 asks for the licence to travel with the fonts.
writeFileSync(join(packDir, 'LICENSE.txt'), `The fonts in this folder come from Fontsource (Google Fonts) under the SIL Open Font License 1.1:
https://openfontlicense.org. Source Sans 3, Inter, Playfair Display, Abhaya Libre, Ms Madi, Plus Jakarta Sans, DM Sans.
Copyright belongs to their authors; each font's copyright notice is in its name table.\n`);
console.log(`built ${out}${skipWeb ? ' (web reused)' : ''}`);
