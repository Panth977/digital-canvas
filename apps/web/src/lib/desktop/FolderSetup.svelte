<script lang="ts">
  import Icon from '../Icon.svelte';
  import { desktop } from './desktop.svelte.ts';

  let busy = $state(false);
  let error = $state('');

  async function run(op: 'chooseFolder' | 'useDefaultFolder'): Promise<void> {
    busy = true;
    error = '';
    try { await desktop.call(op); } catch (e) { error = e instanceof Error ? e.message : String(e); } finally { busy = false; }
  }
</script>

<div class="setup" data-testid="folder-setup">
  <img src="/favicon.svg" alt="" width="56" height="56" />
  <h1>Where should your designs live?</h1>
  <p>Pick a folder. Designs and uploads stay there as plain files, on this computer, with no account. You can change it later in Settings.</p>
  <button class="btn primary big" disabled={busy} onclick={() => run('chooseFolder')} data-testid="choose-folder"><Icon name="folder" size={18} /> Choose a folder…</button>
  <button class="btn ghost" disabled={busy} onclick={() => run('useDefaultFolder')} data-testid="default-folder">Use {desktop.state?.defaultFolder}</button>
  {#if error}<p class="err" role="alert">{error}</p>{/if}
</div>

<style>
  .setup { height: 100%; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 12px; padding: 24px; text-align: center; }
  h1 { margin: 8px 0 0; font-size: 26px; }
  p { margin: 0 0 8px; max-width: 460px; line-height: 1.5; color: var(--ink-2); }
  .big { padding: 10px 18px; font-size: 15px; }
  .err { color: var(--danger); }
</style>
