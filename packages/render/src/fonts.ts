import type { CanvasKit, TypefaceFontProvider } from 'canvaskit-wasm';
import type { Color } from '@digital-canvas/scene';

/** Parse `#rgb`, `#rrggbb` or `#rrggbbaa` into a CanvasKit colour. */
export function color(ck: CanvasKit, hex: Color, alpha = 1): Float32Array {
  let h = hex.replace('#', '');
  if (h.length === 3) h = [...h].map((c) => c + c).join('');
  const n = (i: number) => parseInt(h.slice(i, i + 2), 16) / 255;
  const a = h.length >= 8 ? n(6) : 1;
  return ck.Color4f(n(0) || 0, n(2) || 0, n(4) || 0, a * alpha);
}

/** One font file the library holds (kept so exports can embed it). */
export interface FontFace {
  family: string;
  bytes: Uint8Array;
  weight: number;
  italic: boolean;
  subset?: string;
}

/** Fonts the renderer can draw with. Several faces may share a family. */
export class FontLibrary {
  readonly provider: TypefaceFontProvider;
  /** Family names people pick from (subset aliases left out). */
  readonly families = new Set<string>();
  /** Bumped on every new font, so cached text layouts know to redo. */
  version = 0;
  /** family → the provider names to try in order (the family itself, then its script subsets). */
  private chains = new Map<string, string[]>();
  /** Every face added, with its bytes (for SVG and PDF export). */
  readonly faces: FontFace[] = [];

  constructor(private ck: CanvasKit) {
    this.provider = ck.TypefaceFontProvider.Make();
  }

  private seen = new Set<string>();

  /** Register a face once (keyed by `key`, e.g. its asset id) — safe to call for every opened file. */
  addOnce(family: string, key: string, bytes: ArrayBuffer | Uint8Array, subset?: string, face?: { weight?: number; italic?: boolean }): void {
    if (this.seen.has(key)) return;
    this.seen.add(key);
    this.add(family, bytes, subset, face);
  }

  has(key: string): boolean {
    return this.seen.has(key);
  }

  /**
   * Add a face. A `subset` face (one script of a family split by script, like
   * Google Fonts' latin / latin-ext files) is registered under its own name
   * and tried after the family's other faces.
   */
  add(family: string, bytes: ArrayBuffer | Uint8Array, subset?: string, face?: { weight?: number; italic?: boolean }): void {
    const name = subset ? `${family}\u241f${subset}` : family;
    this.provider.registerFont(bytes, name);
    this.faces.push({ family, bytes: bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes), weight: face?.weight ?? 400, italic: face?.italic ?? false, subset });
    this.families.add(family);
    const chain = this.chains.get(family) ?? [];
    if (!chain.includes(name)) {
      chain.push(name);
      // The family's own name first, then latin, then the other scripts.
      const rank = (n: string) => (n === family ? 0 : n.endsWith('\u241flatin') ? 1 : 2);
      chain.sort((a, b) => rank(a) - rank(b));
    }
    this.chains.set(family, chain);
    this.version++;
  }

  /** Provider names to try for `family`, in order. */
  chain(family: string): string[] {
    return this.chains.get(family) ?? [family];
  }

  /** Load the faces that ship with the app (Inter regular/bold/italic). */
  async loadBundled(baseUrl: string, fetcher: (url: string) => Promise<ArrayBuffer> = defaultFetch): Promise<void> {
    const faces = ['Inter-Regular', 'Inter-Bold', 'Inter-Italic', 'Inter-BoldItalic'];
    const bytes = await Promise.all(faces.map((f) => fetcher(`${baseUrl}${f}.ttf`)));
    bytes.forEach((b, i) => this.add('Inter', b, undefined, { weight: i % 2 ? 700 : 400, italic: i >= 2 }));
  }

  dispose(): void {
    this.provider.delete();
  }
}

async function defaultFetch(url: string): Promise<ArrayBuffer> {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`font ${url}: HTTP ${r.status}`);
  return r.arrayBuffer();
}
