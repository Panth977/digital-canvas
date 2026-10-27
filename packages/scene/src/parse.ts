import { FORMAT, VERSION } from './types.ts';
import type { Doc } from './types.ts';

export class DocFormatError extends Error {
  override name = 'DocFormatError';
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const num = (v: unknown) => typeof v === 'number' && Number.isFinite(v);
const ANIM_TYPES = ['rise', 'pan', 'fade', 'pop', 'wipe', 'typewriter', 'baseline', 'drift', 'tumble'];
const ANIM_DIRS = ['left', 'right', 'up', 'down'];
/** An unknown or broken animation is dropped (the design still opens). */
function cleanAnimation(o: Record<string, unknown>): void {
  if (!('animation' in o)) return;
  const a = o.animation;
  if (!isObj(a) || !ANIM_TYPES.includes(a.type as string)) { delete o.animation; return; }
  if (a.duration !== undefined && !(num(a.duration) && (a.duration as number) > 0)) delete a.duration;
  if (a.direction !== undefined && !ANIM_DIRS.includes(a.direction as string)) delete a.direction;
}

/**
 * Check a parsed `document.json` and return it as a Doc. Throws
 * DocFormatError with the first problem found. Newer versions are refused
 * rather than silently damaged.
 */
export function parseDoc(input: unknown): Doc {
  if (!isObj(input)) throw new DocFormatError('document is not an object');
  if (input.format !== FORMAT) throw new DocFormatError(`not a ${FORMAT} document`);
  if (typeof input.version !== 'number') throw new DocFormatError('missing version');
  if (input.version > VERSION) throw new DocFormatError(`document version ${input.version} is newer than this app (${VERSION})`);
  for (const k of ['width', 'height'] as const) if (!num(input[k]) || (input[k] as number) <= 0) throw new DocFormatError(`bad ${k}`);
  if (!Array.isArray(input.pages) || input.pages.length === 0) throw new DocFormatError('document has no pages');
  input.pages.forEach((p, i) => {
    if (!isObj(p) || typeof p.id !== 'string' || !Array.isArray(p.elements)) throw new DocFormatError(`page ${i + 1} is malformed`);
    const check = (els: unknown[], where: string): void => els.forEach((e, j) => {
      if (!isObj(e) || typeof e.id !== 'string' || !['shape', 'text', 'image', 'video', 'path', 'group', 'line', 'table', 'chart'].includes(e.type as string))
        throw new DocFormatError(`${where}element ${j + 1}: unknown element`);
      for (const k of ['x', 'y', 'w', 'h']) if (!num(e[k])) throw new DocFormatError(`${where}element ${j + 1}: bad ${k}`);
      // containers (groups) hold elements too
      cleanAnimation(e);
      if (e.type === 'group' && !Array.isArray(e.children)) throw new DocFormatError(`${where}element ${j + 1}: group without children`);
      if (Array.isArray(e.children)) check(e.children, `${where}element ${j + 1}, `);
    });
    check(p.elements, `page ${i + 1}, `);
    cleanAnimation(p);
  });
  const doc = input as unknown as Doc;
  return {
    ...doc,
    bleed: num(doc.bleed) ? doc.bleed : 0,
    unit: doc.unit ?? 'px',
    assets: isObj(doc.assets) ? doc.assets : {},
  };
}
