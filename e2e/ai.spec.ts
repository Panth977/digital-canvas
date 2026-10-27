import { expect, test, type Page, type Request } from '@playwright/test';
import { doc, elements, newDesign } from './helpers.ts';
import { claudeReply, stubClaude, stubFonts, stubIconify } from './module-stubs.ts';

const KEY = 'sk-ant-api03-test-key-0123456789';

async function withKey(page: Page): Promise<void> {
  await page.getByTestId('tab-ai').click();
  await page.getByTestId('ai-key-input').fill(KEY);
  await page.getByTestId('ai-key-save').click();
  await expect(page.getByTestId('ai-tab-design')).toBeVisible();
}

/** Every request must go to Anthropic only, with the user's key and the browser header. */
function checkRequest(req: Request, h: Record<string, string>): any {
  // the SDK sends the key as x-api-key or (SDK 1.x) a bearer token
  expect(h['x-api-key'] === KEY || h.authorization === `Bearer ${KEY}`).toBe(true);
  expect(h['anthropic-dangerous-direct-browser-access']).toBe('true');
  expect(h['anthropic-version']).toBeTruthy();
  const body = req.postDataJSON();
  expect(body.model).toBe('claude-sonnet-5-5');
  return body;
}

test.beforeEach(async ({ page }) => {
  await stubFonts(page, ['Anton', 'Poppins']);
  await stubIconify(page);
  // nothing else may see the key
  page.on('request', (r) => {
    if (!r.url().startsWith('https://api.anthropic.com/')) expect(JSON.stringify(r.headers()) + (r.postData() ?? '')).not.toContain(KEY);
  });
});

test('AI: without a key it explains how to get one; the key stays in this browser', async ({ page }) => {
  await newDesign(page);
  await page.getByTestId('tab-ai').click();
  await expect(page.getByTestId('ai-key-box')).toContainText('console.anthropic.com');
  await expect(page.getByTestId('ai-tab-design')).toHaveCount(0);
  await page.getByTestId('ai-key-input').fill('not-a-key');
  await expect(page.getByTestId('ai-key-save')).toBeDisabled();
  await page.getByTestId('ai-key-input').fill(KEY);
  await page.getByTestId('ai-key-save').click();
  expect(await page.evaluate(() => localStorage.getItem('dc.anthropicKey'))).toBe(KEY);
  // not in the design file
  expect(JSON.stringify(await doc(page))).not.toContain(KEY);
  await page.getByTestId('ai-settings').click();
  await page.getByTestId('ai-key-forget').click();
  expect(await page.evaluate(() => localStorage.getItem('dc.anthropicKey'))).toBeNull();
  await expect(page.getByTestId('ai-key-input')).toBeVisible();
});

test('AI: Design for me turns Claude’s JSON into an editable page', async ({ page }) => {
  let body: any;
  await stubClaude(page, (req, h) => {
    body = checkRequest(req, h);
    const design = { pages: [{ background: '#fdf6ec', elements: [
      { type: 'shape', shape: 'rect', x: 0, y: 0, w: 1080, h: 320, fill: '#7a3e1d' },
      { type: 'text', text: 'GRAND OPENING', x: 60, y: 100, w: 960, fontSize: 110, fontFamily: 'Anton', color: '#ffffff', align: 'center' },
      { type: 'icon', icon: 'mdi:star', x: 440, y: 500, w: 200, h: 200, color: '#e0a526' },
      { type: 'text', text: 'Fresh bread every morning', x: 90, y: 800, w: 900, fontSize: 44, fontFamily: 'Poppins', color: '#7a3e1d', align: 'center' },
    ] }] };
    return { json: claudeReply(`Here you go:\n\`\`\`json\n${JSON.stringify(design)}\n\`\`\``) };
  });
  await newDesign(page);
  await withKey(page);
  await page.getByTestId('ai-prompt').fill('Bakery grand opening post');
  await page.getByTestId('ai-generate').click();
  await expect.poll(async () => (await elements(page)).length).toBe(4);
  expect(body.messages[0].content).toContain('Bakery grand opening post');
  expect(body.system).toContain('1080×1080');
  const els = (await elements(page)) as any[];
  expect(els.map((e) => e.type)).toEqual(['shape', 'text', 'path', 'text']);
  expect(els[2].name).toBe('mdi:star');
  expect(els[1].style.fontFamily).toBe('Anton');
  expect((await doc(page)).pages[0].background.color).toBe('#fdf6ec');
  expect((await doc(page)).fonts.some((f: any) => f.family === 'Anton')).toBe(true);

  // a second design asks before replacing
  await page.getByTestId('ai-generate').click();
  await page.getByTestId('insert-add').click();
  await expect.poll(async () => (await doc(page)).pages.length).toBe(2);
});

test('AI: Magic Write rewrites and translates the selected text', async ({ page }) => {
  const asked: string[] = [];
  await stubClaude(page, (req, h) => {
    const body = checkRequest(req, h);
    asked.push(body.messages[0].content);
    const out = body.messages[0].content.includes('Translate') ? 'नमस्ते दुनिया' : 'Hi world';
    return { json: claudeReply(out) };
  });
  await newDesign(page);
  await page.getByTestId('tab-text').click();
  await page.getByTestId('text-heading').click();
  await withKey(page);
  await page.getByTestId('ai-tab-write').click();
  await page.getByTestId('ai-write-shorter').click();
  await expect(page.getByTestId('ai-write-result')).toContainText('Hi world');
  expect(asked[0]).toContain('shorter');
  expect(asked[0]).toContain('Add a heading');
  await page.getByTestId('ai-write-use').click();
  await expect.poll(async () => (await elements(page))[0]!.text).toBe('Hi world');

  await page.getByTestId('ai-write-translate').click();
  await expect(page.getByTestId('ai-write-result')).toContainText('नमस्ते');
  expect(asked[1]).toContain('Hindi');
  await page.getByTestId('ai-write-use').click();
  await expect.poll(async () => (await elements(page))[0]!.text).toBe('नमस्ते दुनिया');
});

test('AI: alt text for a page, saved to notes; errors are explained', async ({ page }) => {
  let fail = false;
  await stubClaude(page, (req, h) => {
    const body = checkRequest(req, h);
    if (fail) return { status: 401, json: { type: 'error', error: { type: 'authentication_error', message: 'invalid x-api-key' } } };
    expect(body.messages[0].content[0].type).toBe('image');
    expect(body.messages[0].content[0].source.media_type).toBe('image/png');
    return { json: claudeReply('A purple square on a white Instagram post.') };
  });
  await newDesign(page);
  await page.getByTestId('shape-rect').click();
  await withKey(page);
  await page.getByTestId('ai-tab-describe').click();
  await page.getByTestId('ai-describe').click();
  await expect(page.getByTestId('ai-alt')).toContainText('A purple square');
  await page.getByTestId('ai-alt-notes').click();
  expect((await doc(page)).pages[0].notes).toBe('Alt text: A purple square on a white Instagram post.');

  fail = true;
  await page.getByTestId('ai-describe').click();
  await expect(page.getByTestId('ai-error')).toContainText('API key was refused');
});
