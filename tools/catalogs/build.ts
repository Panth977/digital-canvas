/**
 * Build the open content the panels ship with, straight from each catalogue:
 *
 *   apps/web/src/lib/content/data/{palettes,gradients,patterns,fontpairs}.json
 *   apps/web/public/illustrations/open-doodles/*.svg + index.json
 *
 *   npx tsx tools/catalogs/build.ts
 *
 * Nothing here draws or invents anything: it only reads upstream data. Then
 * run tools/catalogs/credits.ts for LICENSES and public/credits.html.
 * Downloads are cached under ~/.cache/digital-canvas/catalogs.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../..');
const CACHE = join(homedir(), '.cache/digital-canvas/catalogs');
const DATA = join(ROOT, 'apps/web/src/lib/content/data');
const DOODLES = join(ROOT, 'apps/web/public/illustrations/open-doodles');
mkdirSync(CACHE, { recursive: true });
mkdirSync(DATA, { recursive: true });
mkdirSync(DOODLES, { recursive: true });

async function get(url: string, file: string): Promise<string> {
  const local = join(CACHE, file);
  if (existsSync(local)) return readFileSync(local, 'utf8');
  mkdirSync(dirname(local), { recursive: true });
  for (let attempt = 1; ; attempt++) {
    try {
      const r = await fetch(url);
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const t = await r.text();
      writeFileSync(local, t);
      return t;
    } catch (e) {
      if (attempt >= 5) throw new Error(`${url}: ${e instanceof Error ? e.message : e}`);
      await new Promise((ok) => setTimeout(ok, 5000 * attempt));
    }
  }
}

/** An npm package unpacked in the cache. */
function npmPack(name: string, version: string): string {
  const dir = join(CACHE, 'npm', `${name.replace(/\W/g, '-')}-${version}`);
  if (existsSync(join(dir, 'package'))) return join(dir, 'package');
  mkdirSync(dir, { recursive: true });
  execFileSync('npm', ['pack', `${name}@${version}`, '--silent'], { cwd: dir });
  const tgz = readdirSync(dir).find((f) => f.endsWith('.tgz'))!;
  execFileSync('tar', ['xzf', tgz], { cwd: dir });
  return join(dir, 'package');
}

const title = (s: string) => s.replace(/[-_]/g, ' ').replace(/([a-z])([A-Z])/g, '$1 $2').replace(/\b\w/g, (c) => c.toUpperCase());
const save = (name: string, v: unknown) => { writeFileSync(join(DATA, `${name}.json`), JSON.stringify(v)); console.log(`${name}: ${Array.isArray(v) ? v.length : ''}`); };

