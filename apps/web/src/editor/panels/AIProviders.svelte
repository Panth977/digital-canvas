<script lang="ts">
  import './panels.css';
  import Icon from '../../lib/Icon.svelte';
  import { KINDS, kindInfo } from '../../lib/ai/registry.ts';
  import { COMPATIBLE_PRESETS } from '../../lib/ai/compat.ts';
  import { aiSettings, maskKey, taskCap } from '../../lib/ai/settings.svelte.ts';
  import { TASKS, type ProviderKind, type Task } from '../../lib/ai/types.ts';

  let { ondone }: { ondone?: () => void } = $props();

  // ---- add a provider ----
  let adding = $state<ProviderKind | null>(null);
  let keyDraft = $state('');
  let baseDraft = $state('');
  let labelDraft = $state('');
  let preset = $state('groq');
  const info = $derived(adding ? kindInfo(adding) : null);
  const presetInfo = $derived(COMPATIBLE_PRESETS.find((p) => p.id === preset));
  const keyless = $derived(adding === 'compatible' && !!presetInfo?.keyless);
  const keyOk = $derived(!info ? false : keyless ? true : info.keyPattern ? info.keyPattern.test(keyDraft.trim()) : keyDraft.trim().length > 0);
  const baseOk = $derived(adding !== 'compatible' || /^https?:\/\/\S+$/.test(baseDraft.trim()));

  function startAdd(k: ProviderKind): void {
    adding = k;
    keyDraft = '';
    labelDraft = '';
    if (k === 'compatible') pickPreset('groq');
  }
  function pickPreset(id: string): void {
    preset = id;
    const p = COMPATIBLE_PRESETS.find((x) => x.id === id);
    baseDraft = p?.baseUrl ?? '';
    labelDraft = p && p.id !== 'custom' ? p.label : '';
  }
  async function save(): Promise<void> {
    if (!adding || !keyOk || !baseOk) return;
    const id = aiSettings.add(adding, keyDraft, { ...(labelDraft ? { label: labelDraft } : {}), ...(adding === 'compatible' ? { baseUrl: baseDraft } : {}) });
    adding = null;
    keyDraft = '';
    void test(id);
  }

  // ---- test connection ----
  let tests = $state<Record<string, { busy: boolean; ok?: boolean; text?: string }>>({});
  async function test(id: string): Promise<void> {
    tests = { ...tests, [id]: { busy: true } };
    try {
      const text = await aiSettings.provider(id).test();
      tests = { ...tests, [id]: { busy: false, ok: true, text } };
      await aiSettings.refreshModels(id).catch(() => {});
    } catch (e) {
      tests = { ...tests, [id]: { busy: false, ok: false, text: e instanceof Error ? e.message : String(e) } };
    }
  }

  // ---- default model per task ----
  const providersFor = (t: Task) => aiSettings.providers.filter((p) => aiSettings.canDo(p.id, taskCap(t)));
  function setProvider(t: Task, id: string): void {
    if (!id) return aiSettings.setDefault(t, null);
    const cfg = aiSettings.get(id)!;
    const model = kindInfo(cfg.kind).defaults[t] ?? aiSettings.modelsFor(id, taskCap(t))[0]?.id ?? '';
    aiSettings.setDefault(t, { provider: id, model });
  }
  function setModel(t: Task, model: string): void {
    const c = aiSettings.choice(t);
    if (c && model.trim()) aiSettings.setDefault(t, { provider: c.provider, model: model.trim() });
  }
</script>

