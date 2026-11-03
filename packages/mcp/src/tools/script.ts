/**
 * run_script: the agent sends one small JavaScript program instead of dozens
 * of tool calls. It runs in a QuickJS sandbox (no network, no files, no host
 * objects) where every Digital Canvas tool is an async function on `dc`.
 * Designs are opened once and saved once at the end, so a script with 300
 * edits costs one save, and only its return value and logs go back into the
 * agent's context.
 */
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { z, type ZodRawShape } from 'zod';
import type { QuickJSContext, QuickJSHandle, QuickJSWASMModule } from 'quickjs-emscripten-core';
import { followSubtitles, pruneAssets, pruneFonts } from '@digital-canvas/scene';
import type { ProjectFile } from '@digital-canvas/storage';
import { Context, ToolError } from '../context.ts';
import { thumbnail } from '../engine.ts';
import { embedFonts } from '../fonts.ts';
import { json, safe, type Extra } from './util.ts';

type ToolCb = (args: Record<string, unknown>, extra: Extra) => Promise<CallToolResult>;
export interface ToolDef { name: string; schema: ZodRawShape | undefined; cb: ToolCb; description?: string }
export type ToolSet = Map<string, ToolDef>;

/** Collect the tools a set of register functions makes, without a server. */
export function collectTools(register: (server: McpServer) => void): ToolSet {
  const tools: ToolSet = new Map();
  const fake = {
    registerTool(name: string, config: { inputSchema?: ZodRawShape; description?: string }, cb: ToolCb) {
      tools.set(name, { name, schema: config.inputSchema, cb, description: config.description });
      return {};
    },
  } as unknown as McpServer;
  register(fake);
  return tools;
}

/** A Context that keeps opened designs in memory and saves each changed one once, at flush(). */
export class BatchContext extends Context {
  private files = new Map<string, ProjectFile>();
  private dirty = new Set<string>();

  override async open(id: string): Promise<ProjectFile> {
    let f = this.files.get(id);
    if (!f) { f = await super.open(id); this.files.set(id, f); }
    // a copy: tools that turn a design into another one (duplicate, resize) must not change this one
    return { ...f, doc: f.doc, assets: new Map(f.assets) };
  }

  override async save(file: ProjectFile): Promise<{ missingFonts: string[] }> {
    const { missing } = await embedFonts(file);
    file.doc = pruneFonts(pruneAssets({ ...file.doc, updatedAt: new Date().toISOString() }));
    for (const k of [...file.assets.keys()]) if (!file.doc.assets[k]) file.assets.delete(k);
    this.files.set(file.doc.id, file);
    this.dirty.add(file.doc.id);
    return { missingFonts: missing };
  }

  override async edit<T>(id: string, fn: (file: ProjectFile) => Promise<T> | T): Promise<T & { missingFonts?: string[] }> {
    const file = await this.open(id);
    const before = file.doc;
    const out = await fn(file);
    file.doc = followSubtitles(before, file.doc);
    const { missingFonts } = await this.save(file);
    return { ...(out as T), ...(missingFonts.length ? { missingFonts } : {}) };
  }

  get pending(): string[] { return [...this.dirty]; }

  /** Write every changed design (thumbnail + store). */
  async flush(): Promise<string[]> {
    const saved: string[] = [];
    for (const id of [...this.dirty]) {
      const file = this.files.get(id)!;
      file.thumbnail = await thumbnail(file).catch(() => file.thumbnail);
      await this.ws.store.save(file);
      this.dirty.delete(id);
      saved.push(id);
    }
    return saved;
  }

  discard(): string[] {
    const lost = [...this.dirty];
    for (const id of lost) this.files.delete(id);
    this.dirty.clear();
    return lost;
  }
}

// ---------------------------------------------------------------- the sandbox

