"""Reference compositor for the mockup format v1 (exactly the contract formula).

  python tools/mockups/composite.py [--design img.png] [--sheet out.jpg] [--big id1,id2 --bigdir DIR] [ids...]

Without --design it renders the orientation test design (colour grid, "TOP LEFT" in the top-left corner).
"""
import sys, os, json
import numpy as np
from PIL import Image, ImageDraw, ImageFont

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, '..', '..'))
LIB = os.environ.get('DC_MOCKUP_LIB') or os.path.join(ROOT, 'apps', 'web', 'public', 'mockups')
FONT = '/System/Library/Fonts/Supplemental/Arial Bold.ttf'


def hex_rgb(h):
    h = h.lstrip('#')
    return np.array([int(h[i:i + 2], 16) for i in (0, 2, 4)], np.float64)


def test_design(aspect, long=1200):
    if aspect >= 1:
        w, h = long, round(long / aspect)
    else:
        w, h = round(long * aspect), long
    img = Image.new('RGB', (w, h))
    d = ImageDraw.Draw(img)
    n = 6
    cols = [(231, 76, 60), (241, 196, 15), (46, 204, 113), (52, 152, 219), (155, 89, 182), (26, 188, 156),
            (230, 126, 34), (236, 240, 241), (52, 73, 94)]
    cw, ch = w / n, h / n
    for j in range(n):
        for i in range(n):
            d.rectangle([i * cw, j * ch, (i + 1) * cw, (j + 1) * ch], fill=cols[(i + 2 * j) % len(cols)])
    for i in range(n + 1):
        d.line([(i * cw, 0), (i * cw, h)], fill=(20, 20, 20), width=max(2, w // 300))
        d.line([(0, i * ch), (w, i * ch)], fill=(20, 20, 20), width=max(2, w // 300))
    s = min(w, h)
    f = ImageFont.truetype(FONT, max(14, s // 9))
    d.rectangle([0, 0, cw * 2, ch], fill=(255, 255, 255))
    d.text((s * 0.03, s * 0.02), 'TOP LEFT', font=f, fill=(0, 0, 0))
    # big arrow pointing up and a circle to reveal distortion
    d.ellipse([w / 2 - s * 0.25, h / 2 - s * 0.25, w / 2 + s * 0.25, h / 2 + s * 0.25], outline=(0, 0, 0),
              width=max(3, s // 80))
    f2 = ImageFont.truetype(FONT, max(12, s // 7))
    d.text((w / 2, h / 2), 'R', font=f2, fill=(0, 0, 0), anchor='mm')
    d.rectangle([0, 0, w - 1, h - 1], outline=(0, 0, 0), width=max(4, s // 60))
    return img


def cover_fit(design, aspect):
    """Scale + centre-crop the design to the print area's aspect (w/h)."""
    w, h = design.size
    if abs(w / h - aspect) < 1e-3:
        return design
    if w / h > aspect:  # too wide
        nw = round(h * aspect)
        x0 = (w - nw) // 2
        return design.crop((x0, 0, x0 + nw, h))
    nh = round(w / aspect)
    y0 = (h - nh) // 2
    return design.crop((0, y0, w, y0 + nh))


def bilinear(img, x, y):
    h, w = img.shape[:2]
    x0 = np.clip(np.floor(x).astype(int), 0, w - 1)
    y0 = np.clip(np.floor(y).astype(int), 0, h - 1)
    x1 = np.clip(x0 + 1, 0, w - 1)
    y1 = np.clip(y0 + 1, 0, h - 1)
    fx = (x - x0)[..., None]
    fy = (y - y0)[..., None]
    a = img[y0, x0] * (1 - fx) + img[y0, x1] * fx
    b = img[y1, x0] * (1 - fx) + img[y1, x1] * fx
    return a * (1 - fy) + b * fy


def composite(mid, design, color=None, lib=LIB):
    meta = next(m for m in json.load(open(os.path.join(lib, 'index.json')))['mockups'] if m['id'] == mid)
    d = os.path.join(lib, mid)
    base = np.asarray(Image.open(os.path.join(d, 'base.jpg')).convert('RGB'), np.float64)
    hi = np.asarray(Image.open(os.path.join(d, 'uv-hi.png')).convert('RGB'), np.float64)
    lo = np.asarray(Image.open(os.path.join(d, 'uv-lo.png')).convert('RGB'), np.float64)
    shade = np.asarray(Image.open(os.path.join(d, 'shade.png')).convert('L'), np.float64)
    color_px = base.copy()
    if meta['tint']:
        tint = np.asarray(Image.open(os.path.join(d, 'tint.png')).convert('L'), np.float64)[..., None] / 255
        pc = hex_rgb(color or meta['colors'][0]) / 255
        color_px = color_px * (1 - tint) + (color_px * pc) * tint
    m = hi[..., 2] / 255
    des = np.asarray(cover_fit(design.convert('RGBA'), meta['aspect']), np.float64)
    dh, dw = des.shape[:2]
    on = m > 0
    u = (hi[..., 0][on] * 256 + lo[..., 0][on]) / 65535
    v = (hi[..., 1][on] * 256 + lo[..., 1][on]) / 65535
    dd = bilinear(des, u * (dw - 1), v * (dh - 1))
    lit = np.clip(dd[:, :3] * (shade[on] / 128)[:, None], 0, 255)
    a = (m[on] * dd[:, 3] / 255)[:, None]
    color_px[on] = color_px[on] * (1 - a) + lit * a
    return Image.fromarray(np.clip(color_px + 0.5, 0, 255).astype(np.uint8))


def sheet(images, labels, out, cell=360, cols=6):
    rows = (len(images) + cols - 1) // cols
    S = Image.new('RGB', (cols * cell, rows * (cell + 26)), (245, 245, 245))
    dr = ImageDraw.Draw(S)
    f = ImageFont.truetype(FONT, 15)
    for k, (im, lb) in enumerate(zip(images, labels)):
        im = im.copy()
        im.thumbnail((cell - 8, cell - 8), Image.LANCZOS)
        x = (k % cols) * cell
        y = (k // cols) * (cell + 26)
        S.paste(im, (x + (cell - im.width) // 2, y + 4 + (cell - 8 - im.height) // 2))
        dr.text((x + 6, y + cell), lb, font=f, fill=(20, 20, 20))
    S.save(out, quality=85)


if __name__ == '__main__':
    args = sys.argv[1:]
    design_path, sheet_out, big, bigdir, ids, color_alt = None, None, [], '/tmp/orch27-rw', [], False
    i = 0
    while i < len(args):
        a = args[i]
        if a == '--design':
            design_path = args[i + 1]; i += 2; continue
        if a == '--sheet':
            sheet_out = args[i + 1]; i += 2; continue
        if a == '--big':
            big = args[i + 1].split(','); i += 2; continue
        if a == '--bigdir':
            bigdir = args[i + 1]; i += 2; continue
        if a == '--alt':
            color_alt = True; i += 1; continue
        ids.append(a); i += 1
    idx = json.load(open(os.path.join(LIB, 'index.json')))['mockups']
    ids = ids or [m['id'] for m in idx]
    imgs, labels = [], []
    for m in idx:
        if m['id'] not in ids:
            continue
        des = Image.open(design_path) if design_path else test_design(m['aspect'])
        col = m['colors'][1] if (color_alt and m['tint'] and len(m['colors']) > 1) else None
        im = composite(m['id'], des, col)
        imgs.append(im)
        labels.append(f"{m['category']} / {m['id']}")
        if m['id'] in big:
            im.save(os.path.join(bigdir, f"r13-mockup-{m['id']}.jpg"), quality=88)
    if sheet_out:
        sheet(imgs, labels, sheet_out)
        print('sheet', sheet_out, len(imgs))
