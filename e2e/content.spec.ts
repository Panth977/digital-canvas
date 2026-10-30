import { readFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import { doc, elements, newDesign, pngBytes } from './helpers.ts';

/**
 * The content panels (Elements, Text, Photos, Videos, Audio) against
 * offline copies of the open APIs: every request to Iconify, Openverse,
 * Wikimedia, NASA and Fontsource is answered here.
 */

const fixture = (name: string) => readFileSync(new URL(`./fixtures/${name}`, import.meta.url));
const INTER = readFileSync(new URL('../apps/web/public/fonts/Inter-Bold.ttf', import.meta.url));

const FLAT = (fill: string) => `<path fill="${fill}" d="M4 4h24v24H4z"/><circle cx="16" cy="16" r="6" fill="#222"/>`;
const GRADIENT = '<defs><linearGradient id="a"><stop offset="0" stop-color="#f00"/><stop offset="1" stop-color="#00f"/></linearGradient></defs><path fill="url(#a)" d="M4 4h24v24H4z"/>';

/** Answer the content libraries with small fixtures. Call after `newDesign` (later routes win). */
async function stubLibraries(page: Page): Promise<{ urls: string[] }> {
  const urls: string[] = [];
  const png = await pngBytes(page, 60, 40, '#22aa66');
  const tall = await pngBytes(page, 40, 60, '#aa2266');
  // Iconify: search, collections (browse) and batched icon JSON
  await page.route('https://api.iconify.design/search?*', (r) => {
    const q = new URL(r.request().url()).searchParams;
    urls.push(r.request().url());
    const prefixes = q.get('prefixes') ?? '';
    const icons = prefixes.startsWith('fluent-emoji-flat') ? ['fluent-emoji-flat:cat-face', 'fluent-emoji:cat-3d']
      : prefixes.startsWith('fluent-color') ? ['fluent-color:cat-graphic'] : ['mdi:cat'];
    return r.fulfill({ json: { icons } });
  });
  await page.route('https://api.iconify.design/collection?*', (r) => {
    const prefix = new URL(r.request().url()).searchParams.get('prefix')!;
    return r.fulfill({ json: { prefix, categories: { All: Array.from({ length: 60 }, (_, i) => `${prefix.slice(0, 4)}-${i}`) } } });
  });
  await page.route(/^https:\/\/api\.iconify\.design\/[a-z0-9-]+\.json\?/, (r) => {
    const u = new URL(r.request().url());
    const prefix = u.pathname.slice(1, -5);
    const names = u.searchParams.get('icons')!.split(',');
    return r.fulfill({ json: { prefix, width: 32, height: 32, icons: Object.fromEntries(names.map((n) => [n, { body: prefix === 'fluent-emoji' ? GRADIENT : FLAT(prefix === 'mdi' ? 'currentColor' : '#ffcc00') }])) } });
  });
  // Openverse photos and sounds
  await page.route('https://api.openverse.org/v1/images/?*', (r) => {
    urls.push(r.request().url());
    return r.fulfill({ json: { page_count: 1, results: [
      { id: 'p1', title: 'Green field', creator: 'Ana', license: 'by', license_version: '4.0', url: 'https://photos.example/p1.png', thumbnail: 'https://api.openverse.org/v1/images/p1/thumb/', foreign_landing_url: 'https://photos.example/p1', width: 60, height: 40 },
      { id: 'p2', title: 'Red door', creator: 'Bo', license: 'cc0', license_version: '1.0', url: 'https://photos.example/p2.png', thumbnail: 'https://api.openverse.org/v1/images/p2/thumb/', foreign_landing_url: 'https://photos.example/p2', width: 40, height: 60 },
    ] } });
  });
  await page.route('https://api.openverse.org/v1/images/*/thumb/', (r) => r.fulfill({ body: png, contentType: 'image/png' }));
  await page.route('https://photos.example/**', (r) => r.fulfill({ body: r.request().url().includes('p2') ? tall : png, contentType: 'image/png' }));
  await page.route('https://api.openverse.org/v1/audio/?*', (r) => {
    urls.push(r.request().url());
    return r.fulfill({ json: { page_count: 1, results: [
      { id: 'a1', title: 'Happy Tune.mp3', creator: 'Jo', license: 'by', license_version: '4.0', url: 'https://cdn.freesound.org/previews/tone.mp3', foreign_landing_url: 'https://freesound.org/s/1', duration: 3000 },
    ] } });
  });
  await page.route('https://cdn.freesound.org/**', (r) => r.fulfill({ body: fixture('tone.mp3'), contentType: 'audio/mpeg' }));
  // Wikimedia Commons: one photo, one video, no sounds
  await page.route('https://commons.wikimedia.org/w/api.php?*', (r) => {
    const s = new URL(r.request().url()).searchParams.get('gsrsearch') ?? '';
    urls.push(r.request().url());
    const meta = { LicenseShortName: { value: 'CC BY-SA 4.0' }, Artist: { value: '<a href="//commons">Cy</a>' } };
    if (s.includes('filetype:bitmap')) return r.fulfill({ json: { query: { pages: { 1: { title: 'File:Blue_lake.jpg', index: 1, imageinfo: [{
      url: 'https://upload.wikimedia.org/c/Blue_lake.jpg', descriptionurl: 'https://commons.wikimedia.org/wiki/File:Blue_lake.jpg', mime: 'image/jpeg', width: 60, height: 40,
      thumburl: 'https://upload.wikimedia.org/thumb/c/Blue_lake.jpg/330px-Blue_lake.jpg', extmetadata: meta }] } } } } });
    if (s.includes('filetype:video')) return r.fulfill({ json: { query: { pages: { 1: { title: 'File:Ocean_waves.webm', index: 1,
      imageinfo: [{ url: 'https://upload.wikimedia.org/v/Ocean_waves.webm', descriptionurl: 'https://commons.wikimedia.org/wiki/File:Ocean_waves.webm', mime: 'video/webm', width: 320, height: 240, duration: 2,
        thumburl: 'https://upload.wikimedia.org/thumb/v/Ocean_waves.webm/330px--Ocean_waves.webm.jpg', extmetadata: meta }],
      videoinfo: [{ derivatives: [{ src: 'https://upload.wikimedia.org/transcoded/v/Ocean_waves.webm.240p.vp9.webm', type: 'video/webm; codecs="vp9"', transcodekey: '240p.vp9.webm', width: 320, height: 240, bandwidth: 100000 }] }] } } } } });
    return r.fulfill({ json: { batchcomplete: '' } });
  });
  await page.route('https://upload.wikimedia.org/**', (r) => (r.request().url().endsWith('.webm')
    ? r.fulfill({ body: fixture('clip.webm'), contentType: 'video/webm' })
    : r.fulfill({ body: png, contentType: 'image/png' })));
  await page.route('https://images-api.nasa.gov/**', (r) => r.fulfill({ json: { collection: { items: [] } } }));
  return { urls };
}

/** Fontsource: a tiny catalogue whose files are Inter (made unique per URL so each face is its own asset). */
async function stubFonts(page: Page): Promise<void> {
  const font = (id: string, family: string, category: string) => ({ id, family, category, weights: [400, 700], styles: ['normal'], subsets: ['latin'] });
  await page.route('https://api.fontsource.org/v1/fonts', (r) => r.fulfill({ json: [font('lobster', 'Lobster', 'display'), font('archivo-black', 'Archivo Black', 'sans-serif'), font('archivo', 'Archivo', 'sans-serif'), font('space-grotesk', 'Space Grotesk', 'sans-serif'), font('space-mono', 'Space Mono', 'monospace')] }));
  await page.route('https://api.fontsource.org/v1/fonts/*', (r) => {
    const id = r.request().url().split('/').pop();
    const v = (w: number) => ({ normal: { latin: { url: { ttf: `https://cdn.jsdelivr.net/fontsource/fonts/${id}@latest/latin-${w}-normal.ttf` } } } });
    return r.fulfill({ json: { unicodeRange: { latin: 'U+0000-00FF' }, variants: { 400: v(400), 700: v(700) } } });
  });
  await page.route('https://cdn.jsdelivr.net/fontsource/**', (r) => {
    const url = r.request().url();
    if (!url.endsWith('.ttf')) return r.fulfill({ status: 404, body: '' });
    return r.fulfill({ body: Buffer.concat([INTER, Buffer.from(url)]), contentType: 'font/ttf' });
  });
}

async function searchElements(page: Page, q: string): Promise<void> {
  await page.getByTestId('elements-search').fill(q);
  await page.getByTestId('elements-search').press('Enter');
}

test('elements: one search across every library, tabs, vector and picture stickers, photos, recently used', async ({ page }) => {
  await newDesign(page);
  await stubLibraries(page);
  await searchElements(page, 'cat');
  for (const t of ['all', 'graphics', 'stickers', 'photos', 'videos', 'audio', 'icons']) await expect(page.getByTestId(`etab-${t}`)).toBeVisible();
  await expect(page.getByTestId('etab-shapes')).toHaveCount(0); // nothing called "cat" among the shapes
  // All: a row per library
  await expect(page.getByTestId('row-stickers').locator('.tile')).toHaveCount(2);
  await expect(page.getByTestId('row-graphics').locator('.tile')).toHaveCount(1);
  await expect(page.getByTestId('row-photos').locator('.tile')).toHaveCount(3); // Openverse and Commons together
  await expect(page.getByTestId('row-videos').locator('.tile')).toHaveCount(1);
  await expect(page.getByTestId('row-audio').locator('.track')).toHaveCount(1);

  // Stickers tab: a flat sticker is a vector, a gradient one a picture
  await page.getByTestId('etab-stickers').click();
  const grid = page.getByTestId('element-results');
  await expect(grid.locator('.tile')).toHaveCount(2);
  await grid.getByRole('button', { name: 'Add sticker Cat face' }).click();
  await expect.poll(async () => (await elements(page)).length).toBe(1);
  const [st] = (await elements(page)) as any[];
  expect(st.type).toBe('path');
  expect(st.name).toBe('fluent-emoji-flat:cat-face');
  expect(st.paths.map((p: any) => p.fill.color)).toEqual(['#ffcc00', '#222222']);
  await grid.getByRole('button', { name: 'Add sticker Cat 3d' }).click();
  await expect.poll(async () => (await elements(page)).length).toBe(2);
  const pic = (await elements(page))[1] as any;
  expect(pic.type).toBe('image');
  expect((await doc(page)).assets[pic.asset].mime).toBe('image/png');

  // Photos tab: credit kept with the asset
  await page.getByTestId('etab-photos').click();
  await page.getByTestId('element-results').getByRole('button', { name: 'Add photo Green field' }).click();
  await expect.poll(async () => (await elements(page)).length).toBe(3);
  const ph = (await elements(page))[2] as any;
  expect((await doc(page)).assets[ph.asset].name).toBe('"Green field" by Ana (CC BY 4.0) https://photos.example/p1');

  // a search that names shapes shows them too
  await searchElements(page, 'star');
  await expect(page.getByTestId('row-shapes').getByTestId('shape-star')).toBeVisible();

  // back home: recently used, newest first
  await page.getByRole('button', { name: 'Clear search' }).click();
  const recentRow = page.getByTestId('row-recent');
  await expect(recentRow.locator('.tile')).toHaveCount(3);
  await expect(recentRow.locator('.tile').first()).toHaveAttribute('data-key', 'openverse:p1');
  // and it survives a reload (localStorage)
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('dc.recent.v1')!).length)).toBe(3);
});

