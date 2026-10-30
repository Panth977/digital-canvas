"""Build mockup maps from a real photograph of a blank product.

A spec (specs.py) names the photo and describes its print surface in pixels of the prepared image
(crop, then 1600 px long side). `python tools/mockups/build.py --grid <id>` draws a pixel grid to read them.

Surface:
  kind 'flat'      homography across a quad
  kind 'cloth'     homography plus a warp displaced by the photo's own luminance
  kind 'cylinder'  mug/cup/can/bottle: axis, radius at both ends, ellipse sag, arc
Coverage comes from `seed` (flood-fill segmentation of the blank, so fingers, clips and frame lips are
left out on their own) and/or `quad`/`poly`; `exclude` polygons cut objects in front.
"""
import numpy as np
import cv2
from PIL import Image, ImageOps

LONG = 1600


def prepare(path, crop=None):
    im = ImageOps.exif_transpose(Image.open(path)).convert('RGB')
    if crop:
        im = im.crop(tuple(crop))
    s = LONG / max(im.size)
    if s < 1:
        im = im.resize((round(im.width * s), round(im.height * s)), Image.LANCZOS)
    return np.asarray(im, np.uint8)


def luminance(rgb):
    return cv2.cvtColor(rgb, cv2.COLOR_RGB2GRAY).astype(np.float32)


def flood(rgb, seeds, tol=3):
    """Region of the blank: floating-range flood fill on a denoised image, so slow shading is followed
    and real edges stop it."""
    sm = cv2.bilateralFilter(rgb, 7, 18, 5)
    h, w = rgb.shape[:2]
    mask = np.zeros((h + 2, w + 2), np.uint8)
    flags = 4 | (255 << 8) | cv2.FLOODFILL_MASK_ONLY
    for x, y in seeds:
        cv2.floodFill(sm.copy(), mask, (int(x), int(y)), 0, (tol,) * 3, (tol,) * 3, flags)
    return mask[1:-1, 1:-1]


def clean(mask, close=5, fill_holes=True):
    """Largest region, small gaps closed. Holes (creases, specks) are filled; bites from the edge stay."""
    if close:
        k = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (close, close))
        mask = cv2.morphologyEx(mask, cv2.MORPH_CLOSE, k)
    n, lab, st, _ = cv2.connectedComponentsWithStats(mask, 8)
    if n < 2:
        return mask
    big = 1 + np.argmax(st[1:, cv2.CC_STAT_AREA])
    mask = np.where(lab == big, 255, 0).astype(np.uint8)
    if fill_holes:
        cnt, _ = cv2.findContours(mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_NONE)
        mask = cv2.drawContours(np.zeros_like(mask), cnt, -1, 255, -1)
    return mask


def order_quad(q):
    """Clockwise from the corner nearest the image's top-left."""
    q = np.asarray(q, np.float64)
    c = q.mean(0)
    a = np.arctan2(q[:, 1] - c[1], q[:, 0] - c[0])
    q = q[np.argsort(a)]
    i = np.argmin(q.sum(1))
    return np.roll(q, -i, 0)


def line_fit(pts):
    vx, vy, x0, y0 = cv2.fitLine(pts.astype(np.float32), cv2.DIST_HUBER, 0, 0.01, 0.01).ravel()
    return np.array([x0, y0]), np.array([vx, vy])


def meet(a, b):
    c = lambda a, b: a[0] * b[1] - a[1] * b[0]
    p, r = a
    q, s = b
    t = c(q - p, s) / c(r, s)
    return p + t * r


