/**
 * The speech model, off the main thread: text → phonemes (our rules and
 * misaki's dictionaries, no eSpeak) → Kokoro-82M through onnxruntime-web, on the
 * GPU if it works, else on the CPU. Nothing leaves the device; the only network
 * is the one-time download of the pinned files.
 */
import { fetchCached, hasGpu, loadOrt, type Ort, type OrtSession, type Progress } from '../models.ts';
import type { Lexicon, Lexicons } from './english.ts';
import { chunk, phonemize, tokenize } from './phonemes.ts';
import { ENGINES, lexiconUrl, modelUrl, voiceById, voiceUrl, type Engine, type Lang } from './voices.ts';

const RATE = 24000;
/** Silence between the pieces of a long line. */
const GAP = Math.round(RATE * 0.15);

let ctx: { file: string; ep: string; session: OrtSession; ort: Ort } | null = null;

async function open(engine: Engine, progress: Progress): Promise<{ session: OrtSession; ort: Ort }> {
  const { file, ep, mb } = ENGINES[engine];
  if (ctx?.file === file) return ctx;
  if (ctx) { await ctx.session.release().catch(() => {}); ctx = null; }
  const ort = await loadOrt();
  const bytes = await fetchCached(modelUrl(file), 'the speech model', mb, progress);
  progress('Starting the speech model…');
  const session = await ort.InferenceSession.create(bytes, { executionProviders: [ep], graphOptimizationLevel: 'all' });
  ctx = { file, ep, session, ort };
  return ctx;
}

const lexicons = new Map<string, Promise<Lexicons>>();

function lexicon(lang: Lang, progress: Progress): Promise<Lexicons> {
  const key = lang === 'en-gb' ? 'gb' : 'us';
  let p = lexicons.get(key);
  if (!p) {
    p = (async () => {
      const dec = new TextDecoder();
      const get = async (n: string): Promise<Lexicon> => JSON.parse(dec.decode(await fetchCached(lexiconUrl(`${key}_${n}`), 'the dictionary', 0, progress))) as Lexicon;
      progress('Getting the pronunciation dictionary…');
      const [gold, silver] = await Promise.all([get('gold'), get('silver')]);
      return { gold, silver };
    })();
    p.catch(() => lexicons.delete(key));
    lexicons.set(key, p);
  }
  return p;
}

const styles = new Map<string, Float32Array>();

async function style(id: string, progress: Progress): Promise<Float32Array> {
  let s = styles.get(id);
  if (!s) {
    const b = await fetchCached(voiceUrl(id), 'the voice', 0, progress);
    s = new Float32Array(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer);
    styles.set(id, s);
  }
  return s;
}

const cancelled = new Set<number>();
/** Lets a queued cancel message in between two model runs. */
const breathe = (): Promise<void> => new Promise((r) => setTimeout(r));

export interface SpeakResult { pcm: Float32Array; rate: number; ep: string; phonemes: string; ms: number }

async function speak(id: number, text: string, voiceId: string, speed: number, engine: Engine, progress: Progress): Promise<SpeakResult> {
  const voice = voiceById(voiceId);
  if (!voice && !/^[a-z]{2}_/.test(voiceId)) throw new Error(`unknown voice ${voiceId}`);
  const lex = await lexicon(voice?.lang ?? 'en-us', progress);
  const voiceData = await style(voiceId, progress);
  const phonemes = phonemize(text, lex);
  if (!phonemes) throw new Error('nothing to say in this line');
  const pieces = chunk(phonemes);
  const engines: Engine[] = engine === 'gpu' && (await hasGpu()) ? ['gpu', 'small'] : ['small'];
  let last: unknown;
  for (const eng of engines) {
    try {
      const { session, ort } = await open(eng, progress);
      const t0 = performance.now();
      const out: Float32Array[] = [];
      for (const [i, piece] of pieces.entries()) {
        await breathe();
        if (cancelled.has(id)) throw new Error('cancelled');
        const ids = tokenize(piece);
        const at = Math.min(Math.max(ids.length - 2, 0), 509) * 256;
        const say = (rate: number) => session.run({
          input_ids: new ort.Tensor('int64', BigInt64Array.from(ids.map(BigInt)), [1, ids.length]),
          style: new ort.Tensor('float32', voiceData.slice(at, at + 256), [1, 256]),
          speed: new ort.Tensor('float32', new Float32Array([rate]), [1]),
        });
        const heard = (d: { data: Float32Array } | undefined): Float32Array | null => (d?.data.length && Number.isFinite(d.data[0]) ? d.data : null);
        // quantised models can overflow on one exact input: a hair's difference in speed gets past it
        const wav = heard((await say(speed))[session.outputNames[0]!]) ?? heard((await say(speed * 1.02))[session.outputNames[0]!]);
        if (!wav) throw new Error('the model gave no sound');
        out.push(new Float32Array(wav));
        if (pieces.length > 1) progress('Speaking…', (i + 1) / pieces.length);
      }
      const len = out.reduce((n, a) => n + a.length, 0) + GAP * (out.length - 1);
      const pcm = new Float32Array(len);
      let o = 0;
      for (const a of out) { pcm.set(a, o); o += a.length + GAP; }
      return { pcm, rate: RATE, ep: ENGINES[eng].ep, phonemes, ms: performance.now() - t0 };
    } catch (e) {
      if (e instanceof Error && e.message === 'cancelled') throw e;
      last = e;
      if (ctx) { await ctx.session.release().catch(() => {}); ctx = null; }
    }
  }
  throw last;
}

export type TtsRequest =
  | { id: number; op: 'speak'; text: string; voice: string; speed: number; engine: Engine }
  | { id: number; op: 'cancel' };

export type TtsReply =
  | { id: number; progress: { msg: string; fraction?: number } }
  | { id: number; result: SpeakResult }
  | { id: number; error: string };

self.onmessage = async (e: MessageEvent<TtsRequest>) => {
  const q = e.data;
  if (q.op === 'cancel') { cancelled.add(q.id); return; }
  const post = (r: TtsReply, tr: Transferable[] = []) => (self as unknown as Worker).postMessage(r, tr);
  try {
    const result = await speak(q.id, q.text, q.voice, q.speed, q.engine, (msg, fraction) => post({ id: q.id, progress: { msg, fraction } }));
    post({ id: q.id, result }, [result.pcm.buffer as ArrayBuffer]);
  } catch (err) {
    post({ id: q.id, error: err instanceof Error ? err.message : String(err) });
  } finally {
    cancelled.delete(q.id);
  }
};
