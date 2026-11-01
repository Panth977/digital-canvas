import { defineConfig, type Plugin } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { createHash } from 'node:crypto';
import { cpSync, existsSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, relative, sep } from 'node:path';

/**
 * Writes dist/sw.js after a production build: lib/pwa-sw.js with the list of
 * files to precache and a version that changes whenever any of them does.
 * Not used by `vite dev` (the app only registers the worker in production).
 */
function serviceWorker(): Plugin {
  let outDir = '';
  return {
    name: 'dc-service-worker',
    apply: 'build',
    configResolved(c) {
      outDir = c.build.outDir.startsWith('/') ? c.build.outDir : join(c.root, c.build.outDir);
    },
    writeBundle() {
      const files: string[] = [];
      const walk = (dir: string) => {
        for (const name of readdirSync(dir)) {
          const p = join(dir, name);
          if (statSync(p).isDirectory()) walk(p);
          else files.push(relative(outDir, p).split(sep).join('/'));
        }
      };
      walk(outDir);
      // Template thumbnails are fetched on demand (stale-while-revalidate); source maps and the worker itself never.
      // The mockup library (large photos and maps) is fetched on demand too.
      // The AI device worker (2.5 MB) is fetched only when "Let AI use this device" is on (it needs the network anyway).
      // The desktop app's video worker runs only there, from its own local server.
      const precache = files.filter((f) => !f.startsWith('templates/') && !f.startsWith('mockups/') && !f.startsWith('illustrations/') && !f.startsWith('pdfjs/') && !f.endsWith('.map') && f !== 'sw.js' && !f.endsWith('OFL.txt') && !/^assets\/(video)?worker-/.test(f)).sort();
      const hash = createHash('sha256');
      for (const f of precache) hash.update(f).update(readFileSync(join(outDir, f)));
      const src = readFileSync(new URL('./src/lib/pwa-sw.js', import.meta.url), 'utf8');
      const version = hash.digest('hex').slice(0, 12);
      const urls = precache.map((f) => '/' + f);
      writeFileSync(join(outDir, 'sw.js'), `const VERSION = ${JSON.stringify(version)};\nconst PRECACHE = ${JSON.stringify(urls, null, 0)};\n${src}`);
      this.info?.(`sw.js: ${urls.length} files precached, version ${version}`);
    },
  };
}

/** pdf.js's data files (fonts for PDFs that embed none, CMaps, decoders): served in dev, copied on build, fetched on demand. */
function pdfjsData(): Plugin {
  const root = join(dirname(createRequire(import.meta.url).resolve('pdfjs-dist/package.json')));
  const dirs = ['standard_fonts', 'cmaps', 'wasm'];
  return {
    name: 'dc-pdfjs-data',
    configureServer(server) {
      server.middlewares.use('/pdfjs', (req, res, next) => {
        const path = join(root, decodeURIComponent((req.url ?? '').split('?')[0]!));
        if (!dirs.some((d) => path.startsWith(join(root, d))) || !existsSync(path) || !statSync(path).isFile()) return next();
        res.setHeader('Content-Type', path.endsWith('.wasm') ? 'application/wasm' : 'application/octet-stream');
        res.end(readFileSync(path));
      });
    },
    writeBundle(o) {
      for (const d of dirs) cpSync(join(root, d), join(o.dir!, 'pdfjs', d), { recursive: true });
    },
  };
}

export default defineConfig({
  plugins: [svelte(), pdfjsData(), serviceWorker()],
  optimizeDeps: { include: ['canvaskit-wasm/bin/full/canvaskit.js'] },
  // The AI device worker (lib/bridge/worker.ts) is a module worker: templates load as separate chunks.
  worker: { format: 'es' },
  server: { port: Number(process.env.DC_PORT ?? 5181), strictPort: true },
  preview: { port: 5181, strictPort: true },
  build: { target: 'es2022', chunkSizeWarningLimit: 2000 },
});