def fit_quad(mask):
    """Four corners of a segmented surface: a line through each side of its contour."""
    cnt, _ = cv2.findContours(mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_NONE)
    c = max(cnt, key=cv2.contourArea)
    hull = cv2.convexHull(c)
    per = cv2.arcLength(hull, True)
    q = None
    for e in np.linspace(0.005, 0.2, 80):
        ap = cv2.approxPolyDP(hull, e * per, True)
        if len(ap) == 4:
            q = ap[:, 0, :]
            break
    if q is None:
        raise ValueError('no quad')
    q = order_quad(q)
    pts = c[:, 0, :].astype(np.float64)
    lines = []
    for i in range(4):
        a, b = q[i], q[(i + 1) % 4]
        d = b - a
        L = np.hypot(*d)
        d /= L
        rel = pts - a
        t = rel @ d
        n = np.abs(rel[:, 0] * d[1] - rel[:, 1] * d[0])
        sel = pts[(n < 5) & (t > 0.08 * L) & (t < 0.92 * L)]
        lines.append(line_fit(sel) if len(sel) > 8 else (a, d))
    return order_quad([meet(lines[i - 1], lines[i]) for i in range(4)])


def homography_uv(q, w, h):
    src = np.float32(q)
    H = cv2.getPerspectiveTransform(src, np.float32([[0, 0], [1, 0], [1, 1], [0, 1]]))
    x, y = np.meshgrid(np.arange(w, dtype=np.float64) + 0, np.arange(h, dtype=np.float64))
    d = H[2, 0] * x + H[2, 1] * y + H[2, 2]
    return (H[0, 0] * x + H[0, 1] * y + H[0, 2]) / d, (H[1, 0] * x + H[1, 1] * y + H[1, 2]) / d


def true_aspect(q, w, h):
    """Real width/height of a planar rectangle from its image (principal point = centre, square pixels)."""
    m = [np.array([p[0] - w / 2, p[1] - h / 2, 1.0]) for p in (q[0], q[1], q[3], q[2])]
    m1, m2, m3, m4 = m
    k2 = np.dot(np.cross(m1, m4), m3) / np.dot(np.cross(m2, m4), m3)
    k3 = np.dot(np.cross(m1, m4), m2) / np.dot(np.cross(m3, m4), m2)
    n2, n3 = k2 * m2 - m1, k3 * m3 - m1
    d = n2[0] * n3[0] + n2[1] * n3[1]
    e = (n2[2] * n3[2])
    f2 = -d / e if abs(e) > 1e-12 else 0
    if f2 <= (0.3 * max(w, h)) ** 2 or f2 > (40 * max(w, h)) ** 2:   # near-frontal: f is ill-defined
        return np.hypot(*(q[1] - q[0])) / np.hypot(*(q[3] - q[0])) * 0.5 + np.hypot(*(q[2] - q[3])) / np.hypot(*(q[2] - q[1])) * 0.5
    A = np.diag([1 / f2, 1 / f2, 1.0])
    return float(np.sqrt((n2 @ A @ n2) / (n3 @ A @ n3)))


def cylinder_uv(s, w, h):
    """axis [[x,y],[x,y]] from top centre to bottom centre of the body; r [top, bottom] radius in px;
    sag [top, bottom] = minor semi-axis of the rim ellipses (bulge toward the viewer's bottom);
    band [v0, v1] along the axis, arc = half-angle in degrees either side of `front` degrees."""
    a, b = np.array(s['axis'], np.float64)
    L = np.hypot(*(b - a))
    ax = (b - a) / L
    nx = np.array([ax[1], -ax[0]])
    if nx[0] < 0:
        nx = -nx
    x, y = np.meshgrid(np.arange(w, dtype=np.float64), np.arange(h, dtype=np.float64))
    ss = (x - a[0]) * ax[0] + (y - a[1]) * ax[1]
    rr = (x - a[0]) * nx[0] + (y - a[1]) * nx[1]
    r0, r1 = s['r']
    b0, b1 = s['sag']
    t = np.clip(ss / L, -0.3, 1.3)
    for _ in range(6):
        R = r0 + (r1 - r0) * t
        n = np.clip(rr / R, -1, 1)
        B = b0 + (b1 - b0) * t
        t = (ss - B * np.sqrt(1 - n * n)) / L
    th = np.degrees(np.arcsin(np.clip(rr / (r0 + (r1 - r0) * t), -1, 1)))
    inside = np.abs(rr / (r0 + (r1 - r0) * t))
    v0, v1 = s.get('band', [0.1, 0.9])
    arc = s.get('arc', 70)
    front = s.get('front', 0)
    u = (th - (front - arc)) / (2 * arc)
    v = (t - v0) / (v1 - v0)
    Rm = (r0 + r1) / 2
    aspect = (np.radians(2 * arc) * Rm) / (L * (v1 - v0))
    return u, v, inside, aspect


