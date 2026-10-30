from . import mockup
import blib as B
import math
import numpy as np
from scenes.apparel import m_canvas, waves
from scenes.printed import sofa, desk


def m_canvas_flat(name='ArtCanvas', color=(0.86, 0.85, 0.82)):
    m, nb = B.new_mat(name)
    co = nb.coord('Object')
    a = nb.wave(co, scale=600, axis='X', dist=1.5, detail=1)
    b = nb.wave(co, scale=600, axis='Z', dist=1.5, detail=1)
    nz = nb.noise(co, scale=80, detail=3)
    h = nb.math('ADD', nb.math('MULTIPLY', a.outputs[1], b.outputs[1]), nb.math('MULTIPLY', nz.outputs[0], 0.3))
    nb.output(nb.bsdf(color=color, rough=0.85, normal=nb.bump(h, strength=0.3, distance=0.0006), spec=0.3))
    nb.print_aov()
    return m


@mockup('canvas-print', 'Canvas print', 'Home', aspect=1.25, res=(1600, 1280), albedo=0.85)
def canvas_print():
    wall = B.m_plaster('Wall', color=(0.8, 0.79, 0.76))
    floor = B.m_wood('Floor', tone=(0.6, 0.46, 0.32), plank=1.6, rough=0.4, coat=0.2)
    B.room(wall, floor, size=(9, 9, 3.0), back_y=0.0)
    W, H, D = 1.0, 0.8, 0.038
    side = B.m_linen('CanvasSide', (0.85, 0.84, 0.8), 600)
    B.box((W, D, H), (0, -D / 2, 1.45), mat=side, bevel=0.002)
    B.plane(W - 0.002, H - 0.002, (0, -D - 0.0005, 1.45), rot=(90, 0, 0), mat=m_canvas_flat(), name='Art')
    bench = B.m_wood('Bench', tone=(0.35, 0.22, 0.14), rough=0.4)
    B.box((1.4, 0.38, 0.05), (0, -0.3, 0.45), mat=bench, bevel=0.004)
    for x in (-0.62, 0.62):
        B.box((0.05, 0.34, 0.42), (x, -0.3, 0.21), mat=bench, bevel=0.003)
    B.leaf_plant((0.45, -0.3, 0.475), height=0.35, n=12, pot_r=0.07, seed=41)
    B.box((0.25, 0.18, 0.05), (-0.35, -0.3, 0.5), rot=(0, 0, 8), mat=B.m_linen('Bk', (0.2, 0.3, 0.35), 900), bevel=0.003)
    B.world_color((0.75, 0.82, 0.95), 0.35)
    B.sun_light((1.0, -0.9, 0.6), strength=3.0, angle=2.0)
    B.window_gobo((2.4, -2.2, 2.5), (1.0, -0.9, 0.6), w=1.2, h=2.0, panes=(2, 3), bar=0.06)
    B.area_light((-1, -4, 1.8), (0, 0, 1.2), size=3, power=450)
    B.camera((-1.2, -3.1, 1.3), (0.0, 0.0, 1.2), lens=40)


@mockup('pillow', 'Throw pillow', 'Home', aspect=1.0, res=(1600, 1600), tint=True,
        colors=['#f2efe9', '#2b2d42', '#d8b4a0', '#588157', '#e9c46a'], albedo=0.8, target=0.92)
def pillow():
    wall = B.m_plaster('Wall', color=(0.68, 0.7, 0.68))
    floor = B.m_wood('Floor', tone=(0.55, 0.4, 0.26), plank=1.6, rough=0.4, coat=0.3)
    B.room(wall, floor, size=(9, 9, 3.0), back_y=0.0)
    sofa(0.0, -0.48, color=(0.3, 0.33, 0.36))
    rng = np.random.default_rng(2)
    S = 0.45
    can = m_canvas('PillowFab', color=(0.84, 0.83, 0.8), scale=300)

    def surf(sign):
        def fn(s, t):
            x, y = (s - 0.5) * S, (t - 0.5) * S
            # edges sag inwards (concave sides)
            x *= 1 - 0.05 * (1 - (2 * t - 1) ** 2) * abs(2 * s - 1) ** 6
            y *= 1 - 0.05 * (1 - (2 * s - 1) ** 2) * abs(2 * t - 1) ** 6
            fx = 1 - abs(2 * s - 1) ** 2.5
            fy = 1 - abs(2 * t - 1) ** 2.5
            z = 0.1 * (max(fx, 0) * max(fy, 0)) ** 0.5
            P = np.array([[x, y]])
            z += 0.007 * waves(P, np.random.default_rng(7 if sign > 0 else 9), 8, (0.08, 0.25))[0] * (fx * fy) ** 0.3
            # corner wrinkles
            for cx, cy in ((0, 0), (0, 1), (1, 0), (1, 1)):
                dd = math.hypot(s - cx, t - cy)
                z += 0.004 * math.sin(dd * 60) * max(0, 0.25 - dd) * 4
            return (x, y, sign * z)
        return fn
    seam = ('seam', lambda s, t: (min(s, 1 - s, t, 1 - t) * S, 1.0))
    weave = ('weave', lambda s, t: ((s - 0.5) * S, (t - 0.5) * S))
    m = 0.025
    front = B.grid_mesh('PillowF', 80, 80, surf(1), uvfn=lambda s, t: ((s - m) / (1 - 2 * m), (t - m) / (1 - 2 * m)),
                        mat=can, extra_uv=(seam, weave))
    back = B.grid_mesh('PillowB', 40, 40, surf(-1), mat=m_canvas('PillowBack', printable=False),
                       extra_uv=(seam, weave))
    piping = B.curve_tube('Piping', [(-S / 2, -S / 2, 0), (S / 2, -S / 2, 0)], 0.001, None)
    root = B.bpy.data.objects.new('Pillow', None)
    B.link(root)
    for o in (front, back):
        o.parent = root
    root.rotation_euler = (math.radians(72), math.radians(-4), math.radians(18))
    root.location = (0.15, -0.34, 0.72)
    B.bpy.data.objects.remove(piping)
    p2 = B.box((0.42, 0.14, 0.42), (-0.55, -0.32, 0.7), rot=(-14, 0, -10), mat=B.m_linen('P2', (0.55, 0.42, 0.3), 700),
               bevel=0.06, segs=5)
    B.subsurf(p2, 2)
    B.world_color((0.75, 0.82, 0.95), 0.35)
    B.sun_light((-1.0, -0.3, 0.45), strength=4.5, angle=3.0)
    B.area_light((1.5, -1.5, 1.4), (0, -0.4, 0.7), size=1.5, power=120, color=(1, 0.97, 0.93))
    B.camera((0.45, -1.7, 0.85), (0.1, -0.36, 0.7), lens=50, fstop=4)


