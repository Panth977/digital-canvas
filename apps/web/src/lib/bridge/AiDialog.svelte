<script lang="ts">
  import { onMount } from 'svelte';
  import { ONLINE_MS } from '@digital-canvas/mcp/bridge';
  import Icon from '../Icon.svelte';
  import { account } from '../account.svelte.ts';
  import { toast } from '../toast.svelte.ts';
  import { isNative, nativePlatform } from '../native/platform.ts';
  import { bridgeUi } from './bridgeUi.svelte.ts';

  /**
   * File › Settings › AI and devices (also Help › Connect your AI): how to
   * connect Claude, where the AI's work runs (your device, or our cloud for
   * allowlisted accounts), "Let AI use this device", and your devices.
   */
  let { onclose }: { onclose: () => void } = $props();

  const URL_MCP = 'https://digital-canvas-p977.web.app/mcp';
  let now = $state(Date.now());
  let saving = $state(false);
  const ios = isNative() && nativePlatform() === 'ios';
  const android = isNative() && nativePlatform() === 'android';

  onMount(() => {
    let stop: (() => void) | null = null;
    let gone = false;
    if (account.user) {
      void bridgeUi.loadSettings();
      void bridgeUi.watch().then((s) => (gone ? s() : (stop = s)));
    }
    const t = setInterval(() => (now = Date.now()), 5000);
    return () => { gone = true; stop?.(); clearInterval(t); };
  });

  const online = (d: { enabled: boolean; lastSeen: number; id: string }) =>
    d.enabled && (now - d.lastSeen < ONLINE_MS || (d.id === bridgeUi.id && bridgeUi.status === 'on'));
  const ago = (ms: number) => {
    if (!ms) return 'never';
    const s = Math.max(0, Math.round((now - ms) / 1000));
    return s < 90 ? 'just now' : s < 5400 ? `${Math.round(s / 60)} min ago` : s < 172800 ? `${Math.round(s / 3600)} h ago` : `${Math.round(s / 86400)} days ago`;
  };
  const list = $derived([...bridgeUi.devices].sort((a, b) => Number(b.id === bridgeUi.id) - Number(a.id === bridgeUi.id) || b.lastSeen - a.lastSeen));
  const s = $derived(bridgeUi.settings);
  const onlineCount = $derived(list.filter(online).length);

  async function toggle(e: Event): Promise<void> {
    const on = (e.currentTarget as HTMLInputElement).checked;
    await bridgeUi.setEnabled(on);
    if (on && bridgeUi.status === 'error') toast.show(`Couldn't turn it on: ${bridgeUi.error}`);
  }

  async function mode(m: 'device' | 'cloud'): Promise<void> {
    saving = true;
    try { await bridgeUi.setProcessing(m); } catch (err) { toast.show(err instanceof Error ? err.message : String(err)); } finally { saving = false; }
  }

  async function choose(id: string | null): Promise<void> {
    try { await bridgeUi.chooseDevice(id); } catch (err) { toast.show(err instanceof Error ? err.message : String(err)); }
  }

  async function copy(): Promise<void> {
    await navigator.clipboard?.writeText(URL_MCP).catch(() => {});
    toast.show('Connector URL copied');
  }
</script>

<svelte:window onkeydowncapture={(e) => { if (e.key === 'Escape') { e.stopPropagation(); onclose(); } }} />

