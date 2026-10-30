"""Apparel: garments are heightfield meshes built from a 2D outline (flat lay) — puffed edges,
soft folds, rib collars, seams as shader creases, knit micro-texture. Print UV = rest XY in the chest box."""
from . import mockup
import blib as B
import math
import numpy as np
from scenes.printed import desk

TINT_TEE = ['#ffffff', '#1d1d1f', '#9aa5b1', '#1f3a93', '#c0392b', '#2e7d32', '#f1c40f', '#f5e6c8']


def chaikin(pts, n=4, closed=True, sharp=()):
    """Corner-cutting smoothing; indices in `sharp` stay as hard corners."""
    p = [np.asarray(x, float) for x in pts]
    hard = [i in sharp for i in range(len(p))]
    for _ in range(n):
        q, qh = [], []
        m = len(p)
        for i in range(m):
            a, b = p[i], p[(i + 1) % m]
            if hard[i]:
                q.append(a); qh.append(True)
            q.append(0.75 * a + 0.25 * b if not hard[i] else 0.9 * a + 0.1 * b); qh.append(False)
            q.append(0.25 * a + 0.75 * b if not hard[(i + 1) % m] else 0.1 * a + 0.9 * b); qh.append(False)
        p, hard = q, qh
    return np.array(p)


def inside_poly(px, py, poly):
    x, y = poly[:, 0], poly[:, 1]
    x2, y2 = np.roll(x, -1), np.roll(y, -1)
    ins = np.zeros(px.shape, bool)
    for i in range(len(x)):
        c = ((y[i] > py) != (y2[i] > py)) & (px < (x2[i] - x[i]) * (py - y[i]) / (y2[i] - y[i] + 1e-12) + x[i])
        ins ^= c
    return ins


def seg_dist(P, A, Bp):
    """distance from points P (N,2) to polyline A->B pairs arrays (M,2)."""
    d = np.full(len(P), 1e9)
    for a, b in zip(A, Bp):
        ab = b - a
        t = np.clip(((P - a) @ ab) / (ab @ ab + 1e-12), 0, 1)
        q = a + t[:, None] * ab
        d = np.minimum(d, np.linalg.norm(P - q, axis=1))
    return d


def poly_dist(P, poly, closed=True):
    A = poly
    Bp = np.roll(poly, -1, axis=0)
    if not closed:
        A, Bp = poly[:-1], poly[1:]
    return seg_dist(P, A, Bp)


def waves(P, rng, n=10, lam=(0.05, 0.16), amp=1.0):
    z = np.zeros(len(P))
    for _ in range(n):
        a = rng.uniform(0, math.pi)
        k = 2 * math.pi / rng.uniform(*lam)
        z += amp * rng.uniform(0.4, 1.0) * np.sin(k * (P[:, 0] * math.cos(a) + P[:, 1] * math.sin(a)) + rng.uniform(0, 6.3))
    return z / math.sqrt(n)


def ridge(P, a, b, width, height):
    """soft fold along segment a-b, fading towards b."""
    a, b = np.asarray(a), np.asarray(b)
    ab = b - a
    t = np.clip(((P - a) @ ab) / (ab @ ab), 0, 1)
    q = a + t[:, None] * ab
    d = np.linalg.norm(P - q, axis=1)
    inside = (((P - a) @ ab) / (ab @ ab) >= 0) & (((P - a) @ ab) / (ab @ ab) <= 1)
    return height * np.exp(-(d / width) ** 2) * (1 - t) ** 0.7 * inside


