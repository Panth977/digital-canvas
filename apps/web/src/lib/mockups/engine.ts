/**
 * The mockup work that runs off the main thread (worker.ts), or on it when
 * workers are unavailable: fetch and decode a mockup's maps, prepare them
 * per size (small = the grid, full = the preview dialog), composite the
 * design. Decoding uses createImageBitmap + OffscreenCanvas with no colour
 * conversion: the UV maps are data, not pictures.
 */
import { compositeMockup, mockupFiles, prepareMockup, MOCKUP_SMALL, type MockupEntry, type PreparedMockup, type Rgba } from '@digital-canvas/render/mockup';

export type MockupSize = 'small' | 'full';

export interface RenderRequest {
  entry: MockupEntry;
  size: MockupSize;
  /** Which design buffer (set with `setDesign`). */
  design: string;
  color?: string | null;
}

async function decode(url: string): Promise<Rgba> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  const bmp = await createImageBitmap(await res.blob(), { colorSpaceConversion: 'none', premultiplyAlpha: 'none' });
  try {
    const c = new OffscreenCanvas(bmp.width, bmp.height);
    const g = c.getContext('2d', { willReadFrequently: true, colorSpace: 'srgb' } as CanvasRenderingContext2DSettings) as OffscreenCanvasRenderingContext2D | null;
    if (!g) throw new Error('no 2D canvas');
    g.drawImage(bmp, 0, 0);
    const d = g.getImageData(0, 0, bmp.width, bmp.height);
    return { width: d.width, height: d.height, data: d.data };
  } finally {
    bmp.close();
  }
}

export class MockupEngine {
  private designs = new Map<string, Rgba>();
  /** Prepared mockups, least recently used first. */
  private prepared = new Map<string, Promise<PreparedMockup>>();

  constructor(private base: string, private limits = { small: 32, full: 2 }) {}

  setDesign(key: string, d: Rgba): void {
    this.designs.set(key, d);
  }

  private prepare(e: MockupEntry, size: MockupSize): Promise<PreparedMockup> {
    const key = `${size}:${e.id}`;
    let hit = this.prepared.get(key);
    if (hit) {
      this.prepared.delete(key);
      this.prepared.set(key, hit);
      return hit;
    }
    hit = (async () => {
      const f = mockupFiles(e);
      const u = (p: string) => new URL(p, this.base).href;
      const [base, uvHi, uvLo, shade, tint] = await Promise.all([decode(u(f.base)), decode(u(f.uvHi)), decode(u(f.uvLo)), decode(u(f.shade)), f.tint ? decode(u(f.tint)) : Promise.resolve(null)]);
      return prepareMockup({ base, uvHi, uvLo, shade, tint }, size === 'small' ? MOCKUP_SMALL : undefined);
    })();
    hit.catch(() => this.prepared.delete(key));
    this.prepared.set(key, hit);
    const limit = size === 'small' ? this.limits.small : this.limits.full;
    const same = [...this.prepared.keys()].filter((k) => k.startsWith(`${size}:`));
    for (const k of same.slice(0, Math.max(0, same.length - limit))) this.prepared.delete(k);
    return hit;
  }

  /** Composite; returns RGBA (its buffer can be transferred). */
  async render(r: RenderRequest): Promise<{ width: number; height: number; data: Uint8ClampedArray; ms: number }> {
    const t0 = performance.now();
    const m = await this.prepare(r.entry, r.size);
    const design = this.designs.get(r.design);
    if (!design) throw new Error(`no design ${r.design}`);
    const data = compositeMockup(m, design, { aspect: r.entry.aspect, color: r.entry.tint ? r.color : null });
    return { width: m.width, height: m.height, data, ms: performance.now() - t0 };
  }
}
