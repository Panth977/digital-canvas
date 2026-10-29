/**
 * The AI provider adapters with fetch mocked: request shape, headers (the key
 * goes to that provider's host only), reply parsing, errors, and job polling
 * (Sora, Gemini video, kie.ai).
 */
import { describe, expect, it } from 'vitest';
import { AnthropicProvider } from '../src/lib/ai/anthropic.ts';
import { CompatibleProvider, OpenRouterProvider, compatCaps } from '../src/lib/ai/compat.ts';
import { GeminiProvider, geminiCaps, outputsOf } from '../src/lib/ai/gemini.ts';
import { AIError, nearest, nearestRatio } from '../src/lib/ai/http.ts';
import { KieProvider } from '../src/lib/ai/kie.ts';
import { OpenAIProvider, openaiCaps, openaiImageSize, soraSize } from '../src/lib/ai/openai.ts';
import { createProvider, KINDS } from '../src/lib/ai/registry.ts';

interface Call { url: string; method: string; headers: Record<string, string>; body: any; raw: BodyInit | null | undefined }
type Answer = { status?: number; json?: unknown; bytes?: Uint8Array; type?: string } | ((c: Call) => Answer);

/** Routes: [method + URL prefix or regexp, answer]. Every call is recorded. */
function mock(routes: [string | RegExp, Answer][]) {
  const calls: Call[] = [];
  const f = (async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const url = String(input), method = (init.method ?? 'GET').toUpperCase();
    const headers: Record<string, string> = {};
    new Headers(init.headers).forEach((v, k) => (headers[k] = v));
    let body: any = null;
    if (typeof init.body === 'string') { try { body = JSON.parse(init.body); } catch { body = init.body; } }
    else if (init.body instanceof FormData) body = Object.fromEntries(init.body.entries());
    const call = { url, method, headers, body, raw: init.body };
    calls.push(call);
    const key = `${method} ${url}`;
    for (const [k, v] of routes) {
      if (typeof k === 'string' ? key.startsWith(k) : k.test(key)) {
        const a = typeof v === 'function' ? v(call) : v;
        if (a.bytes) return new Response(a.bytes as BodyInit, { status: a.status ?? 200, headers: { 'content-type': a.type ?? 'application/octet-stream' } });
        return new Response(JSON.stringify(a.json ?? {}), { status: a.status ?? 200, headers: { 'content-type': 'application/json' } });
      }
    }
    return new Response('{"error":{"message":"no route"}}', { status: 404 });
  }) as typeof fetch;
  return { fetch: f, calls, sleep: async () => {} };
}

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]);
const MP4 = new Uint8Array([0, 0, 0, 0x18, 0x66, 0x74, 0x79, 0x70, 0x6d, 0x70, 0x34]);
const b64 = (b: Uint8Array) => Buffer.from(b).toString('base64');

/** Nothing but `host` ever saw the key. */
function keyOnlyTo(calls: Call[], key: string, host: string | RegExp): void {
  for (const c of calls) {
    const has = JSON.stringify(c.headers).includes(key) || c.url.includes(key) || JSON.stringify(c.body ?? '').includes(key);
    if (has) expect(new URL(c.url).host).toMatch(host);
  }
}

