<script lang="ts">
  import Icon from '../lib/Icon.svelte';

  /** Canva's Help ▸ Keyboard shortcuts (also opened with "?"). */
  let { onclose }: { onclose: () => void } = $props();

  const GROUPS: { title: string; keys: [string, string][] }[] = [
    { title: 'Basics', keys: [['Undo', '⌘Z'], ['Redo', '⇧⌘Z'], ['Save', '⌘S'], ['Copy', '⌘C'], ['Paste', '⌘V'], ['Duplicate', '⌘D'], ['Delete', '⌫'], ['Select all', '⌘A'], ['Deselect', 'Esc']] },
    { title: 'Text', keys: [['Bold', '⌘B'], ['Italic', '⌘I'], ['Underline', '⌘U'], ['Add a text box', 'T'], ['Edit selected text', 'Enter']] },
    { title: 'Elements', keys: [['Rectangle', 'R'], ['Circle', 'C'], ['Line', 'L'], ['Group', '⌘G'], ['Ungroup', '⇧⌘G'], ['Forward / to front', '⌘] / ⌥⌘]'], ['Backward / to back', '⌘[ / ⌥⌘['], ['Nudge', 'Arrows (⇧ for 10 px)'], ['Next element', 'Tab']] },
    { title: 'View', keys: [['Zoom in / out', '⌘+ / ⌘−'], ['Fit to screen', '⌘0'], ['Rulers and guides', '⇧R'], ['New page', '⌘Enter'], ['Keyboard shortcuts', '?']] },
    { title: 'Tabs', keys: [['New design', '⌘T'], ['Close tab', '⌘W'], ['Next / previous tab', '⌃Tab / ⌃⇧Tab'], ['Go to tab 1–8 / last', '⌘1–8 / ⌘9']] },
  ];
</script>

<svelte:window onkeydowncapture={(e) => { if (e.key === 'Escape') { e.stopPropagation(); onclose(); } }} />

<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
<div class="scrim" onclick={onclose}>
  <div class="dlg" role="dialog" tabindex="-1" aria-modal="true" aria-label="Keyboard shortcuts" data-testid="shortcuts" onclick={(e) => e.stopPropagation()}>
    <header><h3>Keyboard shortcuts</h3><button class="btn ghost icon" aria-label="Close" onclick={onclose}><Icon name="close" size={18} /></button></header>
    <div class="cols scroll-y">
      {#each GROUPS as g (g.title)}
        <section>
          <h4>{g.title}</h4>
          {#each g.keys as [what, keys] (what)}<div class="row"><span>{what}</span><kbd>{keys}</kbd></div>{/each}
        </section>
      {/each}
    </div>
  </div>
</div>

<style>
  .scrim { position: fixed; inset: 0; z-index: 900; background: rgba(0,0,0,.5); display: grid; place-items: center; }
  .dlg { width: min(720px, calc(100% - 32px)); max-height: calc(100% - 48px); display: flex; flex-direction: column; background: var(--pop); color: var(--ink); border-radius: 12px; padding: 16px 20px 20px; box-shadow: var(--shadow); }
  header { display: flex; align-items: center; justify-content: space-between; }
  h3 { margin: 0; font-size: 18px; }
  .cols { display: grid; grid-template-columns: 1fr 1fr; gap: 8px 28px; }
  h4 { margin: 14px 0 6px; font-size: 13px; color: var(--muted); }
  .row { display: flex; justify-content: space-between; gap: 12px; padding: 5px 0; font-size: 14px; border-bottom: 1px solid var(--line); }
  kbd { font: inherit; font-size: 13px; color: var(--ink-2); white-space: nowrap; }
</style>