test('elements: browse a category with endless scrolling, built-in categories, back', async ({ page }) => {
  await newDesign(page);
  await stubLibraries(page);
  await page.getByTestId('cat-stickers').click();
  const grid = page.getByTestId('element-results');
  await expect(grid).toHaveAttribute('data-count', '48');
  await page.getByTestId('elements-panel').locator('div.pbody').evaluate((el) => el.scrollTo(0, el.scrollHeight));
  await expect(grid).toHaveAttribute('data-count', '96');
  await page.getByTestId('cat-back').click();
  await expect(page.getByText('Browse categories')).toBeVisible();

  await page.getByTestId('cat-tables').click();
  await page.getByTestId('table-4x3').click();
  const [t] = (await elements(page)) as any[];
  expect(t.type).toBe('table');
  expect([t.rows.length, t.cols.length]).toEqual([4, 3]);
  await page.getByTestId('cat-back').click();
  await page.getByTestId('cat-shapes').click();
  await page.getByTestId('shape-pentagon').click();
  expect(((await elements(page))[1] as any).shape).toBe('pentagon');
});

test('elements: Open Doodles show without the network and come in as a credited picture', async ({ page }) => {
  await newDesign(page);
  await stubLibraries(page);
  await page.getByTestId('cat-illustrations').click();
  const grid = page.getByTestId('element-results');
  await expect(grid.getByRole('button', { name: 'Coffee' })).toBeVisible();
  await grid.getByRole('button', { name: 'Coffee' }).click();
  await expect.poll(async () => (await elements(page)).length).toBe(1);
  const [img] = (await elements(page)) as any[];
  expect(img.type).toBe('image');
  const meta = (await doc(page)).assets[img.asset];
  expect(meta.mime).toBe('image/png');
  expect(meta.name).toContain('Pablo Stanley');
  expect(meta.name).toContain('CC0');
});

