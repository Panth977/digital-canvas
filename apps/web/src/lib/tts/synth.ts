/** What the editor calls for speech. The worker loads only when speech is first asked for. */
import type { Progress } from '../models.ts';
import type { Engine } from './voices.ts';

export interface SynthOptions { voice: string; speed: number; engine: Engine; progress?: Progress; signal?: AbortSignal }
export interface Spoken { pcm: Float32Array; rate: number }
export type Synth = (text: string, o: SynthOptions) => Promise<Spoken>;

export const speakOnDevice: Synth = async (text, o) => (await import('./client.ts')).speak(text, o);
