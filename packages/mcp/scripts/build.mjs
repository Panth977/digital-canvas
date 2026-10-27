// Bundle the server for npm: the workspace packages (scene, render, storage) and the web app's
// pure content adapters go inside; npm dependencies stay external. Fonts and templates are copied
// next to the bundle (see src/paths.ts).
import { build } from 'esbuild';
import { cpSync, mkdirSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const pkgDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const root = resolve(pkgDir, '../..');
const out = join(pkgDir, 'dist');
const pkg = JSON.parse(readFileSync(join(pkgDir, 'package.json'), 'utf8'));
const external = Object.keys(pkg.dependencies).filter((d) => !d.startsWith('@digital-canvas/'));

rmSync(out, { recursive: true, force: true });
await build({
  entryPoints: { cli: join(pkgDir, 'src/cli.ts'), index: join(pkgDir, 'src/index.ts'), remote: join(pkgDir, 'src/remote/index.ts') },
  outdir: out,
  bundle: true,
  splitting: true,
  platform: 'node',
  format: 'esm',
  target: 'node20',
  external: [...external, 'ffmpeg-static'],
  banner: { js: "import { createRequire as __dcRequire } from 'node:module'; const require = __dcRequire(import.meta.url);" },
  logLevel: 'warning',
});
mkdirSync(join(out, 'fonts'), { recursive: true });
for (const f of readdirSync(join(root, 'apps/web/public/fonts'))) cpSync(join(root, 'apps/web/public/fonts', f), join(out, 'fonts', f));
cpSync(join(root, 'apps/web/src/templates'), join(out, 'templates'), { recursive: true });
console.log(`built ${out}`);
