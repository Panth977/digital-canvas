import { expect, test, type Page } from '@playwright/test';
import { elements, newDesign, pngBytes } from './helpers.ts';

const select = (page: Page, ids: string[]) => page.evaluate((ids) => (window as any).__dc.select(ids), ids);

async function heading(page: Page): Promise<void> {
  await page.getByTestId('tab-text').click();
  await page.getByTestId('text-heading').click();
}

test('font size: typing keeps the value until Enter, Esc puts it back, the list has Canva sizes', async ({ page }) => {
  await newDesign(page);
  await heading(page);
  const bar = page.getByTestId('context-toolbar');
  await expect(bar.getByTestId('font-picker')).toContainText('Inter'); // the current font
  const size = page.getByTestId('font-size');
  const before = (await elements(page))[0]!.style.fontSize;
  await size.click();
  await expect(page.getByTestId('font-size-list')).toBeVisible();
  await expect(page.getByTestId('font-size-list').getByRole('option')).toHaveCount(23);
  await page.keyboard.type('1');
  await expect(size).toHaveValue('1'); // not clamped or applied while typing
  expect((await elements(page))[0]!.style.fontSize).toBe(before);
  await page.keyboard.type('2');
  await page.keyboard.press('Escape');
  await expect(size).toHaveValue(String(before));
  expect((await elements(page))[0]!.style.fontSize).toBe(before);
  await size.click();
  await page.keyboard.type('12');
  await page.keyboard.press('Enter');
  expect((await elements(page))[0]!.style.fontSize).toBe(12);
  await size.click();
  await page.getByTestId('font-size-48').click();
  expect((await elements(page))[0]!.style.fontSize).toBe(48);
  await expect(size).toHaveValue('48');
  await page.getByTestId('font-size-up').click();
  expect((await elements(page))[0]!.style.fontSize).toBe(49);
});

test('text colour bar shows every colour of mixed runs; B/I off when the font has no such face', async ({ page }) => {
  await newDesign(page);
  await heading(page);
  const [t] = await elements(page);
  await page.evaluate((id) => {
    const ed = (window as any).__dc;
    ed.setRich(id, 'Red blue', [{ text: 'Red ', style: { color: '#ff0000' } }, { text: 'blue', style: { color: '#0000ff' } }]);
    ed.seal();
  }, t!.id);
  await expect(page.getByTestId('text-color-bar')).toHaveAttribute('data-colors', '2');
  // a family with only a regular face
  await page.evaluate(() => {
    const ed = (window as any).__dc;
    ed.engine.fonts.faces.push({ family: 'Only Regular', bytes: new Uint8Array(), weight: 400, italic: false });
    ed.updateTextStyle({ fontFamily: 'Only Regular', bold: false, italic: false });
    ed.seal();
  });
  await expect(page.getByTestId('bold')).toBeDisabled();
  await expect(page.getByTestId('italic')).toBeDisabled();
  await expect(page.getByTestId('underline')).toBeEnabled();
  await page.evaluate(() => { (window as any).__dc.updateTextStyle({ fontFamily: 'Inter' }); });
  await expect(page.getByTestId('bold')).toBeEnabled();
});

test('alignment and list cycle with their icon; spacing has an anchor that keeps the bottom edge', async ({ page }) => {
  await newDesign(page);
  await heading(page);
  const align = page.getByTestId('align');
  const seen = new Set<string>();
  for (let i = 0; i < 4; i++) {
    seen.add((await elements(page))[0]!.style.align);
    seen.add((await align.innerHTML()));
    await align.click();
  }
  expect([...seen].filter((x) => !x.includes('<')).sort()).toEqual(['center', 'justify', 'left', 'right']);
  await page.getByTestId('list').click();
  expect((await elements(page))[0]!.list).toBe('bullet');
  await page.getByTestId('list').click();
  expect((await elements(page))[0]!.list).toBe('number');
  await page.getByTestId('list').click();
  expect((await elements(page))[0]!.list).toBeUndefined();

  await page.getByTestId('spacing-btn').click();
  await page.getByTestId('anchor-bottom').click();
  const [a] = await elements(page);
  expect((a as any).anchor).toBe('bottom');
  await page.getByTestId('line-height').fill('3');
  const [b] = await elements(page);
  expect(b!.h).toBeGreaterThan(a!.h);
  expect(b!.y + b!.h).toBeCloseTo(a!.y + a!.h, 3);
});