def garment_mesh(name, outline, mat, height_fn, step=0.004, print_box=None, seams=(), rng=None, drift=0.0):
    """Grid inside outline; boundary verts snapped onto the outline. height_fn(P, d_edge) -> z.
    print_box = (x0, y0_top, w, h). seams = list of (polyline, closed) for crease lines."""
    xs = np.arange(outline[:, 0].min() - step, outline[:, 0].max() + step, step)
    ys = np.arange(outline[:, 1].min() - step, outline[:, 1].max() + step, step)
    GX, GY = np.meshgrid(xs, ys)
    ins = inside_poly(GX, GY, outline)
    ny, nx = ins.shape
    # keep verts used by a quad whose 4 corners... allow quads with >=3 inside, then snap outside corners
    q = ins[:-1, :-1].astype(int) + ins[1:, :-1] + ins[:-1, 1:] + ins[1:, 1:]
    keepq = q >= 2
    used = np.zeros_like(ins)
    used[:-1, :-1] |= keepq
    used[1:, :-1] |= keepq
    used[:-1, 1:] |= keepq
    used[1:, 1:] |= keepq
    idx = -np.ones(ins.shape, int)
    idx[used] = np.arange(used.sum())
    P = np.stack([GX[used], GY[used]], 1)
    # snap: verts outside polygon -> nearest point on outline; inside verts near edge stay
    out = ~ins[used]
    if out.any():
        A, Bp = outline, np.roll(outline, -1, axis=0)
        Q = P[out]
        best = np.full(len(Q), 1e9)
        bq = Q.copy()
        for a, b in zip(A, Bp):
            ab = b - a
            t = np.clip(((Q - a) @ ab) / (ab @ ab + 1e-12), 0, 1)
            pr = a + t[:, None] * ab
            dd = np.linalg.norm(Q - pr, axis=1)
            m = dd < best
            best[m] = dd[m]
            bq[m] = pr[m]
        P[out] = bq
    d_edge = poly_dist(P, outline)
    d_edge[out] = 0
    Z = height_fn(P, d_edge)
    faces = []
    for j in range(ny - 1):
        for i in range(nx - 1):
            if keepq[j, i]:
                faces.append((idx[j, i], idx[j, i + 1], idx[j + 1, i + 1], idx[j + 1, i]))
    Pd = P.copy()
    if drift:
        r2 = np.random.default_rng(11)
        env = np.clip(d_edge / 0.03, 0, 1)
        Pd[:, 0] += drift * waves(P, r2, 8, (0.08, 0.2)) * env
        Pd[:, 1] += drift * waves(P, r2, 8, (0.08, 0.2)) * env
    verts = np.column_stack([Pd, Z])
    o = B.mesh_obj(name, verts, faces, mat)
    me = o.data
    li_v = np.zeros(len(me.loops), int)
    me.loops.foreach_get('vertex_index', li_v)
    def put(nm, U, V):
        uvl = me.uv_layers.new(name=nm)
        uv = np.column_stack([U[li_v], V[li_v]]).astype(np.float32)
        uvl.data.foreach_set('uv', uv.reshape(-1))
    if print_box:
        x0, ytop, w, h = print_box
        put('print', (P[:, 0] - x0) / w, (P[:, 1] - (ytop - h)) / h)
    else:
        put('print', np.full(len(P), -5.0), np.full(len(P), -5.0))
    put('weave', P[:, 0], P[:, 1])
    ds = np.full(len(P), 1.0)
    for pl, closed in seams:
        ds = np.minimum(ds, poly_dist(P, np.asarray(pl, float), closed))
    put('seam', ds, d_edge)
    return o, P


