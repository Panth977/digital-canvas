"""Turn raw Blender passes into contract files (see mockup-format v1).

  python tools/mockups/pack.py [ids...] [--raw /tmp/dc-mockups-raw] [--out apps/web/public/mockups]

Per id: base.jpg, uv-hi.png, uv-lo.png, shade.png, tint.png (if tint), thumb.jpg. Then rewrites index.json
from every <out>/<id>/meta.json present (order = category order, then registration order in meta 'order').
Needs numpy, scipy, Pillow.
"""
import sys, os, json, io
import numpy as np
from PIL import Image
from scipy import ndimage

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, '..', '..'))
CATS = ['Apparel', 'Outdoor', 'Print', 'Packaging', 'Devices', 'Home']
KEYS = ['id', 'label', 'category', 'width', 'height', 'aspect', 'tint', 'colors', 'credit']


def srgb(x):
    x = np.maximum(x, 0)
    return np.where(x <= 0.0031308, 12.92 * x, 1.055 * np.power(x, 1 / 2.4) - 0.055)


def soft(x, knee=0.7):
    """Identity below knee, smooth exponential shoulder to 1.0 above."""
    x = np.maximum(x, 0)
    over = x - knee
    return np.where(x < knee, x, knee + (1 - knee) * (1 - np.exp(-over / (1 - knee))))


def png_bytes(img, **kw):
    b = io.BytesIO()
    img.save(b, 'PNG', optimize=True, **kw)
    return b.getvalue()


def pack(mid, raw, out):
    d = os.path.join(raw, mid)
    meta = json.load(open(os.path.join(d, 'meta.json')))
    z = np.load(os.path.join(d, 'passes.npz'))
    comb, pc, tint = z['combined'], z['pc'], z['tint']
    H, W = comb.shape[:2]
    # EXR rows are top-to-bottom already (OIIO), Blender writes y-down images
    cov = np.clip(pc[..., 2], 0, 1)
    safe = np.maximum(cov, 1e-6)
    u = np.clip(pc[..., 0] / safe, 0, 1)
    v = np.clip(pc[..., 1] / safe, 0, 1)
    cov[cov < 1.5 / 255] = 0
    lum = comb[..., 0] * 0.2126 + comb[..., 1] * 0.7152 + comb[..., 2] * 0.0722
    irr = lum / meta['albedo']
    inner = cov > 0.985
    if inner.sum() < 50:
        inner = cov > 0.5
    # exposure
    if meta.get('exposure'):
        k = meta['exposure']
    else:
        k = meta['target'] / max(np.percentile(irr[inner], meta.get('pct', 85)), 1e-6)
    # shade only trusted inside; fill edges/outside from nearest interior pixel
    idx = ndimage.distance_transform_edt(~inner, return_distances=False, return_indices=True)
    irr_f = irr[idx[0], idx[1]]
    irr_f = np.where(inner, irr, irr_f)
    shade = srgb(k * irr_f)
    shade = np.clip(shade * 128, 0, 255)
    shade[cov == 0] = 128
    # base
    base = srgb(soft(k * comb))
    base8 = np.clip(base * 255 + 0.5, 0, 255).astype(np.uint8)
    # uv
    u16 = np.round(u * 65535).astype(np.uint32)
    v16 = np.round(v * 65535).astype(np.uint32)
    u16[cov == 0] = 0
    v16[cov == 0] = 0
    c8 = np.round(cov * 255).astype(np.uint8)
    hi = np.stack([(u16 >> 8).astype(np.uint8), (v16 >> 8).astype(np.uint8), c8], -1)
    lo = np.stack([(u16 & 255).astype(np.uint8), (v16 & 255).astype(np.uint8), np.zeros_like(c8)], -1)
    od = os.path.join(out, mid)
    os.makedirs(od, exist_ok=True)
    for f in os.listdir(od):
        os.remove(os.path.join(od, f))
    Image.fromarray(base8).save(os.path.join(od, 'base.jpg'), quality=82, optimize=True, progressive=True)
    open(os.path.join(od, 'uv-hi.png'), 'wb').write(png_bytes(Image.fromarray(hi, 'RGB')))
    open(os.path.join(od, 'uv-lo.png'), 'wb').write(png_bytes(Image.fromarray(lo, 'RGB')))
    open(os.path.join(od, 'shade.png'), 'wb').write(
        png_bytes(Image.fromarray(np.round(shade).astype(np.uint8), 'L')))
    if meta['tint']:
        t8 = np.round(np.clip(tint, 0, 1) * 255).astype(np.uint8)
        open(os.path.join(od, 'tint.png'), 'wb').write(png_bytes(Image.fromarray(t8, 'L')))
    th = Image.fromarray(base8)
    s = 400 / max(W, H)
    th = th.resize((round(W * s), round(H * s)), Image.LANCZOS)
    th.save(os.path.join(od, 'thumb.jpg'), quality=80, optimize=True)
    entry = {k: meta[k] for k in KEYS}
    entry['width'], entry['height'] = W, H
    json.dump(dict(entry, order=meta.get('order', 0)), open(os.path.join(od, 'meta.json'), 'w'))
    size = sum(os.path.getsize(os.path.join(od, f)) for f in os.listdir(od) if f != 'meta.json')
    print(f'packed {mid}: {W}x{H} exposure={k:.3f} {size / 1024:.0f} KB')
    return entry


def write_index(out, order=None):
    entries = []
    for mid in sorted(os.listdir(out)):
        p = os.path.join(out, mid, 'meta.json')
        if os.path.isfile(p):
            entries.append(json.load(open(p)))
    pos = {m: i for i, m in enumerate(order or [])}
    entries.sort(key=lambda e: (CATS.index(e['category']), e.get('order', 999), e['id']))
    idx = {'version': 1, 'mockups': [{k: e[k] for k in KEYS} for e in entries]}
    json.dump(idx, open(os.path.join(out, 'index.json'), 'w'), indent=1)
    return idx


if __name__ == '__main__':
    args = sys.argv[1:]
    raw = '/tmp/dc-mockups-raw'
    out = os.path.join(ROOT, 'apps', 'web', 'public', 'mockups')
    ids = []
    i = 0
    while i < len(args):
        if args[i] == '--raw':
            raw = args[i + 1]; i += 2; continue
        if args[i] == '--out':
            out = args[i + 1]; i += 2; continue
        ids.append(args[i]); i += 1
    if not ids:
        ids = sorted(x for x in os.listdir(raw) if os.path.isfile(os.path.join(raw, x, 'passes.npz')))
    for mid in ids:
        pack(mid, raw, out)
    idx = write_index(out)
    print(f'index.json: {len(idx["mockups"])} mockups')
