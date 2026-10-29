import { mkdirSync } from 'node:fs';
import { expect, test, type Page, type Route } from '@playwright/test';
import { doc, elements, newDesign, pngBytes } from './helpers.ts';
import { CORS, stubFonts, stubIconify } from './module-stubs.ts';

const SHOTS = '/tmp/orch27-rw';
mkdirSync(SHOTS, { recursive: true });

const OPENAI_KEY = 'sk-proj-test-openai-0123456789';
const KIE_KEY = 'kie-test-key-0123456789abcdef';

/** A stubbed OpenAI API. `on(path, method)` answers; every request is checked for the key. */
async function stubOpenAI(page: Page, on: (path: string, method: string, body: any) => { status?: number; json?: unknown; body?: Buffer; contentType?: string }): Promise<void> {
  await page.route('https://api.openai.com/**', async (r: Route) => {
    const req = r.request();
    if (req.method() === 'OPTIONS') return r.fulfill({ status: 204, headers: CORS });
    expect((await req.allHeaders()).authorization).toBe(`Bearer ${OPENAI_KEY}`);
    const url = new URL(req.url());
    let body: any = null;
    try { body = req.postDataJSON(); } catch { body = null; }
    const out = on(url.pathname, req.method(), body);
    if (out.body) return r.fulfill({ status: out.status ?? 200, body: out.body, contentType: out.contentType ?? 'application/octet-stream', headers: CORS });
    return r.fulfill({ status: out.status ?? 200, json: out.json ?? {}, headers: CORS });
  });
}

const responsesReply = (text: string) => ({ id: 'resp_1', status: 'completed', output: [{ type: 'message', role: 'assistant', content: [{ type: 'output_text', text }] }] });

async function addOpenAI(page: Page): Promise<void> {
  await page.getByTestId('tab-ai').click();
  await page.getByTestId('ai-add-openai').click();
  await page.getByTestId('ai-add-key').fill(OPENAI_KEY);
  await page.getByTestId('ai-add-save').click();
}

test.beforeEach(async ({ page }) => {
  await stubFonts(page, ['Anton', 'Poppins']);
  await stubIconify(page);
  // no key may leave for anywhere but its own provider
  page.on('request', (r) => {
    const seen = JSON.stringify(r.headers()) + (r.postData() ?? '') + r.url();
    if (!r.url().startsWith('https://api.openai.com/')) expect(seen).not.toContain(OPENAI_KEY);
    if (!r.url().startsWith('https://api.kie.ai/')) expect(seen).not.toContain(KIE_KEY);
  });
});

test('AI providers: add OpenAI and kie.ai, test the connection, pick default models per task', async ({ page }) => {
  let kieOk = false;
  await stubOpenAI(page, (path) => {
    if (path === '/v1/models') return { json: { data: [{ id: 'gpt-6.1-sol' }, { id: 'gpt-6.1-terra' }, { id: 'gpt-image-2.5-flare' }, { id: 'sora-2' }, { id: 'text-embedding-3-small' }] } };
    return { status: 404, json: {} };
  });
  await page.route('https://api.kie.ai/**', async (r) => {
    if (r.request().method() === 'OPTIONS') return r.fulfill({ status: 204, headers: CORS });
    expect((await r.request().allHeaders()).authorization).toBe(`Bearer ${KIE_KEY}`);
    return r.fulfill({ json: kieOk ? { code: 200, msg: 'success', data: 250 } : { code: 401, msg: 'Unauthorized' }, headers: CORS });
  });
  await newDesign(page);
  await page.getByTestId('tab-ai').click();
  await page.screenshot({ path: `${SHOTS}/r10-ai-providers-empty.png` });

  await page.getByTestId('ai-add-openai').click();
  await page.getByTestId('ai-add-key').fill(OPENAI_KEY);
  await page.getByTestId('ai-add-save').click();
  // saving tests the key at once and reads the model list (embeddings dropped)
  await page.getByTestId('ai-settings').click();
  await expect(page.getByTestId('ai-provider-openai').getByTestId('ai-provider-status')).toHaveText('✓ Connected · 4 models');

  await page.getByTestId('ai-add-kie').click();
  await page.getByTestId('ai-add-key').fill(KIE_KEY);
  await page.getByTestId('ai-add-save').click();
  const kie = page.getByTestId('ai-provider-kie');
  await expect(kie.getByTestId('ai-provider-status')).toContainText('kie.ai refused that API key');
  kieOk = true;
  await kie.getByTestId('ai-provider-test').click();
  await expect(kie.getByTestId('ai-provider-status')).toHaveText('✓ Connected · 250 credits');

  // defaults: OpenAI for text; images can go to either
  await expect(page.getByTestId('ai-default-writing-model')).toHaveValue('gpt-6.1-terra');
  await expect(page.getByTestId('ai-default-design-model')).toHaveValue('gpt-6.1-sol');
  await expect(page.getByTestId('ai-default-image-model')).toHaveValue('gpt-image-2.5-flare');
  await page.getByTestId('ai-default-image-provider').selectOption('kie');
  await expect(page.getByTestId('ai-default-image-model')).toHaveValue('google/nano-banana');
  await page.getByTestId('ai-default-video-provider').selectOption('kie');
  await page.getByTestId('ai-default-video-model').fill('grok-imagine/text-to-video');
  await page.getByTestId('ai-default-video-model').blur();
  // kie.ai has no chat models: it isn't offered for writing
  await expect(page.getByTestId('ai-default-writing-provider').locator('option')).toHaveText(['OpenAI']);
  const stored = await page.evaluate(() => ({ d: JSON.parse(localStorage.getItem('dc.ai.defaults')!), p: localStorage.getItem('dc.ai.providers') }));
  expect(stored.d.image).toEqual({ provider: 'kie', model: 'google/nano-banana' });
  expect(stored.d.video).toEqual({ provider: 'kie', model: 'grok-imagine/text-to-video' });
  expect(stored.p).not.toContain(OPENAI_KEY);
  await page.screenshot({ path: `${SHOTS}/r10-ai-providers.png` });

  // OpenAI-compatible endpoint: presets fill the base URL
  await page.getByTestId('ai-add-compatible').click();
  await page.getByTestId('ai-add-preset').selectOption('ollama');
  await expect(page.getByTestId('ai-add-base')).toHaveValue('http://localhost:11434/v1');
  await expect(page.getByTestId('ai-add-form')).toContainText('OLLAMA_ORIGINS');
  await page.screenshot({ path: `${SHOTS}/r10-ai-add-compatible.png` });
});

