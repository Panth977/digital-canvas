import { readFileSync } from 'node:fs';
import type { Page } from '@playwright/test';

/** The synthetic mockup library (tools/mockups/fixtures.ts). */
const LIB = new URL('./fixtures/mockups/', import.meta.url);

/** Serve /mockups/** from e2e/fixtures/mockups (404 for anything missing). */
export async function routeMockups(page: Page): Promise<void> {
  // only the site's /mockups/ folder (not the app's own src/lib/mockups modules)
  await page.route(/^https?:\/\/[^/]+\/mockups\//, (r) => {
    const path = new URL(r.request().url()).pathname.replace(/^\/mockups\//, '');
    try {
      const body = readFileSync(new URL(path, LIB));
      const type = path.endsWith('.json') ? 'application/json' : path.endsWith('.png') ? 'image/png' : 'image/jpeg';
      return r.fulfill({ status: 200, body, contentType: type });
    } catch {
      return r.fulfill({ status: 404, body: 'not found' });
    }
  });
}
