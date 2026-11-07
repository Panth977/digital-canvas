<script lang="ts">
  import Icon from '../Icon.svelte';
  import { desktop } from './desktop.svelte.ts';
  import { tabs } from '../tabs.svelte.ts';

  /**
   * "A new version is out": the user chooses Update now (download, swap,
   * restart) or Later. Nothing installs without that click.
   */
  let { compact = false }: { compact?: boolean } = $props();
  const u = $derived(desktop.state?.update ?? null);
  const pct = $derived(Math.round((u?.progress ?? 0) * 100));
  const mb = (n: number) => `${Math.round(n / 1048576)} MB`;
  let notes = $state(false);
  let err = $state('');

  async function now(): Promise<void> {
    err = '';
    try {
      await tabs.saveAll(); // the app quits to swap itself: nothing may be left unsaved
      await desktop.installUpdate();
    } catch (e) {
      err = e instanceof Error ? e.message.replace(/^Error invoking remote method 'dc': (Error: )?/, '') : String(e);
    }
  }
</script>

{#if u}
  <div class="upd" class:compact role="status" data-testid="update-banner" data-phase={u.phase}>
    <div class="row">
      <Icon name="download" size={18} />
      <div class="txt">
        {#if u.phase === 'downloading'}
          <b>Downloading {u.version}… {pct}%</b>
          <div class="bar"><i style="width:{pct}%"></i></div>
        {:else if u.phase === 'installing'}
          <b>Installing {u.version}…</b><span>The app restarts by itself.</span>
        {:else if u.phase === 'manual'}
          <b>The {u.version} installer is open.</b><span>Finish there, then start Digital Canvas again.</span>
        {:else}
          <b>Digital Canvas {u.version} is available</b>
          <span>You have {desktop.state?.version}{u.asset ? ` · ${mb(u.asset.size)} download` : ''}</span>
          {#if u.phase === 'error' || err}<span class="err" data-testid="update-error">{err || u.error}</span>{/if}
        {/if}
      </div>
    </div>
    {#if u.phase === 'available' || u.phase === 'error'}
      <div class="acts">
        {#if u.notes}<button class="btn ghost" onclick={() => (notes = !notes)}>{notes ? 'Hide' : "What's new"}</button>{/if}
        <button class="btn ghost" onclick={() => void desktop.later()} data-testid="update-later">Later</button>
        <button class="btn" onclick={() => void now()} data-testid="update-now">{u.phase === 'error' ? 'Try again' : 'Update now'}</button>
      </div>
      {#if notes && u.notes}<pre class="notes">{u.notes}</pre>{/if}
    {/if}
  </div>
{/if}

<style>
  .upd { position: fixed; right: 16px; bottom: 16px; z-index: 1000; width: 360px; background: var(--pop); color: var(--ink); border: 1px solid var(--line); border-radius: 14px; box-shadow: var(--shadow); padding: 12px 14px; font-size: 13px; }
  .upd.compact { position: static; width: auto; box-shadow: none; }
  .row { display: flex; gap: 10px; align-items: flex-start; color: var(--accent); }
  .txt { display: flex; flex-direction: column; gap: 2px; color: var(--ink); flex: 1; min-width: 0; }
  .txt span { color: var(--muted); }
  .txt .err { color: var(--danger); }
  .bar { height: 6px; border-radius: 3px; background: var(--chip); overflow: hidden; margin-top: 6px; }
  .bar i { display: block; height: 100%; background: var(--accent); transition: width .2s; }
  .acts { display: flex; justify-content: flex-end; gap: 6px; margin-top: 10px; }
  .btn { height: 32px; padding: 0 14px; border: 0; border-radius: 8px; background: var(--accent); color: #fff; font-weight: 600; font-size: 13px; }
  .btn.ghost { background: var(--chip); color: var(--ink); }
  .notes { max-height: 180px; overflow: auto; white-space: pre-wrap; font: inherit; font-size: 12px; color: var(--ink-2); background: var(--field); border-radius: 8px; padding: 8px; margin: 8px 0 0; }
</style>