test('copy style: the roller takes a shape look onto the next element picked; Esc cancels', async ({ page }) => {
  await newDesign(page);
  await page.getByTestId('shape-rect').click();
  await page.getByTestId('shape-ellipse').click();
  const [r, e] = await elements(page);
  await page.evaluate((id) => { const ed = (window as any).__dc; ed.update({ fill: { type: 'solid', color: '#ff0000' }, opacity: 0.5 }, null, [id]); ed.seal(); }, r!.id);
  await select(page, [r!.id]);
  await page.getByTestId('copy-style').click();
  await expect(page.getByTestId('copy-style')).toHaveAttribute('aria-pressed', 'true');
  await select(page, [e!.id]);
  const [, e2] = await elements(page);
  expect((e2 as any).fill).toEqual({ type: 'solid', color: '#ff0000' });
  expect(e2!.opacity).toBe(0.5);
  await expect(page.getByTestId('copy-style')).toHaveAttribute('aria-pressed', 'false');
  // armed then Esc: nothing is pasted
  await page.getByTestId('copy-style').click();
  await page.keyboard.press('Escape');
  await select(page, [r!.id]);
  expect((await elements(page))[0]!.opacity).toBe(0.5);
});

test('transparency slider and number; tooltips name the shortcut', async ({ page }) => {
  await newDesign(page);
  await page.getByTestId('shape-rect').click();
  await page.getByTestId('opacity-btn').click();
  await page.getByTestId('opacity').fill('40');
  expect((await elements(page))[0]!.opacity).toBeCloseTo(0.4);
  await page.getByRole('spinbutton', { name: 'Transparency value' }).fill('70');
  expect((await elements(page))[0]!.opacity).toBeCloseTo(0.7);
  await page.keyboard.press('Escape');
  await heading(page);
  await page.getByTestId('bold').hover();
  const tip = page.getByTestId('tooltip');
  await expect(tip).toContainText('Bold');
  await expect(tip.locator('kbd')).toHaveText('⌘B');
  // every toolbar button has a tooltip or a label
  const unnamed = await page.getByTestId('context-toolbar').evaluate((bar) =>
    [...bar.querySelectorAll('button')].filter((b) => !b.title && !b.dataset.tip && !b.getAttribute('aria-label')).map((b) => b.outerHTML.slice(0, 80)));
  expect(unnamed).toEqual([]);
});

test('narrow window: less used tools fold into "…"', async ({ page }) => {
  await page.setViewportSize({ width: 1100, height: 800 });
  await newDesign(page);
  await heading(page);
  const bar = page.getByTestId('context-toolbar');
  await expect(bar).toHaveAttribute('data-compact', '3');
  await expect(bar.getByTestId('effects-btn')).toBeHidden();
  await expect(bar.getByTestId('copy-style')).toHaveCount(0);
  expect(await bar.evaluate((b) => b.scrollWidth <= b.clientWidth + 1)).toBe(true);
  await bar.getByTestId('more-btn').click();
  await expect(page.getByTestId('more-copy-style')).toBeVisible();
  await expect(page.getByTestId('more-effects')).toBeVisible();
  await page.getByTestId('more-opacity').click();
  await expect(page.getByTestId('opacity')).toBeVisible();
  await page.setViewportSize({ width: 1700, height: 900 });
  await expect(bar).toHaveAttribute('data-compact', '0');
  await expect(bar.getByTestId('copy-style')).toBeVisible();
});