<div class="dp-stack" data-testid="ai-providers-box">
  <div class="dp-row"><b class="grow">AI providers</b>{#if ondone && aiSettings.any}<button class="dp-link" onclick={ondone} data-testid="ai-providers-done">Done</button>{/if}</div>
  <p class="dp-hint" style="margin:0">Use your own keys with Claude, GPT, Gemini, OpenRouter, kie.ai or any OpenAI-compatible endpoint. You pay the provider for what you use.</p>

  {#each aiSettings.providers as p (p.id)}
    {@const t = tests[p.id]}
    {@const k = kindInfo(p.kind)}
    <div class="dp-box dp-stack prov" data-testid="ai-provider-{p.id}">
      <div class="dp-row">
        <span class="grow"><b>{p.label}</b><br /><small class="dp-hint">{p.baseUrl ?? k.host}{aiSettings.key(p.id) ? ` · key ${maskKey(aiSettings.key(p.id))}` : ''}</small></span>
        <button class="btn" disabled={t?.busy} onclick={() => test(p.id)} data-testid="ai-provider-test">{#if t?.busy}<span class="dp-spin"></span>{:else}Test{/if}</button>
        <button class="btn icon danger" title="Remove" aria-label="Remove {p.label}" onclick={() => aiSettings.remove(p.id)} data-testid="ai-provider-remove"><Icon name="trash" size={16} /></button>
      </div>
      {#if t?.text}<p class={t.ok ? 'dp-ok' : 'dp-err'} style="margin:0" data-testid="ai-provider-status">{t.ok ? '✓ ' : ''}{t.text}</p>{/if}
    </div>
  {/each}

  {#if adding && info}
    <form class="dp-box dp-stack" onsubmit={(e) => { e.preventDefault(); void save(); }} data-testid="ai-add-form">
      <b>{info.label}</b>
      <p class="dp-hint" style="margin:0">{info.blurb}</p>
      {#if adding === 'compatible'}
        <select class="input" value={preset} onchange={(e) => pickPreset((e.target as HTMLSelectElement).value)} aria-label="Endpoint" data-testid="ai-add-preset">
          {#each COMPATIBLE_PRESETS as pr (pr.id)}<option value={pr.id}>{pr.label}</option>{/each}
        </select>
        <input class="input" placeholder="https://…/v1" bind:value={baseDraft} aria-label="Base URL" data-testid="ai-add-base" />
        <input class="input" placeholder="Name (optional)" bind:value={labelDraft} aria-label="Name" />
        {#if presetInfo?.note}<p class="dp-hint" style="margin:0">{presetInfo.note}</p>{/if}
        {#if presetInfo?.keyUrl}<p class="dp-hint" style="margin:0">Get a key at <a href={presetInfo.keyUrl} target="_blank" rel="noreferrer">{new URL(presetInfo.keyUrl).host}</a>.</p>{/if}
      {:else if info.keyUrl}
        <p class="dp-hint" style="margin:0">Get a key at <a href={info.keyUrl} target="_blank" rel="noreferrer">{new URL(info.keyUrl).host}</a> and paste it here.</p>
      {/if}
      <input class="input" type="password" autocomplete="off" placeholder={keyless ? 'API key (not needed)' : info.keyHint} bind:value={keyDraft} aria-label="{info.label} API key" data-testid="ai-add-key" />
      {#if keyDraft && !keyOk}<p class="dp-err" style="margin:0">That doesn’t look like a {info.label} key{info.keyHint.includes('…') ? ` (it starts with ${info.keyHint.replace('…', '')})` : ''}.</p>{/if}
      <div class="dp-row">
        <button class="btn primary grow" disabled={!keyOk || !baseOk} data-testid="ai-add-save">Save</button>
        <button type="button" class="btn" onclick={() => (adding = null)}>Cancel</button>
      </div>
    </form>
  {:else}
    <div class="dp-head" style="margin:6px 0 0"><h3>Add a provider</h3></div>
    <div class="kinds">
      {#each KINDS as k (k.kind)}
        <button class="dp-item kind" onclick={() => startAdd(k.kind)} data-testid="ai-add-{k.kind}">
          <span class="grow"><b>{k.label}</b><small>{k.caps.includes('image') || k.caps.includes('video') ? [k.caps.includes('text') ? 'text' : '', k.caps.includes('vision') ? 'vision' : '', k.caps.includes('image') ? 'images' : '', k.caps.includes('video') ? 'video' : ''].filter(Boolean).join(' · ') : 'text · vision'}</small></span>
          <Icon name="plus" size={16} />
        </button>
      {/each}
    </div>
  {/if}

  {#if aiSettings.any}
    <div class="dp-head" style="margin:10px 0 0"><h3>Default model for…</h3></div>
    {#each TASKS as t (t.id)}
      {@const c = aiSettings.choice(t.id)}
      {@const list = c ? aiSettings.modelsFor(c.provider, t.cap) : []}
      <div class="task" data-testid="ai-default-{t.id}">
        <span class="tl">{t.label}</span>
        {#if providersFor(t.id).length}
          <div class="dp-row">
            <select class="input grow" value={c?.provider ?? ''} onchange={(e) => setProvider(t.id, (e.target as HTMLSelectElement).value)} aria-label="{t.label} provider" data-testid="ai-default-{t.id}-provider">
              {#each providersFor(t.id) as p (p.id)}<option value={p.id}>{p.label}</option>{/each}
            </select>
          </div>
          <input class="input" list="ai-models-{t.id}" value={c?.model ?? ''} onchange={(e) => setModel(t.id, (e.target as HTMLInputElement).value)} aria-label="{t.label} model" data-testid="ai-default-{t.id}-model" />
          <datalist id="ai-models-{t.id}">{#each list as m (m.id)}<option value={m.id}>{m.label ?? m.id}</option>{/each}</datalist>
        {:else}
          <small class="dp-hint">None of your providers can do this{t.cap === 'video' ? ' (OpenAI, Gemini and kie.ai can)' : t.cap === 'image' ? ' (OpenAI, Gemini, OpenRouter and kie.ai can)' : ''}.</small>
        {/if}
      </div>
    {/each}
  {/if}

  <p class="dp-hint" style="margin:0"><Icon name="lock" size={12} /> Keys are kept in this browser on this device only (local storage). Each key is sent only to its provider’s own endpoint — never to our servers or into your designs. Remove a provider to delete its key.</p>
</div>

<style>
  .kinds { display: flex; flex-direction: column; gap: 4px; }
  .kind { text-align: left; align-items: center; }
  .kind small { display: block; color: var(--muted); font-size: 12px; font-weight: 400; }
  .kind b { font-weight: 600; font-size: 13px; }
  .prov small { font-size: 12px; word-break: break-all; }
  .task { display: flex; flex-direction: column; gap: 4px; margin-top: 6px; }
  .tl { font-size: 12px; font-weight: 600; color: var(--ink-2); }
  select.input { height: 34px; }
  :global(.dp-ok) { color: #127a3d; font-size: 13px; }
</style>
