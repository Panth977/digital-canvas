<script lang="ts">
  /**
   * Subtitles for a video: type or paste a script, it becomes timed lines that
   * show as caption text; pick a voice and turn the lines into speech with a
   * model that runs on this device. Lines, captions and clips stay in step
   * (scene/subtitles.ts); the work is in lib/tts/subtitles.svelte.ts.
   */
  import { CAPTION_STYLES, lineVoice, speechKey, type SubtitleLine } from '@digital-canvas/scene';
  import type { EditorState } from '../../lib/editor.svelte.ts';
  import { formatTime } from '../../lib/media.ts';
  import { mobile } from '../../lib/mobile.svelte.ts';
  import { download, pickFiles } from '../../lib/files.ts';
  import { toast } from '../../lib/toast.svelte.ts';
  import { LANGS, VOICES, voiceById, type Lang } from '../../lib/tts/voices.ts';
  import Icon from '../../lib/Icon.svelte';
  import './panels.css';

  let { ed }: { ed: EditorState } = $props();

  const s = $derived(ed.subs);
  const track = $derived(s.track);
  const stale = $derived(new Set(s.stale.map((l) => l.id)));
  const job = $derived(s.job);
  const speech = $derived(track.speech);
  const lang = $derived<Lang>(voiceById(speech.voice)?.lang ?? 'en-us');
  const voices = $derived(VOICES.filter((v) => v.lang === lang));
  /** Clip of a line (when it has one). */
  const clipOf = (id: string) => ed.doc.audio?.find((a) => a.speech?.line === id);

  let script = $state('');
  let open = $state<string | null>(null);
  let gpu = $state(false);
  $effect(() => {
    if (mobile.on) { if (!s.smallModel) s.setSmallModel(true); return; }
    void (navigator as unknown as { gpu?: { requestAdapter(): Promise<unknown> } }).gpu?.requestAdapter().then((a) => (gpu = !!a)).catch(() => {});
  });
  const mb = $derived(s.downloadMb(gpu));

  // ---- phones: ask before a big download ----
  let confirmFor = $state<{ only?: string } | null>(null);
  async function modelOnDevice(): Promise<boolean> {
    const cache = await caches.open('dc-models').catch(() => null);
    return !!(await cache?.keys())?.some((k) => k.url.includes('Kokoro'));
  }
  async function generate(only?: string): Promise<void> {
    if (mobile.on && !confirmFor && !(await modelOnDevice())) { confirmFor = { only }; return; }
    confirmFor = null;
    await s.generate(only);
  }

  function addScript(): void {
    if (s.addScript(script)) script = '';
  }

  async function importFile(): Promise<void> {
    const [f] = await pickFiles('.srt,.vtt,text/vtt,application/x-subrip');
    if (!f) return;
    const n = s.importCues(await f.text());
    toast.show(n ? `${n} subtitle${n === 1 ? '' : 's'} imported` : 'No subtitles found in that file');
  }
  function exportFile(kind: 'srt' | 'vtt'): void {
    void download(new TextEncoder().encode(s.exportCues(kind)), `${ed.doc.title || 'subtitles'}.${kind}`, kind === 'srt' ? 'application/x-subrip' : 'text/vtt');
  }

  function setLang(l: Lang): void {
    const v = VOICES.find((x) => x.lang === l);
    if (v) { s.setSpeech({ voice: v.id }); ed.seal(); }
  }
  const time = (e: Event): number => Math.max(0, Number((e.currentTarget as HTMLInputElement).value) || 0);
  function setTimes(l: SubtitleLine, patch: { start?: number; end?: number }): void {
    const start = patch.start ?? l.start, end = patch.end ?? l.end;
    if (end - start >= 0.2) { s.updateLine(l.id, patch); ed.seal(); }
  }
  function seek(l: SubtitleLine): void {
    void ed.player.seek(l.start);
  }
  /** Is the sound of this line up to date, and what does it say about itself? */
  function lineState(l: SubtitleLine): string {
    if (!l.text.trim()) return '';
    const c = clipOf(l.id);
    if (!c) return 'No speech yet';
    if (c.speech!.key !== speechKey(l, speech)) return 'Changed, generate again';
    return `${c.duration.toFixed(1)} s${c.speech!.fitted ? `, ${c.speech!.fitted.toFixed(2)}× faster` : ''}`;
  }
</script>

