import { expect, test } from '@playwright/test';
import { doc, elements, newDesign, pngBytes } from './helpers.ts';
import { SVG_ICON, stubFonts, stubIconify } from './module-stubs.ts';

const openApp = async (page: import('@playwright/test').Page, id: string) => {
  await page.getByTestId('tab-apps').click();
  await page.getByTestId(`app-${id}`).click();
};

test('apps: directory, search and Iconify sets', async ({ page }) => {
  await stubIconify(page);
  await newDesign(page);
  await page.getByTestId('tab-apps').click();
  await expect(page.getByTestId('apps-panel').locator('.appcard')).toHaveCount(13);
  await page.getByTestId('apps-search').fill('photo');
  await expect(page.getByTestId('apps-panel').locator('.appcard')).toHaveCount(2); // Openverse, Wikimedia
  await page.getByTestId('apps-search').fill('');
  await page.getByTestId('app-iconify').click();
  await page.getByTestId('app-icon-search').fill('star');
  await page.getByTestId('app-icon-search').press('Enter');
  await expect(page.getByTestId('app-icon-results').locator('button')).toHaveCount(2);
  await page.getByTestId('app-icon-results').locator('button').first().click();
  await expect.poll(async () => (await elements(page)).length).toBe(1);
  expect(((await elements(page))[0] as any).name).toBe('mdi:star');
  await page.getByTestId('apps-back').click();
  await expect(page.getByTestId('app-emoji')).toBeVisible();
});

test('apps: Noto emoji come in as pictures', async ({ page }) => {
  await stubIconify(page, ['noto:star-struck']);
  await newDesign(page);
  await openApp(page, 'emoji');
  await expect(page.getByTestId('app-emoji-results').locator('button')).toHaveCount(24); // popular set
  await page.getByTestId('app-emoji-search').fill('star');
  await page.getByTestId('app-emoji-search').press('Enter');
  await expect(page.getByTestId('app-emoji-results').locator('button')).toHaveCount(1);
  await page.getByTestId('app-emoji-results').locator('button').click();
  await expect.poll(async () => (await elements(page)).length).toBe(1);
  const [img] = (await elements(page)) as any[];
  expect(img.type).toBe('image');
  expect((await doc(page)).assets[img.asset].name).toContain('Noto Emoji');
});

test('apps: Wikimedia Commons images keep their credit', async ({ page }) => {
  await newDesign(page);
  const png = await pngBytes(page, 90, 60, '#3355ff');
  await page.route('https://commons.wikimedia.org/w/api.php?*', (r) => r.fulfill({ json: { query: { pages: { 7: { pageid: 7, title: 'File:Taj Mahal.jpg', index: 1, imageinfo: [{ thumburl: 'https://upload.wikimedia.org/taj.png', url: 'https://upload.wikimedia.org/taj-full.jpg', mime: 'image/jpeg', descriptionurl: 'https://commons.wikimedia.org/wiki/File:Taj_Mahal.jpg', extmetadata: { Artist: { value: '<a href="x">Yann</a>' }, LicenseShortName: { value: 'CC BY-SA 4.0' } } }] } } } } }));
  await page.route('https://upload.wikimedia.org/taj.png', (r) => r.fulfill({ body: png, contentType: 'image/png' }));
  await openApp(page, 'wikimedia');
  await page.getByTestId('app-wiki-search').fill('taj mahal');
  await page.getByTestId('app-wiki-search').press('Enter');
  await page.getByTestId('app-wiki-results').locator('button').click();
  await expect.poll(async () => (await elements(page)).length).toBe(1);
  const [img] = (await elements(page)) as any[];
  expect((await doc(page)).assets[img.asset].name).toBe('"Taj Mahal" by Yann (CC BY-SA 4.0) https://commons.wikimedia.org/wiki/File:Taj_Mahal.jpg');
});