def m_cotton(name='Cotton', color=(0.84, 0.84, 0.83), printable=True, tint=True, rib=False, knit_scale=420.0):
    """Jersey: knit bump on 'weave' UV, seam creases from 'seam' UV (u = dist to seam lines, v = dist to edge)."""
    m, nb = B.new_mat(name)
    wv = nb.uv('weave')
    sep = nb.node('ShaderNodeSeparateXYZ')
    nb._set(sep.inputs[0], nb.uv('seam'))
    dseam, dedge = sep.outputs['X'], sep.outputs['Y']
    k1 = nb.wave(wv, scale=knit_scale, axis='X', dist=0.8, detail=0, profile='SIN')
    k2 = nb.wave(wv, scale=knit_scale * 1.7, axis='Y', dist=0.3, detail=0, profile='SIN')
    fz = nb.noise(wv, scale=90, detail=5, rough=0.6)
    crease = nb.math('EXPONENT', nb.math('MULTIPLY', -1.0, nb.math('POWER', nb.math('DIVIDE', dseam, 0.0016), 2.0)))
    stitch = nb.math('MULTIPLY', crease, nb.math('GREATER_THAN',
                                                 nb.wave(wv, scale=320, axis='X' if False else 'X', profile='SIN').outputs[1], 0.0))
    h = nb.math('ADD', nb.math('MULTIPLY', k1.outputs[1], 0.35), nb.math('MULTIPLY', k2.outputs[1], 0.15))
    h = nb.math('ADD', h, nb.math('MULTIPLY', fz.outputs[0], 0.4))
    h = nb.math('SUBTRACT', h, nb.math('MULTIPLY', crease, 2.5))
    if rib:
        rb = nb.wave(wv, scale=700, axis='X', profile='SIN')
        h = nb.math('ADD', h, nb.math('MULTIPLY', rb.outputs[1], 1.2))
    nrm = nb.bump(h, strength=0.35, distance=0.0006)
    shade = nb.math('SUBTRACT', 1.0, nb.math('MULTIPLY', crease, 0.18))
    col = nb.mix(1.0, color, nb.node('ShaderNodeCombineXYZ', inputs={'X': shade, 'Y': shade, 'Z': shade}).outputs[0],
                 blend='MULTIPLY')
    col = nb.mix(nb.math('MULTIPLY', fz.outputs[0], 0.1), col, tuple(c * 0.92 for c in color))
    nb.output(nb.bsdf(color=col, rough=0.9, normal=nrm, sheen=0.7, sheen_rough=0.35, spec=0.25))
    if tint:
        nb.aov('tint', value=1.0)
    if printable:
        nb.print_aov()
    return m


def tee_outline(long_sleeve=False, width=0.265, length=0.36, neck_front=0.29):
    if long_sleeve:
        R = [(0.0, neck_front), (0.05, neck_front + 0.012), (0.08, 0.335), (0.09, 0.355), (0.24, 0.315),
             (0.33, 0.1), (0.455, -0.3), (0.44, -0.36), (0.36, -0.38), (0.35, -0.32), (0.29, -0.02), (width, -0.05),
             (width, -length + 0.01), (width - 0.004, -length), (0.0, -length - 0.004)]
        sharpR = {3, 6, 7, 8, 9, 13}
    else:
        R = [(0.0, neck_front), (0.05, neck_front + 0.012), (0.08, 0.335), (0.09, 0.355), (0.235, 0.318),
             (0.4, 0.205), (0.338, 0.098), (0.262, 0.152), (width - 0.003, 0.0), (width, -length + 0.008),
             (width - 0.003, -length), (0.0, -length - 0.003)]
        sharpR = {3, 5, 6, 10}
    L = [(-x, y) for x, y in reversed(R[1:-1])]
    nR = len(R)
    sharpL = {nR + (len(R) - 2 - i) for i in sharpR if 0 < i < nR - 1}
    # index of R[i] mirrored in L: L index k corresponds to R[len(R)-2-k]
    sharpL = {nR + (nR - 2 - i) for i in sharpR}
    return chaikin(R + L, 3, sharp=sharpR | sharpL)


def collar(points, radius, mat, name='Collar', z=0.0):
    pts = [(x, y, z) for x, y in points]
    o = B.curve_tube(name, pts, radius, mat)
    o.data.bevel_resolution = 4
    o.scale = (1, 1, 0.55)
    return o


