/**
 * Motion recipes from open CSS catalogues, as data: every @keyframes of
 * Animate.css 4.1.1 and magic.css 1.4.8 (both MIT) becomes normalised keyframes
 * in packages/scene/src/motion-data.json. Nothing here is invented: scene
 * `anim.ts` samples these numbers. 3D turns become their 2D projection
 * (rotateX → scaleY = cos): the renderer draws flat.
 *
 * Animate.css is pinned to 4.1.1: that npm package is MIT; the project's main
 * branch has since moved to the Hippocratic License, which we don't take.
 *
 *   npx tsx tools/catalogs/motion.ts [animate.css] [magic.css]
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../..');
const ANIMATE_URL = 'https://unpkg.com/animate.css@4.1.1/animate.css';
const MAGIC_URL = 'https://unpkg.com/magic.css@1.4.8/dist/magic.css';

export interface KF { a: number; o?: number; tx?: number; ty?: number; px?: number; py?: number; sx?: number; sy?: number; r?: number; kx?: number; ky?: number; b?: number; e?: number[] }
export interface Recipe { src: 'animate' | 'magic'; len?: number; ox?: number; oy?: number; f: KF[] }

import { readKeyframes } from '../../packages/scene/src/keyframes.ts';

async function load(path: string | undefined, url: string): Promise<string> {
  if (path) return readFileSync(path, 'utf8');
  const r = await fetch(url);
  if (!r.ok) throw new Error(`${url}: ${r.status}`);
  return r.text();
}

const out: Record<string, Recipe> = {};
readKeyframes(await load(process.argv[2], ANIMATE_URL), 'animate', out as never);
// the same name in magic.css (none today) would throw: keep them apart with a prefix
readKeyframes((await load(process.argv[3], MAGIC_URL)).replace(/@keyframes\s+([a-zA-Z0-9_-]+)/g, '@keyframes m_$1').replace(/^\.([a-zA-Z]+) \{/gm, '.m_$1 {'), 'magic', out as never);
writeFileSync(join(ROOT, 'packages/scene/src/motion-data.json'), `${JSON.stringify(out)}\n`);
console.log(`${Object.keys(out).length} recipes`);
