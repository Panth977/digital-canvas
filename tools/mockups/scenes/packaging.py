from . import mockup
import blib as B
import math

FRONT = -math.pi / 2  # angle of the cylinder side that faces a camera on -Y


def wrap_aspect(r, span, h):
    return round(r * span / h, 3)


MUG_R, MUG_H, MUG_SPAN, MUG_Z = 0.042, 0.096, math.radians(150), (0.016, 0.084)


@mockup('mug', 'Coffee mug', 'Packaging', aspect=wrap_aspect(MUG_R, MUG_SPAN, MUG_Z[1] - MUG_Z[0]),
        res=(1600, 1280), tint=True, colors=['#ffffff', '#1d1d1f', '#f4d35e', '#3d5a80', '#e07a5f'], albedo=0.86)
def mug():
    B.studio(color=(0.72, 0.7, 0.66), key_side=-1)
    r, h = MUG_R, MUG_H
    cer = B.m_ceramic('MugGlaze', color=(0.86, 0.86, 0.85))
    t = 0.0045
    prof = [(0.0, 0.0), (r - 0.007, 0.0), (r - 0.002, 0.002), (r, 0.008)]
    prof += [(r, 0.008 + (h - 0.012) * k / 30) for k in range(1, 31)]
    prof += [(r - 0.0005, h - 0.001), (r - t / 2, h), (r - t + 0.0005, h - 0.001), (r - t, h - 0.004), (r - t, 0.01),
             (r - t - 0.004, 0.008), (0.0, 0.008)]
    o = B.lathe('Mug', prof, 128, cer)
    B.set_uv(o, 'print', B.cyl_uv(FRONT + math.radians(15), MUG_SPAN, *MUG_Z), face_filter=lambda p: B.outward(p) and p.center.z > 0.009)
    pts = [(r - 0.003, 0, h * 0.82), (r + 0.034, 0, h * 0.76), (r + 0.036, 0, h * 0.38), (r - 0.003, 0, h * 0.24)]
    cer2 = B.m_ceramic('MugGlazeH', color=(0.86, 0.86, 0.85), printable=False, tint=True)
    hd = B.curve_tube('Handle', pts, 0.0058, cer2)
    hd.scale = (0.9, 1.3, 1)
    o.rotation_euler = (0, 0, math.radians(-15))
    hd.rotation_euler = (0, 0, math.radians(-15))
    coffee = B.m_simple('Coffee', (0.05, 0.025, 0.012), rough=0.05)
    B.cylinder(r - t - 0.0003, 0.002, (0, 0, h * 0.86), mat=coffee)
    B.camera((0.0, -0.5, 0.14), (0.012, 0.0, 0.047), lens=85, fstop=8)


@mockup('paper-cup', 'Paper coffee cup', 'Packaging', aspect=round(0.04 * math.radians(150) / 0.085, 3),
        res=(1280, 1600), albedo=0.85)
def paper_cup():
    B.studio(color=(0.55, 0.62, 0.66), key_side=1)
    r0, r1, h = 0.029, 0.044, 0.112
    paper = B.m_paper('CupPaper', color=(0.86, 0.86, 0.85), rough=0.5, fiber=0.05)
    prof = [(0, 0.002), (r0 - 0.001, 0.002), (r0, 0.0)]
    prof += [(r0 + (r1 - r0) * k / 30, h * k / 30) for k in range(1, 31)]
    prof += [(r1 - 0.002, h), (0, h)]
    o = B.lathe('Cup', prof, 128, paper)
    # print band z 0.012..0.097, use mean radius ~0.04
    B.set_uv(o, 'print', B.cyl_uv(FRONT, math.radians(150), 0.012, 0.097), face_filter=lambda p: B.outward(p))
    lid = B.m_simple('Lid', (0.85, 0.85, 0.84), rough=0.35)
    lp = [(0, h + 0.012), (0.03, h + 0.012), (0.033, h + 0.008), (r1 + 0.001, h + 0.006), (r1 + 0.003, h + 0.002),
          (r1 + 0.002, h - 0.004), (r1 - 0.0005, h - 0.004), (r1, h)]
    l = B.lathe('Lid', lp, 96, lid)
    B.solidify(l, 0.0008, 0)
    B.box((0.012, 0.004, 0.003), (0.0, -0.032, h + 0.0135), mat=lid, bevel=0.001)
    B.camera((0.0, -0.45, 0.13), (0.0, 0.0, 0.062), lens=85, fstop=8)
    # sleeve-less cup slightly rotated so the seam is at the back


