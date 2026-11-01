/**
 * The speech model and its voices. Everything is pinned: Kokoro-82M's ONNX
 * export (Apache-2.0) and misaki's dictionaries (Apache-2.0).
 */
const KOKORO = 'https://huggingface.co/onnx-community/Kokoro-82M-v1.0-ONNX/resolve/1939ad2a8e416c0acfeecc08a694d14ef25f2231';
const MISAKI = 'https://cdn.jsdelivr.net/gh/hexgrad/misaki@fba1236595f2d2bf21d414ba6e57d25256afada3/misaki/data';

/** Goes on the asset and the clip: a new id regenerates every line. */
export const MODEL_ID = 'kokoro-82m-v1.0';
export const MODEL_LABEL = 'Kokoro-82M';

/**
 * Two builds of the same weights. Measured on an M-series Mac, one thread for
 * WebAssembly: `gpu` (full precision on WebGPU) makes a 6 s line in 2 s; `small`
 * (quantised, on the CPU) takes 10 s. The smaller builds give NaN on WebGPU,
 * and the full one is too big for phones, so each engine has its own file.
 */
export type Engine = 'gpu' | 'small';
export const ENGINES: Record<Engine, { file: string; ep: string; mb: number }> = {
  gpu: { file: 'model.onnx', ep: 'webgpu', mb: 326 },
  small: { file: 'model_q8f16.onnx', ep: 'wasm', mb: 86 },
};

export const modelUrl = (file: string): string => `${KOKORO}/onnx/${file}`;
export const voiceUrl = (id: string): string => `${KOKORO}/voices/${id}.bin`;
export const lexiconUrl = (name: string): string => `${MISAKI}/${name}.json`;

export type Lang = 'en-us' | 'en-gb' | 'hi';
export interface Voice { id: string; label: string; lang: Lang; gender: 'Female' | 'Male'; grade: string }

/** Grades are the model author's (VOICES.md). Hindi voices are all C: fewer minutes of training data. */
export const VOICES: Voice[] = [
  { id: 'af_heart', label: 'Heart', lang: 'en-us', gender: 'Female', grade: 'A' },
  { id: 'af_bella', label: 'Bella', lang: 'en-us', gender: 'Female', grade: 'A-' },
  { id: 'af_nicole', label: 'Nicole', lang: 'en-us', gender: 'Female', grade: 'B-' },
  { id: 'af_sarah', label: 'Sarah', lang: 'en-us', gender: 'Female', grade: 'C+' },
  { id: 'am_michael', label: 'Michael', lang: 'en-us', gender: 'Male', grade: 'C+' },
  { id: 'am_fenrir', label: 'Fenrir', lang: 'en-us', gender: 'Male', grade: 'C+' },
  { id: 'am_puck', label: 'Puck', lang: 'en-us', gender: 'Male', grade: 'C+' },
  { id: 'bf_emma', label: 'Emma', lang: 'en-gb', gender: 'Female', grade: 'B-' },
  { id: 'bf_isabella', label: 'Isabella', lang: 'en-gb', gender: 'Female', grade: 'C' },
  { id: 'bm_george', label: 'George', lang: 'en-gb', gender: 'Male', grade: 'C' },
  { id: 'bm_fable', label: 'Fable', lang: 'en-gb', gender: 'Male', grade: 'C' },
  { id: 'hf_alpha', label: 'Alpha', lang: 'hi', gender: 'Female', grade: 'C' },
  { id: 'hf_beta', label: 'Beta', lang: 'hi', gender: 'Female', grade: 'C' },
  { id: 'hm_omega', label: 'Omega', lang: 'hi', gender: 'Male', grade: 'C' },
  { id: 'hm_psi', label: 'Psi', lang: 'hi', gender: 'Male', grade: 'C' },
];

export const LANGS: { id: Lang; label: string }[] = [
  { id: 'en-us', label: 'English (US)' },
  { id: 'en-gb', label: 'English (UK)' },
  { id: 'hi', label: 'हिन्दी (Hindi)' },
];

export const voiceById = (id: string): Voice | undefined => VOICES.find((v) => v.id === id);
export const DEFAULT_VOICE: Record<Lang, string> = { 'en-us': 'af_heart', 'en-gb': 'bf_emma', hi: 'hf_alpha' };
