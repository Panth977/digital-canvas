/** Small pure helpers for panel content: credit lines and MIME types. */
import type { Credit } from './types.ts';

/** `"Title" by Creator (Licence) page`: the credit kept as the asset's name. */
export function creditLine(c: Credit): string {
  return `"${c.title}"${c.creator ? ` by ${c.creator}` : ''} (${c.license})${c.page ? ` ${c.page}` : ''}`;
}

const EXT_MIME: Record<string, string> = { webm: 'video/webm', mp4: 'video/mp4', m4v: 'video/mp4', mov: 'video/mp4', mp3: 'audio/mpeg', m4a: 'audio/mp4', ogg: 'audio/ogg', oga: 'audio/ogg', wav: 'audio/wav', jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', gif: 'image/gif' };

/** A usable MIME type: the server's, or from the file extension when it sent a generic one. */
export function mimeFor(url: string, served: string, kind: 'image' | 'video' | 'audio'): string {
  if (served.startsWith(`${kind}/`)) return served === 'video/quicktime' ? 'video/mp4' : served;
  const ext = /\.([a-z0-9]+)(?:[?#]|$)/i.exec(new URL(url, 'https://x').pathname)?.[1]?.toLowerCase() ?? '';
  const guess = EXT_MIME[ext];
  if (guess?.startsWith(`${kind}/`)) return guess;
  if (kind === 'audio' && served === 'application/ogg') return 'audio/ogg';
  if (kind === 'audio' && (served === 'application/octet-stream' || !served)) return 'audio/mpeg';
  return served;
}