CAN_R, CAN_H = 0.033, 0.122


@mockup('can', 'Drink can', 'Packaging', aspect=round(CAN_R * math.radians(140) / 0.088, 3), res=(1280, 1600),
        albedo=0.8)
def can():
    B.studio(color=(0.2, 0.22, 0.25), key=500, rim=600, key_side=-1)
    r, h = CAN_R, CAN_H
    paint = B.new_mat('CanPaint')
    m, nb = paint
    nb.output(nb.bsdf(color=(0.8, 0.8, 0.8), metal=0.35, rough=0.22, coat=1.0, coat_rough=0.05))
    nb.print_aov()
    alu = B.m_metal('Alu', (0.8, 0.8, 0.82), rough=0.25, brushed=0.05)
    prof = [(0, 0.004), (r * 0.7, 0.004), (r * 0.78, 0.0), (r * 0.9, 0.002), (r, 0.012)]
    prof += [(r, 0.012 + (h - 0.03) * k / 30) for k in range(1, 31)]
    prof += [(r * 0.86, h - 0.004), (r * 0.84, h), (r * 0.8, h + 0.001), (r * 0.79, h - 0.002), (0, h - 0.002)]
    o = B.lathe('Can', prof, 128, m)
    o.data.materials.append(alu)
    for p in o.data.polygons:
        if p.center.z > h - 0.017 or p.center.z < 0.011:
            p.material_index = 1
    B.set_uv(o, 'print', B.cyl_uv(FRONT, math.radians(140), 0.016, 0.104), face_filter=lambda p: B.outward(p))
    tab = B.box((0.012, 0.022, 0.0008), (0, 0.004, h - 0.0012), mat=alu, bevel=0.0003)
    # wet floor reflection
    B.camera((0.0, -0.5, 0.08), (0.0, 0.0, 0.062), lens=85, fstop=8)


@mockup('bottle-label', 'Bottle label', 'Packaging', aspect=round(0.0375 * math.radians(120) / 0.095, 3),
        res=(1280, 1600), albedo=0.85)
def bottle():
    B.studio(color=(0.78, 0.74, 0.68), key_side=-1, rim=500)
    glass = B.m_glass('BottleGlass', color=(0.12, 0.3, 0.12), rough=0.02)
    R = 0.037
    prof = [(0, 0.003), (R - 0.004, 0.0), (R, 0.006), (R, 0.2), (R * 0.95, 0.225), (R * 0.55, 0.26), (0.015, 0.285),
            (0.0145, 0.32), (0.016, 0.322), (0.016, 0.33), (0.012, 0.33), (0.011, 0.32)]
    o = B.lathe('Bottle', prof, 96, glass)
    B.solidify(o, 0.003, 1)
    B.subsurf(o, 1)
    wine = B.m_glass('Wine', color=(0.25, 0.02, 0.04), rough=0.0, ior=1.33)
    lq = B.lathe('Liquid', [(0, 0.006), (R - 0.0035, 0.006), (R - 0.0035, 0.2), (R * 0.9, 0.225), (0.0, 0.225)], 64, wine)
    foil = B.m_metal('Foil', (0.35, 0.05, 0.06), rough=0.3)
    f = B.lathe('Foil', [(0.0168, 0.27), (0.017, 0.334), (0.0, 0.335)], 64, foil)
    # label: open cylinder band slightly outside the glass
    lab = B.m_paper('Label', color=(0.86, 0.85, 0.82), rough=0.6, fiber=0.12)
    Rl = R + 0.0036
    zl0, zl1 = 0.06, 0.155
    seg = 90
    verts, faces = [], []
    span_full = math.radians(200)
    for k in range(seg + 1):
        a = FRONT - span_full / 2 + span_full * k / seg
        for z in (zl0, zl1):
            verts.append((Rl * math.cos(a), Rl * math.sin(a), z))
    for k in range(seg):
        faces.append((2 * k, 2 * k + 2, 2 * k + 3, 2 * k + 1))
    lo = B.mesh_obj('Label', verts, faces, lab)
    B.set_uv(lo, 'print', B.cyl_uv(FRONT, math.radians(120), zl0 + 0.0, zl1))
    B.camera((0.0, -0.82, 0.2), (0.0, 0.0, 0.168), lens=85, fstop=11)