test('apps: a map of a place from OpenStreetMap', async ({ page }) => {
  await newDesign(page);
  const tile = await pngBytes(page, 256, 256, '#aad3df');
  const tiles: string[] = [];
  await page.route('https://nominatim.openstreetmap.org/search?*', (r) => r.fulfill({ json: [{ display_name: 'Pune, Maharashtra, India', lat: '18.52', lon: '73.85', type: 'city' }] }));
  await page.route('https://tile.openstreetmap.org/**', (r) => { tiles.push(r.request().url()); return r.fulfill({ body: tile, contentType: 'image/png' }); });
  await openApp(page, 'maps');
  await page.getByTestId('app-map-search').fill('Pune');
  await page.getByTestId('app-map-search').press('Enter');
  await page.getByTestId('app-map-results').locator('button').click();
  await expect(page.getByTestId('app-map-preview')).toBeVisible();
  expect(tiles.length).toBeGreaterThan(4);
  expect(tiles.every((u) => /\/12\/\d+\/\d+\.png$/.test(u))).toBe(true); // city zoom
  await page.getByTestId('app-map-add').click();
  await expect.poll(async () => (await elements(page)).length).toBe(1);
  const [img] = (await elements(page)) as any[];
  const meta = (await doc(page)).assets[img.asset];
  expect(meta).toMatchObject({ mime: 'image/png', width: 1200, height: 800 });
  expect(meta.name).toContain('© OpenStreetMap contributors');
});

test('apps: DiceBear avatars', async ({ page }) => {
  await newDesign(page);
  const png = await pngBytes(page, 512, 512, '#ffcc00');
  const asked: string[] = [];
  await page.route('https://api.dicebear.com/**', (r) => {
    asked.push(r.request().url());
    return r.request().url().includes('/png') ? r.fulfill({ body: png, contentType: 'image/png' }) : r.fulfill({ body: SVG_ICON, contentType: 'image/svg+xml' });
  });
  await openApp(page, 'avatars');
  await expect(page.getByTestId('app-avatar-results').locator('button')).toHaveCount(9);
  await page.getByTestId('app-avatar-results').locator('button').first().click();
  await expect.poll(async () => (await elements(page)).length).toBe(1);
  expect(asked.some((u) => u.startsWith('https://api.dicebear.com/9.x/notionists/png?seed=Panth'))).toBe(true);
  const [img] = (await elements(page)) as any[];
  expect((await doc(page)).assets[img.asset].name).toContain('DiceBear Notionists');
});

test('apps: pattern, gradient and palette generators', async ({ page }) => {
  await newDesign(page);
  await page.getByTestId('shape-rect').click();
  await openApp(page, 'patterns');
  await page.getByTestId('pattern-checker').click();
  await page.getByTestId('pattern-bg').click();
  let els = (await elements(page)) as any[];
  expect(els).toHaveLength(2);
  expect(els[0].type).toBe('path'); // behind the rect
  expect(els[0].name).toBe('Pattern: checker');
  expect([els[0].w, els[0].h]).toEqual([1080, 1080]);

  await page.getByTestId('apps-back').click();
  await page.getByTestId('app-gradients').click();
  await page.getByTestId('gradient-Ocean').click();
  await page.getByTestId('gradient-page').click();
  expect((await doc(page)).pages[0].background).toEqual({ type: 'linear', angle: 135, stops: [{ offset: 0, color: '#2193b0' }, { offset: 1, color: '#6dd5ed' }] });

  await page.getByTestId('apps-back').click();
  await page.getByTestId('app-palettes').click();
  await page.getByTestId('palette-base').fill('#e11d48');
  const palette = await page.getByTestId('palette-swatches').locator('button').evaluateAll((bs) => bs.map((b) => b.getAttribute('title')!.slice(6)));
  expect(palette).toHaveLength(5);
  await page.getByTestId('palette-recolor').click();
  els = (await elements(page)) as any[];
  expect(palette).toContain(els[1].fill.color); // the rect took a palette colour
  await page.getByTestId('palette-save').click();
  await page.getByTestId('tab-brand').click();
  await expect(page.getByTestId('brand-swatch')).toHaveCount(5);
});

test('apps: Google Fonts, QR codes and charts', async ({ page }) => {
  await stubFonts(page, ['Lobster', 'Lato']);
  await newDesign(page);
  await openApp(page, 'fonts');
  await page.getByTestId('app-font-search').fill('lob');
  await page.getByRole('button', { name: /Lobster/ }).click();
  await expect.poll(async () => (await elements(page))[0]?.style?.fontFamily).toBe('Lobster');
  await page.getByTestId('apps-back').click();
  await page.getByTestId('app-qr').click();
  await page.getByTestId('app-qr-text').fill('hello');
  await page.getByTestId('app-qr-add').click();
  expect(((await elements(page)).at(-1) as any).qr).toBe('hello');
  await page.getByTestId('apps-back').click();
  await page.getByTestId('app-charts').click();
  await page.getByTestId('app-chart-line').click();
  expect(((await elements(page)).at(-1) as any).chart).toBe('line');
});