<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
<div class="scrim" onclick={onclose}>
  <div class="dlg" role="dialog" tabindex="-1" aria-modal="true" aria-label="AI and devices" data-testid="ai-dialog" onclick={(e) => e.stopPropagation()}>
    <header><h3><Icon name="ai" size={20} /> Connect your AI</h3><button class="btn ghost icon" aria-label="Close" onclick={onclose}><Icon name="close" size={18} /></button></header>
    <div class="body scroll-y">
      <section>
        <p>Let Claude (or any app that speaks MCP) make posters, posts and reels from your photos and clips. In Claude: <b>Settings › Connectors › Add custom connector</b>, then sign in with this Google account.</p>
        <div class="url"><code>{URL_MCP}</code><button class="btn" onclick={copy}><Icon name="copy" size={16} /> Copy</button></div>
        <p class="muted">More ways to connect (Claude Code, a local server): <a href="/connect-ai.html" target="_blank" rel="noreferrer">the full guide</a>.</p>
      </section>

      {#if !account.user}
        <section><p class="note" data-testid="ai-signin">Sign in with Google to connect your AI and to let it use this device.</p></section>
      {:else}
        <section data-testid="ai-mode">
          <h4>Where the AI's work runs</h4>
          {#if s?.cloudAllowed}
            <div class="seg" role="radiogroup" aria-label="Processing">
              <label class:on={s.requested === 'device'}><input type="radio" name="proc" checked={s.requested === 'device'} disabled={saving} onchange={() => mode('device')} data-testid="proc-device" /> <Icon name="laptop" size={16} /> On my devices</label>
              <label class:on={s.requested === 'cloud'}><input type="radio" name="proc" checked={s.requested === 'cloud'} disabled={saving} onchange={() => mode('cloud')} data-testid="proc-cloud" /> <Icon name="cloud" size={16} /> In the Digital Canvas cloud</label>
            </div>
          {/if}
          <p data-testid="ai-mode-text">
            {#if !s}Checking…
            {:else if s.mode === 'cloud'}<b>In the cloud.</b> Our server opens, renders and exports your designs while the AI works (nothing is kept there). You don't need a device open.
            {:else}<b>On your devices.</b> Designs are opened, rendered and exported by Digital Canvas on one of your devices (it needs to be open, with “Let AI use this device” on); our server only passes the AI's requests and answers along.{/if}
          </p>
        </section>

        <section>
          <h4>This device</h4>
          <label class="switch" data-testid="ai-this-device">
            <input type="checkbox" checked={bridgeUi.enabled} onchange={toggle} data-testid="ai-device-toggle" />
            <span><b>Let AI use this device</b><br /><span class="muted">{bridgeUi.status === 'on' ? (bridgeUi.busy ? `Working: ${bridgeUi.tool ?? 'a request'}` : 'Ready for requests') : bridgeUi.status === 'starting' ? 'Starting…' : bridgeUi.status === 'error' ? bridgeUi.error : 'Off'}</span></span>
          </label>
          <p class="muted small">
            {#if ios}On iPhone and iPad the AI can use this device only while Digital Canvas is open on screen (iOS pauses apps in the background).
            {:else if android}While this is on, Android keeps Digital Canvas running in the background (you'll see a notification).
            {:else}Keep this tab or the installed app open. Browsers slow down tabs in the background, so a visible window answers fastest.{/if}
          </p>
        </section>

        <section>
          <h4>Your devices {#if list.length}<span class="muted">· {onlineCount} online</span>{/if}</h4>
          {#if !list.length}
            <p class="muted">No devices yet. Turn on “Let AI use this device” here or in Digital Canvas on another computer or phone.</p>
          {:else}
            <ul class="devices" data-testid="ai-devices">
              {#each list as d (d.id)}
                {@const on = online(d)}
                {@const chosen = s?.activeDevice === d.id}
                <li data-testid="ai-device">
                  <Icon name={/phone|android|ios|iPhone/i.test(d.platform + d.name) ? 'phone' : 'laptop'} size={20} />
                  <span class="name"><b>{d.name}</b>{#if d.id === bridgeUi.id} <span class="tag">this device</span>{/if}{#if chosen} <span class="tag accent">chosen for AI</span>{/if}<br />
                    <span class="muted"><span class="dot" class:live={on}></span>{on ? 'Online' : d.enabled ? `Offline · seen ${ago(d.lastSeen)}` : `AI off · seen ${ago(d.lastSeen)}`}</span></span>
                  {#if chosen}<button class="btn ghost" onclick={() => choose(null)}>Any device</button>
                  {:else}<button class="btn" onclick={() => choose(d.id)} title="The AI uses this device from now on">Use for AI</button>{/if}
                  <button class="btn ghost icon" aria-label="Forget {d.name}" title="Forget this device" onclick={() => bridgeUi.forget(d.id)}><Icon name="trash" size={16} /></button>
                </li>
              {/each}
            </ul>
            <p class="muted small">When several devices are online and none is chosen, the AI asks you which one to use.</p>
          {/if}
        </section>
      {/if}
    </div>
  </div>
</div>

<style>
  .scrim { position: fixed; inset: 0; z-index: 900; background: rgba(0,0,0,.5); display: grid; place-items: center; }
  .dlg { width: min(620px, calc(100% - 24px)); max-height: calc(100% - 40px); display: flex; flex-direction: column; background: var(--pop); color: var(--ink); border-radius: 12px; padding: 16px 20px 18px; box-shadow: var(--shadow); }
  header { display: flex; align-items: center; justify-content: space-between; }
  h3 { margin: 0; font-size: 18px; display: flex; align-items: center; gap: 8px; }
  h4 { margin: 0 0 8px; font-size: 14px; }
  section { padding: 12px 0; border-bottom: 1px solid var(--line); }
  section:last-child { border-bottom: 0; }
  p { margin: 6px 0; line-height: 1.45; font-size: 14px; }
  .muted { color: var(--muted); }
  .small { font-size: 12.5px; }
  .note { background: var(--accent-soft); padding: 10px 12px; border-radius: 8px; }
  .url { display: flex; gap: 8px; align-items: center; }
  .url code { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; font: 13px ui-monospace, Menlo, monospace; background: var(--hover); padding: 8px 10px; border-radius: 8px; }
  .seg { display: flex; gap: 8px; flex-wrap: wrap; margin-bottom: 6px; }
  .seg label { display: flex; align-items: center; gap: 6px; padding: 8px 12px; border: 1px solid var(--line); border-radius: 8px; cursor: pointer; font-size: 14px; }
  .seg label.on { border-color: var(--accent); background: var(--accent-soft); }
  .seg input { accent-color: var(--accent); margin: 0; }
  .switch { display: flex; gap: 10px; align-items: flex-start; cursor: pointer; font-size: 14px; }
  .switch input { width: 18px; height: 18px; margin-top: 2px; accent-color: var(--accent); }
  .devices { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 6px; }
  .devices li { display: flex; align-items: center; gap: 10px; padding: 8px 10px; border: 1px solid var(--line); border-radius: 10px; font-size: 14px; }
  .devices .name { flex: 1; min-width: 0; }
  .tag { font-size: 11.5px; padding: 1px 6px; border-radius: 6px; background: var(--hover); color: var(--ink-2); font-weight: 600; }
  .tag.accent { background: var(--accent-soft); color: var(--accent); }
  .dot { display: inline-block; width: 8px; height: 8px; border-radius: 50%; background: #9aa0a6; margin-right: 6px; vertical-align: 1px; }
  .dot.live { background: #1fa855; }
</style>
