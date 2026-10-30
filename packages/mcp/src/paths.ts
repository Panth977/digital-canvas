/**
 * Where the files the server ships with live: the bundled fonts (Inter) and the
 * template library. In the monorepo they are the web app's own files; in the
 * published bundle (and the Cloud Function) they are copied next to it.
 */
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));

function find(env: string | undefined, candidates: string[]): string {
  if (env && existsSync(env)) return env;
  for (const c of candidates) if (existsSync(c)) return c;
  throw new Error(`Digital Canvas MCP: resource folder missing (looked in ${candidates.join(', ')})`);
}

/** Folder holding Inter-*.ttf. */
export const fontsDir = (): string => find(process.env.DC_FONTS_DIR, [join(here, 'fonts'), resolve(here, '../dist/fonts'), resolve(here, '../../../apps/web/public/fonts')]);

/** Folder holding the template library (`index.json` + `<id>.json`). */
export const templatesDir = (): string => find(process.env.DC_TEMPLATES_DIR, [join(here, 'templates'), resolve(here, '../dist/templates'), resolve(here, '../../../apps/web/src/templates')]);

/** The CanvasKit wasm file (bundles copy it next to the code). */
export function canvasKitWasm(): string | null {
  for (const c of [join(here, 'canvaskit.wasm'), resolve(here, '../dist/canvaskit.wasm')]) if (existsSync(c)) return c;
  return null;
}

/**
 * The mockup library on disk (`index.json` + `<id>/…`), or null (then it is
 * fetched from the site): DC_MOCKUPS_DIR (set but empty = always fetch), else
 * the web app's public/mockups when it has an index.
 */
export function mockupsDir(): string | null {
  const env = process.env.DC_MOCKUPS_DIR;
  if (env !== undefined) return env && existsSync(join(env, 'index.json')) ? env : null;
  for (const c of [join(here, 'mockups'), resolve(here, '../../../apps/web/public/mockups')]) if (existsSync(join(c, 'index.json'))) return c;
  return null;
}
