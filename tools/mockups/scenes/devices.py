from . import mockup
import blib as B
import math
from scenes.printed import desk


def phone(screen_mat=None, body_color=(0.08, 0.08, 0.09), frame_color=(0.55, 0.55, 0.57), island=True):
    """Phone lying in local XY, screen up (+Z). Returns root empty. Screen aspect 0.462."""
    W, H, T, R = 0.0715, 0.147, 0.0078, 0.0115
    root = B.bpy.data.objects.new('Phone', None)
    B.link(root)
    frame = B.m_metal('PhoneFrame', frame_color, rough=0.22)
    body = B.rounded_slab(W, H, T, R, frame, bevel=0.0018, name='PhoneBody')
    glass = B.m_simple('BlackGlass', (0.005, 0.005, 0.006), rough=0.05, coat=1.0)
    front = B.rounded_slab(W - 0.0012, H - 0.0012, 0.0003, R - 0.0006, glass, name='FrontGlass')
    front.location.z = T - 0.0001
    sw, sh = 0.0665, 0.144
    sm = screen_mat or B.m_screen('PhoneScreen')
    scr = B.rounded_face(sw, sh, R - 0.0022, sm, name='Screen', uv_rect=(sw, sh))
    scr.location.z = T + 0.00025
    parts = [body, front, scr]
    if island:
        isl = B.rounded_slab(0.019, 0.0055, 0.0001, 0.00275, B.m_simple('Island', (0, 0, 0), rough=0.3), name='Island')
        isl.location = (0, sh / 2 - 0.0055, T + 0.0003)
        parts.append(isl)
    back = B.m_simple('PhoneBack', body_color, rough=0.35)
    bk = B.rounded_slab(W - 0.0012, H - 0.0012, 0.0003, R - 0.0006, back, name='Back')
    bk.location.z = -0.0002
    parts.append(bk)
    for p in parts:
        p.parent = root
    return root


@mockup('phone-desk', 'Phone on a desk', 'Devices', aspect=0.462, res=(1600, 1280), albedo=1.0, target=0.95, pct=50)
def phone_desk():
    desk(top=B.m_wood('Oak', tone=(0.6, 0.45, 0.3), axis='X', rough=0.4), sun_dir=(-0.8, 0.7, 0.9), sun=2.5,
         fill=120, wall=False)
    p = phone()
    p.rotation_euler = (0, 0, math.radians(-14))
    p.location = (0, 0, 0.0002)
    B.mug_prop((0.17, 0.1, 0), rot=120)
    B.pen_prop((-0.09, -0.05, 0), rot=75)
    nb = B.m_linen('Notebook', (0.75, 0.68, 0.55), 900)
    B.box((0.15, 0.21, 0.01), (-0.19, 0.08, 0.005), rot=(0, 0, -12), mat=nb, bevel=0.002)
    B.leaf_plant((0.2, -0.12, 0.0), height=0.14, n=8, pot_r=0.035, seed=21, leaf_len=0.07)
    B.camera((0.03, -0.19, 0.25), (0.005, 0.005, 0.0), lens=45, fstop=4)


def slab_device(W, H, T, R, sw, sh, sr, frame_color=(0.62, 0.62, 0.64), bezel=(0.01, 0.01, 0.011), name='Dev'):
    root = B.bpy.data.objects.new(name, None)
    B.link(root)
    frame = B.m_metal(name + 'Frame', frame_color, rough=0.3, brushed=0.03)
    body = B.rounded_slab(W, H, T, R, frame, bevel=0.0015, name=name + 'Body')
    glass = B.m_simple(name + 'Bezel', bezel, rough=0.05, coat=1.0)
    fg = B.rounded_slab(W - 0.001, H - 0.001, 0.0003, R - 0.0005, glass, name=name + 'Glass')
    fg.location.z = T - 0.0001
    scr = B.rounded_face(sw, sh, sr, B.m_screen(name + 'Screen'), name=name + 'Screen', uv_rect=(sw, sh))
    scr.location.z = T + 0.00025
    for p in (body, fg, scr):
        p.parent = root
    return root