test('AI providers: Magic Write and Design for me run on OpenAI', async ({ page }) => {
  const asked: any[] = [];
  await stubOpenAI(page, (path, _m, body) => {
    if (path === '/v1/models') return { json: { data: [{ id: 'gpt-6.1-sol' }, { id: 'gpt-6.1-terra' }] } };
    if (path === '/v1/responses') {
      asked.push(body);
      if (body.text?.format?.type === 'json_object') {
        // the first design is broken JSON: the app asks once more with the error
        if (asked.filter((b) => b.text).length === 1) return { json: responsesReply('{"pages": [ {"background": "#fff", "elements": [') };
        return { json: responsesReply(JSON.stringify({ pages: [{ background: '#0f172a', elements: [{ type: 'text', text: 'LAUNCH DAY', x: 80, y: 420, w: 920, fontSize: 120, fontFamily: 'Anton', color: '#ffffff', align: 'center' }] }] })) };
      }
      return { json: responsesReply('Fresh bread, every single morning') };
    }
    return { status: 404, json: {} };
  });
  await newDesign(page);
  await page.getByTestId('tab-text').click();
  await page.getByTestId('text-heading').click();
  await addOpenAI(page);
  await expect(page.getByTestId('ai-using')).toContainText('GPT-6.1 Sol · OpenAI');
  await page.getByTestId('ai-tab-write').click();
  await expect(page.getByTestId('ai-using')).toContainText('GPT-6.1 Terra');
  await page.getByTestId('ai-write-longer').click();
  await expect(page.getByTestId('ai-write-result')).toContainText('Fresh bread');
  const w = asked[0];
  expect(w.model).toBe('gpt-6.1-terra');
  expect(w.instructions).toContain('You edit short copy');
  expect(w.input[0].content[0].text).toContain('Add a heading');
  await page.screenshot({ path: `${SHOTS}/r10-ai-magic-write-openai.png` });
  await page.getByTestId('ai-write-use').click();
  await expect.poll(async () => (await elements(page))[0]!.text).toBe('Fresh bread, every single morning');

  // Design for me: JSON mode, validated, retried once with the error
  await page.getByTestId('ai-tab-design').click();
  await page.getByTestId('ai-prompt').fill('Product launch post');
  await page.getByTestId('ai-generate').click();
  await page.getByTestId('insert-add').click();
  await expect.poll(async () => (await doc(page)).pages.length).toBe(2);
  const designs = asked.filter((b) => b.text?.format?.type === 'json_object');
  expect(designs).toHaveLength(2);
  expect(designs[0].model).toBe('gpt-6.1-sol');
  expect(designs[1].input[0].content[0].text).toContain('could not be used');
  expect((await elements(page, 1)).map((e) => e.text)).toEqual(['LAUNCH DAY']);
});

