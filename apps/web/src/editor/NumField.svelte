<script lang="ts">
  let { label, value, onchange, onend, min, max, step = 1, suffix = '', testid }: {
    label: string;
    value: number;
    onchange: (v: number) => void;
    onend?: () => void;
    min?: number;
    max?: number;
    step?: number;
    suffix?: string;
    testid?: string;
  } = $props();

  const shown = $derived(Math.round(value * 100) / 100);

  function set(raw: string): void {
    let v = Number(raw);
    if (!Number.isFinite(v)) return;
    if (min !== undefined) v = Math.max(min, v);
    if (max !== undefined) v = Math.min(max, v);
    onchange(v);
  }
</script>

<label class="num">
  <span>{label}</span>
  <span class="wrap">
    <input class="input" type="number" value={shown} {min} {max} {step} data-testid={testid}
      oninput={(e) => set((e.currentTarget as HTMLInputElement).value)}
      onchange={() => onend?.()} onblur={() => onend?.()} />
    {#if suffix}<em>{suffix}</em>{/if}
  </span>
</label>

<style>
  .num { display: flex; flex-direction: column; gap: 4px; min-width: 0; }
  .num > span:first-child { font-size: 12px; color: var(--muted); font-weight: 600; }
  .wrap { position: relative; }
  em { position: absolute; right: 8px; top: 50%; transform: translateY(-50%); font-style: normal; color: var(--muted); font-size: 12px; pointer-events: none; }
  input::-webkit-inner-spin-button { opacity: .4; }
</style>