test('animate: element and page animations from the toolbar, stored in the design', async ({ page }) => {
  await newDesign(page);
  await heading(page);
  await page.getByTestId('animate-btn').click();
  await expect(page.getByTestId('animate-panel')).toBeVisible();
  await page.getByTestId('anim-rise').click();
  expect((await elements(page))[0]!.animation?.type).toBe('rise');
  await expect(page.getByTestId('animate-btn')).toHaveText('Rise');
  await page.keyboard.press('Escape'); // nothing selected: the panel shows page animations
  await expect(page.getByTestId('context-toolbar')).toHaveAttribute('data-kind', 'page');
  await expect(page.getByTestId('anim-tab-page')).toHaveAttribute('aria-selected', 'true');
  await page.getByTestId('anim-fade').click();
  expect((await page.evaluate(() => (window as any).__dc.page.animation))?.type).toBe('fade');
});

test('colour panel: search, our own picker, photo colours, gradients, change all', async ({ page }) => {
  await newDesign(page);
  await page.getByTestId('shape-rect').click();
  await page.getByTestId('shape-ellipse').click();
  const [r, e] = await elements(page);
  await page.evaluate(([a, b]) => { const ed = (window as any).__dc; ed.update({ fill: { type: 'solid', color: '#ff3131' } }, null, [a, b]); ed.seal(); }, [r!.id, e!.id]);
  // a photo in the design gives "Photo colours"
  const png = await pngBytes(page, 40, 40, '#00bf63');
  await page.evaluate(async (b64) => {
    const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    await (window as any).__dc.addImageFile(new File([bytes], 'g.png', { type: 'image/png' }));
  }, png.toString('base64'));
  await select(page, [r!.id]);
  await page.getByTestId('fill-btn').click();
  const panel = page.getByTestId('color-panel');
  await expect(page.getByTestId('photo-colors').getByRole('button', { name: 'Colour #00bf63' })).toBeVisible();
  await expect(page.getByTestId('default-gradients')).toBeVisible();

  // search by name and by hex
  await page.getByTestId('color-search').fill('blue');
  const blues = await page.getByTestId('default-colors').getByRole('button').count();
  expect(blues).toBeGreaterThan(0);
  expect(blues).toBeLessThan(24);
  await expect(page.getByTestId('default-colors').getByRole('button', { name: 'Colour #ff3131' })).toHaveCount(0);
  await page.getByTestId('color-search').fill('#123abc');
  await page.getByTestId('color-search-hit').click();
  expect(((await elements(page))[0] as any).fill.color).toBe('#123abc');
  await page.getByTestId('color-search').fill('');

  // Change all: the ellipse shared the old red
  await expect(page.getByTestId('change-all')).toHaveText('Change all (1)');
  await page.getByTestId('change-all').click();
  expect(((await elements(page))[1] as any).fill.color).toBe('#123abc');

  // our picker, not the browser's
  await page.getByTestId('color-add').click();
  const sq = (await panel.getByTestId('cp-square').boundingBox())!;
  await page.mouse.click(sq.x + sq.width - 2, sq.y + 2); // full saturation, full brightness
  const c = ((await elements(page))[0] as any).fill.color as string;
  expect(c).not.toBe('#123abc');
  expect(await page.locator('input[type=color]').count()).toBe(0);
  const hue = (await panel.getByTestId('cp-hue').boundingBox())!;
  await page.mouse.click(hue.x + 1, hue.y + hue.height / 2); // red end of the hue bar
  expect(((await elements(page))[0] as any).fill.color).toMatch(/^#f[c-f][0-1][0-9a-f]0[0-9a-f]$/);

  // a default gradient
  await page.getByTestId('gradient-0').click();
  expect(((await elements(page))[0] as any).fill.type).toBe('linear');
});