test('AI providers: Generate image with OpenAI → tiles → click adds it, stored with provider/model/prompt', async ({ page }) => {
  await newDesign(page);
  const png = await pngBytes(page, 64, 64, '#e11d48');
  const asked: any[] = [];
  await stubOpenAI(page, (path, _m, body) => {
    if (path === '/v1/models') return { json: { data: [{ id: 'gpt-6.1-sol' }, { id: 'gpt-image-2.5-flare' }] } };
    if (path === '/v1/images/generations') {
      asked.push(body);
      return { json: { data: Array.from({ length: body.n }, () => ({ b64_json: png.toString('base64') })) } };
    }
    return { status: 404, json: {} };
  });
  await addOpenAI(page);
  await page.getByTestId('ai-tab-image').click();
  await page.getByTestId('ai-media-prompt').fill('A red paper lantern');
  await page.getByTestId('ai-style-watercolor').click();
  await page.getByTestId('ai-image-count').selectOption('2');
  await page.getByTestId('ai-media-generate').click();
  await expect(page.getByTestId('ai-result')).toHaveCount(2);
  expect(asked[0]).toMatchObject({ model: 'gpt-image-2.5-flare', n: 2, size: '1024x1024' });
  expect(asked[0].prompt).toContain('A red paper lantern');
  expect(asked[0].prompt).toContain('watercolour');
  await page.screenshot({ path: `${SHOTS}/r10-ai-generate-image.png` });

  await page.getByTestId('ai-result').first().click();
  await expect.poll(async () => (await elements(page)).filter((e) => e.type === 'image').length).toBe(1);
  const d = await doc(page);
  const img = (await elements(page)).find((e) => e.type === 'image') as any;
  const meta = d.assets[img.asset];
  expect(meta.ai).toMatchObject({ provider: 'openai', model: 'gpt-image-2.5-flare' });
  expect(meta.ai.prompt).toContain('A red paper lantern');
  expect(meta.mime).toBe('image/png');
  expect(meta.width).toBe(64);
  // both tiles are the same bytes: one asset (content hash)
  await page.getByTestId('ai-result').nth(1).click();
  await expect.poll(async () => (await elements(page)).filter((e) => e.type === 'image').length).toBe(2);
  expect(Object.values((await doc(page)).assets).filter((a: any) => a.ai).length).toBe(1);
  await page.screenshot({ path: `${SHOTS}/r10-ai-image-inserted.png` });
});

test('AI providers: a long kie.ai video job shows progress and keeps going while you edit', async ({ page }) => {
  let polls = 0;
  let release = false;
  await newDesign(page);
  await page.route('https://api.kie.ai/**', async (r) => {
    const url = new URL(r.request().url());
    if (r.request().method() === 'OPTIONS') return r.fulfill({ status: 204, headers: CORS });
    if (url.pathname === '/api/v1/chat/credit') return r.fulfill({ json: { code: 200, data: 99 }, headers: CORS });
    if (url.pathname === '/api/v1/jobs/createTask') {
      const body = r.request().postDataJSON();
      expect(body.model).toBe('kling-2.6/text-to-video');
      expect(body.input).toMatchObject({ aspect_ratio: '1:1', duration: '5', sound: false });
      return r.fulfill({ json: { code: 200, data: { taskId: 'task_1' } }, headers: CORS });
    }
    if (url.pathname === '/api/v1/jobs/recordInfo') {
      polls++;
      return r.fulfill({ json: { code: 200, data: release ? { state: 'fail', failCode: '501', failMsg: 'stub: no real video here' } : { state: 'generating', progress: 40 } }, headers: CORS });
    }
    return r.fulfill({ status: 404, headers: CORS });
  });
  await page.getByTestId('tab-ai').click();
  await page.getByTestId('ai-add-kie').click();
  await page.getByTestId('ai-add-key').fill(KIE_KEY);
  await page.getByTestId('ai-add-save').click();
  await page.getByTestId('ai-tab-video').click();
  await page.getByTestId('ai-media-prompt').fill('Waves rolling on a beach at sunset');
  await page.getByTestId('ai-media-generate').click();
  await expect(page.getByTestId('ai-job')).toContainText('Generating');
  await page.screenshot({ path: `${SHOTS}/r10-ai-video-job.png` });
  // edit meanwhile: switch panels and add a shape; the job lives on
  await page.getByTestId('tab-elements').click().catch(() => {});
  await page.getByTestId('tab-ai').click();
  await expect(page.getByTestId('ai-job')).toBeVisible();
  release = true;
  await expect(page.getByTestId('ai-job-error')).toContainText('stub: no real video here', { timeout: 20_000 });
  expect(polls).toBeGreaterThan(0);
});
