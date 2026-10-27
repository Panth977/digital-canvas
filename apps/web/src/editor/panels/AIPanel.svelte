<script lang="ts">
  import './panels.css';
  import type { Doc, TextElement } from '@digital-canvas/scene';
  import type { EditorState } from '../../lib/editor.svelte.ts';
  import Icon from '../../lib/Icon.svelte';
  import { fetchIcon } from '../../lib/stock.ts';
  import { brand } from '../../lib/brand.svelte.ts';
  import { place } from '../../lib/tools.ts';
  import { text as textEl } from '@digital-canvas/scene';
  import { insertDesign, pageIsEmpty, type InsertMode } from '../../lib/templates.ts';
  import { AI_MODEL, WRITE_ACTIONS, describePage, designForMe, getKey, looksLikeKey, magicWrite, resolveIcons, setKey, type WriteAction } from '../../lib/ai.ts';
  import InsertDialog from './InsertDialog.svelte';

  let { ed }: { ed: EditorState } = $props();

  let key = $state(getKey());
  let keyDraft = $state('');
  let showSettings = $state(false);
  const hasKey = $derived(!!key);
  function saveKey(): void {
    setKey(keyDraft);
    key = getKey();
    keyDraft = '';
    showSettings = false;
  }
  function forgetKey(): void {
    setKey('');
    key = '';
  }
  const masked = $derived(key ? `${key.slice(0, 10)}…${key.slice(-4)}` : '');

  type Mode = 'design' | 'write' | 'describe';
  let mode = $state<Mode>('design');
  let busy = $state(false);
  let error = $state('');

  // ---- design for me ----
  let prompt = $state('');
  let warnings = $state<string[]>([]);
  let pending = $state.raw<Doc | null>(null);
  const IDEAS = ['Instagram post for a monsoon sale at a saree shop, 40% off', 'Poster for a weekend jazz night at a rooftop café', 'Slide: our Q3 results — revenue up 18%, 3 key wins', 'Birthday wishes for my sister Aanya, playful and pink'];
  function brandHint(): string {
    const parts: string[] = [];
    if (brand.colors.length) parts.push(`Use these brand colours: ${brand.colors.slice(0, 6).join(', ')}.`);
    const f = brand.kit.fonts;
    if (f.heading) parts.push(`Headline font: ${f.heading.fontFamily}.`);
    if (f.body) parts.push(`Body font: ${f.body.fontFamily}.`);
    return parts.join(' ');
  }
  async function generate(): Promise<void> {
    if (!prompt.trim()) return;
    busy = true;
    error = '';
    warnings = [];
    try {
      const r = await designForMe(prompt, { width: ed.doc.width, height: ed.doc.height }, brandHint());
      const doc = await resolveIcons(r.doc, r.icons, fetchIcon);
      warnings = r.warnings;
      if (pageIsEmpty(ed)) await insertDesign(ed, doc, 'replace');
      else pending = doc;
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    } finally {
      busy = false;
    }
  }
  async function pick(m: InsertMode): Promise<void> {
    const d = pending;
    pending = null;
    if (d) { busy = true; try { await insertDesign(ed, d, m); } finally { busy = false; } }
  }

  // ---- magic write ----
  const sel = $derived(ed.selected.find((e): e is TextElement => e.type === 'text') ?? null);
  let lang = $state('Hindi');
  let custom = $state('');
  let result = $state<{ id: string | null; text: string; action: WriteAction } | null>(null);
  async function write(action: WriteAction): Promise<void> {
    busy = true;
    error = '';
    try {
      const out = await magicWrite(sel?.text ?? '', action, action === 'translate' ? lang : custom);
      result = { id: sel?.id ?? null, text: out, action };
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    } finally {
      busy = false;
    }
  }
  function useResult(): void {
    if (!result) return;
    if (result.id && ed.doc.pages.some((p) => p.elements.some((e) => e.id === result!.id))) {
      ed.setText(result.id, result.text);
      ed.seal();
      ed.refitText();
    } else addAsText(result.text);
    result = null;
  }
  function addAsText(value: string): void {
    const size = Math.round(Math.max(14, Math.min(ed.doc.width, ed.doc.height) / 40));
    let t = textEl(value, { x: 0, y: 0, w: ed.doc.width * 0.7, h: 10 }, { fontSize: size });
    t = { ...t, h: ed.renderer.textHeight(t), x: ed.doc.width * 0.15 };
    t.y = (ed.doc.height - t.h) / 2;
    place(ed, [t]);
  }

  // ---- describe ----
  let alt = $state('');
  let copied = $state(false);
  async function describe(): Promise<void> {
    busy = true;
    error = '';
    alt = '';
    try {
      const png = ed.exportPage(ed.pageId, 'png', Math.min(1, 1024 / Math.max(ed.doc.width, ed.doc.height)));
      alt = await describePage(png, ed.page, ed.doc);
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    } finally {
      busy = false;
    }
  }
  function saveToNotes(): void {
    const notes = ed.page.notes ? `${ed.page.notes}\n\nAlt text: ${alt}` : `Alt text: ${alt}`;
    ed.updatePage({ notes });
    ed.seal();
  }