<div class="dp st" data-testid="subtitles-panel">
  <div class="dp-head"><h3>Script</h3>
    <span class="tools">
      <button class="dp-link" data-testid="sub-import" onclick={importFile}>Import</button>
      {#if track.lines.length}
        <button class="dp-link" data-testid="sub-export-srt" onclick={() => exportFile('srt')}>.srt</button>
        <button class="dp-link" data-testid="sub-export-vtt" onclick={() => exportFile('vtt')}>.vtt</button>
      {/if}
    </span>
  </div>
  <textarea class="field" rows="3" placeholder="Type or paste your script. Each sentence becomes a subtitle." bind:value={script} data-testid="sub-script" aria-label="Script"></textarea>
  <div class="row">
    <button class="btn" disabled={!script.trim()} data-testid="sub-add-script" onclick={addScript}>Add to video</button>
    <button class="btn ghost" data-testid="sub-add-line" onclick={() => s.addLine()}>Add a line</button>
  </div>

  {#if track.lines.length}
    <div class="dp-head"><h3>Lines</h3><button class="dp-link" data-testid="sub-clear" onclick={() => s.clear()}>Clear</button></div>
    <ol class="lines" data-testid="sub-lines">
      {#each track.lines as l, i (l.id)}
        <li class="line" class:stale={stale.has(l.id)} data-testid="sub-line" data-id={l.id}>
          <div class="times">
            <button class="n" title="Go to this line" onclick={() => seek(l)}>{i + 1}</button>
            <input type="number" step="0.1" min="0" value={l.start} aria-label="Start, seconds" data-testid="sub-start" onchange={(e) => setTimes(l, { start: time(e) })} />
            <span>–</span>
            <input type="number" step="0.1" min="0" value={l.end} aria-label="End, seconds" data-testid="sub-end" onchange={(e) => setTimes(l, { end: time(e) })} />
            <span class="grow"></span>
            <button class="ic" title="Voice for this line" aria-label="Voice for this line" aria-expanded={open === l.id} data-testid="sub-more" onclick={() => (open = open === l.id ? null : l.id)}><Icon name="more" size={15} /></button>
            <button class="ic" title="Speak this line" aria-label="Speak this line" disabled={!!job || !l.text.trim()} data-testid="sub-speak" onclick={() => generate(l.id)}><Icon name="play" size={14} /></button>
            <button class="ic" title="Delete line" aria-label="Delete line" data-testid="sub-del" onclick={() => s.removeLine(l.id)}><Icon name="trash" size={15} /></button>
          </div>
          <textarea class="field txt" rows="2" value={l.text} aria-label="Line {i + 1}" data-testid="sub-text" lang={/[ऀ-ॿ]/.test(l.text) ? 'hi' : undefined}
            oninput={(e) => s.updateLine(l.id, { text: (e.currentTarget as HTMLTextAreaElement).value }, `sub-text:${l.id}`)} onblur={() => ed.seal()}></textarea>
          <span class="state" data-testid="sub-state">{lineState(l)}{#if l.text.trim() && clipOf(l.id)} · {formatTime(l.start, true)}{/if}</span>
          {#if open === l.id}
            <div class="over">
              <label>Voice
                <select class="field" value={l.voice ?? ''} data-testid="sub-line-voice" onchange={(e) => { s.updateLine(l.id, { voice: (e.currentTarget as HTMLSelectElement).value || undefined }); ed.seal(); }}>
                  <option value="">Default ({voiceById(lineVoice({ text: l.text }, speech))?.label})</option>
                  {#each VOICES as v (v.id)}<option value={v.id}>{v.label} · {LANGS.find((x) => x.id === v.lang)?.label}</option>{/each}
                </select>
              </label>
              <label>Speed
                <input class="field" type="number" min="0.5" max="2" step="0.05" value={l.speed ?? ''} placeholder={String(speech.speed)} data-testid="sub-line-speed"
                  onchange={(e) => { const v = Number((e.currentTarget as HTMLInputElement).value); s.updateLine(l.id, { speed: v ? Math.max(0.5, Math.min(2, v)) : undefined }); ed.seal(); }} />
              </label>
            </div>
          {/if}
        </li>
      {/each}
    </ol>

    <div class="dp-head"><h3>On the video</h3>
      <label class="tick"><input type="checkbox" checked={track.show} data-testid="sub-show" onchange={(e) => s.setShow((e.currentTarget as HTMLInputElement).checked)} /> Show subtitles</label>
    </div>
    {#if track.show}
      <div class="styles" role="radiogroup" aria-label="Subtitle style">
        {#each CAPTION_STYLES as c (c.id)}
          <button class="sty" class:on={track.style === c.id} role="radio" aria-checked={track.style === c.id} data-testid="sub-style-{c.id}" onclick={() => s.setStyle(c.id)}>{c.label}</button>
        {/each}
      </div>
      <p class="dp-hint">They are ordinary text: click one on the video to edit, move or restyle it.</p>
    {/if}

    <div class="dp-head"><h3>Voice</h3></div>
    <div class="grid">
      <label>Language
        <select class="field" value={lang} data-testid="sub-lang" onchange={(e) => setLang((e.currentTarget as HTMLSelectElement).value as Lang)}>
          {#each LANGS as x (x.id)}<option value={x.id}>{x.label}</option>{/each}
        </select>
      </label>
      <label>Voice
        <span class="pair">
          <select class="field" value={speech.voice} data-testid="sub-voice" onchange={(e) => { s.setSpeech({ voice: (e.currentTarget as HTMLSelectElement).value }); ed.seal(); }}>
            {#each voices as v (v.id)}<option value={v.id}>{v.label} · {v.gender} · {v.grade}</option>{/each}
          </select>
          <button class="ic bd" title="Hear this voice" aria-label="Hear this voice" disabled={!!s.previewing || !!job} data-testid="sub-preview" onclick={() => s.preview(speech.voice)}><Icon name="play" size={14} /></button>
        </span>
      </label>
      <label>Speed <b>{speech.speed.toFixed(2)}×</b>
        <input type="range" min="0.5" max="2" step="0.05" value={speech.speed} data-testid="sub-speed" oninput={(e) => s.setSpeech({ speed: Number((e.currentTarget as HTMLInputElement).value) }, 'sub-speed')} onchange={() => ed.seal()} />
      </label>
      <label>Volume <b>{Math.round(speech.volume * 100)}%</b>
        <input type="range" min="0" max="1" step="0.05" value={speech.volume} data-testid="sub-volume" oninput={(e) => s.setSpeech({ volume: Number((e.currentTarget as HTMLInputElement).value) }, 'sub-volume')} onchange={() => ed.seal()} />
      </label>
      <label>When speech is longer than its line
        <select class="field" value={speech.fit} data-testid="sub-fit" onchange={(e) => { s.setSpeech({ fit: (e.currentTarget as HTMLSelectElement).value as 'stretch' }); ed.seal(); }}>
          <option value="stretch">Make the line and scene longer</option>
          <option value="speed">Speed up the speech</option>
        </select>
      </label>
      <label class="tick"><input type="checkbox" checked={speech.duck !== undefined} data-testid="sub-duck" onchange={(e) => { s.setSpeech({ duck: (e.currentTarget as HTMLInputElement).checked ? 0.25 : undefined }); ed.seal(); }} /> Lower the music during speech</label>
    </div>

    {#if confirmFor}
      <div class="warn" role="alertdialog" aria-label="Download the speech model" data-testid="sub-phone-warn">
        <p>Speech runs on this phone. The first time, it downloads about {mb} MB and needs a lot of memory; use Wi-Fi, and keep the app open.</p>
        <div class="row">
          <button class="btn" data-testid="sub-phone-go" onclick={() => generate(confirmFor?.only)}>Download and speak</button>
          <button class="btn ghost" onclick={() => (confirmFor = null)}>Not now</button>
        </div>
      </div>
    {/if}

    {#if job}
      <div class="job" role="status" data-testid="sub-progress">
        <span>{#if job.total > 1}Line {job.done + 1} of {job.total}: {/if}{job.msg}</span>
        <div class="bar"><i style="width:{((job.done + (job.fraction ?? 0)) / job.total) * 100}%"></i></div>
        <button class="btn ghost" data-testid="sub-cancel" onclick={() => s.cancel()}>Cancel</button>
      </div>
    {:else}
      <button class="btn big" disabled={!stale.size} data-testid="sub-generate" onclick={() => generate()}>
        {stale.size ? `Generate speech (${stale.size} ${stale.size === 1 ? 'line' : 'lines'})` : 'Speech is up to date'}
      </button>
    {/if}
    {#if s.error}<p class="dp-err" role="alert" data-testid="sub-error">{s.error}</p>{/if}
    <p class="dp-hint" data-testid="sub-note">Made on this device by Kokoro-82M; nothing is sent anywhere. The first time downloads about {mb} MB, then it works offline.</p>
    {#if gpu && !mobile.on}
      <label class="tick"><input type="checkbox" checked={s.smallModel} data-testid="sub-small" onchange={(e) => s.setSmallModel((e.currentTarget as HTMLInputElement).checked)} /> Use the smaller model (86 MB, slower)</label>
    {/if}
  {/if}
</div>

<style>
  .st { gap: 6px; padding-bottom: 12px; }
  .tools { display: flex; gap: 2px; }
  .field { width: 100%; box-sizing: border-box; border: 1px solid var(--line); border-radius: 8px; background: var(--field); color: var(--ink); padding: 6px 8px; font: inherit; font-size: 13px; resize: vertical; }
  select.field { height: 32px; padding: 0 6px; }
  .field:focus { outline: 2px solid var(--accent-soft); border-color: var(--accent); }
  .row { display: flex; gap: 8px; margin-top: 6px; }
  .btn { flex: 1; height: 34px; border: 0; border-radius: 8px; background: var(--accent); color: #fff; font-weight: 600; font-size: 13px; padding: 0 10px; }
  .btn.ghost { background: var(--chip); color: var(--ink); flex: 0 0 auto; }
  .btn.big { height: 40px; margin-top: 12px; width: 100%; flex: none; }
  .btn:disabled { opacity: .5; }
  .lines { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 8px; }
  .line { border: 1px solid var(--line); border-radius: 10px; padding: 6px; display: flex; flex-direction: column; gap: 4px; }
  .line.stale { border-left: 3px solid var(--accent); }
  .times { display: flex; align-items: center; gap: 4px; font-size: 12px; color: var(--muted); }
  .times input { width: 54px; height: 26px; box-sizing: border-box; border: 1px solid var(--line); border-radius: 6px; background: var(--field); color: var(--ink); padding: 0 4px; font-size: 12px; font-variant-numeric: tabular-nums; }
  .n { width: 22px; height: 22px; border: 0; border-radius: 6px; background: var(--chip); color: var(--ink-2); font-size: 11px; font-weight: 600; padding: 0; }
  .grow { flex: 1; }
  .ic { width: 28px; height: 28px; display: grid; place-items: center; border: 0; border-radius: 6px; background: none; color: var(--ink-2); padding: 0; flex-shrink: 0; }
  .ic:hover:not(:disabled) { background: var(--hover); color: var(--ink); }
  .ic:disabled { opacity: .4; }
  .ic.bd { border: 1px solid var(--line); width: 32px; height: 32px; }
  .state { font-size: 11px; color: var(--muted); min-height: 14px; }
  .over { display: grid; grid-template-columns: 1fr 72px; gap: 6px; font-size: 12px; color: var(--ink-2); }
  .styles { display: grid; grid-template-columns: repeat(3, 1fr); gap: 6px; }
  .sty { height: 36px; border: 1px solid var(--line); border-radius: 8px; background: #2b2f36; color: #fff; font-weight: 700; font-size: 12px; }
  .sty.on { outline: 2px solid var(--accent); outline-offset: 1px; }
  .tick { display: flex; align-items: center; gap: 6px; font-size: 13px; color: var(--ink-2); }
  .grid { display: flex; flex-direction: column; gap: 10px; }
  .grid > label:not(.tick) { display: flex; flex-direction: column; gap: 4px; font-size: 12px; color: var(--ink-2); }
  .grid b { font-weight: 600; color: var(--ink); }
  .grid input[type=range] { accent-color: var(--accent); width: 100%; }
  .pair { display: flex; gap: 6px; }
  .job { margin-top: 12px; display: flex; flex-direction: column; gap: 6px; font-size: 13px; color: var(--ink-2); }
  .bar { height: 6px; border-radius: 3px; background: var(--chip); overflow: hidden; }
  .bar i { display: block; height: 100%; background: var(--accent); transition: width .2s; }
  .warn { margin-top: 12px; padding: 10px; border: 1px solid var(--line); border-radius: 10px; background: var(--chip); font-size: 13px; }
  .warn p { margin: 0 0 4px; }
  textarea.txt { min-height: 44px; }
</style>
