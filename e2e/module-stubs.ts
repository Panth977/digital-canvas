import { readFileSync } from 'node:fs';
import type { Page } from '@playwright/test';

/** Shared stubs for the rail-module specs (no real network). */

const INTER = readFileSync(new URL('../apps/web/public/fonts/Inter-Regular.ttf', import.meta.url));

/**
 * Google Fonts via Fontsource: the catalogue lists `families`, and every face
 * downloads as Inter (a real TTF, so the renderer accepts it).
 */
export async function stubFonts(page: Page, families: string[]): Promise<void> {
  const id = (f: string) => f.toLowerCase().replace(/\s+/g, '-');
  await page.route('https://api.fontsource.org/v1/fonts', (r) => r.fulfill({
    json: families.map((family) => ({ id: id(family), family, category: 'display', weights: [400, 700], styles: ['normal'], subsets: ['latin'] })),
  }));
  await page.route('https://api.fontsource.org/v1/fonts/*', (r) => {
    const fid = r.request().url().split('/').pop()!;
    return r.fulfill({ json: { unicodeRange: { latin: 'U+0000-00FF' }, variants: { 400: { normal: { latin: { url: { ttf: `https://cdn.example/fonts/${fid}-400.ttf` } } } }, 700: { normal: { latin: { url: { ttf: `https://cdn.example/fonts/${fid}-700.ttf` } } } } } } });
  });
  // distinct bytes per face (trailing bytes are ignored by font parsers), so each is its own asset
  await page.route('https://cdn.example/fonts/*', (r) => r.fulfill({ body: Buffer.concat([INTER, Buffer.from(r.request().url())]), contentType: 'font/ttf' }));
  await page.route('https://cdn.jsdelivr.net/fontsource/**', (r) => r.fulfill({ status: 404, body: '' }));
}

export const SVG_ICON = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path fill="#f59e0b" d="M12 2l3 7h7l-5.5 4 2 7-6.5-4.5L5.5 20l2-7L2 9h7z"/></svg>';

/** Iconify: every search finds two icons, every icon is a star. */
export async function stubIconify(page: Page, icons = ['mdi:star', 'mdi:star-outline']): Promise<void> {
  await page.route('https://api.iconify.design/search?*', (r) => r.fulfill({ json: { icons } }));
  await page.route(/https:\/\/api\.iconify\.design\/[\w-]+\/[\w-]+\.svg/, (r) => r.fulfill({ body: SVG_ICON, contentType: 'image/svg+xml' }));
}

/** Screen position of page coordinates on the current page. */
export function screenOf(page: Page, p: { x: number; y: number }): Promise<{ x: number; y: number }> {
  return page.evaluate(([x, y]) => {
    const stage = document.querySelector('[data-testid="stage"]')!.getBoundingClientRect();
    const bar = document.querySelector('.pagebar') as HTMLElement;
    const zoom = parseFloat(bar.style.width) / (window as any).__dc.doc.width;
    const left = parseFloat(bar.style.left), top = parseFloat(bar.style.top) + 34;
    return { x: stage.left + left + (x as number) * zoom, y: stage.top + top + (y as number) * zoom };
  }, [p.x, p.y]);
}

/** A Claude Messages API reply. */
export function claudeReply(text: string) {
  return { id: 'msg_test', type: 'message', role: 'assistant', model: 'claude-sonnet-5-5', content: [{ type: 'text', text }], stop_reason: 'end_turn', stop_sequence: null, usage: { input_tokens: 10, output_tokens: 10 } };
}

const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': 'POST, OPTIONS' };

/** Stub the Messages API: `handle` gets each POST (preflights are answered here). */
export async function stubClaude(page: Page, handle: (req: import('@playwright/test').Request, headers: Record<string, string>) => { status?: number; json: unknown }): Promise<void> {
  await page.route('https://api.anthropic.com/**', async (r) => {
    if (r.request().method() === 'OPTIONS') return r.fulfill({ status: 204, headers: CORS });
    const out = handle(r.request(), await r.request().allHeaders());
    return r.fulfill({ status: out.status ?? 200, json: out.json, headers: CORS });
  });
}
