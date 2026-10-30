"""Write contract files (see mockup-format v1) from photo maps.

write_mockup() takes the photo plus float maps and writes base.jpg, uv-hi.png, uv-lo.png, shade.png,
tint.png (if any), thumb.jpg and meta.json; write_index() rebuilds index.json from every meta.json.
"""
import sys, os, json, io
import numpy as np
from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, '..', '..'))
CATS = ['Apparel', 'Outdoor', 'Print', 'Packaging', 'Devices', 'Home']
KEYS = ['id', 'label', 'category', 'width', 'height', 'aspect', 'tint', 'colors', 'credit', 'printWidth', 'fit']


def png_bytes(img, **kw):
    """Plain PNG: no gAMA/iCCP/sRGB/cHRM chunks (browsers would colour-convert the data)."""
    img.info = {}
    b = io.BytesIO()
    img.save(b, 'PNG', optimize=True, **kw)
    data = b.getvalue()
    bad = [c for c in (b'gAMA', b'iCCP', b'sRGB', b'cHRM') if c in png_chunks(data)]
    assert not bad, bad
    return data


def png_chunks(data):
    out, i = [], 8
    while i < len(data):
        n = int.from_bytes(data[i:i + 4], 'big')
        out.append(data[i + 4:i + 8])
        i += 12 + n
    return out


def write_mockup(meta, base, u, v, cov, shade, tint, out):
    """base: uint8 RGB. u, v, cov: float 0..1. shade: float 0..255. tint: float 0..1 or None."""
    mid = meta['id']
    H, W = base.shape[:2]
    # 14-bit effective precision (step 4/65535, < 0.15 px on a 4000 px design) keeps uv-lo compressible
    u16 = np.minimum(np.round(np.clip(u, 0, 1) * 65535 / 4) * 4, 65535).astype(np.uint32)
    v16 = np.minimum(np.round(np.clip(v, 0, 1) * 65535 / 4) * 4, 65535).astype(np.uint32)
    c8 = np.round(np.clip(cov, 0, 1) * 255).astype(np.uint8)
    u16[c8 == 0] = 0
    v16[c8 == 0] = 0
    s8 = np.round(np.clip(shade, 0, 255)).astype(np.uint8)
    s8[c8 == 0] = 128
    hi = np.stack([(u16 >> 8).astype(np.uint8), (v16 >> 8).astype(np.uint8), c8], -1)
    lo = np.stack([(u16 & 255).astype(np.uint8), (v16 & 255).astype(np.uint8), np.zeros_like(c8)], -1)
    od = os.path.join(out, mid)
    os.makedirs(od, exist_ok=True)
    for f in os.listdir(od):
        os.remove(os.path.join(od, f))
    Image.fromarray(base).save(os.path.join(od, 'base.jpg'), quality=84, optimize=True, progressive=True)
    open(os.path.join(od, 'uv-hi.png'), 'wb').write(png_bytes(Image.fromarray(hi, 'RGB')))
    open(os.path.join(od, 'uv-lo.png'), 'wb').write(png_bytes(Image.fromarray(lo, 'RGB')))
    open(os.path.join(od, 'shade.png'), 'wb').write(png_bytes(Image.fromarray(s8, 'L')))
    if tint is not None:
        t8 = np.round(np.clip(tint, 0, 1) * 255).astype(np.uint8)
        open(os.path.join(od, 'tint.png'), 'wb').write(png_bytes(Image.fromarray(t8, 'L')))
    th = Image.fromarray(base)
    s = 400 / max(W, H)
    th.resize((round(W * s), round(H * s)), Image.LANCZOS).save(os.path.join(od, 'thumb.jpg'), quality=80, optimize=True)
    entry = {k: meta.get(k) for k in KEYS}
    entry['width'], entry['height'] = W, H
    entry['tint'] = tint is not None
    # print area's width in px at full size: 1 / |du/dpixel| over fully covered pixels
    gy, gx = np.gradient(u)
    g = np.hypot(gx, gy)[cov > 0.99]
    g = g[g > 0]
    entry['printWidth'] = int(round(1.0 / np.median(g))) if len(g) else W
    json.dump(dict(entry, order=meta.get('order', 0)), open(os.path.join(od, 'meta.json'), 'w'))
    size = sum(os.path.getsize(os.path.join(od, f)) for f in os.listdir(od) if f != 'meta.json')
    print(f'packed {mid}: {W}x{H} print {entry["printWidth"]} px, {size / 1024:.0f} KB')
    return entry


def write_index(out, order=None):
    entries = []
    for mid in sorted(os.listdir(out)):
        p = os.path.join(out, mid, 'meta.json')
        if os.path.isfile(p):
            entries.append(json.load(open(p)))
    pos = {m: i for i, m in enumerate(order or [])}
    entries.sort(key=lambda e: (CATS.index(e['category']), e.get('order', 999), e['id']))
    idx = {'version': 1, 'mockups': [{k: e[k] for k in KEYS if e.get(k) is not None} for e in entries]}
    json.dump(idx, open(os.path.join(out, 'index.json'), 'w'), indent=1)
    return idx