describe('helpers', () => {
  it('pick the nearest aspect ratio and allowed value', () => {
    expect(nearestRatio(1080, 1920, ['1:1', '16:9', '9:16'])).toBe('9:16');
    expect(nearestRatio(1080, 1350, ['1:1', '4:5', '9:16'])).toBe('4:5');
    expect(nearestRatio(1920, 1080, ['2:3', '3:2', '16:9'])).toBe('16:9');
    expect(nearest(7, [4, 8, 12])).toBe(8);
    expect(openaiImageSize(1080, 1080)).toBe('1024x1024');
    expect(openaiImageSize(1920, 1080)).toBe('1536x1024');
    expect(soraSize('sora-2', 1080, 1920)).toBe('720x1280');
    expect(soraSize('sora-2-pro', 1920, 1080)).toBe('1920x1080');
  });

  it('every kind has a factory, a host and defaults for what it can do', () => {
    for (const k of KINDS) {
      expect(createProvider(k.kind, { key: 'k', baseUrl: 'https://x.example/v1' }).kind).toBe(k.kind);
      for (const [task, model] of Object.entries(k.defaults)) expect(model, `${k.kind} ${task}`).toBeTruthy();
    }
    expect(KINDS.find((k) => k.kind === 'anthropic')!.defaults.writing).toBe('claude-sonnet-5-5');
  });

  it('capabilities from model ids', () => {
    expect(openaiCaps('gpt-6.1-sol')).toEqual(['text', 'vision', 'json']);
    expect(openaiCaps('gpt-image-2.5-flare')).toEqual(['image']);
    expect(openaiCaps('sora-2')).toEqual(['video']);
    expect(openaiCaps('text-embedding-3-large')).toBeNull();
    expect(geminiCaps('gemini-omni-1.1-flash')).toEqual(['video']);
    expect(geminiCaps('gemini-nano-banana-2.1')).toEqual(['image']);
    expect(geminiCaps('gemini-3.8-flash-tts')).toBeNull();
    expect(compatCaps('llama-3.3-70b-versatile')).toEqual(['text', 'json']);
    expect(compatCaps('meta-llama/Llama-4-Scout-17B')).toContain('vision');
    expect(compatCaps('black-forest-labs/FLUX.1-schnell')).toEqual(['image']);
  });
});

describe('Anthropic', () => {
  const KEY = 'sk-ant-api03-secret-0123456789';
  it('sends the browser header + key to api.anthropic.com only; text and image blocks; parses the reply', async () => {
    const m = mock([['POST https://api.anthropic.com/v1/messages', { json: { content: [{ type: 'text', text: 'Hello ' }, { type: 'text', text: 'world' }], stop_reason: 'end_turn' } }]]);
    const p = new AnthropicProvider({ key: KEY, fetch: m.fetch });
    const out = await p.chat({ model: 'claude-sonnet-5-5', system: 'sys', content: [{ type: 'image', mime: 'image/png', data: 'AAA' }, { type: 'text', text: 'hi' }], maxTokens: 100 });
    expect(out).toBe('Hello world');
    const c = m.calls[0]!;
    expect(c.headers['x-api-key']).toBe(KEY);
    expect(c.headers['anthropic-dangerous-direct-browser-access']).toBe('true');
    expect(c.headers['anthropic-version']).toBe('2023-06-01');
    expect(c.body).toMatchObject({ model: 'claude-sonnet-5-5', max_tokens: 100, system: 'sys' });
    expect(c.body.messages[0].content[0]).toEqual({ type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'AAA' } });
    keyOnlyTo(m.calls, KEY, 'api.anthropic.com');
  });

  it('explains a refused key, a refusal and a cut-off reply', async () => {
    const bad = mock([['POST', { status: 401, json: { type: 'error', error: { type: 'authentication_error', message: 'invalid x-api-key' } } }]]);
    await expect(new AnthropicProvider({ key: KEY, fetch: bad.fetch }).chat({ model: 'm', system: '', content: 'x' })).rejects.toThrow(/refused that API key/);
    const ref = mock([['POST', { json: { content: [], stop_reason: 'refusal' } }]]);
    await expect(new AnthropicProvider({ key: KEY, fetch: ref.fetch }).chat({ model: 'm', system: '', content: 'x' })).rejects.toThrow(/declined/);
    const cut = mock([['POST', { json: { content: [{ type: 'text', text: '{"a":' }], stop_reason: 'max_tokens' } }]]);
    await expect(new AnthropicProvider({ key: KEY, fetch: cut.fetch }).chat({ model: 'm', system: '', content: 'x' })).rejects.toThrow(/cut off/);
  });

  it('lists models from /v1/models', async () => {
    const m = mock([['GET https://api.anthropic.com/v1/models', { json: { data: [{ id: 'claude-opus-5-5', display_name: 'Claude Opus 5.5' }] } }]]);
    expect(await new AnthropicProvider({ key: KEY, fetch: m.fetch }).listModels()).toEqual([{ id: 'claude-opus-5-5', label: 'Claude Opus 5.5', caps: ['text', 'vision', 'json'] }]);
  });
});