def tee_flat(name_prefix, outline, print_box, rng, col_mat, back_mat, extra_seams=(), puff=0.009,
             neck_front=0.29, neck_back=0.345, folds=None):
    """Front panel (printed) + back panel visible through the neck + rib collars."""
    shoulder_r = [(0.09, 0.355), (0.23, 0.315)]
    shoulder_l = [(-0.09, 0.355), (-0.23, 0.315)]
    seams = [(shoulder_r, False), (shoulder_l, False)] + list(extra_seams)

    def hf(P, d):
        z = puff * (1 - np.exp(-d / 0.007)) ** 0.7
        env = np.clip(d / 0.03, 0, 1)
        z += 0.006 * waves(P, rng, 12, (0.08, 0.25)) * env
        z += 0.0014 * waves(P, rng, 10, (0.025, 0.06)) * env
        for f in (folds or []):
            z += 2.0 * ridge(P, *f) * env
        return np.maximum(z, 0.0) + 0.0005
    front, P = garment_mesh(name_prefix + 'Front', outline, col_mat, hf, print_box=print_box, seams=seams, drift=0.004)
    # back panel: same outline but neck cut higher; sits slightly below
    bo = outline.copy()
    nb = (np.abs(bo[:, 0]) < 0.09) & (bo[:, 1] > 0.2)
    bo[nb, 1] = np.maximum(bo[nb, 1], neck_back - 0.03 * (bo[nb, 0] / 0.09) ** 2 * -1 + 0.0)
    back, _ = garment_mesh(name_prefix + 'Back', bo, back_mat,
                           lambda P, d: 0.003 * (1 - np.exp(-d / 0.01)) - 0.006, step=0.008)
    back.data.polygons.foreach_set('use_smooth', [True] * len(back.data.polygons))
    return front, back


def neck_curves(neck_front, neck_back, half=0.088, n=24):
    fr, bk = [], []
    for k in range(n + 1):
        t = -1 + 2 * k / n
        x = half * t
        fr.append((x, neck_front + (0.355 - neck_front) * abs(t) ** 1.8))
        bk.append((x, neck_back + (0.355 - neck_back) * abs(t) ** 2.2))
    return fr, bk


@mockup('tshirt-front', 'T-shirt', 'Apparel', aspect=0.8, res=(1600, 1600), tint=True, colors=TINT_TEE,
        albedo=0.84, target=0.92)
def tshirt_front():
    rng = np.random.default_rng(3)
    desk(top=B.m_wood('Floor', tone=(0.62, 0.48, 0.34), plank=7.0, axis='Y', rough=0.5, coat=0.05),
         sun_dir=(-0.9, 0.7, 0.75), sun=4.0, wall=False, fill=120, gobo=False)
    outline = tee_outline()
    cot = m_cotton('Tee')
    cot_in = m_cotton('TeeIn', color=(0.7, 0.7, 0.69), printable=False)
    rib = m_cotton('TeeRib', printable=False, rib=True)
    hem = [(-0.255, -0.338), (0.255, -0.338)]
    cuffR = [(0.392, 0.18), (0.345, 0.095)]
    cuffL = [(-0.392, 0.18), (-0.345, 0.095)]
    arm_r = [(0.23, 0.315), (0.25, 0.23), (0.262, 0.155)]
    arm_l = [(-0.23, 0.315), (-0.25, 0.23), (-0.262, 0.155)]
    folds = [((0.26, 0.15), (0.05, 0.02), 0.02, 0.005), ((-0.26, 0.15), (-0.08, -0.03), 0.025, 0.004),
             ((0.24, -0.33), (0.1, -0.15), 0.025, 0.0035), ((-0.2, -0.36), (-0.05, -0.2), 0.02, 0.003),
             ((0.33, 0.1), (0.3, 0.27), 0.012, 0.003), ((-0.35, 0.12), (-0.28, 0.26), 0.012, 0.003)]
    front, back = tee_flat('Tee', outline, (-0.14, 0.235, 0.28, 0.35), rng, cot, cot_in,
                           extra_seams=[(hem, False), (cuffR, False), (cuffL, False), (arm_r, False), (arm_l, False)],
                           folds=folds)
    fr, bk = neck_curves(0.29, 0.345)
    collar(fr, 0.0075, rib, z=0.006)
    collar(bk, 0.007, rib, name='CollarBack', z=0.003)
    for o in (front, back):
        o.rotation_euler = (0, 0, math.radians(0))
    B.camera((0.0, 0.0, 1.55), (0.0, 0.0, 0.0), lens=50)
    B.bpy.context.scene.camera.rotation_euler = (0, 0, 0)