@mockup('product-box', 'Product box', 'Packaging', aspect=0.6, res=(1600, 1600), albedo=0.85)
def product_box():
    B.studio(color=(0.62, 0.6, 0.57), key_side=-1)
    w, d, h = 0.12, 0.06, 0.2
    card = B.m_paper('Card', color=(0.86, 0.86, 0.85), printable=False, rough=0.5, fiber=0.04)
    front = B.m_paper('BoxFront', color=(0.86, 0.86, 0.85), rough=0.5, fiber=0.04)
    root = B.bpy.data.objects.new('BoxRoot', None)
    B.link(root)
    b = B.box((w, d, h), (0, 0, h / 2), mat=card, bevel=0.0012)
    p = B.plane(w - 0.0016, h - 0.0016, (0, -d / 2 - 0.0002, h / 2), rot=(90, 0, 0), mat=front, name='Front')
    # tuck flap line on top
    flap = B.box((w - 0.002, 0.0006, 0.0005), (0, -d / 2 + 0.012, h + 0.0002), mat=card)
    for o in (b, p, flap):
        o.parent = root
    root.rotation_euler = (0, 0, math.radians(28))
    b2 = B.box((w, d, h), (0.0, 0.0, h / 2), mat=card, bevel=0.0012)
    b2.location = (0.13, 0.12, h / 2)
    b2.rotation_euler = (0, 0, math.radians(-15))
    B.camera((0.12, -0.6, 0.24), (0.02, 0.0, 0.095), lens=70, fstop=8)


@mockup('shopping-bag', 'Shopping bag', 'Packaging', aspect=0.78, res=(1280, 1600), tint=True,
        colors=['#ffffff', '#c8a27a', '#1d1d1f', '#2a9d8f'], albedo=0.85)
def shopping_bag():
    B.studio(color=(0.7, 0.68, 0.64), key_side=1)
    W, D, H = 0.32, 0.12, 0.4
    paper = B.m_paper('BagPaper', color=(0.86, 0.86, 0.85), printable=False, rough=0.6, fiber=0.08, tint=True)
    front = B.m_paper('BagFront', color=(0.86, 0.86, 0.85), rough=0.6, fiber=0.08, tint=True)

    def warp(x, y, s, t):
        z = 0.002 * math.sin(s * 9 + t * 3) * math.sin(t * 5) + 0.003 * math.sin(math.pi * s) * (1 - t)
        z += -0.004 * max(0, 0.06 - t) / 0.06  # bottom fold
        return x, y, z
    root = B.bpy.data.objects.new('Bag', None)
    B.link(root)
    fr = B.sheet(W, H, 0.0004, (0, -D / 2, H / 2), rot=(90, 0, 0), front=front, back=paper, nx=40, ny=50,
                 warp=warp, name='BagFront')
    # sides: two halves with an inward fold (gusset)
    parts = [fr]
    for sgn in (-1, 1):
        for k, (y0, y1) in enumerate(((-D / 2, 0.0), (0.0, D / 2))):
            vx = [(sgn * W / 2, y0, 0), (sgn * (W / 2 - 0.015), (y0 + y1) / 2 if False else y1, 0)]
        vs = [(sgn * W / 2, -D / 2, 0), (sgn * (W / 2 - 0.025), 0, 0), (sgn * W / 2, D / 2, 0),
              (sgn * W / 2, D / 2, H), (sgn * (W / 2 - 0.025), 0, H), (sgn * W / 2, -D / 2, H)]
        fs = [(0, 1, 4, 5), (1, 2, 3, 4)]
        o = B.mesh_obj('Gusset', vs, fs, paper, smooth=False)
        parts.append(o)
    bk = B.plane(W, H, (0, D / 2, H / 2), rot=(90, 0, 0), mat=paper, name='BagBack')
    bot = B.plane(W, D, (0, 0, 0.001), mat=paper)
    parts += [bk, bot]
    # inner dark
    rope = B.m_linen('Rope', (0.86, 0.86, 0.85), 300)
    B.bpy.data.materials['Rope'].node_tree  # noqa
    for yy in (-D / 2 + 0.003, D / 2 - 0.003):
        pts = [(-0.06, yy, H - 0.03), (-0.065, yy, H + 0.06), (0.0, yy, H + 0.13), (0.065, yy, H + 0.06),
               (0.06, yy, H - 0.03)]
        t = B.curve_tube('Handle', pts, 0.0035, rope)
        parts.append(t)
    for o in parts:
        o.parent = root
    root.rotation_euler = (0, 0, math.radians(-22))
    B.camera((0.05, -1.25, 0.32), (0.0, 0.0, 0.25), lens=70, fstop=8)