let qjs: Promise<QuickJSWASMModule> | null = null;
async function quickjs(): Promise<QuickJSWASMModule> {
  qjs ??= (async () => {
    const [{ newQuickJSWASMModuleFromVariant }, variant] = await Promise.all([import('quickjs-emscripten-core'), import('@jitl/quickjs-singlefile-mjs-release-sync')]);
    return newQuickJSWASMModuleFromVariant(variant.default);
  })();
  qjs.catch(() => (qjs = null));
  return qjs;
}

/** Tools that read stored files themselves (or leave the batch): flush before them. */
const FLUSH_BEFORE = /^(export_|open_in_editor$|get_export$|assemble_video$|generate_speech$|render_mockup$)/;

const MAX_CALLS = 3000;
const MAX_LOG = 20_000;

export interface ScriptOutcome {
  ok: boolean;
  result?: unknown;
  error?: string;
  logs: string;
  calls: number;
  saved: string[];
  discarded?: string[];
  images: { data: string; mimeType: string }[];
  ms: number;
}

export async function runScript(code: string, tools: ToolSet, bctx: BatchContext, o: { timeoutMs: number; saveOnError: boolean; signal?: AbortSignal }): Promise<ScriptOutcome> {
  const t0 = Date.now();
  const Q = await quickjs();
  const rt = Q.newRuntime();
  rt.setMemoryLimit(128 * 1024 * 1024);
  rt.setMaxStackSize(1024 * 1024);
  const deadline = t0 + o.timeoutMs;
  rt.setInterruptHandler(() => Date.now() > deadline || !!o.signal?.aborted);
  const vm: QuickJSContext = rt.newContext();
  let logs = '';
  let calls = 0;
  const images: { data: string; mimeType: string }[] = [];
  const shown: { data: string; mimeType: string }[] = [];
  let failed = false;
  const log = (s: string) => { if (logs.length < MAX_LOG) logs += (logs ? '\n' : '') + s.slice(0, MAX_LOG - logs.length); };

  const fn = (name: string, f: (...a: QuickJSHandle[]) => QuickJSHandle | undefined) => { const h = vm.newFunction(name, f); return h; };

  // console.log / warn / error → logs
  const con = vm.newObject();
  for (const lvl of ['log', 'info', 'warn', 'error']) {
    const h = fn(lvl, (...args) => {
      const parts = args.map((a) => { const v = vm.dump(a); return typeof v === 'string' ? v : JSON.stringify(v); });
      log(`${lvl === 'log' || lvl === 'info' ? '' : `[${lvl}] `}${parts.join(' ')}`);
      return undefined;
    });
    vm.setProp(con, lvl, h);
    h.dispose();
  }
  vm.setProp(vm.global, 'console', con);
  con.dispose();

  // __call(name, json) → Promise<json string>
  const callFn = fn('__call', (nameH, argsH) => {
    const name = vm.getString(nameH);
    const argsJson = vm.getString(argsH);
    const d = vm.newPromise();
    void (async () => {
      try {
        if (Date.now() > deadline) throw new Error(`time is up (${Math.round(o.timeoutMs / 1000)} s): split the work into smaller scripts`);
        if (++calls > MAX_CALLS) throw new Error(`more than ${MAX_CALLS} tool calls in one script`);
        const tool = tools.get(name);
        if (!tool) throw new Error(`no tool "${name}"`);
        let args = JSON.parse(argsJson || '{}') as Record<string, unknown>;
        if (tool.schema) {
          const parsed = z.object(tool.schema).safeParse(args);
          if (!parsed.success) throw new Error(`${name}: ${parsed.error.issues.slice(0, 5).map((i) => `${i.path.join('.') || 'args'}: ${i.message}`).join('; ')}`);
          args = parsed.data as Record<string, unknown>;
        }
        if (FLUSH_BEFORE.test(name)) await bctx.flush();
        const res = await tool.cb(args, { signal: o.signal });
        const text = res.content.filter((c) => c.type === 'text').map((c) => (c as { text: string }).text).join('\n');
        if (res.isError) throw new Error(text.replace(/^Error: /, ''));
        let value: unknown;
        try { value = JSON.parse(text); } catch { value = text; }
        const imgs = res.content.filter((c) => c.type === 'image') as { data: string; mimeType: string }[];
        const refs = imgs.map((im) => { images.push(im); return images.length - 1; });
        const links = res.content.filter((c) => c.type === 'resource_link').map((c) => (c as { uri: string }).uri);
        let out: unknown = value;
        if (refs.length || links.length) out = { ...(value && typeof value === 'object' && !Array.isArray(value) ? value : { value }), ...(refs.length ? { images: refs } : {}), ...(links.length ? { links } : {}) };
        const h = vm.newString(JSON.stringify(out ?? null));
        d.resolve(h);
        h.dispose();
      } catch (e) {
        const err = vm.newError(e instanceof Error ? e.message : String(e));
        d.reject(err);
        err.dispose();
      }
      rt.executePendingJobs();
    })();
    return d.handle;
  });
  vm.setProp(vm.global, '__call', callFn);
  callFn.dispose();

  // __show(index) → the image goes back with the result
  const showFn = fn('__show', (iH) => {
    const i = vm.getNumber(iH);
    const im = images[i];
    if (im && shown.length < 6 && !shown.includes(im)) shown.push(im);
    return undefined;
  });
  vm.setProp(vm.global, '__show', showFn);
  showFn.dispose();

  const names = JSON.stringify([...tools.keys()]);
  const prelude = `
const __names = ${names};
const dc = {
  call: async (name, args) => JSON.parse(await __call(String(name), JSON.stringify(args ?? {}))),
  show: (r) => { const list = r && r.images ? r.images : typeof r === 'number' ? [r] : []; for (const i of list) __show(i); return r; },
};
for (const n of __names) dc[n] = (args) => dc.call(n, args);
globalThis.dc = dc;
`;
  const pre = vm.evalCode(prelude, 'prelude.js');
  if (pre.error) { const e = vm.dump(pre.error); pre.error.dispose(); vm.dispose(); rt.dispose(); throw new Error(`sandbox setup failed: ${JSON.stringify(e)}`); }
  pre.value.dispose();

  let result: unknown;
  let error: string | undefined;
  const ran = vm.evalCode(`(async () => {\n${code}\n})()`, 'script.js');
  if (ran.error) {
    error = errText(vm.dump(ran.error));
    ran.error.dispose();
  } else {
    const p = ran.value;
    const settled = vm.resolvePromise(p);
    p.dispose();
    rt.executePendingJobs();
    // wait, waking up while host calls are in flight
    const timer = new Promise<'timeout'>((res) => setTimeout(() => res('timeout'), Math.max(0, deadline - Date.now()) + 50));
    const r = await Promise.race([settled, timer]);
    if (r === 'timeout') error = `time is up (${Math.round(o.timeoutMs / 1000)} s): split the work into smaller scripts`;
    else if (r.error) { error = errText(vm.dump(r.error)); r.error.dispose(); }
    else { result = vm.dump(r.value); r.value.dispose(); }
  }
  failed = !!error;
  let saved: string[] = [], discarded: string[] | undefined;
  if (!failed || o.saveOnError) saved = await bctx.flush();
  else { discarded = bctx.discard(); }
  try { vm.dispose(); rt.dispose(); } catch { /* pending promises at timeout */ }
  return { ok: !failed, ...(failed ? { error } : { result }), logs, calls, saved, ...(discarded?.length ? { discarded } : {}), images: shown, ms: Date.now() - t0 };
}

