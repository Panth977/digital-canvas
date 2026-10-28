/**
 * Tool results through the mailbox: JSON, inline when small, else split into
 * parts that each fit a Firestore document. Pictures (render_page, previews)
 * are base64 in the JSON; MP4/PDF/PNG exports never are (the device saves them
 * to the user's Drive and returns links).
 */
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { MAX_RESULT_BYTES, PART_BYTES } from './types.ts';

const enc = new TextEncoder();

/** UTF-8 size of a string. */
export const utf8Bytes = (s: string): number => enc.encode(s).length;

/** Split a string into pieces of at most `max` UTF-8 bytes (never inside a character). */
export function splitUtf8(s: string, max = PART_BYTES): string[] {
  const out: string[] = [];
  let start = 0, bytes = 0;
  for (let i = 0; i < s.length;) {
    const cp = s.codePointAt(i)!;
    const n = cp < 0x80 ? 1 : cp < 0x800 ? 2 : cp < 0x10000 ? 3 : 4;
    const w = cp > 0xffff ? 2 : 1;
    if (bytes + n > max) { out.push(s.slice(start, i)); start = i; bytes = 0; }
    bytes += n;
    i += w;
  }
  if (start < s.length || !out.length) out.push(s.slice(start));
  return out;
}

/** Drop the largest pictures until the result fits (each replaced by a note). */
function fit(result: CallToolResult, max: number): CallToolResult {
  let json = JSON.stringify(result);
  if (utf8Bytes(json) <= max) return result;
  const content = [...result.content];
  const order = content.map((c, i) => ({ i, n: c.type === 'image' || c.type === 'audio' ? c.data.length : 0 })).filter((x) => x.n).sort((a, b) => b.n - a.n);
  for (const { i } of order) {
    content[i] = { type: 'text', text: '(a picture was left out: too large to send back from the device; ask for a smaller one, e.g. render_page with size 768)' };
    json = JSON.stringify({ ...result, content });
    if (utf8Bytes(json) <= max) break;
  }
  return { ...result, content };
}

export interface Encoded {
  /** The whole result (fits one document). */
  inline?: string;
  /** Or these parts, in order. */
  parts?: string[];
}

export function encodeResult(result: CallToolResult, opts: { partBytes?: number; maxBytes?: number } = {}): Encoded {
  const partBytes = opts.partBytes ?? PART_BYTES;
  const json = JSON.stringify(fit(result, opts.maxBytes ?? MAX_RESULT_BYTES));
  if (utf8Bytes(json) <= partBytes) return { inline: json };
  return { parts: splitUtf8(json, partBytes) };
}

/** Back to a CallToolResult (anything malformed becomes an error result). */
export function decodeResult(json: string): CallToolResult {
  try {
    const r = JSON.parse(json) as CallToolResult;
    if (!r || !Array.isArray(r.content)) throw new Error('no content');
    return r;
  } catch (e) {
    return { isError: true, content: [{ type: 'text', text: `Error: the device sent back a result that could not be read (${e instanceof Error ? e.message : String(e)})` }] };
  }
}