@mockup('tablet', 'Tablet', 'Devices', aspect=0.75, res=(1600, 1280), albedo=1.0, pct=50)
def tablet():
    desk(top=B.m_concrete('Concrete', color=(0.55, 0.54, 0.52), scale=4, strength=0.15), sun_dir=(0.8, 0.8, 1.0),
         sun=2.6, fill=120, wall=False)
    sh = 0.25
    t = slab_device(0.19, 0.262, 0.0063, 0.016, 0.1785, sh * 0.952, 0.012, name='Tab')
    t.rotation_euler = (0, 0, math.radians(8))
    B.mug_prop((-0.2, 0.15, 0), rot=60, mat=B.m_ceramic('M2', (0.15, 0.15, 0.16), printable=False, tint=False))
    B.leaf_plant((0.23, 0.2, 0.0), height=0.2, n=9, pot_r=0.045, seed=2, leaf_len=0.09)
    B.camera((0.02, -0.34, 0.42), (0.0, 0.005, 0.0), lens=45, fstop=6)


def keyboard_keys(root, x0, y0, cols, rows, pitch, key, mat, z):
    for j in range(rows):
        for i in range(cols):
            k = B.box((key, key, 0.0012), (x0 + i * pitch, y0 + j * pitch, z), mat=mat, bevel=0.0004, segs=2)
            k.parent = root


@mockup('laptop', 'Laptop', 'Devices', aspect=1.6, res=(1600, 1200), albedo=1.0, pct=50)
def laptop():
    desk(top=B.m_wood('Desk', tone=(0.55, 0.4, 0.27), axis='X', rough=0.4), sun_dir=(-0.9, 0.5, 0.8), sun=2.2,
         fill=150, wall=True, wall_color=(0.7, 0.7, 0.68))
    W, D = 0.312, 0.221
    alu = B.m_metal('Alu', (0.68, 0.68, 0.7), rough=0.32, brushed=0.03)
    root = B.bpy.data.objects.new('Laptop', None)
    B.link(root)
    base = B.rounded_slab(W, D, 0.011, 0.012, alu, bevel=0.002, name='Base')
    base.parent = root
    kb = B.m_simple('Keys', (0.02, 0.02, 0.022), rough=0.5)
    well = B.box((0.27, 0.105, 0.0006), (0, 0.035, 0.0108), mat=B.m_simple('Well', (0.04, 0.04, 0.045), rough=0.6))
    well.parent = root
    keyboard_keys(root, -0.124, -0.006, 15, 5, 0.0178, 0.0155, kb, 0.0116)
    sp = B.box((0.09, 0.014, 0.0012), (0, -0.017, 0.0116), mat=kb, bevel=0.0004)  # spacebar row hint
    sp.parent = root
    tp = B.rounded_slab(0.13, 0.08, 0.0003, 0.006, B.m_metal('Pad', (0.62, 0.62, 0.64), rough=0.45), name='Pad')
    tp.location = (0, -0.06, 0.0109)
    tp.parent = root
    # lid hinged at back edge
    hinge = B.bpy.data.objects.new('Hinge', None)
    B.link(hinge)
    hinge.parent = root
    hinge.location = (0, D / 2 - 0.004, 0.011)
    lid = B.rounded_slab(W, D, 0.006, 0.012, alu, bevel=0.0015, name='Lid')
    lid.parent = hinge
    lid.location = (0, -D / 2, 0)
    bz = B.rounded_slab(W - 0.002, D - 0.002, 0.0003, 0.011, B.m_simple('Bez', (0.01, 0.01, 0.012), rough=0.05,
                                                                    coat=1.0), name='LidBezel')
    bz.parent = hinge
    bz.location = (0, -D / 2, -0.0003)
    bz.rotation_euler = (math.radians(180), 0, 0)
    sw, sh = 0.2864, 0.179
    scr = B.rounded_face(sw, sh, 0.004, B.m_screen('LapScreen'), name='LapScreen', uv_rect=(sw, sh))
    scr.parent = hinge
    scr.location = (0, -D / 2 - 0.004, -0.0008)
    scr.rotation_euler = (math.radians(180), 0, 0)
    hinge.rotation_euler = (math.radians(-110), 0, 0)
    root.rotation_euler = (0, 0, math.radians(-18))
    B.mug_prop((0.26, 0.05, 0), rot=200)
    B.leaf_plant((-0.3, 0.2, 0.0), height=0.3, n=12, pot_r=0.06, seed=9)
    B.camera((0.12, -0.6, 0.28), (0.0, 0.03, 0.1), lens=50, fstop=5.6)