test('elements: drag a sticker from the panel onto the page', async ({ page }) => {
  await newDesign(page);
  await stubLibraries(page);
  await searchElements(page, 'cat');
  await page.getByTestId('etab-stickers').click();
  const tile = page.getByTestId('element-results').getByRole('button', { name: 'Add sticker Cat face' });
  const bar = (await page.locator('.pagebar').boundingBox())!;
  const stage = (await page.getByTestId('stage').boundingBox())!;
  // drop near the page's top-left corner
  await tile.dragTo(page.getByTestId('stage'), { targetPosition: { x: bar.x - stage.x + bar.width * 0.2, y: bar.y - stage.y + 34 + bar.width * 0.2 } });
  await expect.poll(async () => (await elements(page)).length).toBe(1);
  const [el] = await elements(page);
  const d = await doc(page);
  expect(el!.x + el!.w / 2).toBeCloseTo(d.width * 0.2, -1.5);
  expect(el!.y + el!.h / 2).toBeCloseTo(d.height * 0.2, -1.5);
});

test('text: font combinations add a styled group with its fonts embedded', async ({ page }) => {
  await newDesign(page);
  await stubFonts(page);
  await page.getByTestId('tab-text').click();
  await expect(page.getByTestId('combos').locator('.combo')).toHaveCount(12);
  await page.getByTestId('see-combos').click();
  expect(await page.locator('.combo').count()).toBeGreaterThanOrEqual(30);
  await page.getByTestId('combo-brutalist').click();
  await expect.poll(async () => (await elements(page)).length).toBe(1);
  const [g] = (await elements(page)) as any[];
  expect(g.type).toBe('group');
  expect(g.children.map((c: any) => [c.text, c.style.fontFamily, c.style.bold])).toEqual([['Archivo Black', 'Archivo Black', true], ['Archivo', 'Archivo', false]]);
  const families = new Set((await doc(page)).fonts.map((f: any) => f.family));
  expect(families.has('Archivo Black') && families.has('Archivo')).toBe(true);
  // one undo removes the whole combination
  await page.getByTestId('undo').click();
  expect(await elements(page)).toHaveLength(0);
});