describe('OpenAI', () => {
  const KEY = 'sk-proj-secret-0123456789';
  it('chat goes through the Responses API with JSON mode and image input', async () => {
    const m = mock([['POST https://api.openai.com/v1/responses', { json: { status: 'completed', output: [{ type: 'reasoning' }, { type: 'message', content: [{ type: 'output_text', text: '{"pages":[]}' }] }] } }]]);
    const out = await new OpenAIProvider({ key: KEY, fetch: m.fetch }).chat({ model: 'gpt-6.1-sol', system: 'Answer in JSON', content: [{ type: 'text', text: 'hi' }, { type: 'image', mime: 'image/png', data: 'QUJD' }], json: true, effort: 'medium' });
    expect(out).toBe('{"pages":[]}');
    const c = m.calls[0]!;
    expect(c.headers.authorization).toBe(`Bearer ${KEY}`);
    expect(c.body).toMatchObject({ model: 'gpt-6.1-sol', instructions: 'Answer in JSON', text: { format: { type: 'json_object' } }, reasoning: { effort: 'medium' }, store: false });
    expect(c.body.input[0].content).toEqual([{ type: 'input_text', text: 'hi' }, { type: 'input_image', image_url: 'data:image/png;base64,QUJD' }]);
  });

  it('refusals, incomplete replies and rate limits become plain messages', async () => {
    const r = mock([['POST', { json: { output: [{ type: 'message', content: [{ type: 'refusal', refusal: 'no' }] }] } }]]);
    await expect(new OpenAIProvider({ key: KEY, fetch: r.fetch }).chat({ model: 'gpt-6-luna', system: '', content: 'x' })).rejects.toThrow(/declined/);
    const i = mock([['POST', { json: { status: 'incomplete', incomplete_details: { reason: 'max_output_tokens' }, output: [] } }]]);
    await expect(new OpenAIProvider({ key: KEY, fetch: i.fetch }).chat({ model: 'gpt-6-luna', system: '', content: 'x' })).rejects.toThrow(/cut off/);
    const l = mock([['POST', { status: 429, json: { error: { message: 'slow down' } } }]]);
    await expect(new OpenAIProvider({ key: KEY, fetch: l.fetch }).chat({ model: 'gpt-6-luna', system: '', content: 'x' })).rejects.toThrow(/too many requests/);
  });

  it('images: gpt-image with the page shape, b64 back', async () => {
    const m = mock([['POST https://api.openai.com/v1/images/generations', { json: { data: [{ b64_json: b64(PNG) }, { b64_json: b64(PNG) }] } }]]);
    const out = await new OpenAIProvider({ key: KEY, fetch: m.fetch }).images({ model: 'gpt-image-2.5-flare', prompt: 'a cat', aspect: { w: 1080, h: 1920 }, count: 2 });
    expect(out).toHaveLength(2);
    expect(out[0]!.mime).toBe('image/png');
    expect([...out[0]!.bytes]).toEqual([...PNG]);
    expect(m.calls[0]!.body).toEqual({ model: 'gpt-image-2.5-flare', prompt: 'a cat', n: 2, size: '1024x1536' });
  });

  it('video: Sora job (multipart), polled with progress, then downloaded', async () => {
    let polls = 0;
    const m = mock([
      ['POST https://api.openai.com/v1/videos', { json: { id: 'video_1', status: 'queued' } }],
      ['GET https://api.openai.com/v1/videos/video_1/content', { bytes: MP4, type: 'video/mp4' }],
      ['GET https://api.openai.com/v1/videos/video_1', () => ({ json: ++polls < 3 ? { status: 'in_progress', progress: polls * 40 } : { status: 'completed', progress: 100 } })],
    ]);
    const seen: (number | null)[] = [];
    const v = await new OpenAIProvider({ key: KEY, fetch: m.fetch, sleep: m.sleep }).video({ model: 'sora-2', prompt: 'waves', aspect: { w: 1920, h: 1080 }, duration: 7, onProgress: (p) => seen.push(p.fraction) });
    expect(v.mime).toBe('video/mp4');
    expect(m.calls[0]!.raw).toBeInstanceOf(FormData);
    expect(m.calls[0]!.body).toMatchObject({ model: 'sora-2', prompt: 'waves', size: '1280x720', seconds: '8' });
    expect(m.calls[0]!.headers['content-type']).toBeUndefined(); // the browser sets the multipart boundary
    expect(seen).toEqual(expect.arrayContaining([0.4, 0.8, 1]));
    keyOnlyTo(m.calls, KEY, 'api.openai.com');
  });

  it('video: a failed job says why', async () => {
    const m = mock([
      ['POST https://api.openai.com/v1/videos', { json: { id: 'v2', status: 'queued' } }],
      ['GET https://api.openai.com/v1/videos/v2', { json: { status: 'failed', error: { message: 'moderation' } } }],
    ]);
    await expect(new OpenAIProvider({ key: KEY, fetch: m.fetch, sleep: m.sleep }).video({ model: 'sora-2', prompt: 'x', aspect: { w: 1, h: 1 }, duration: 4 })).rejects.toThrow(/moderation/);
  });
});

