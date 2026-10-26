/** Video and audio files in the browser: what they are, how long, and a poster frame. */

export const VIDEO_TYPES = ['video/mp4', 'video/webm', 'video/quicktime'];
export const AUDIO_TYPES = ['audio/mpeg', 'audio/mp4', 'audio/x-m4a', 'audio/aac', 'audio/wav', 'audio/x-wav', 'audio/ogg', 'audio/webm'];

export const isVideoFile = (f: File) => VIDEO_TYPES.includes(f.type) || /\.(mp4|webm|mov|m4v)$/i.test(f.name);
export const isAudioFile = (f: File) => AUDIO_TYPES.includes(f.type) || /\.(mp3|m4a|aac|wav|ogg|oga|opus)$/i.test(f.name);

/** A MIME type for a media file (some systems leave `type` empty). */
export function mediaMime(f: File): string {
  if (f.type) return f.type === 'video/quicktime' ? 'video/mp4' : f.type;
  const ext = f.name.split('.').pop()?.toLowerCase() ?? '';
  return ({ mp4: 'video/mp4', m4v: 'video/mp4', mov: 'video/mp4', webm: 'video/webm', mp3: 'audio/mpeg', m4a: 'audio/mp4', aac: 'audio/aac', wav: 'audio/wav', ogg: 'audio/ogg', oga: 'audio/ogg', opus: 'audio/ogg' } as Record<string, string>)[ext] ?? 'application/octet-stream';
}

function once(el: HTMLMediaElement, ok: string, ms = 15000): Promise<void> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('media did not load')), ms);
    el.addEventListener(ok, () => { clearTimeout(t); resolve(); }, { once: true });
    el.addEventListener('error', () => { clearTimeout(t); reject(new Error(el.error?.message || 'this browser cannot play the file')); }, { once: true });
  });
}

export interface VideoInfo {
  width: number;
  height: number;
  duration: number;
  /** PNG of a frame near the start. */
  poster: Uint8Array;
}

/** Read a video's size and length and grab a poster frame. Throws when the browser can't decode it. */
export async function probeVideo(bytes: Uint8Array, mime: string): Promise<VideoInfo> {
  const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: mime }));
  const v = document.createElement('video');
  v.muted = true;
  v.preload = 'auto';
  v.src = url;
  try {
    await once(v, 'loadeddata');
    const duration = Number.isFinite(v.duration) ? v.duration : 0;
    v.currentTime = Math.min(0.1, duration / 2);
    await once(v, 'seeked');
    const c = new OffscreenCanvas(v.videoWidth, v.videoHeight);
    c.getContext('2d')!.drawImage(v, 0, 0);
    const poster = new Uint8Array(await (await c.convertToBlob({ type: 'image/png' })).arrayBuffer());
    return { width: v.videoWidth, height: v.videoHeight, duration, poster };
  } finally {
    v.removeAttribute('src');
    v.load();
    URL.revokeObjectURL(url);
  }
}

/** Length of an audio file, seconds. */
export async function probeAudio(bytes: Uint8Array, mime: string): Promise<number> {
  const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: mime }));
  const a = document.createElement('audio');
  a.preload = 'metadata';
  a.src = url;
  try {
    await once(a, 'loadedmetadata');
    return Number.isFinite(a.duration) ? a.duration : 0;
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** "1:05.2" style time. */
export function formatTime(s: number, tenths = false): string {
  const m = Math.floor(s / 60), r = s - m * 60;
  return `${m}:${(tenths ? r.toFixed(1) : Math.floor(r).toString()).padStart(tenths ? 4 : 2, '0')}`;
}