function errText(v: unknown): string {
  if (v && typeof v === 'object') {
    const o = v as { name?: string; message?: string; stack?: string };
    const where = o.stack?.match(/script\.js:(\d+)/)?.[1];
    return `${o.name && o.name !== 'Error' ? `${o.name}: ` : ''}${o.message ?? JSON.stringify(v)}${where ? ` (script line ${Number(where) - 1})` : ''}`;
  }
  return String(v);
}

export const SCRIPT_GUIDE = `## Scripts (run_script): many steps, one call
When a job needs more than ~3 tool calls (many elements, a loop over rows or pages, measure-then-fix passes, checking every price), write one script instead of making the calls yourself. Every tool is an async function on \`dc\` with the same arguments: \`await dc.add_elements({design_id, elements})\`, \`await dc.update_elements(...)\`, \`dc.call('name', args)\`. Results are the tools' JSON. Designs are opened once and saved once at the end, so 300 edits cost one save; if the script throws, nothing is saved (pass save_on_error to keep partial work).
- \`return\` a small summary (ids, counts, what you checked): it is all that comes back, with console.log lines. Do not return whole outlines.
- Pictures: \`dc.show(await dc.render_page({design_id, page: 1}))\` sends that render back with the result (up to 6).
- Plain JavaScript (ES2023) in QuickJS: no fetch, no files, no require/import, no timers. Data you need must come from tools or be written in the script.
- Keep it under about ${40} seconds in cloud mode (the client gives up near 60 s); split big jobs into a few scripts.
Example:
\`\`\`js
const d = await dc.open_design({ design_id: 'd_x' });
const prices = d.pages[0].elements.filter(e => e.type === 'text' && /^₹/.test(e.text));
await dc.update_elements({ design_id: 'd_x', updates: prices.map(e => ({ id: e.id, fontSize: 44, color: '#c2410c' })) });
return { changed: prices.length };
\`\`\``;