// ---- palettes: Open Color and Tailwind CSS (both MIT)
{
  const oc = JSON.parse(readFileSync(join(npmPack('open-color', '1.9.1'), 'open-color.json'), 'utf8')) as Record<string, string[]>;
  // read as text: the module pulls in Tailwind's logger
  const twSrc = readFileSync(join(npmPack('tailwindcss', '3.4.17'), 'lib/public/colors.js'), 'utf8');
  const tw = [...twSrc.matchAll(/^\s*([a-z]+): \{\n((?:\s*\d+: "#[0-9a-f]+",?\n)+)/gm)].map((m) => [m[1]!, [...m[2]!.matchAll(/"(#[0-9a-f]+)"/g)].map((x) => x[1]!)] as const);
  const out: { id: string; name: string; catalog: string; colors: string[] }[] = [];
  for (const [k, v] of Object.entries(oc)) if (Array.isArray(v) && v.length >= 5) out.push({ id: `open-color-${k}`, name: title(k), catalog: 'Open Color', colors: v.map((c) => c.toLowerCase()) });
  for (const [k, v] of tw) out.push({ id: `tailwind-${k}`, name: title(k), catalog: 'Tailwind CSS', colors: v });
  save('palettes', out);
}

// ---- gradients: uiGradients (MIT)
{
  const list = JSON.parse(await get('https://raw.githubusercontent.com/Ghosh/uiGradients/master/gradients.json', 'uigradients.json')) as { name: string; colors: string[] }[];
  save('gradients', list.map((g) => ({ name: g.name.trim(), colors: g.colors.map((c) => c.toLowerCase().replace(/^#(.)(.)(.)$/, '#$1$1$2$2$3$3')) })));
}

// ---- patterns: Hero Patterns by Steve Schoger (CC BY 4.0), the tiles from the hero-patterns package
{
  const hp = await import(pathToFileURL(join(npmPack('hero-patterns', '2.1.0'), 'dist/hero-patterns.cjs.js')).href) as Record<string, unknown>;
  const fns = { ...(hp.default as Record<string, unknown>), ...hp };
  const out: { id: string; name: string; width: number; height: number; svg: string }[] = [];
  for (const [k, f] of Object.entries(fns)) {
    if (typeof f !== 'function' || k === 'default') continue;
    const css = (f as (c: string, o: number) => string)('#000000', 1);
    const m = /data:image\/svg\+xml,([^')]+)/.exec(css);
    if (!m) continue;
    const svg = decodeURIComponent(m[1]!).replace(/#000000/g, '{{color}}').replace(/#000\b/g, '{{color}}').replace(/fill-opacity="1"/, '');
    const w = Number(/width="([\d.]+)"/.exec(svg)?.[1]), h = Number(/height="([\d.]+)"/.exec(svg)?.[1]);
    if (w && h) out.push({ id: k.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`), name: title(k), width: w, height: h, svg });
  }
  out.sort((a, b) => a.id.localeCompare(b.id));
  save('patterns', out);
}

// ---- font pairings: Fonttrio (MIT), heading + body and its own type scale
{
  const reg = JSON.parse(await get('https://raw.githubusercontent.com/kapishdima/fonttrio/main/registry.json', 'fonttrio/registry.json')) as { pairings: (string | { name: string })[] };
  const names = reg.pairings.map((p) => (typeof p === 'string' ? p : p.name));
  const cat = (JSON.parse(await get('https://api.fontsource.org/v1/fonts', 'fontsource.json')) as { family: string }[]);
  const known = new Set(cat.map((f) => f.family));
  const out: { id: string; name: string; tags: string; description: string; heading: string; body: string; headingRem: number; bodyRem: number; headingBold: boolean }[] = [];
  // Fonttrio's named, hand-curated pairings first (`agency`, `beacon`…), then the font-font ones
  const named = (n: string) => (n.split('-').length === 1 ? 0 : 1);
  const perHeading = new Map<string, number>();
  for (const name of [...names].sort((a, b) => named(a) - named(b) || a.localeCompare(b))) {
    if (out.length >= 60) break;
    const j = JSON.parse(await get(`https://raw.githubusercontent.com/kapishdima/fonttrio/main/registry/pairings/${name}.json`, `fonttrio/${name}.json`));
    const [heading, body] = String(j.title).split(' — ').pop()!.split(' + ').map((s) => s.trim());
    if (!heading || !body || heading === body || !known.has(heading) || !known.has(body)) continue;
    if ((perHeading.get(heading) ?? 0) >= 2) continue;
    perHeading.set(heading, (perHeading.get(heading) ?? 0) + 1);
    const css = j.css?.['@layer base'] ?? {};
    const h1 = css.h1 ?? {}, bodyCss = css.body ?? {};
    out.push({
      id: name, name: `${heading} + ${body}`, tags: [...(j.categories ?? []), ...(j.meta?.mood ?? []), ...(j.meta?.useCase ?? [])].join(' ').toLowerCase(), description: String(j.description ?? ''),
      heading, body, headingRem: parseFloat(h1['font-size'] ?? '2.5') || 2.5, bodyRem: parseFloat(bodyCss['font-size'] ?? '1') || 1, headingBold: Number(h1['font-weight'] ?? 400) >= 600,
    });
  }
  save('fontpairs', out);
}

// ---- illustrations: Open Doodles by Pablo Stanley (CC0)
{
  const NAMES = ['Doggie', 'loving', 'laying', 'sleek', 'ice-cream', 'selfie', 'plant', 'sitting', 'rolling', 'coffee', 'clumsy', 'zombieing', 'reading-side', 'dog-jump', 'swinging', 'bikini', 'dancing', 'running', 'groovy', 'ballet', 'roller-skating', 'sprinting', 'sitting-reading', 'float', 'chilling', 'strolling', 'levitate', 'petting', 'reading', 'meditating', 'jumping', 'unboxing', 'moshing'];
  const out: { id: string; title: string; width: number; height: number }[] = [];
  for (const n of NAMES) {
    const svg = await get(`https://opendoodles.s3-us-west-1.amazonaws.com/${n}.svg`, `open-doodles/${n}.svg`);
    const id = n.toLowerCase();
    writeFileSync(join(DOODLES, `${id}.svg`), svg);
    const vb = /viewBox="[\d.-]+ [\d.-]+ ([\d.]+) ([\d.]+)"/.exec(svg);
    out.push({ id, title: title(n), width: Number(vb?.[1] ?? 1024), height: Number(vb?.[2] ?? 768) });
  }
  writeFileSync(join(DOODLES, 'index.json'), JSON.stringify(out));
  console.log(`open doodles: ${out.length}`);
}
