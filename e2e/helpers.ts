import { expect, type Page } from '@playwright/test';

/** Hosts of the side panels' free content libraries (Iconify, Openverse, Wikimedia, NASA). */
export const CONTENT_HOSTS = /^https:\/\/(api\.iconify\.design|api\.openverse\.org|commons\.wikimedia\.org|upload\.wikimedia\.org|images-api\.nasa\.gov|images-assets\.nasa\.gov)\//;

/**
 * Create a design from a preset and wait for the editor. The content
 * libraries are answered offline (empty) so tests never hit those APIs;
 * a test that needs results routes them after this (later routes win).
 */
export async function newDesign(page: Page, preset = 'instagram-post'): Promise<void> {
  await page.route(CONTENT_HOSTS, (r) => r.fulfill({ status: 503, body: 'offline in tests' }));
  await page.goto('/');
  await page.getByTestId(`preset-${preset}`).click();
  await expect(page.getByTestId('canvas')).toBeVisible();
  await page.waitForFunction(() => !!(window as any).__dc);
}

export type El = { id: string; type: string; x: number; y: number; w: number; h: number; rotation: number; text?: string; style?: any; opacity: number };

export function elements(page: Page, pageIndex = 0): Promise<El[]> {
  return page.evaluate((i) => (window as any).__dc.doc.pages[i].elements, pageIndex);
}

export function doc(page: Page): Promise<any> {
  return page.evaluate(() => (window as any).__dc.doc);
}

/** Screen centre of the (single) selection, from the overlay polygon. */
export async function selectionCenter(page: Page): Promise<{ x: number; y: number }> {
  const pts = await page.locator('svg.overlay polygon.sel').first().getAttribute('points');
  const stage = (await page.getByTestId('stage').boundingBox())!;
  const xy = pts!.split(' ').map((p) => p.split(',').map(Number) as [number, number]);
  const cx = xy.reduce((s, p) => s + p[0], 0) / xy.length, cy = xy.reduce((s, p) => s + p[1], 0) / xy.length;
  return { x: stage.x + cx, y: stage.y + cy };
}

/** Screen position of a handle circle (corner) by index: 0 nw, 1 ne, 2 se, 3 sw. */
export async function handle(page: Page, index: number): Promise<{ x: number; y: number }> {
  const c = page.locator('svg.overlay circle.handle').nth(index);
  const stage = (await page.getByTestId('stage').boundingBox())!;
  return { x: stage.x + Number(await c.getAttribute('cx')), y: stage.y + Number(await c.getAttribute('cy')) };
}

export async function drag(page: Page, from: { x: number; y: number }, to: { x: number; y: number }): Promise<void> {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move((from.x + to.x) / 2, (from.y + to.y) / 2, { steps: 4 });
  await page.mouse.move(to.x, to.y, { steps: 4 });
  await page.mouse.up();
}

export async function waitSaved(page: Page): Promise<void> {
  await expect(page.getByTestId('save-state')).toContainText('Saved', { timeout: 10_000 });
}

/** A small solid-colour PNG made in the browser. */
export async function pngBytes(page: Page, w: number, h: number, color: string): Promise<Buffer> {
  const b64 = await page.evaluate(async ([w, h, color]) => {
    const c = new OffscreenCanvas(w as number, h as number);
    const g = c.getContext('2d')!;
    g.fillStyle = color as string;
    g.fillRect(0, 0, w as number, h as number);
    const blob = await c.convertToBlob({ type: 'image/png' });
    const buf = new Uint8Array(await blob.arrayBuffer());
    let s = '';
    for (const b of buf) s += String.fromCharCode(b);
    return btoa(s);
  }, [w, h, color]);
  return Buffer.from(b64, 'base64');
}