describe('Gemini', () => {
  const KEY = 'AIzaSyFAKE-key-0123456789abcdefghij';
  it('chat: Interactions API, x-goog-api-key header (never Api-Revision: CORS), JSON response_format, steps parsing', async () => {
    const m = mock([['POST https://generativelanguage.googleapis.com/v1beta/interactions', { json: { status: 'completed', steps: [{ type: 'user_input', content: [{ type: 'text', text: 'q' }] }, { type: 'thought', content: [] }, { type: 'model_output', content: [{ type: 'text', text: '{"ok":1}' }] }] } }]]);
    const out = await new GeminiProvider({ key: KEY, fetch: m.fetch }).chat({ model: 'gemini-3.8-flash', system: 'sys', content: [{ type: 'text', text: 'q' }, { type: 'image', mime: 'image/png', data: 'QQ==' }], json: true });
    expect(out).toBe('{"ok":1}');
    const c = m.calls[0]!;
    expect(c.headers['x-goog-api-key']).toBe(KEY);
    expect(c.headers['api-revision']).toBeUndefined();
    expect(c.url).not.toContain(KEY);
    expect(c.body).toMatchObject({ model: 'gemini-3.8-flash', system_instruction: 'sys', response_format: { type: 'text', mime_type: 'application/json' } });
    expect(c.body.input[1]).toEqual({ type: 'image', data: 'QQ==', mime_type: 'image/png' });
    expect(outputsOf({ outputs: [{ type: 'text', text: 'old shape' }] })[0]!.text).toBe('old shape');
  });

  it('images: one interaction per image with the nearest aspect ratio', async () => {
    const m = mock([['POST https://generativelanguage.googleapis.com/v1beta/interactions', { json: { status: 'completed', steps: [{ type: 'model_output', content: [{ type: 'image', data: b64(PNG), mime_type: 'image/png' }] }] } }]]);
    const out = await new GeminiProvider({ key: KEY, fetch: m.fetch }).images({ model: 'gemini-nano-banana-2.1', prompt: 'p', aspect: { w: 1080, h: 1350 }, count: 3 });
    expect(out).toHaveLength(3);
    expect(m.calls).toHaveLength(3);
    expect(m.calls[0]!.body.response_format).toEqual({ type: 'image', aspect_ratio: '4:5' });
  });

  it('video: background interaction, polled, downloaded from its uri with the key only on the Gemini host', async () => {
    let n = 0;
    const m = mock([
      ['POST https://generativelanguage.googleapis.com/v1beta/interactions', { json: { id: 'v1_abc', status: 'in_progress' } }],
      ['GET https://generativelanguage.googleapis.com/v1beta/interactions/v1_abc', () => ({ json: ++n < 2 ? { id: 'v1_abc', status: 'in_progress' } : { id: 'v1_abc', status: 'completed', steps: [{ type: 'model_output', content: [{ type: 'video', uri: 'https://generativelanguage.googleapis.com/v1beta/files/f1:download?alt=media', mime_type: 'video/mp4' }] }] } })],
      ['GET https://generativelanguage.googleapis.com/v1beta/files/f1', { bytes: MP4, type: 'video/mp4' }],
    ]);
    const v = await new GeminiProvider({ key: KEY, fetch: m.fetch, sleep: m.sleep }).video({ model: 'gemini-omni-1.1-flash', prompt: 'fish', aspect: { w: 1080, h: 1920 }, duration: 6, image: { bytes: PNG, mime: 'image/png' } });
    expect(v.mime).toBe('video/mp4');
    const first = m.calls[0]!.body;
    expect(first).toMatchObject({ model: 'gemini-omni-1.1-flash', background: true, response_format: { type: 'video', aspect_ratio: '9:16' } });
    expect(first.input[0]).toMatchObject({ type: 'image', mime_type: 'image/png' });
    expect(m.calls.at(-1)!.headers['x-goog-api-key']).toBe(KEY);
  });

  it('a video on another host is fetched without the key', async () => {
    const m = mock([
      ['POST https://generativelanguage.googleapis.com/v1beta/interactions', { json: { id: 'x', status: 'completed', steps: [{ type: 'model_output', content: [{ type: 'video', uri: 'https://storage.example.com/v.mp4' }] }] } }],
      ['GET https://storage.example.com/v.mp4', { bytes: MP4, type: 'video/mp4' }],
    ]);
    await new GeminiProvider({ key: KEY, fetch: m.fetch, sleep: m.sleep }).video({ model: 'gemini-omni-1.1-flash', prompt: 'p', aspect: { w: 16, h: 9 }, duration: 5 });
    keyOnlyTo(m.calls, KEY, 'generativelanguage.googleapis.com');
  });

  it('lists models from /models, dropping TTS/embedding ones', async () => {
    const m = mock([['GET https://generativelanguage.googleapis.com/v1beta/models', { json: { models: [{ name: 'models/gemini-3.8-flash', displayName: 'Gemini 3.8 Flash' }, { name: 'models/gemini-embedding-001' }, { name: 'models/gemini-3.8-flash-tts' }] } }]]);
    const list = await new GeminiProvider({ key: KEY, fetch: m.fetch }).listModels();
    expect(list.map((x) => x.id)).toContain('gemini-3.8-flash');
    expect(list.map((x) => x.id)).not.toContain('gemini-embedding-001');
    expect(list.some((x) => x.caps.includes('video'))).toBe(true);
  });
});