@mockup('hoodie', 'Hoodie', 'Apparel', aspect=1.0, res=(1600, 1600), tint=True,
        colors=['#e8e8e6', '#1d1d1f', '#6b7280', '#14213d', '#7f1d1d', '#d4a373'], albedo=0.84, target=0.92)
def hoodie():
    rng = np.random.default_rng(5)
    desk(top=B.m_concrete('Concrete', color=(0.6, 0.59, 0.57), scale=3, strength=0.12), sun_dir=(0.7, 0.8, 1.0),
         sun=3.0, wall=False, fill=200)
    outline = tee_outline(long_sleeve=True, width=0.29, length=0.38)
    cot = m_cotton('Fleece', knit_scale=300)
    cot_in = m_cotton('FleeceIn', color=(0.7, 0.7, 0.69), printable=False)
    rib = m_cotton('HoodRib', printable=False, rib=True)
    # hood: lying behind the neck, as its own puffed shape
    hood = chaikin([(-0.13, 0.25), (-0.16, 0.38), (-0.11, 0.47), (0.0, 0.5), (0.11, 0.47), (0.16, 0.38), (0.13, 0.25)], 3)
    garment_mesh('Hood', hood, cot_in if False else m_cotton('HoodOut', printable=False),
                 lambda P, d: 0.012 * (1 - np.exp(-d / 0.02)) - 0.002 + 0.002 * waves(P, rng, 6, (0.05, 0.1)),
                 step=0.004, seams=[([(0.0, 0.5), (0.0, 0.3)], False)])
    pocket = [(-0.17, -0.31), (-0.11, -0.08), (0.11, -0.08), (0.17, -0.31)]
    hem = [(-0.285, -0.3), (0.285, -0.3)]
    cuffR = [(0.448, -0.3), (0.352, -0.32)]
    cuffL = [(-0.448, -0.3), (-0.352, -0.32)]
    folds = [((0.28, 0.0), (0.08, -0.06), 0.03, 0.006), ((-0.28, 0.0), (-0.1, -0.04), 0.03, 0.005),
             ((0.3, 0.12), (0.4, -0.25), 0.015, 0.004), ((-0.3, 0.12), (-0.4, -0.25), 0.015, 0.004),
             ((0.2, -0.36), (0.05, -0.2), 0.02, 0.003)]
    front, back = tee_flat('Hoodie', outline, (-0.13, 0.22, 0.26, 0.26), rng, cot, cot_in,
                           extra_seams=[(pocket, False), (hem, False), (cuffR, False), (cuffL, False)],
                           puff=0.013, folds=folds)
    fr, bk = neck_curves(0.29, 0.345)
    collar(fr, 0.009, rib, z=0.009)
    # drawstrings
    sm = B.m_simple('String', (0.86, 0.86, 0.85), rough=0.8, tint=True)
    for sx in (-0.035, 0.035):
        B.curve_tube('String', [(sx, 0.3, 0.012), (sx * 1.2, 0.2, 0.014), (sx * 1.5 + 0.005, 0.08, 0.016)], 0.0035, sm)
        B.cylinder(0.0045, 0.025, (sx * 1.5 + 0.005, 0.068, 0.016), rot=(90, 0, 0), mat=B.m_metal('Aglet', (0.8, 0.8, 0.8)))
    # rib bands
    for poly in (chaikin([(-0.285, -0.3), (0.285, -0.3), (0.285, -0.375), (-0.285, -0.375)], 1),):
        pass
    B.camera((0.0, 0.0, 1.75), (0.0, 0.03, 0.0), lens=50)
    B.bpy.context.scene.camera.rotation_euler = (0, 0, 0)
    B.bpy.context.scene.camera.location = (0.0, 0.03, 1.75)