export function registerScriptTool(server: McpServer, ctx: Context, register: (server: McpServer, ctx: Context) => void): void {
  server.registerTool('run_script', {
    title: 'Run a script (many tool calls in one)',
    description: [
      'Run JavaScript that calls the other tools (`await dc.add_elements({...})`, `dc.update_elements`, `dc.open_design`, `dc.render_page`, `dc.set_page_html`…) and returns a small result.',
      'Use it whenever a job takes more than ~3 calls (loops over rows, pages, prices; measure-then-fix passes; bulk restyles): it keeps your context free of tool chatter and saves each design once (fast) instead of after every call. A thrown error saves nothing.',
      'Sandboxed QuickJS: no network, files or imports. `return` what you need to know; console.log lines come back too; `dc.show(renderResult)` returns that image. See dcanvas://guide "Scripts".',
    ].join('\n'),
    inputSchema: {
      code: z.string().min(1).max(200_000).describe('The body of an async function: use await and return.'),
      timeout_s: z.number().min(5).max(600).optional().describe('Default 50 (cloud) / 300 (desktop, local).'),
      save_on_error: z.boolean().optional().describe('Keep the changes made before an error (default false: all or nothing).'),
    },
  }, safe(async ({ code, timeout_s, save_on_error }, extra) => {
    const bctx = new BatchContext(ctx.ws, ctx.opts);
    const tools = collectTools((s) => register(s, bctx));
    tools.delete('run_script');
    const out = await runScript(code, tools, bctx, { timeoutMs: (timeout_s ?? (ctx.remote ? 50 : 300)) * 1000, saveOnError: !!save_on_error, signal: extra?.signal });
    const body = {
      ok: out.ok,
      ...(out.ok ? { result: out.result ?? null } : { error: out.error }),
      ...(out.logs ? { logs: out.logs } : {}),
      calls: out.calls, ...(out.saved.length ? { saved: out.saved } : {}), ...(out.discarded ? { not_saved: out.discarded } : {}), seconds: Math.round(out.ms / 100) / 10,
    };
    const res = json(body);
    if (!out.ok) res.isError = true;
    for (const im of out.images) res.content.push({ type: 'image', data: im.data, mimeType: im.mimeType });
    return res;
  }));
  void ToolError;
}