describe('OpenAI-compatible and OpenRouter', () => {
  it('compatible: base URL + bearer key; JSON mode dropped when the endpoint refuses it', async () => {
    const m = mock([['POST https://api.groq.com/openai/v1/chat/completions', (c) => (c.body.response_format ? { status: 400, json: { error: { message: 'response_format not supported' } } } : { json: { choices: [{ message: { content: 'ok' }, finish_reason: 'stop' }] } })]]);
    const p = new CompatibleProvider({ key: 'gsk_x', baseUrl: 'https://api.groq.com/openai/v1/', fetch: m.fetch });
    expect(await p.chat({ model: 'llama-3.3-70b', system: 's', content: 'u', json: true })).toBe('ok');
    expect(m.calls).toHaveLength(2);
    expect(m.calls[0]!.body.messages).toEqual([{ role: 'system', content: 's' }, { role: 'user', content: 'u' }]);
    expect(m.calls[0]!.headers.authorization).toBe('Bearer gsk_x');
  });

  it('compatible: a local server without a key sends no authorization; an unreachable one says how to allow it', async () => {
    const m = mock([['GET http://localhost:11434/v1/models', { json: { data: [{ id: 'llama3.2' }, { id: 'nomic-embed-text' }] } }]]);
    const p = new CompatibleProvider({ key: '', baseUrl: 'http://localhost:11434/v1', fetch: m.fetch });
    expect((await p.listModels()).map((x) => x.id)).toEqual(['llama3.2']);
    expect(m.calls[0]!.headers.authorization).toBeUndefined();
    const down = new CompatibleProvider({ key: '', baseUrl: 'http://localhost:11434/v1', fetch: (async () => { throw new TypeError('Failed to fetch'); }) as typeof fetch });
    await expect(down.listModels()).rejects.toThrow(/OLLAMA_ORIGINS/);
    await expect(new CompatibleProvider({ key: '' }).listModels()).rejects.toThrow(/base URL/);
  });

  it('OpenRouter: attribution headers, modality-aware model list, image output via chat', async () => {
    const m = mock([
      ['GET https://openrouter.ai/api/v1/models', { json: { data: [
        { id: 'anthropic/claude-sonnet-5.5', name: 'Claude', architecture: { input_modalities: ['text', 'image'], output_modalities: ['text'] } },
        { id: 'google/gemini-3.1-flash-image', name: 'Img', architecture: { input_modalities: ['text', 'image'], output_modalities: ['image', 'text'] } },
        { id: 'x/embed', architecture: { input_modalities: ['text'], output_modalities: ['embeddings'] } },
      ] } }],
      ['POST https://openrouter.ai/api/v1/chat/completions', { json: { choices: [{ message: { content: '', images: [{ image_url: { url: `data:image/png;base64,${b64(PNG)}` } }] } }] } }],
      ['GET https://openrouter.ai/api/v1/key', { json: { data: { label: 'my key', limit_remaining: 4.5 } } }],
    ]);
    const p = new OpenRouterProvider({ key: 'sk-or-v1-abc', fetch: m.fetch });
    const list = await p.listModels();
    expect(list.find((x) => x.id === 'anthropic/claude-sonnet-5.5')!.caps).toEqual(['text', 'json', 'vision']);
    expect(list.find((x) => x.id === 'google/gemini-3.1-flash-image')!.caps).toContain('image');
    expect(list.some((x) => x.id === 'x/embed')).toBe(false);
    const imgs = await p.images({ model: 'google/gemini-3.1-flash-image', prompt: 'p', aspect: { w: 16, h: 9 }, count: 1 });
    expect(imgs[0]!.mime).toBe('image/png');
    const c = m.calls.find((x) => x.method === 'POST')!;
    expect(c.body).toMatchObject({ modalities: ['image', 'text'], image_config: { aspect_ratio: '16:9' } });
    expect(c.headers['x-title']).toBe('Digital Canvas');
    expect(await p.test()).toBe('Connected · my key · $4.50 left');
  });
});

