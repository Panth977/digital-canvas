/** One sound preview at a time for the Audio panel (Canva's play button on each track). */
import { resolveNasa } from './nasa.ts';
import type { Item } from './types.ts';

export const listening = $state({ key: '', time: 0, loading: false });
let el: HTMLAudioElement | null = null;

export function stopPreview(): void {
  el?.pause();
  listening.key = '';
  listening.time = 0;
  listening.loading = false;
}

export async function togglePreview(item: Item): Promise<void> {
  if (listening.key === item.key) return stopPreview();
  stopPreview();
  listening.key = item.key;
  listening.loading = true;
  const src = item.preview ?? (item.source === 'nasa' ? (await resolveNasa(item).catch(() => item)).preview : item.url);
  if (!src || listening.key !== item.key) return;
  el ??= new Audio();
  el.src = src;
  el.ontimeupdate = () => (listening.time = el!.currentTime);
  el.onplaying = () => (listening.loading = false);
  el.onended = el.onerror = () => stopPreview();
  el.play().catch(() => stopPreview());
}
