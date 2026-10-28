import { peaks } from './timeline.ts';

/** Loudness bars per second of sound drawn on the timeline's audio lane. */
export const BARS_PER_SECOND = 20;

const cache = new Map<string, Promise<number[] | null>>();

/**
 * A sound's loudness, BARS_PER_SECOND bars a second (0..1), decoded once per
 * asset. Null when the browser cannot decode it.
 */
export function waveform(asset: string, bytes: Uint8Array | undefined): Promise<number[] | null> {
  let p = cache.get(asset);
  if (p) return p;
  p = (async () => {
    if (!bytes || typeof OfflineAudioContext === 'undefined') return null;
    try {
      const ctx = new OfflineAudioContext(1, 1, 22050);
      const buf = await ctx.decodeAudioData(bytes.slice().buffer as ArrayBuffer);
      const ch = buf.getChannelData(0);
      return peaks(ch, Math.max(1, Math.ceil(buf.duration * BARS_PER_SECOND)));
    } catch {
      return null;
    }
  })();
  cache.set(asset, p);
  return p;
}
