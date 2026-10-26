// Bundle and deploy the Cloud Functions.
// Same steps as `icebase deploy --only functions`, but IceBase 0.4.7's buildFunctions reads
// peerDependencies from its own package.json, which the JSR npm build doesn't have, so it crashes.
// Remove this script once that is fixed in IceBase.
import { build } from 'esbuild';
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(root, '.icebase/functions');
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
const deps = Object.fromEntries(['firebase', 'firebase-admin', 'firebase-functions'].map((d) => [d, pkg.dependencies[d]]));

mkdirSync(out, { recursive: true });
await build({
  entryPoints: [join(root, 'functions/src/index.ts')],
  outfile: join(out, 'index.js'),
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  external: Object.keys(deps).flatMap((d) => [d, `${d}/*`]),
  banner: { js: "import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);" },
  // The app imports '@panth977/icebase' (npm alias of the JSR package) and icebase-server imports
  // '@jsr/panth977__icebase': make them one copy, or instanceof checks fail at runtime.
  alias: { '@panth977/icebase': '@jsr/panth977__icebase' },
  logLevel: 'warning',
});
writeFileSync(join(out, 'package.json'), JSON.stringify({ name: 'digital-canvas-functions', private: true, type: 'module', main: 'index.js', engines: { node: '22' }, dependencies: deps }, null, 2) + '\n');
const fb = join(root, '.icebase/firebase.json');
writeFileSync(fb, JSON.stringify({ functions: { source: 'functions', runtime: 'nodejs22' } }, null, 2) + '\n');
console.log('bundled → .icebase/functions/index.js');
if (!process.argv.includes('--build-only')) {
  execFileSync(join(root, '../node_modules/.bin/firebase'), ['deploy', '--only', 'functions', '--project', 'digital-canvas-p977', '--config', fb, '--non-interactive', '--force'], { cwd: join(root, '.icebase'), stdio: 'inherit' });
}