describe('kie.ai', () => {
  const KEY = 'kie-secret-key-0123456789';
  it('image: createTask with the model input, polls recordInfo until success, downloads the result URLs', async () => {
    let n = 0;
    const m = mock([
      ['POST https://api.kie.ai/api/v1/jobs/createTask', { json: { code: 200, msg: 'success', data: { taskId: 't1' } } }],
      ['GET https://api.kie.ai/api/v1/jobs/recordInfo?taskId=t1', () => ({ json: { code: 200, data: ++n === 1 ? { state: 'waiting' } : n === 2 ? { state: 'generating', progress: 50 } : { state: 'success', resultJson: JSON.stringify({ resultUrls: ['https://tempfile.aiquickdraw.com/a.png'] }) } } })],
      ['GET https://tempfile.aiquickdraw.com/a.png', { bytes: PNG, type: 'application/octet-stream' }],
    ]);
    const msgs: string[] = [];
    const out = await new KieProvider({ key: KEY, fetch: m.fetch, sleep: m.sleep }).images({ model: 'google/nano-banana', prompt: 'cat', aspect: { w: 1080, h: 1920 }, count: 1, onProgress: (p) => msgs.push(p.message) });
    expect(out[0]!.mime).toBe('image/png'); // sniffed from the bytes
    expect(m.calls[0]!.body).toEqual({ model: 'google/nano-banana', input: { prompt: 'cat', aspect_ratio: '9:16', output_format: 'png' } });
    expect(m.calls[0]!.headers.authorization).toBe(`Bearer ${KEY}`);
    expect(msgs).toEqual(expect.arrayContaining(['Queued', 'Generating', 'Downloading']));
    keyOnlyTo(m.calls, KEY, 'api.kie.ai');
  });

  it('image-to-video: uploads the picture, switches to the image-to-video model, polls, downloads', async () => {
    const m = mock([
      ['POST https://api.kie.ai/api/file-base64-upload', { json: { success: true, code: 200, data: { downloadUrl: 'https://tempfile.redpandaai.co/digital-canvas/ref.png' } } }],
      ['POST https://api.kie.ai/api/v1/jobs/createTask', { json: { code: 200, data: { taskId: 'v1' } } }],
      ['GET https://api.kie.ai/api/v1/jobs/recordInfo?taskId=v1', { json: { code: 200, data: { state: 'success', resultJson: '{"resultUrls":["https://tempfile.aiquickdraw.com/v.mp4"]}' } } }],
      ['GET https://tempfile.aiquickdraw.com/v.mp4', { bytes: MP4, type: 'video/mp4' }],
    ]);
    const v = await new KieProvider({ key: KEY, fetch: m.fetch, sleep: m.sleep }).video({ model: 'kling-2.6/text-to-video', prompt: 'move', aspect: { w: 16, h: 9 }, duration: 8, image: { bytes: PNG, mime: 'image/png' } });
    expect(v.mime).toBe('video/mp4');
    expect(m.calls[0]!.body.base64Data).toMatch(/^data:image\/png;base64,/);
    expect(m.calls[1]!.body).toEqual({ model: 'kling-2.6/image-to-video', input: { prompt: 'move', sound: false, duration: '10', image_urls: ['https://tempfile.redpandaai.co/digital-canvas/ref.png'] } });
  });

  it('text-to-video picks the aspect ratio and duration the model takes', async () => {
    const m = mock([
      ['POST https://api.kie.ai/api/v1/jobs/createTask', { json: { code: 200, data: { taskId: 'g' } } }],
      ['GET https://api.kie.ai/api/v1/jobs/recordInfo', { json: { code: 200, data: { state: 'success', resultJson: '{"resultUrls":["https://x.example/v.mp4"]}' } } }],
      ['GET https://x.example/v.mp4', { bytes: MP4, type: 'video/mp4' }],
    ]);
    await new KieProvider({ key: KEY, fetch: m.fetch, sleep: m.sleep }).video({ model: 'grok-imagine/text-to-video', prompt: 'p', aspect: { w: 1080, h: 1350 }, duration: 3 });
    expect(m.calls[0]!.body.input).toMatchObject({ aspect_ratio: '2:3', duration: 6, mode: 'normal' });
  });

  it('errors arrive as HTTP 200 with a code: key, credits, failed jobs', async () => {
    const k = mock([['GET https://api.kie.ai/api/v1/chat/credit', { json: { code: 401, msg: 'Unauthorized' } }]]);
    await expect(new KieProvider({ key: KEY, fetch: k.fetch }).test()).rejects.toThrow(/refused that API key/);
    const ok = mock([['GET https://api.kie.ai/api/v1/chat/credit', { json: { code: 200, data: 120.5 } }]]);
    expect(await new KieProvider({ key: KEY, fetch: ok.fetch }).test()).toBe('Connected · 120.5 credits');
    const poor = mock([['POST https://api.kie.ai/api/v1/jobs/createTask', { json: { code: 402, msg: 'Insufficient credits' } }]]);
    await expect(new KieProvider({ key: KEY, fetch: poor.fetch }).images({ model: 'google/nano-banana', prompt: 'p', aspect: { w: 1, h: 1 }, count: 1 })).rejects.toThrow(/not enough credits/);
    const fail = mock([
      ['POST https://api.kie.ai/api/v1/jobs/createTask', { json: { code: 200, data: { taskId: 'f' } } }],
      ['GET https://api.kie.ai/api/v1/jobs/recordInfo', { json: { code: 200, data: { state: 'fail', failCode: '500', failMsg: 'content policy' } } }],
    ]);
    const e = await new KieProvider({ key: KEY, fetch: fail.fetch, sleep: fail.sleep }).images({ model: 'google/nano-banana', prompt: 'p', aspect: { w: 1, h: 1 }, count: 1 }).catch((x) => x);
    expect(e).toBeInstanceOf(AIError);
    expect(e.message).toMatch(/content policy/);
  });
});
