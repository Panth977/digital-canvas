<script lang="ts">
  import { toast } from './toast.svelte.ts';
  import Icon from './Icon.svelte';

  let okBtn = $state<HTMLButtonElement>();
  $effect(() => { if (toast.confirm) okBtn?.focus(); });

  function onKey(e: KeyboardEvent): void {
    if (!toast.confirm) return;
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); toast.confirm.resolve(false); }
  }
</script>

<svelte:window onkeydowncapture={onKey} />

<div class="toasts" aria-live="polite">
  {#each toast.list as t (t.id)}
    <div class="toast" role="status" data-testid="toast">
      <span>{t.text}</span>
      {#if t.action}
        <button class="act" data-testid="toast-action" onclick={() => { t.action!.run(); toast.close(t.id); }}>{t.action.label}</button>
      {/if}
      <button class="x" aria-label="Dismiss" onclick={() => toast.close(t.id)}><Icon name="close" size={16} /></button>
    </div>
  {/each}
</div>

{#if toast.confirm}
  {@const c = toast.confirm}
  <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
  <div class="scrim" onclick={() => c.resolve(false)}>
    <div class="dialog" role="alertdialog" aria-modal="true" aria-labelledby="confirm-title" data-testid="confirm" onclick={(e) => e.stopPropagation()}>
      <h3 id="confirm-title">{c.title}</h3>
      {#if c.body}<p>{c.body}</p>{/if}
      <div class="btns">
        <button class="btn" data-testid="confirm-cancel" onclick={() => c.resolve(false)}>{c.cancel}</button>
        <button class="btn primary" class:danger={c.danger} bind:this={okBtn} data-testid="confirm-ok" onclick={() => c.resolve(true)}>{c.ok}</button>
      </div>
    </div>
  </div>
{/if}

<style>
  .toasts { position: fixed; left: 24px; bottom: 24px; z-index: 1000; display: flex; flex-direction: column; gap: 8px; pointer-events: none; }
  .toast { pointer-events: auto; display: flex; align-items: center; gap: 12px; min-height: 48px; max-width: 420px; padding: 0 8px 0 16px; border-radius: 8px;
    background: #252627; color: #fff; box-shadow: 0 4px 16px rgba(0,0,0,.3); font-size: 14px; animation: rise .18s ease-out; }
  .toast span { flex: 1; }
  .act { border: 0; background: none; color: #fff; font-weight: 700; text-decoration: underline; text-underline-offset: 3px; padding: 6px 8px; border-radius: 6px; }
  .act:hover { background: rgba(255,255,255,.12); }
  .x { width: 32px; height: 32px; display: grid; place-items: center; border: 0; background: none; color: rgba(255,255,255,.7); border-radius: 6px; }
  .x:hover { background: rgba(255,255,255,.12); color: #fff; }
  @keyframes rise { from { transform: translateY(8px); opacity: 0; } }
  .scrim { position: fixed; inset: 0; z-index: 1001; background: rgba(0,0,0,.45); display: grid; place-items: center; }
  .dialog { width: min(420px, calc(100% - 32px)); background: var(--pop); color: var(--ink); border-radius: 12px; padding: 24px; box-shadow: var(--shadow); }
  h3 { margin: 0 0 8px; font-size: 18px; }
  p { margin: 0 0 4px; color: var(--ink-2); font-size: 14px; line-height: 1.5; }
  .btns { display: flex; justify-content: flex-end; gap: 8px; margin-top: 20px; }
  .btn.danger { background: var(--danger); border-color: var(--danger); color: #fff; }
</style>