@mockup('monitor', 'Desktop monitor', 'Devices', aspect=1.778, res=(1600, 1200), albedo=1.0, pct=50)
def monitor():
    desk(top=B.m_wood('Desk', tone=(0.75, 0.62, 0.48), axis='X', rough=0.4), sun_dir=(0.9, -0.3, 0.7), sun=2.0,
         fill=150, wall=True, gobo=False, wall_color=(0.62, 0.64, 0.66))
    root = B.bpy.data.objects.new('Mon', None)
    B.link(root)
    blk = B.m_simple('MonBlack', (0.02, 0.02, 0.022), rough=0.35)
    alu = B.m_metal('Stand', (0.7, 0.7, 0.72), rough=0.3)
    W, H = 0.615, 0.36
    body = B.box((W, 0.02, H), (0, 0.0, 0.0), mat=blk, bevel=0.004)
    sw, sh = 0.597, 0.336
    scr = B.rounded_face(sw, sh, 0.001, B.m_screen('MonScreen'), name='MonScreen', uv_rect=(sw, sh))
    scr.rotation_euler = (math.radians(90), 0, 0)
    scr.location = (0, -0.0102, 0.006)
    neck = B.box((0.05, 0.02, 0.3), (0, 0.04, -0.12), rot=(-8, 0, 0), mat=alu, bevel=0.003)
    foot = B.rounded_slab(0.24, 0.17, 0.008, 0.02, alu, bevel=0.002, name='Foot')
    foot.location = (0, 0.06, -0.335)
    for p in (body, scr, neck, foot):
        p.parent = root
    root.location = (0, 0.15, 0.335)
    kbm = B.m_simple('KB', (0.85, 0.85, 0.86), rough=0.5)
    kb = B.rounded_slab(0.36, 0.12, 0.008, 0.006, B.m_metal('KbAlu', (0.75, 0.75, 0.77), rough=0.35), name='Keyboard')
    kb.location = (-0.03, -0.18, 0)
    keys = B.bpy.data.objects.new('Keys', None)
    B.link(keys)
    keyboard_keys(keys, -0.198, -0.226, 19, 6, 0.0185, 0.016, kbm, 0.0085)
    B.box((0.06, 0.1, 0.03), (0.28, -0.18, 0.015), mat=kbm, bevel=0.012, segs=5)  # mouse-ish
    B.leaf_plant((0.45, 0.12, 0.0), height=0.32, n=12, pot_r=0.06, seed=12)
    B.mug_prop((-0.35, -0.12, 0), rot=30)
    B.camera((0.12, -0.95, 0.4), (0.0, 0.1, 0.33), lens=45, fstop=5.6)


@mockup('tv-living-room', 'TV in a living room', 'Devices', aspect=1.778, res=(1600, 1200), albedo=1.0, pct=50)
def tv():
    wall = B.m_plaster('Wall', color=(0.36, 0.38, 0.4))
    floor = B.m_wood('Floor', tone=(0.45, 0.32, 0.2), plank=1.6, rough=0.4, coat=0.3)
    B.room(wall, floor, size=(9, 9, 3.0), back_y=0.0)
    blk = B.m_simple('TVBlack', (0.015, 0.015, 0.017), rough=0.3)
    W, H = 1.45, 0.83
    B.box((W, 0.03, H), (0, -0.04, 1.35), mat=blk, bevel=0.004)
    sw, sh = 1.43, 0.804
    scr = B.rounded_face(sw, sh, 0.001, B.m_screen('TVScreen'), name='TVScreen', uv_rect=(sw, sh))
    scr.rotation_euler = (math.radians(90), 0, 0)
    scr.location = (0, -0.0552, 1.35)
    cab = B.m_wood('Console', tone=(0.4, 0.27, 0.17), axis='X', rough=0.4)
    B.box((2.0, 0.42, 0.45), (0, -0.25, 0.27), mat=cab, bevel=0.006)
    for x in (-0.95, 0.95):
        B.cylinder(0.02, 0.05, (x, -0.25, 0.025), mat=blk)
    B.leaf_plant((-0.75, -0.25, 0.495), height=0.35, n=12, pot_r=0.07, seed=31)
    B.box((0.26, 0.2, 0.06), (0.65, -0.25, 0.525), mat=B.m_linen('Books', (0.6, 0.25, 0.15), 900), bevel=0.003)
    B.leaf_plant((1.6, -0.35, 0.0), height=1.1, n=20, pot_r=0.17, seed=13, leaf_len=0.32)
    B.world_color((0.75, 0.8, 0.9), 0.2)
    B.area_light((-2.0, -2.0, 2.4), (0, 0, 1), size=2.5, power=60, color=(1, 0.85, 0.7))
    B.area_light((1.5, -4, 1.6), (0, 0, 1), size=3, power=25)
    B.point_light((-0.9, -0.25, 0.75), power=8, radius=0.05)
    B.camera((0.7, -3.0, 1.2), (0.0, 0.0, 1.05), lens=32)
