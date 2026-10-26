<script lang="ts">
  let { label, value, onchange, onend, testid }: {
    label: string;
    value: string;
    /** Fires while dragging in the picker. */
    onchange: (hex: string) => void;
    /** Fires when the user is done (picker closed, hex entered). */
    onend?: () => void;
    testid?: string;
  } = $props();

  const hex6 = $derived(value.length >= 7 ? value.slice(0, 7) : value);
  let draft = $state('');
  $effect(() => { draft = hex6; });

  function commitDraft(): void {
    const v = draft.trim().startsWith('#') ? draft.trim() : `#${draft.trim()}`;
    if (/^#([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(v)) {
      onchange(v.toLowerCase());
      onend?.();
    } else draft = hex6;
  }
</script>

<label class="color">
  <span class="lab">{label}</span>
  <span class="row">
    <span class="swatch" style="background:{value}">
      <input type="color" value={hex6} data-testid={testid}
        oninput={(e) => onchange((e.currentTarget as HTMLInputElement).value)}
        onchange={() => onend?.()} aria-label={label} />
    </span>
    <input class="input hex" bind:value={draft} onblur={commitDraft} onkeydown={(e) => e.key === 'Enter' && commitDraft()} aria-label="{label} hex" />
  </span>
</label>

<style>
  .color { display: flex; flex-direction: column; gap: 4px; }
  .lab { font-size: 12px; color: var(--muted); font-weight: 600; }
  .row { display: flex; gap: 6px; align-items: center; }
  .swatch { position: relative; width: 32px; height: 32px; flex-shrink: 0; border-radius: 8px; border: 1px solid var(--line); overflow: hidden;
    background-image: linear-gradient(45deg, #ddd 25%, transparent 25%, transparent 75%, #ddd 75%), linear-gradient(45deg, #ddd 25%, transparent 25%, transparent 75%, #ddd 75%); }
  .swatch input { position: absolute; inset: -6px; width: calc(100% + 12px); height: calc(100% + 12px); opacity: 0; cursor: pointer; }
  .hex { font-family: ui-monospace, Menlo, monospace; text-transform: lowercase; }
</style>
