<script lang="ts">
  import { pdfImport } from './pdfimport.svelte.ts';

  let password = $state('');
  const send = (e: Event) => { e.preventDefault(); pdfImport.ask?.answer(password); password = ''; };
  const pct = $derived(pdfImport.job?.total ? Math.round((pdfImport.job.done / pdfImport.job.total) * 100) : 4);
</script>

{#if pdfImport.job}
  <div class="pi-card" role="status" data-testid="pdf-progress">
    <b>Opening “{pdfImport.job.name}”</b>
    <span>{pdfImport.job.note}</span>
    <div class="bar"><i style="width:{pct}%"></i></div>
    {#if pdfImport.ask}
      <form onsubmit={send}>
        <label>{pdfImport.ask.wrong ? 'That password is wrong. Try again:' : 'This PDF needs a password:'}
          <!-- svelte-ignore a11y_autofocus -->
          <input type="password" bind:value={password} autofocus data-testid="pdf-password" autocomplete="off" />
        </label>
        <button class="btn primary" type="submit" data-testid="pdf-password-ok">Open</button>
      </form>
    {/if}
    <button class="btn ghost" onclick={() => pdfImport.cancel()} data-testid="pdf-cancel">Cancel</button>
  </div>
{/if}

{#if pdfImport.report}
  {@const r = pdfImport.report}
  <div class="pi-card" role="dialog" aria-label="PDF import notes" data-testid="pdf-report">
    <b>Opened “{r.title}”</b>
    <ul>{#each r.report.notes as n}<li>{n}</li>{/each}</ul>
    <button class="btn primary" onclick={() => (pdfImport.report = null)} data-testid="pdf-report-ok">Got it</button>
  </div>
{/if}

<style>
  .pi-card { position: fixed; right: 20px; bottom: 20px; z-index: 900; width: 340px; max-height: 60vh; overflow: auto; display: flex; flex-direction: column; gap: 8px; padding: 16px; background: #fff; color: #1a1c22; border-radius: 12px; box-shadow: 0 8px 32px rgb(0 0 0 / 0.22); font-size: 13px; }
  .bar { height: 6px; border-radius: 3px; background: #e6e8ee; overflow: hidden; }
  .bar i { display: block; height: 100%; background: #7d2ae8; transition: width 0.2s; }
  ul { margin: 0; padding-left: 18px; }
  li { margin: 4px 0; }
  form, label { display: flex; flex-direction: column; gap: 6px; }
  input { padding: 6px 8px; border: 1px solid #c8ccd6; border-radius: 6px; font: inherit; }
</style>
