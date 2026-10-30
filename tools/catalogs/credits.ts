/**
 * Write LICENSES and apps/web/public/credits.html from the catalogue data, so
 * the credits can't drift from what ships.
 *
 *   npx tsx tools/catalogs/credits.ts
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../..');
const read = (p: string) => JSON.parse(readFileSync(join(ROOT, p), 'utf8'));

interface Row { name: string; url: string; by: string; licence: string; licenceUrl: string; note?: string }
const L = {
  MIT: ['MIT', 'https://opensource.org/license/mit'], Apache: ['Apache-2.0', 'https://www.apache.org/licenses/LICENSE-2.0'], ISC: ['ISC', 'https://opensource.org/license/isc-license-txt'],
  CC0: ['CC0 1.0', 'https://creativecommons.org/publicdomain/zero/1.0/'], BY: ['CC BY 4.0', 'https://creativecommons.org/licenses/by/4.0/'], SA: ['CC BY-SA 4.0', 'https://creativecommons.org/licenses/by-sa/4.0/'],
  OFL: ['OFL-1.1', 'https://openfontlicense.org/'], ODbL: ['ODbL 1.0', 'https://opendatacommons.org/licenses/odbl/'], Each: ['per item', ''],
} as const;
const row = (name: string, url: string, by: string, l: readonly [string, string], note?: string): Row => ({ name, url, by, licence: l[0], licenceUrl: l[1], ...(note ? { note } : {}) });

const pal = read('apps/web/src/lib/content/data/palettes.json').length, grad = read('apps/web/src/lib/content/data/gradients.json').length;
const pats = read('apps/web/src/lib/content/data/patterns.json').length, pairs = read('apps/web/src/lib/content/data/fontpairs.json').length;
const doodles = read('apps/web/public/illustrations/open-doodles/index.json').length;

const SECTIONS: { title: string; intro?: string; rows: Row[] }[] = [
  { title: 'Stickers', rows: [
    row('Fluent Emoji', 'https://github.com/microsoft/fluentui-emoji', 'Microsoft', L.MIT, 'via Iconify'),
    row('Noto Emoji', 'https://github.com/googlefonts/noto-emoji', 'Google', L.Apache, 'via Iconify'),
    row('Twemoji', 'https://github.com/jdecked/twemoji', 'Twitter and contributors', L.BY, 'via Iconify; the credit stays on the element'),
    row('OpenMoji', 'https://openmoji.org', 'HfG Schwäbisch Gmünd and contributors', L.SA, 'via Iconify; the credit stays on the element. Derivatives of the artwork stay under CC BY-SA') ] },
  { title: 'Illustrations', rows: [
    row('Open Doodles', 'https://www.opendoodles.com', 'Pablo Stanley', L.CC0, `${doodles} illustrations, shipped with the app`),
    row('Openverse', 'https://openverse.org', 'many authors', L.Each, 'search; each picture keeps its author and licence') ] },
  { title: 'Graphics and icons', intro: 'Through the Iconify API.', rows: [
    row('Fluent UI System Color Icons', 'https://github.com/microsoft/fluentui-system-icons', 'Microsoft', L.MIT),
    row('Streamline', 'https://www.streamlinehq.com', 'Streamline', L.BY),
    row('Flat Color Icons', 'https://github.com/icons8/flat-color-icons', 'Icons8', L.MIT),
    row('Meteocons', 'https://github.com/basmilius/weather-icons', 'Bas Milius', L.MIT),
    row('Circle Flags', 'https://github.com/HatScripts/circle-flags', 'HatScripts', L.MIT),
    row('Phosphor', 'https://phosphoricons.com', 'Phosphor Icons', L.MIT),
    row('Tabler Icons', 'https://tabler.io/icons', 'Paweł Kuna', L.MIT),
    row('Material Design Icons', 'https://pictogrammers.com', 'Pictogrammers', L.Apache),
    row('Lucide', 'https://lucide.dev', 'Lucide Contributors', L.ISC),
    row('Material Symbols', 'https://fonts.google.com/icons', 'Google', L.Apache) ] },
  { title: 'Colours, gradients and patterns', rows: [
    row('Open Color', 'https://yeun.github.io/open-color/', 'heeyeun', L.MIT, 'palettes'),
    row('Tailwind CSS colours', 'https://tailwindcss.com/docs/colors', 'Tailwind Labs', L.MIT, `palettes (${pal} with Open Color)`),
    row('uiGradients', 'https://uigradients.com', 'Indrashish Ghosh and contributors', L.MIT, `${grad} gradients`),
    row('Hero Patterns', 'https://heropatterns.com', 'Steve Schoger', L.BY, `${pats} patterns; the credit stays on the picture`) ] },
  { title: 'Avatars', intro: 'DiceBear’s code is MIT; each style has its own licence (dicebear.com/licenses). Styles under the artist’s own terms are left out.', rows: [
    ...[['Notionists', 'Zoish', L.CC0], ['Open Peeps', 'Pablo Stanley', L.CC0], ['Lorelei', 'Lisa Wischofsky', L.CC0], ['Adventurer', 'Lisa Wischofsky', L.BY], ['Micah', 'Micah Lanier', L.BY], ['Personas', 'Draftbit', L.BY], ['Big Smile', 'Ashley Seo', L.BY], ['Fun Emoji', 'Davis Uche', L.BY], ['Pixel Art', 'DiceBear', L.CC0], ['Thumbs', 'DiceBear', L.CC0]]
      .map(([n, by, l]) => row(`DiceBear ${n}`, 'https://www.dicebear.com/licenses/', by as string, l as readonly [string, string])) ] },
  { title: 'Fonts', rows: [
    row('Fonttrio', 'https://www.fonttrio.xyz', 'KapishDima', L.MIT, `${pairs} heading and body pairings, with its type scale`),
    row('Google Fonts', 'https://fonts.google.com', 'each font’s designers', L.OFL, 'through Fontsource; a few fonts are Apache-2.0') ] },
  { title: 'Photos, video, sound and maps', rows: [
    row('Openverse', 'https://openverse.org', 'many authors', L.Each, 'commercial use and changes allowed; credit kept with each item'),
    row('Wikimedia Commons', 'https://commons.wikimedia.org', 'many authors', L.Each, 'credit kept with each item'),
    row('NASA Image and Video Library', 'https://images.nasa.gov', 'NASA', L.Each, 'generally public domain'),
    row('OpenStreetMap', 'https://www.openstreetmap.org/copyright', 'OpenStreetMap contributors', L.ODbL) ] },
  { title: 'Device mockups', rows: [ row('Digital Canvas mockups', '', 'rendered with Blender for this project', L.CC0, 'see public/mockups/LICENSES.md') ] },
];

interface Tpl { id: string; title: string; category: string; credit: { author: string; authorUrl?: string; catalog: string; sourceUrl: string; fileUrl?: string; licence: string; licenceUrl: string; note?: string } }
const index = read('apps/web/src/templates/index.json') as Tpl[];

// ---- plain text
const lines = ['Third-party content in Digital Canvas', '=====================================', '', 'The code is Apache-2.0 (see LICENSE). Content below keeps its own licence.', 'Generated by tools/catalogs/credits.ts; also served at /credits.html.', ''];
for (const s of SECTIONS) {
  lines.push(s.title, '-'.repeat(s.title.length));
  if (s.intro) lines.push(s.intro);
  for (const r of s.rows) lines.push(`${r.name} by ${r.by}. ${r.licence}. ${r.url}${r.note ? ` (${r.note})` : ''}`);
  lines.push('');
}
lines.push('Templates', '---------');
for (const t of index) {
  const c = t.credit;
  lines.push(`${t.id}: "${t.title}" by ${c.author}. ${c.licence}. ${c.catalog}, ${c.sourceUrl}${c.note ? ` (${c.note})` : ''}`);
}
writeFileSync(join(ROOT, 'LICENSES'), `${lines.join('\n')}\n`);

// ---- served page
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const a = (href: string, text: string) => (href ? `<a href="${esc(href)}" rel="noreferrer">${esc(text)}</a>` : esc(text));
const table = (rows: Row[]) => `<table><thead><tr><th>Catalogue</th><th>By</th><th>Licence</th><th>Notes</th></tr></thead><tbody>${rows.map((r) => `<tr><td>${a(r.url, r.name)}</td><td>${esc(r.by)}</td><td>${a(r.licenceUrl, r.licence)}</td><td>${esc(r.note ?? '')}</td></tr>`).join('')}</tbody></table>`;
const tplRows = index.map((t) => `<tr data-template="${esc(t.id)}"><td>${a(t.credit.sourceUrl, t.title)}</td><td>${esc(t.category)}</td><td>${a(t.credit.authorUrl ?? '', t.credit.author)}</td><td>${a(t.credit.licenceUrl, t.credit.licence.replace('CC-BY-', 'CC BY ').replace(/-/g, ' '))}</td><td>${esc(t.credit.note ?? '')}</td></tr>`).join('');
writeFileSync(join(ROOT, 'apps/web/public/credits.html'), `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Credits and licences · Digital Canvas</title>
<link rel="icon" href="/favicon.svg">
<style>
:root{color-scheme:light dark;--bg:#fff;--ink:#1f2328;--muted:#5f6b76;--line:#e3e6ea;--link:#5b34d6}
@media (prefers-color-scheme:dark){:root{--bg:#16181c;--ink:#eceef1;--muted:#9aa3ad;--line:#2c3036;--link:#b39dff}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);font:15px/1.55 Inter,system-ui,sans-serif}
main{max-width:980px;margin:0 auto;padding:40px 20px 80px}h1{font-size:30px;margin:0 0 8px}h2{font-size:19px;margin:36px 0 8px}p{color:var(--muted);margin:6px 0 12px}
a{color:var(--link)}.wrap{overflow-x:auto}table{border-collapse:collapse;width:100%;font-size:13.5px}th,td{text-align:left;padding:7px 10px 7px 0;border-bottom:1px solid var(--line);vertical-align:top}th{color:var(--muted);font-weight:600}
</style></head><body><main>
<h1>Credits and licences</h1>
<p>Digital Canvas is open source (Apache-2.0). The content below comes from open catalogues and keeps its own licence. Everything that needs a credit keeps it on the item in your design; when you publish a design, follow the licence of what you used.</p>
${SECTIONS.map((s) => `<h2>${esc(s.title)}</h2>${s.intro ? `<p>${esc(s.intro)}</p>` : ''}<div class="wrap">${table(s.rows)}</div>`).join('\n')}
<h2>Templates (${index.length})</h2>
<p>Real designs by people in the Penpot community, from <a href="https://penpot.app/penpothub/libraries-templates" rel="noreferrer">Penpot Hub</a> (<a href="https://github.com/penpot/penpot-files" rel="noreferrer">penpot-files</a>). All were converted from <code>.penpot</code> to our format.</p>
<div class="wrap"><table data-testid="credits-templates"><thead><tr><th>Template</th><th>Kind</th><th>Author</th><th>Licence</th><th>Changes</th></tr></thead><tbody>${tplRows}</tbody></table></div>
</main></body></html>
`);
console.log(`LICENSES and credits.html: ${SECTIONS.reduce((n, s) => n + s.rows.length, 0)} catalogues, ${index.length} templates`);