def poly_mask(polys, w, h, ss=4):
    m = np.zeros((h * ss, w * ss), np.uint8)
    for p in polys:
        cv2.fillPoly(m, [np.round(np.array(p, np.float64) * ss).astype(np.int32)], 255)
    return cv2.resize(m, (w, h), interpolation=cv2.INTER_AREA).astype(np.float32) / 255


def make_shade(lum, cov, ref=None, gamma=1.0, pct=92, lo=205, smooth=4):
    """Blank surface's own luminance around 128: folds and light carry onto the design."""
    on = cov > 0.6
    r = ref or max(float(np.percentile(lum[on], pct)), lo)
    fine = cv2.bilateralFilter(lum, 0, 12, max(smooth, 1)) if smooth else lum
    s = np.power(np.maximum(fine / r, 0.02), gamma) * 128
    # edges carry the neighbours' colour: reuse the value just inside
    inner = (cv2.erode((cov > 0.9).astype(np.uint8), np.ones((5, 5), np.uint8)) > 0)
    if inner.sum() > 100:
        idx = cv2.distanceTransformWithLabels((~inner).astype(np.uint8), cv2.DIST_L2, 5, labelType=cv2.DIST_LABEL_PIXEL)[1]
        vals = np.zeros(idx.max() + 1, np.float32)
        vals[idx[inner]] = s[inner]
        s = np.where(inner, s, vals[idx])
    return np.clip(s, 8, 230)


def grabcut_body(rgb, poly, exclude=None, iters=5):
    h, w = rgb.shape[:2]
    m = np.full((h, w), cv2.GC_BGD, np.uint8)
    pm = poly_mask([poly], w, h) > 0.5
    m[pm] = cv2.GC_PR_FGD
    if exclude:
        m[poly_mask(exclude, w, h) > 0.5] = cv2.GC_BGD
    bg, fg = np.zeros((1, 65)), np.zeros((1, 65))
    cv2.grabCut(cv2.cvtColor(rgb, cv2.COLOR_RGB2BGR), m, None, bg, fg, iters, cv2.GC_INIT_WITH_MASK)
    return ((m == cv2.GC_FGD) | (m == cv2.GC_PR_FGD)).astype(np.uint8) * 255


