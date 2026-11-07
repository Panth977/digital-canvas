<script lang="ts">
  import Icon from '../Icon.svelte';
  import { desktop } from './desktop.svelte.ts';
  import { toast } from '../toast.svelte.ts';
  import UpdateBanner from './UpdateBanner.svelte';

  let { onclose }: { onclose: () => void } = $props();
  const s = $derived(desktop.state!);
  let client = $state('claude-code');
  let reveal = $state(false);
  let error = $state('');
  const config = $derived(s.mcp.configs.find((c) => c.id === client) ?? s.mcp.configs[0]!);
  const shownToken = $derived(reveal ? s.mcp.token : `${s.mcp.token.slice(0, 6)}${'•'.repeat(24)}`);

  async function copy(text: string, what: string): Promise<void> {
    await navigator.clipboard.writeText(text);
    toast.show(`${what} copied`);
  }

  let checking = $state(false);
  let checked = $state<'none' | 'found' | null>(null);
  async function check(): Promise<void> {
    checking = true;
    await run(async () => { checked = (await desktop.checkUpdate()) ? 'found' : 'none'; });
    checking = false;
  }

  async function run(fn: () => Promise<unknown>): Promise<void> {
    error = '';
    try { await fn(); } catch (e) { error = e instanceof Error ? e.message.replace(/^Error invoking remote method 'dc': (Error: )?/, '') : String(e); }
  }
</script>