test('text: font library; a font adds a text box, or restyles the selected text; recent fonts', async ({ page }) => {
  await newDesign(page);
  await stubFonts(page);
  await page.getByTestId('tab-text').click();
  await page.getByTestId('browse-fonts').click();
  await expect(page.getByTestId('fontlib-results').locator('.font')).toHaveCount(3);
  await page.getByTestId('fontcat-monospace').click();
  await expect(page.getByTestId('fontlib-results').locator('.font')).toHaveCount(1);
  await page.getByTestId('fontcat-monospace').click(); // stays on monospace
  await page.getByRole('button', { name: 'All', exact: true }).click();
  await page.getByTestId('fontlib-search').fill('lob');
  await expect(page.getByTestId('fontlib-results').locator('.font')).toHaveCount(1);
  // nothing selected: a new text box in that font
  await page.getByTestId('fontlib-results').locator('[data-font="Lobster"]').click();
  await expect.poll(async () => (await elements(page))[0]?.style.fontFamily, { timeout: 15_000 }).toBe('Lobster');
  expect(await elements(page)).toHaveLength(1);

  // home lists it as recent
  await page.getByTestId('text-back').click();
  await expect(page.locator('.font', { hasText: 'Lobster' }).locator('em')).toHaveText('recent');

  // with text selected: restyle it
  await page.getByTestId('text-heading').click();
  await page.getByTestId('text-search').fill('mono');
  await page.getByTestId('text-font-results').locator('[data-font="Space Mono"]').click();
  await expect.poll(async () => (await elements(page))[1]?.style.fontFamily, { timeout: 15_000 }).toBe('Space Mono');
  expect(await elements(page)).toHaveLength(2);
});

