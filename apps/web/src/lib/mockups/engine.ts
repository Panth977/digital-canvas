/**
 * The mockup work that runs off the main thread (worker.ts), or on it when
 * workers are unavailable: fetch and decode a mockup's maps, prepare them
 * per size (small = the grid, full = the preview dialog), composite the
 * design. Decoding uses createImageBitmap + OffscreenCanvas with no colour
 * conversion: the UV maps are data, not pictures.
 */
import { compositeMockup, defaultFit, mockupFiles, prepareMockup, MOCKUP_SMALL, type MockupBuffers, type MockupEntry, type MockupFit, type PreparedMockup, type Rgba } from '@digital-canvas/render/mockup';
import { quadMockupBuffers, type QuadSpec } from '../plugins/quad-bridge.ts';

/** A mockup made from a photo (a mockup plugin): the photo and mask as file bytes, the print area's corners. */
export interface QuadMockup extends QuadSpec { photo: Uint8Array; mask?: Uint8Array | null }

export type MockupSize = 'small' | 'full';

export interface RenderRequest {
  entry: MockupEntry;
  size: MockupSize;
  /** Which design buffer (set with `setDesign`). */
  design: string;
  color?: string | null;
  /** Default: whole design on products, filled on screens and signs (defaultFit). */
  fit?: MockupFit | null;
}

async function decode(url: string): Promise<Rgba> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  return decodeBlob(await res.blob());
}

async function decodeBlob(blob: Blob): Promise<Rgba> {
  const bmp = await createImageBitmap(blob, { colorSpaceConversion: 'none', premultiplyAlpha: 'none' });
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
  /** Mockups made from photos, by plugin id. */
  private quads = new Map<string, Promise<MockupBuffers>>();

  constructor(private base: string, private limits = { small: 32, full: 2 }) {}

  setDesign(key: string, d: Rgba): void {
    this.designs.set(key, d);
  }

  /** Add or replace a photo mockup (its maps are made here, off the main thread). */
  setQuad(id: string, q: QuadMockup): void {
    const job = (async () => {
      const [photo, mask] = await Promise.all([decodeBlob(new Blob([q.photo as BlobPart])), q.mask ? decodeBlob(new Blob([q.mask as BlobPart])) : Promise.resolve(null)]);
      return quadMockupBuffers(photo, { corners: q.corners, shade: q.shade, width: q.width, height: q.height }, mask);
    })();
    job.catch(() => {});
    this.quads.set(id, job);
    for (const k of [...this.prepared.keys()]) if (k.endsWith(`:${id}`)) this.prepared.delete(k);
  }

  private prepare(e: MockupEntry, size: MockupSize): Promise<PreparedMockup> {
    const key = `${size}:${e.id}`;
    let hit = this.prepared.get(key);
    if (hit) {
      this.prepared.delete(key);
      this.prepared.set(key, hit);
      return hit;
    }
    const quad = this.quads.get(e.id);
    hit = quad ? quad.then((b) => prepareMockup(b, size === 'small' ? MOCKUP_SMALL : undefined)) : (async () => {
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
    const data = compositeMockup(m, design, { aspect: r.entry.aspect, color: r.entry.tint ? r.color : null, fit: r.fit ?? defaultFit(r.entry) });
    return { width: m.width, height: m.height, data, ms: performance.now() - t0 };
  }
}
