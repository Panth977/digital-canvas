import { describe, expect, it } from 'vitest';
import { compositeMockup, prepareMockup, quadAspect, quadMockupBuffers, quadMockupEntry, type Quad, type Rgba } from '../src/mockup.ts';

function img(w: number, h: number, f: (x: number, y: number) => [number, number, number, number?]): Rgba {
  const data = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const [r, g, b, a = 255] = f(x, y); data.set([r, g, b, a], (y * w + x) * 4); }
  return { width: w, height: h, data };
}
const at = (r: { width: number; data: Uint8Array | Uint8ClampedArray }, x: number, y: number) => Array.from(r.data.slice((y * r.width + x) * 4, (y * r.width + x) * 4 + 4));

/** Is (x, y) inside the convex quad (by edge cross products)? */
function inside(q: Quad, x: number, y: number) {
  let sign = 0;
  for (let i = 0; i < 4; i++) {
    const [ax, ay] = q[i]!, [bx, by] = q[(i + 1) % 4]!;
    const c = Math.sign((bx - ax) * (y - ay) - (by - ay) * (x - ax));
    if (c && sign && c !== sign) return false;
    if (c) sign = c;
  }
  return true;
}

const W = 120, H = 90;
const photo = img(W, H, () => [90, 90, 90]); // flat grey wall
const corners: Quad = [[20, 15], [100, 25], [95, 80], [25, 70]]; // a perspective quad, clockwise from top-left
const red = img(40, 30, () => [255, 0, 0]);

describe('quad mockups', () => {
  it('a solid design lands inside the quad and nowhere else', () => {
    const b = quadMockupBuffers(photo, { corners, width: W, height: H });
    const out = compositeMockup(prepareMockup(b), red, { aspect: quadAspect(corners) });
    let checked = 0;
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const c = [x + 0.5, y + 0.5] as const;
      // stay 1.5 px away from the edges (anti-aliased)
      const deep = [[-1.5, 0], [1.5, 0], [0, -1.5], [0, 1.5]].every(([dx, dy]) => inside(corners, c[0] + dx!, c[1] + dy!));
      const out1 = [[-1.5, 0], [1.5, 0], [0, -1.5], [0, 1.5], [-1.5, -1.5], [1.5, 1.5], [1.5, -1.5], [-1.5, 1.5]].every(([dx, dy]) => !inside(corners, c[0] + dx!, c[1] + dy!));
      if (deep) { expect(at({ width: W, data: out }, x, y)).toEqual([255, 0, 0, 255]); checked++; }
      else if (out1) expect(at({ width: W, data: out }, x, y)).toEqual([90, 90, 90, 255]);
    }
    expect(checked).toBeGreaterThan(3000);
  });

  it('maps the design corners to the quad corners (u,v by the inverse homography)', () => {
    // left half blue, right half green: the quad's left edge is blue, its right edge green
    const d = img(40, 30, (x) => (x < 20 ? [0, 0, 255] : [0, 255, 0]));
    const out = { width: W, data: compositeMockup(prepareMockup(quadMockupBuffers(photo, { corners, width: W, height: H })), d, { aspect: quadAspect(corners) }) };
    expect(at(out, 30, 40)).toEqual([0, 0, 255, 255]);
    expect(at(out, 90, 50)).toEqual([0, 255, 0, 255]);
  });

  it('scales corners picked on another size and multiplies a mask', () => {
    const half: Quad = corners.map(([x, y]) => [x / 2, y / 2]) as unknown as Quad;
    const mask = img(W, H, (x) => (x < 60 ? [255, 255, 255] : [0, 0, 0]));
    const out = { width: W, data: compositeMockup(prepareMockup(quadMockupBuffers(photo, { corners: half, width: W / 2, height: H / 2 }, mask)), red, { aspect: 1 }) };
    expect(at(out, 40, 45)).toEqual([255, 0, 0, 255]);
    expect(at(out, 80, 45)).toEqual([90, 90, 90, 255]); // masked out
  });

  it('shade: flat = 128, darker parts of the photo darken the design', () => {
    const p = img(W, H, (x) => (x < 60 ? [60, 60, 60] : [120, 120, 120]));
    const flat = quadMockupBuffers(photo, { corners, width: W, height: H });
    expect(at(flat.shade, 60, 45)[0]).toBe(128);
    const lit = quadMockupBuffers(p, { corners, width: W, height: H, shade: 1 });
    expect(at(lit.shade, 40, 45)[0]).toBeLessThan(110);
    expect(at(lit.shade, 80, 45)[0]).toBeGreaterThan(150);
    const none = quadMockupBuffers(p, { corners, width: W, height: H, shade: 0 });
    expect(at(none.shade, 40, 45)[0]).toBe(128);
    const white = img(10, 10, () => [200, 200, 200]);
    const out = { width: W, data: compositeMockup(prepareMockup(lit), white, { aspect: 1 }) };
    expect(at(out, 40, 45)[0]).toBeLessThan(at(out, 80, 45)[0]!);
  });

  it('gives an index entry with the aspect of the quad', () => {
    const e = quadMockupEntry({ id: 'pl_x', name: 'Wall', corners: [[0, 0], [200, 0], [200, 100], [0, 100]], width: 300, height: 200 });
    expect(e).toMatchObject({ id: 'pl_x', label: 'Wall', category: 'My mockups', aspect: 2 });
  });
});