test('photos panel: topics, search across sources, source filter, credit', async ({ page }) => {
  await newDesign(page);
  const { urls } = await stubLibraries(page);
  await page.getByTestId('tab-photos').click();
  const grid = page.getByTestId('photo-results');
  await expect(grid.locator('.tile')).toHaveCount(3);
  // interleaved: Openverse, Commons, Openverse
  expect(await grid.locator('.tile').evaluateAll((ts) => ts.map((t) => t.getAttribute('data-key')))).toEqual(['openverse:p1', 'commons:Blue_lake.jpg', 'openverse:p2']);
  await page.getByTestId('topic-food').click();
  await expect.poll(() => urls.some((u) => u.includes('q=food'))).toBe(true);
  await page.getByTestId('photo-search').fill('lake');
  await page.getByTestId('photo-search').press('Enter');
  await page.getByTestId('photo-source').selectOption('commons');
  await expect(grid.locator('.tile')).toHaveCount(1);
  await grid.locator('.tile').first().click();
  await expect.poll(async () => (await elements(page)).length).toBe(1);
  const [img] = (await elements(page)) as any[];
  expect((await doc(page)).assets[img.asset].name).toBe('"Blue lake" by Cy (CC BY-SA 4.0) https://commons.wikimedia.org/wiki/File:Blue_lake.jpg');
});

test('videos panel: duration badge, hover preview, add a clip with progress', async ({ page }) => {
  test.setTimeout(60_000);
  await newDesign(page);
  await stubLibraries(page);
  await page.getByTestId('tab-videos').click();
  const tile = page.getByTestId('video-results').locator('.tile').first();
  await expect(tile.locator('.badge')).toHaveText('0:02');
  await tile.hover();
  await expect(tile.locator('video')).toHaveAttribute('src', /240p\.vp9\.webm$/);
  await tile.click();
  await expect.poll(async () => (await elements(page)).map((e) => e.type), { timeout: 20_000 }).toEqual(['video']);
  const v = (await elements(page))[0] as any;
  const d = await doc(page);
  expect(d.assets[v.asset].mime).toBe('video/webm');
  expect(d.assets[v.asset].name).toMatch(/^"Ocean waves" by Cy \(CC BY-SA 4\.0\)/);
  expect(d.assets[v.asset].duration).toBeCloseTo(2, 0);
});

test('audio panel: music and sound effects, preview, add to the timeline', async ({ page }) => {
  await newDesign(page);
  const { urls } = await stubLibraries(page);
  await page.getByTestId('tab-sounds').click();
  const list = page.getByTestId('audio-results');
  await expect(list.locator('.track')).toHaveCount(1);
  expect(urls.some((u) => u.includes('/audio/') && u.includes('category=music'))).toBe(true);
  await list.getByRole('button', { name: 'Play Happy Tune' }).click();
  await expect(list.getByRole('button', { name: 'Pause Happy Tune' })).toBeVisible();
  await list.getByRole('button', { name: 'Pause Happy Tune' }).click();
  await list.getByRole('button', { name: 'Add audio Happy Tune' }).click();
  await expect.poll(async () => (await doc(page)).audio?.length ?? 0, { timeout: 15_000 }).toBe(1);
  const d = await doc(page);
  expect(d.audio[0].name).toBe('Happy Tune');
  expect(d.audio[0].duration).toBeGreaterThan(0);
  expect(d.assets[d.audio[0].asset].name).toBe('"Happy Tune" by Jo (CC BY 4.0) https://freesound.org/s/1');
  await page.getByTestId('mode-sfx').click();
  await expect.poll(() => urls.some((u) => u.includes('category=sound_effect'))).toBe(true);
});