</script>

<div class="dp" data-testid="ai-panel">
  <div class="hero">
    <span class="logo"><Icon name="ai" size={22} /></span>
    <div>
      <b>AI</b>
      <small>{hasKey ? `Claude (${AI_MODEL}) · your key` : 'Bring your own Anthropic key'}</small>
    </div>
    {#if hasKey}<button class="dp-link" style="margin-left:auto" onclick={() => (showSettings = !showSettings)} data-testid="ai-settings"><Icon name="key" size={16} /></button>{/if}
  </div>

  {#if !hasKey || showSettings}
    <div class="dp-box dp-stack" data-testid="ai-key-box">
      {#if hasKey}
        <div class="dp-row"><span class="grow">Key in use: <code>{masked}</code></span><button class="btn danger" onclick={forgetKey} data-testid="ai-key-forget">Remove</button></div>
      {:else}
        <b>Use Claude in your designs</b>
        <p class="dp-hint" style="margin:0">Magic Write, Design for me and alt text run on Anthropic’s Claude with <i>your own</i> API key. You pay Anthropic for what you use (usually well under ₹1 a request).</p>
        <ol class="steps">
          <li>Open <a href="https://console.anthropic.com/settings/keys" target="_blank" rel="noreferrer">console.anthropic.com → API keys</a> and sign in.</li>
          <li>Add a little credit under Billing.</li>
          <li>Create a key and paste it here.</li>
        </ol>
      {/if}
      <form class="dp-stack" onsubmit={(e) => { e.preventDefault(); if (looksLikeKey(keyDraft)) saveKey(); }}>
        <input class="input" type="password" autocomplete="off" placeholder="sk-ant-…" bind:value={keyDraft} data-testid="ai-key-input" aria-label="Anthropic API key" />
        {#if keyDraft && !looksLikeKey(keyDraft)}<p class="dp-err" style="margin:0">That doesn’t look like an Anthropic key (it starts with sk-ant-).</p>{/if}
        <button class="btn primary" disabled={!looksLikeKey(keyDraft)} data-testid="ai-key-save">{hasKey ? 'Replace key' : 'Save key'}</button>
      </form>
      <p class="dp-hint" style="margin:0"><Icon name="lock" size={12} /> The key stays in this browser only (local storage). It is sent to api.anthropic.com and nowhere else — not to our servers, not into your designs.</p>
    </div>
  {/if}

  {#if hasKey}
    <div class="dp-tabs" role="tablist" style="margin-top:12px">
      <button role="tab" class:on={mode === 'design'} onclick={() => (mode = 'design')} data-testid="ai-tab-design">Design for me</button>
      <button role="tab" class:on={mode === 'write'} onclick={() => (mode = 'write')} data-testid="ai-tab-write">Magic Write</button>
      <button role="tab" class:on={mode === 'describe'} onclick={() => (mode = 'describe')} data-testid="ai-tab-describe">Alt text</button>
    </div>
    {#if error}<p class="dp-err" data-testid="ai-error">{error}</p>{/if}

    {#if mode === 'design'}
      <form class="dp-stack" onsubmit={(e) => { e.preventDefault(); void generate(); }}>
        <textarea class="dp-textarea" placeholder="Describe the design you want…" bind:value={prompt} data-testid="ai-prompt" onkeydown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) void generate(); }}></textarea>
        <button class="btn primary dp-cta" disabled={busy || !prompt.trim()} data-testid="ai-generate">
          {#if busy}<span class="dp-spin"></span> Designing…{:else}<Icon name="sparkle" size={16} /> Generate design{/if}
        </button>
      </form>
      <p class="dp-hint">Makes a {Math.round(ed.doc.width)}×{Math.round(ed.doc.height)} page you can edit like any other: text, shapes, icons and charts.{brand.colors.length ? ' Uses your brand colours.' : ''}</p>
      {#if warnings.length}<p class="dp-hint">Note: {warnings.join('; ')}.</p>{/if}
      <div class="dp-head"><h3>Try</h3></div>
      <div class="dp-list">
        {#each IDEAS as idea (idea)}<button class="dp-item idea" onclick={() => (prompt = idea)}><Icon name="sparkle" size={14} /> <span class="dp-tx">{idea}</span></button>{/each}
      </div>
    {:else if mode === 'write'}
      {#if sel}
        <div class="quote">{sel.text.slice(0, 220)}{sel.text.length > 220 ? '…' : ''}</div>
      {:else}
        <p class="dp-hint" style="margin-top:0">Select a text box to rewrite it — or describe what to write and add it as new text.</p>
      {/if}
      {#if sel}
        <div class="actions">
          {#each WRITE_ACTIONS as a (a.id)}<button class="dp-chip" disabled={busy} onclick={() => write(a.id)} data-testid="ai-write-{a.id}">{a.label}</button>{/each}
        </div>
        <div class="dp-row" style="margin-top:8px">
          <select class="input grow" bind:value={lang} aria-label="Language">
            {#each ['Hindi', 'Marathi', 'Gujarati', 'Tamil', 'Telugu', 'Bengali', 'Kannada', 'Malayalam', 'Punjabi', 'Urdu', 'English', 'Spanish', 'French', 'German', 'Portuguese', 'Arabic', 'Japanese', 'Chinese (Simplified)'] as l}<option>{l}</option>{/each}
          </select>
          <button class="btn" disabled={busy} onclick={() => write('translate')} data-testid="ai-write-translate"><Icon name="globe" size={16} /> Translate</button>
        </div>
      {/if}
      <form class="dp-row" style="margin-top:8px" onsubmit={(e) => { e.preventDefault(); if (custom.trim()) void write('custom'); }}>
        <input class="input grow" placeholder={sel ? 'Or say how to change it…' : 'e.g. a catchy tagline for a bakery'} bind:value={custom} data-testid="ai-write-custom" />
        <button class="btn icon" disabled={busy || !custom.trim()} aria-label="Write"><Icon name="send" size={16} /></button>
      </form>
      {#if busy}<p class="dp-hint"><span class="dp-spin"></span> Writing…</p>{/if}
      {#if result}
        <div class="dp-box dp-stack" style="margin-top:12px" data-testid="ai-write-result">
          <div class="out">{result.text}</div>
          <div class="dp-row">
            <button class="btn primary grow" onclick={useResult} data-testid="ai-write-use">{result.id ? 'Replace text' : 'Add to page'}</button>
            {#if result.id}<button class="btn" onclick={() => { addAsText(result!.text); result = null; }}>Add as new</button>{/if}
            <button class="btn icon" title="Try again" aria-label="Try again" disabled={busy} onclick={() => write(result!.action)}><Icon name="redo" size={16} /></button>
          </div>
        </div>
      {/if}
    {:else}
      <p class="dp-hint" style="margin-top:0">Claude looks at page {ed.pageIndex + 1} and writes alt text for it, for screen readers and social posts.</p>
      <button class="btn primary dp-cta" style="margin-top:10px" disabled={busy} onclick={describe} data-testid="ai-describe">
        {#if busy}<span class="dp-spin"></span> Looking…{:else}<Icon name="eye" size={16} /> Describe this page{/if}
      </button>
      {#if alt}
        <div class="dp-box dp-stack" style="margin-top:12px" data-testid="ai-alt">
          <div class="out">{alt}</div>
          <div class="dp-row">
            <button class="btn grow" onclick={async () => { await navigator.clipboard?.writeText(alt).catch(() => {}); copied = true; setTimeout(() => (copied = false), 1500); }}>{copied ? 'Copied' : 'Copy'}</button>
            <button class="btn grow" onclick={saveToNotes} data-testid="ai-alt-notes">Save to page notes</button>
          </div>
        </div>
      {/if}
    {/if}
  {/if}
</div>

{#if pending}
  <InsertDialog title="your AI design" oncancel={() => (pending = null)} onpick={pick} />
{/if}

<style>
  .hero { display: flex; align-items: center; gap: 10px; margin-bottom: 12px; }
  .hero .logo { width: 40px; height: 40px; border-radius: 12px; display: grid; place-items: center; color: #fff; background: conic-gradient(from 200deg, #00c4cc, #7d2ae8, #ff66c4, #00c4cc); flex-shrink: 0; }
  .hero b { display: block; font-size: 17px; }
  .hero small { color: var(--muted); font-size: 12px; }
  .steps { margin: 0; padding-left: 18px; font-size: 13px; line-height: 1.6; color: var(--ink-2); }
  .steps a { color: var(--accent); }
  code { font-size: 12px; background: var(--chip); padding: 1px 4px; border-radius: 4px; }
  .actions { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 10px; }
  .quote { border-left: 3px solid var(--accent); padding: 6px 10px; background: var(--chip); border-radius: 0 8px 8px 0; font-size: 13px; line-height: 1.45; white-space: pre-wrap; }
  .out { white-space: pre-wrap; font-size: 14px; line-height: 1.5; }
  .idea { font-size: 13px; color: var(--ink-2); }
  .idea .dp-tx { white-space: normal; }
  select.input { height: 34px; }
</style>