def build(spec, path):
    """-> (base uint8, u, v, cov, shade, tint|None, aspect)"""
    rgb = prepare(path, spec.get('crop'))
    h, w = rgb.shape[:2]
    lum = luminance(rgb)
    feather = spec.get('feather', 1.1)
    seg = None
    if spec.get('seed'):
        seg = clean(flood(rgb, spec['seed'], spec.get('tol', 3)), spec.get('close', 5), spec.get('fill', True))
    kind = spec['kind']
    if kind == 'cylinder':
        u, v, inside, asp = cylinder_uv(spec, w, h)
        band = (u >= 0) & (u <= 1) & (v >= 0) & (v <= 1) & (inside < 0.995)
        cov = cv2.GaussianBlur(band.astype(np.float32), (0, 0), feather)
        cov = np.where(band, cov, 0).astype(np.float32) if spec.get('hard') else cov
    else:
        q = np.array(spec['quad'], np.float64) if spec.get('quad') else fit_quad(seg)
        q = np.roll(order_quad(q), spec.get('rot', 0), 0)
        if spec.get('shrink'):
            c = q.mean(0)
            q = np.array([p + (c - p) / np.hypot(*(c - p)) * spec['shrink'] * 1.4 for p in q])
        u, v = homography_uv(q, w, h)
        asp = spec.get('aspect') or true_aspect(q, w, h)
        cov = poly_mask([q], w, h)
        if kind == 'cloth':
            k = spec.get('warp', 2.5)
            sm = cv2.GaussianBlur(lum, (0, 0), spec.get('warp_sigma', 10))
            gx, gy = cv2.Sobel(sm, cv2.CV_32F, 1, 0, ksize=3), cv2.Sobel(sm, cv2.CV_32F, 0, 1, ksize=3)
            sd = max(float(np.std(gx[cov > 0.5])), float(np.std(gy[cov > 0.5])), 1e-3)
            mx, my = np.meshgrid(np.arange(w, dtype=np.float32), np.arange(h, dtype=np.float32))
            dx = cv2.GaussianBlur(np.clip(k * gx / sd, -2.5 * k, 2.5 * k), (0, 0), 6)
            dy = cv2.GaussianBlur(np.clip(k * gy / sd, -2.5 * k, 2.5 * k), (0, 0), 6)
            u = cv2.remap(u.astype(np.float32), mx + dx, my + dy, cv2.INTER_LINEAR, borderMode=cv2.BORDER_REPLICATE).astype(np.float64)
            v = cv2.remap(v.astype(np.float32), mx + dx, my + dy, cv2.INTER_LINEAR, borderMode=cv2.BORDER_REPLICATE).astype(np.float64)
            band = (u >= 0) & (u <= 1) & (v >= 0) & (v <= 1)
            cov = cv2.GaussianBlur(band.astype(np.float32), (0, 0), feather)
    if spec.get('radius'):
        # rounded screen corners, measured in pixels along the surface
        pw, ph = np.hypot(*(q[1] - q[0])), np.hypot(*(q[3] - q[0]))
        r = spec['radius']
        dx = np.maximum(r - np.minimum(u, 1 - u) * pw, 0)
        dy = np.maximum(r - np.minimum(v, 1 - v) * ph, 0)
        cov = cov * np.clip(r - np.hypot(dx, dy) + 0.5, 0, 1).astype(np.float32)
    if spec.get('poly'):
        cov = cov * poly_mask(spec['poly'], w, h)
    if seg is not None and not spec.get('noseg'):
        soft = cv2.GaussianBlur((seg > 0).astype(np.float32), (0, 0), feather)
        cov = cov * np.clip((soft - 0.5) * 2 + 0.5 if spec.get('tight') else soft * 1.0, 0, 1)
    if spec.get('exclude'):
        ex = cv2.GaussianBlur(poly_mask(spec['exclude'], w, h), (0, 0), feather)
        cov = cov * (1 - ex)
    if spec.get('inset'):
        k = 2 * spec['inset'] + 1
        cov = cv2.erode(cov, np.ones((k, k), np.uint8))
    shade = make_shade(lum, cov, spec.get('ref'), spec.get('gamma', 1.0), spec.get('pct', 92), spec.get('lo', 205), spec.get('smooth', 4))
    if spec.get('flat_shade'):
        shade = np.full(lum.shape, spec['flat_shade'], np.float32)
    tint = None
    t = spec.get('tint')
    if t:
        if t.get('seed'):
            body = clean(flood(rgb, t['seed'], t.get('tol', 3)), t.get('close', 7), True)
        else:
            body = clean(grabcut_body(rgb, t['poly'], t.get('exclude')), t.get('close', 7), True)
        tint = cv2.GaussianBlur((body > 0).astype(np.float32), (0, 0), t.get('feather', 1.3))
        if t.get('exclude'):
            tint = tint * (1 - cv2.GaussianBlur(poly_mask(t['exclude'], w, h), (0, 0), 1.2))
    cov = np.clip(cov, 0, 1)
    cov[cov < 1.5 / 255] = 0
    return rgb, u, v, cov, shade, tint, round(float(asp), 3)