<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
<div class="scrim" onclick={onclose}>
  <div class="dlg scroll-y" role="dialog" tabindex="-1" aria-modal="true" aria-label="Settings" data-testid="desktop-settings" onclick={(e) => e.stopPropagation()}>
    <header>
      <h3>Settings</h3>
      <button class="btn ghost" aria-label="Close" onclick={onclose}><Icon name="close" size={18} /></button>
    </header>

    <section data-testid="updates">
      <h4>Updates</h4>
      {#if s.update}
        <UpdateBanner compact />
      {:else}
        <p>You have version <b>{s.version}</b>{#if checked === 'none'}, the newest{/if}.{#if s.lastUpdateCheck} <span class="muted small">Checked {new Date(s.lastUpdateCheck).toLocaleString()}.</span>{/if}</p>
      {/if}
      <button class="btn" disabled={checking} onclick={() => void check()} data-testid="check-updates">{checking ? 'Checking…' : 'Check for updates'}</button>
      <p class="muted small">The app looks for a new version when it starts and every 6 hours. It asks before installing anything.</p>
    </section>

    <section>
      <h4>Your folder</h4>
      <div class="url"><code data-testid="settings-folder" title={s.folder}>{s.folder}</code>
        <button class="btn" onclick={() => run(() => desktop.call('revealFolder'))}>Open</button>
        <button class="btn" onclick={() => run(() => desktop.call('chooseFolder'))} data-testid="change-folder">Change…</button></div>
      <p class="muted small">Designs are <code>.dcanvas</code> files; uploads are in <code>assets/</code>, exports from agents in <code>Exports/</code>. Changing the folder moves nothing: the old one stays as it is.</p>
    </section>

    <section>
      <h4>Google Drive <span class="tag">optional</span></h4>
      {#if !s.drive.configured}
        <p class="muted">This build has no Google client, so it can’t connect to Drive.</p>
      {:else if s.drive.connected}
        <p>Connected as <b>{s.drive.account?.email}</b>. Calls go straight from this computer to Google.</p>
        {#if !s.drive.persisted}<p class="muted small">This system has no keychain, so you’ll connect again after the app quits.</p>{/if}
        <div class="seg" role="radiogroup" aria-label="Save designs to">
          <label class:on={s.active === 'folder'}><input type="radio" name="dc-store" checked={s.active === 'folder'} onchange={() => run(() => desktop.setActive('folder'))} /> This folder</label>
          <label class:on={s.active === 'drive'}><input type="radio" name="dc-store" checked={s.active === 'drive'} onchange={() => run(() => desktop.setActive('drive'))} data-testid="use-drive" /> Google Drive</label>
        </div>
        <button class="btn ghost" onclick={() => run(() => desktop.disconnectDrive())}>Disconnect</button>
      {:else}
        <p>Keep designs in your own Drive instead of the folder. Google’s page opens in your browser, the sign-in key is kept in this computer’s keychain, and nothing passes through our servers.</p>
        {#if s.drive.connecting}
          <button class="btn" onclick={() => run(() => desktop.call('drive.cancel'))}>Waiting for your browser… Cancel</button>
        {:else}
          <button class="btn" onclick={() => run(() => desktop.connectDrive())} data-testid="connect-drive"><Icon name="drive" size={16} /> Connect Google Drive</button>
        {/if}
      {/if}
    </section>

    <section>
      <h4>Local MCP</h4>
      <label class="switch"><input type="checkbox" checked={s.mcp.enabled} onchange={(e) => run(() => desktop.call('mcp.set', { on: e.currentTarget.checked }))} data-testid="mcp-switch" />
        <span>Let AI tools on this computer use Digital Canvas <span class="muted small">({s.active === 'drive' ? 'Google Drive' : 'your folder'})</span></span></label>
      {#if s.mcp.enabled}
        <p class="lbl">URL</p>
        <div class="url"><code data-testid="mcp-url">{s.mcp.url}</code><button class="btn" onclick={() => copy(s.mcp.url, 'URL')} data-testid="copy-mcp-url">Copy</button></div>
        <p class="muted small">If a client can’t find that name: <code>{s.mcp.fallbackUrl}</code></p>
        <p class="lbl">Access token</p>
        <div class="url"><code data-testid="mcp-token">{shownToken}</code>
          <button class="btn ghost" onclick={() => (reveal = !reveal)}>{reveal ? 'Hide' : 'Show'}</button>
          <button class="btn" onclick={() => copy(s.mcp.token, 'Token')}>Copy</button>
          <button class="btn ghost" onclick={() => run(() => desktop.call('mcp.newToken'))} data-testid="mcp-new-token">New</button></div>
        <p class="muted small">Only requests with this token get in, and other websites are refused. A new token stops the old one at once.</p>
        <p class="lbl">Add it to</p>
        <div class="clients" role="tablist" aria-label="AI client">
          {#each s.mcp.configs as c (c.id)}<button class="chip" class:on={client === c.id} role="tab" aria-selected={client === c.id} onclick={() => (client = c.id)} data-testid="client-{c.id}">{c.label}</button>{/each}
        </div>
        <p class="muted small">{config.hint}</p>
        <div class="cfg"><pre data-testid="client-config">{config.text}</pre><button class="btn" onclick={() => copy(config.text, config.label)}>Copy</button></div>
        <p class="muted small">Video export runs on this app’s own encoder, so keep Digital Canvas open while an agent exports. It starts a hidden window if none is open.</p>
      {/if}
    </section>

    <section>
      <p class="muted small">Digital Canvas {s.version}. Stock photo, icon and font searches, AI keys you add, and first use of the on-device image models need the internet; everything else works offline.</p>
    </section>
    {#if error}<p class="err" role="alert">{error}</p>{/if}
  </div>
</div>

<style>
  .scrim { position: fixed; inset: 0; z-index: 900; background: rgba(0,0,0,.5); display: grid; place-items: center; }
  .dlg { width: min(640px, calc(100% - 24px)); max-height: calc(100% - 40px); background: var(--pop); color: var(--ink); border-radius: 12px; padding: 16px 20px 18px; box-shadow: var(--shadow); }
  header { display: flex; align-items: center; justify-content: space-between; }
  h3 { margin: 0; font-size: 18px; }
  h4 { margin: 0 0 8px; font-size: 14px; display: flex; gap: 8px; align-items: center; }
  section { padding: 12px 0; border-bottom: 1px solid var(--line); }
  section:last-of-type { border-bottom: 0; }
  p { margin: 6px 0; line-height: 1.45; font-size: 14px; }
  .lbl { font-weight: 600; margin-top: 12px; font-size: 13px; }
  .muted { color: var(--muted); }
  .small { font-size: 12.5px; }
  .url { display: flex; gap: 8px; align-items: center; }
  .url code { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font: 13px ui-monospace, Menlo, monospace; background: var(--hover); padding: 8px 10px; border-radius: 8px; }
  .seg { display: flex; gap: 8px; margin-bottom: 6px; }
  .seg label { display: flex; align-items: center; gap: 6px; padding: 8px 12px; border: 1px solid var(--line); border-radius: 8px; cursor: pointer; font-size: 14px; }
  .seg label.on { border-color: var(--accent); background: var(--accent-soft); }
  .switch { display: flex; gap: 10px; align-items: flex-start; cursor: pointer; font-size: 14px; }
  .switch input { width: 18px; height: 18px; margin-top: 2px; accent-color: var(--accent); }
  .clients { display: flex; flex-wrap: wrap; gap: 6px; }
  .chip { border: 1px solid var(--line); background: var(--pop); color: var(--ink); border-radius: 999px; padding: 4px 12px; font-size: 13px; cursor: pointer; }
  .chip.on { border-color: var(--accent); background: var(--accent-soft); }
  .cfg { display: flex; gap: 8px; align-items: flex-start; }
  pre { flex: 1; min-width: 0; margin: 0; overflow: auto; max-height: 180px; font: 12.5px/1.45 ui-monospace, Menlo, monospace; background: var(--hover); padding: 10px; border-radius: 8px; white-space: pre-wrap; word-break: break-all; }
  .tag { font-size: 11.5px; padding: 1px 6px; border-radius: 6px; background: var(--hover); color: var(--ink-2); font-weight: 600; }
  .err { color: var(--danger); }
</style>
