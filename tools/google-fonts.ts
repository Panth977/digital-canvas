/**
 * Download Google Fonts as TTF (the CSS API serves TTF to non-browser clients), cached in
 * ~/.cache/digital-canvas/fonts/<Family>/<weight>[i].ttf.
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

export interface Face { family: string; weight: number; italic: boolean; bytes: Uint8Array }

const CACHE = join(homedir(), '.cache/digital-canvas/fonts');

export async function googleFont(family: string): Promise<Face[]> {
  const dir = join(CACHE, family.replace(/[^\w ]/g, ''));
  if (existsSync(join(dir, '.done'))) {
    return readdirSync(dir).filter((f) => f.endsWith('.ttf')).map((f) => ({
      family, weight: parseInt(f), italic: f.includes('i'), bytes: new Uint8Array(readFileSync(join(dir, f))),
    }));
  }
  mkdirSync(dir, { recursive: true });
  const variants = [100, 200, 300, 400, 500, 600, 700, 800, 900].flatMap((w) => [`${w}`, `${w}i`]).join(',');
  const css = await (await fetch(`https://fonts.googleapis.com/css?family=${encodeURIComponent(family)}:${variants}`)).text();
  const faces: Face[] = [];
  for (const block of css.split('@font-face').slice(1)) {
    const italic = /font-style:\s*italic/.test(block);
    const weight = Number(/font-weight:\s*(\d+)/.exec(block)?.[1] ?? 400);
    const url = /url\((https:[^)]+\.ttf)\)/.exec(block)?.[1];
    if (!url) continue;
    const bytes = new Uint8Array(await (await fetch(url)).arrayBuffer());
    writeFileSync(join(dir, `${weight}${italic ? 'i' : ''}.ttf`), bytes);
    faces.push({ family, weight, italic, bytes });
  }
  writeFileSync(join(dir, '.done'), '');
  return faces;
}

/** One face with every subset Google has for it (₹, accents, Devanagari…), for embedding. */
export async function googleFontFull(family: string, weight: number, italic: boolean): Promise<Uint8Array> {
  const dir = join(CACHE, family.replace(/[^\w ]/g, ''), 'full');
  const file = join(dir, `${weight}${italic ? 'i' : ''}.ttf`);
  if (existsSync(file)) return new Uint8Array(readFileSync(file));
  mkdirSync(dir, { recursive: true });
  const subsets = 'latin,latin-ext,devanagari,cyrillic,cyrillic-ext,greek,greek-ext,vietnamese';
  const css = await (await fetch(`https://fonts.googleapis.com/css?family=${encodeURIComponent(family)}:${weight}${italic ? 'i' : ''}&subset=${subsets}`)).text();
  const url = /url\((https:[^)]+\.ttf)\)/.exec(css)?.[1];
  if (!url) throw new Error(`no face ${family} ${weight}${italic ? 'i' : ''}`);
  const bytes = new Uint8Array(await (await fetch(url)).arrayBuffer());
  writeFileSync(file, bytes);
  return bytes;
}