@mockup('phone-case', 'Phone case', 'Home', aspect=0.49, res=(1600, 1600), tint=True,
        colors=['#f4f4f2', '#1d1d1f', '#f4acb7', '#a8dadc', '#264653'], albedo=0.85, target=0.92)
def phone_case():
    desk(top=B.m_concrete('Concrete', color=(0.6, 0.6, 0.58), scale=4, strength=0.12), sun_dir=(-0.7, 0.8, 1.0),
         sun=3.0, wall=False, fill=150)
    W, H, T, R = 0.0755, 0.1505, 0.0105, 0.0125
    case_m = B.m_simple('CaseBody', (0.85, 0.85, 0.84), rough=0.4, tint=True)
    print_m = B.new_mat('CaseBack')
    m, nb = print_m
    nb.output(nb.bsdf(color=(0.85, 0.85, 0.84), rough=0.35, coat=0.3, coat_rough=0.2))
    nb.print_aov()
    nb.aov('tint', value=1.0)
    root = B.bpy.data.objects.new('Case', None)
    B.link(root)
    body = B.rounded_slab(W, H, T, R, case_m, bevel=0.003, name='CaseBody')
    face = B.rounded_face(W - 0.004, H - 0.004, R - 0.002, m, name='CaseFace', uv_rect=(W - 0.004, H - 0.004))
    face.location.z = T + 0.0002
    # camera module (top-left seen from the back)
    mod_m = B.m_simple('Module', (0.03, 0.03, 0.035), rough=0.15, coat=1.0)
    lip = B.rounded_slab(0.04, 0.042, 0.0012, 0.009, case_m, bevel=0.0005, name='Lip')
    lip.location = (-W / 2 + 0.024, H / 2 - 0.025, T)
    mod = B.rounded_slab(0.036, 0.038, 0.0022, 0.008, mod_m, bevel=0.0006, name='Module')
    mod.location = (-W / 2 + 0.024, H / 2 - 0.025, T + 0.0004)
    lens_m = B.m_simple('Lens', (0.0, 0.0, 0.0), rough=0.02, coat=1.0)
    ring = B.m_metal('Ring', (0.6, 0.6, 0.62), rough=0.2)
    parts = [body, face, lip, mod]
    for lx, ly in ((-0.0085, 0.009), (-0.0085, -0.009), (0.009, 0.0)):
        c = B.cylinder(0.0062, 0.0016, (-W / 2 + 0.024 + lx, H / 2 - 0.025 + ly, T + 0.0028), mat=ring)
        l = B.cylinder(0.0048, 0.0006, (-W / 2 + 0.024 + lx, H / 2 - 0.025 + ly, T + 0.0034), mat=lens_m)
        parts += [c, l]
    fl = B.cylinder(0.002, 0.0008, (-W / 2 + 0.024 + 0.009, H / 2 - 0.025 + 0.012, T + 0.0028),
                    mat=B.m_simple('Flash', (0.9, 0.85, 0.6), rough=0.3))
    parts.append(fl)
    for p in parts:
        p.parent = root
    root.rotation_euler = (0, 0, math.radians(12))
    # second case under, rotated
    b2 = B.rounded_slab(W, H, T, R, B.m_simple('Case2', (0.12, 0.12, 0.13), rough=0.4), bevel=0.003, name='Case2')
    b2.location = (0.085, 0.04, 0)
    b2.rotation_euler = (0, 0, math.radians(-20))
    B.leaf_plant((-0.12, 0.12, 0.0), height=0.14, n=8, pot_r=0.035, seed=23, leaf_len=0.07)
    B.camera((0.01, -0.13, 0.27), (0.008, 0.0, 0.0), lens=50, fstop=5.6)
