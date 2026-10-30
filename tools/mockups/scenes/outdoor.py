from . import mockup
import blib as B
import math
import random


def m_clouds(name='Clouds', scale=0.004, cover=0.52, brightness=1.0):
    m, nb = B.new_mat(name)
    co = nb.coord('Object')
    mp = nb.node('ShaderNodeMapping', inputs={'Scale': (1, 2.5, 1), 'Vector': co})
    n = nb.noise(mp, scale=scale, detail=10, rough=0.62, dist=0.3)
    d = nb.math('MAP_RANGE' if False else 'SUBTRACT', n.outputs[0], cover)
    a = nb.math('MULTIPLY', d, 4.0, clamp=True)
    col = nb.mix(a, (0.75, 0.78, 0.85), (1.0, 1.0, 1.0))
    em = nb.node('ShaderNodeEmission', inputs={'Strength': brightness})
    nb._set(em.inputs['Color'], col)
    tr = nb.node('ShaderNodeBsdfTransparent')
    mx = nb.node('ShaderNodeMixShader')
    nb._set(mx.inputs[0], a)
    nb._set(mx.inputs[1], tr)
    nb._set(mx.inputs[2], em)
    nb.output(mx)
    return m


def sky(sun_dir=(-0.5, -1.0, 0.8), clouds=True, cloud_y=900, strength=1.0, cover=0.5, sun=5.0):
    """Physical sky without its sun disc + an explicit sun light from sun_dir + a far cloud sheet (camera-only)."""
    d = B.Vector(sun_dir).normalized()
    elev = math.degrees(math.asin(d.z))
    B.world_sky(sun_elev=elev, sun_rot=math.degrees(math.atan2(d.y, d.x)) - 90, strength=strength * 0.35, sun_disc=False)
    B.sun_light(sun_dir, sun, angle=0.6, color=(1.0, 0.95, 0.88))
    if clouds:
        c = B.plane(4000, 1200, (0, cloud_y, 300), rot=(90, 0, 0), mat=m_clouds(cover=cover, brightness=2.5 * strength),
                    name='Clouds')
        c.visible_shadow = False
        c.visible_diffuse = False
        c.visible_glossy = False


def ground(mat=None, size=4000):
    B.plane(size, size, (0, 0, 0), mat=mat or B.m_grass(), name='Ground')


def tree(loc, h=8.0, r=3.0, seed=0, leaf=None, trunk=None):
    rnd = random.Random(seed)
    leaf = leaf or B.m_leaf('TreeLeaf', (0.08, 0.16, 0.04))
    trunk = trunk or B.m_simple('Bark', (0.12, 0.09, 0.07), rough=0.9, bump=0.5, bump_scale=20)
    x, y, z = loc
    B.cylinder(r * 0.08, h * 0.6, (x, y, z + h * 0.3), mat=trunk, verts=12)
    for k in range(7):
        p = (x + rnd.uniform(-r, r) * 0.6, y + rnd.uniform(-r, r) * 0.6, z + h * 0.55 + rnd.uniform(0, h * 0.35))
        s = B.sphere(r * rnd.uniform(0.45, 0.7), p, mat=leaf)
        d = s.modifiers.new('D', 'DISPLACE')
        t = B.bpy.data.textures.new('Clouds%d' % seed, 'CLOUDS')
        t.noise_scale = r * 0.25
        d.texture = t
        d.strength = r * 0.35


def billboard(W, H, loc, rot_z=0.0, pole_h=8.0, lights=True, frame_mat=None):
    """Billboard face centred at loc (x, y, z), facing -Y before rot_z. Returns root."""
    root = B.bpy.data.objects.new('Billboard', None)
    B.link(root)
    steel = frame_mat or B.m_metal('Steel', (0.35, 0.36, 0.37), rough=0.5)
    paint = B.m_simple('FramePaint', (0.08, 0.08, 0.085), rough=0.5)
    vinyl = B.m_paper('Vinyl', color=(0.85, 0.85, 0.84), rough=0.5, fiber=0.0)
    parts = []
    parts.append(B.plane(W, H, (0, -0.06, 0), rot=(90, 0, 0), mat=vinyl, name='Face'))
    t = 0.18
    for sx, sz, px, pz in [(W + 2 * t, t, 0, H / 2 + t / 2), (W + 2 * t, t, 0, -H / 2 - t / 2),
                           (t, H, W / 2 + t / 2, 0), (t, H, -W / 2 - t / 2, 0)]:
        parts.append(B.box((sx, 0.25, sz), (px, 0.04, pz), mat=paint, bevel=0.01))
    parts.append(B.box((W + 0.2, 0.15, H + 0.2), (0, 0.12, 0), mat=paint))
    # back truss
    for k in range(-3, 4):
        parts.append(B.box((0.12, 0.12, H), (k * W / 7, 0.45, 0), mat=steel))
    parts.append(B.box((W, 0.1, 0.1), (0, 0.45, H / 2 - 0.3), mat=steel))
    parts.append(B.box((W, 0.1, 0.1), (0, 0.45, -H / 2 + 0.3), mat=steel))
    # catwalk
    parts.append(B.box((W, 0.9, 0.05), (0, -0.55, -H / 2 - 0.35), mat=steel))
    for k in range(0, 15):
        parts.append(B.cylinder(0.02, 0.9, (-W / 2 + k * W / 14, -0.95, -H / 2 + 0.1), mat=steel, verts=8))
    parts.append(B.cylinder(0.03, W, (0, -0.95, -H / 2 + 0.55), rot=(0, 90, 0), mat=steel, verts=8))
    if lights:
        for k in range(4):
            x = -W / 2 + W * (k + 0.5) / 4
            parts.append(B.cylinder(0.025, 1.3, (x, -0.7, -H / 2 - 0.1), rot=(-60, 0, 0), mat=steel, verts=8))
            parts.append(B.box((0.45, 0.2, 0.12), (x, -1.2, -H / 2 + 0.25), rot=(-35, 0, 0), mat=paint, bevel=0.02))
    # pole
    parts.append(B.cylinder(0.45, pole_h + 0.5, (0, 0.7, -H / 2 - pole_h / 2), mat=steel, verts=24))
    parts.append(B.box((1.6, 0.8, 0.3), (0, 0.7, -H / 2 - 0.1), mat=steel))
    for p in parts:
        p.parent = root
    root.location = loc
    root.rotation_euler = (0, 0, math.radians(rot_z))
    return root


@mockup('billboard-roadside', 'Roadside billboard', 'Outdoor', aspect=3.0, res=(1600, 1067), albedo=0.85,
        target=0.9)
def billboard_roadside():
    sky((-0.5, -1.0, 0.75), cover=0.5)
    ground(B.m_grass('Field', (0.16, 0.2, 0.07), scale=8))
    road = B.m_asphalt('Road')
    B.plane(16, 3000, (-14, 0, 0.02), mat=road, name='Road')
    line = B.m_simple('Line', (0.8, 0.8, 0.75), rough=0.6)
    for k in range(-30, 120):
        B.plane(0.15, 3, (-14, k * 9, 0.03), mat=line)
    B.plane(0.15, 3000, (-6.3, 0, 0.03), mat=line)
    billboard(12.0, 4.0, (0, 30, 11.0), rot_z=12)
    for k, (x, y) in enumerate([(-28, 140), (18, 90), (30, 160), (-40, 260), (55, 220), (8, 300), (-60, 400),
                                (90, 380), (-20, 500), (40, 520)]):
        tree((x, y, 0), h=random.Random(k).uniform(7, 12), r=random.Random(k).uniform(3, 5), seed=k)
    hill = B.grid_mesh('Hills', 60, 4, lambda s, t: ((s - 0.5) * 3000, 900 + t * 300,
                                                     40 * math.sin(s * 9) + 60 * math.sin(s * 3.3 + 1) * t + 30 * t),
                       mat=B.m_grass('HillGrass', (0.12, 0.17, 0.08), 0.02))
    B.camera((-10.5, -6, 1.7), (0.0, 30, 10.0), lens=45)


def m_facade(name='Facade', wall=(0.55, 0.42, 0.33), scale=0.5, glass=(0.08, 0.1, 0.12)):
    """Brick wall with a grid of windows (by object coords x/z in metres)."""
    m, nb = B.new_mat(name)
    co = nb.coord('Object')
    br = nb.node('ShaderNodeTexBrick', inputs={'Scale': 1.0, 'Mortar Size': 0.012, 'Color1': wall,
                                               'Color2': tuple(c * 0.8 for c in wall), 'Mortar': (0.6, 0.58, 0.55)})
    br.inputs['Brick Width'].default_value = 0.25
    br.inputs['Row Height'].default_value = 0.075
    sep = nb.node('ShaderNodeSeparateXYZ')
    nb._set(sep.inputs[0], co)
    hz = nb.math('ADD', sep.outputs['X'], sep.outputs['Y'])
    cmb = nb.node('ShaderNodeCombineXYZ')
    nb._set(cmb.inputs[0], hz)
    nb._set(cmb.inputs[1], sep.outputs['Z'])
    nb._set(br.inputs['Vector'], cmb)
    # window mask: horizontal period 3.0 (window 1.6 wide), z period 3.2 (window 1.9 tall)
    fx = nb.math('FRACT', nb.math('DIVIDE', hz, 3.0))
    fz = nb.math('FRACT', nb.math('DIVIDE', sep.outputs['Z'], 3.2))
    wx = nb.math('MULTIPLY', nb.math('GREATER_THAN', fx, 0.23), nb.math('LESS_THAN', fx, 0.77))
    wz = nb.math('MULTIPLY', nb.math('GREATER_THAN', fz, 0.25), nb.math('LESS_THAN', fz, 0.85))
    win = nb.math('MULTIPLY', wx, wz)
    wall_b = nb.bsdf(color=br.outputs['Color'], rough=0.85,
                     normal=nb.bump(nb.math('SUBTRACT', 1.0, br.outputs['Fac']), strength=0.4, distance=0.01))
    glass_b = nb.bsdf(color=glass, rough=0.05, metal=0.6, spec=1.0)
    mx = nb.node('ShaderNodeMixShader')
    nb._set(mx.inputs[0], win)
    nb._set(mx.inputs[1], wall_b)
    nb._set(mx.inputs[2], glass_b)
    nb.output(mx)
    return m


def street(width=12.0, length=400.0, sidewalk=3.5):
    road = B.m_asphalt('Road')
    B.plane(width, length, (0, 0, 0), mat=road, name='Road')
    sw = B.m_concrete('Sidewalk', color=(0.55, 0.54, 0.52), scale=2, strength=0.2)
    for s in (-1, 1):
        B.box((sidewalk, length, 0.15), (s * (width / 2 + sidewalk / 2), 0, 0.075), mat=sw)
        B.box((0.25, length, 0.16), (s * (width / 2 + 0.12), 0, 0.08), mat=B.m_concrete('Curb', (0.62, 0.62, 0.6), 4))


def buildings(side, x0, ys, seed=1, depth=12):
    rnd = random.Random(seed)
    cols = [(0.55, 0.42, 0.33), (0.62, 0.58, 0.52), (0.45, 0.35, 0.3), (0.7, 0.66, 0.6), (0.4, 0.42, 0.45)]
    out = []
    for i, (y0, y1) in enumerate(ys):
        h = rnd.uniform(10, 28)
        mat = m_facade('Fac%d_%d' % (seed, i), wall=rnd.choice(cols))
        o = B.box((depth, y1 - y0, h), (x0 + side * depth / 2, (y0 + y1) / 2, h / 2), mat=mat)
        out.append(o)
    return out


@mockup('billboard-city', 'City billboard', 'Outdoor', aspect=1.5, res=(1600, 1200), albedo=0.85, target=0.9)
def billboard_city():
    sky((1.0, -0.6, 1.5), cover=0.55)
    street()
    buildings(-1, -9.5, [(-40, -20), (-20, -2), (14, 30), (30, 52), (52, 80)], seed=2)
    buildings(1, 9.5, [(-40, -15), (-15, 5), (5, 25), (25, 50), (50, 90)], seed=3)
    # side wall facing the street (-X) on the left building gap
    wall = B.box((0.5, 16, 24), (-9.6, 6, 12), mat=m_facade('BigWall', wall=(0.6, 0.55, 0.5)))
    root = B.bpy.data.objects.new('BB', None)
    B.link(root)
    W, H = 10.5, 7.0
    face = B.plane(W, H, (0, -0.15, 0), rot=(90, 0, 0), mat=B.m_paper('Vinyl', rough=0.45, fiber=0.0), name='Face')
    paint = B.m_simple('FramePaint', (0.12, 0.12, 0.13), rough=0.5)
    fr = []
    t = 0.25
    for sx, sz, px, pz in [(W + 2 * t, t, 0, H / 2 + t / 2), (W + 2 * t, t, 0, -H / 2 - t / 2),
                           (t, H, W / 2 + t / 2, 0), (t, H, -W / 2 - t / 2, 0)]:
        fr.append(B.box((sx, 0.35, sz), (px, -0.05, pz), mat=paint, bevel=0.01))
    for o in [face] + fr:
        o.parent = root
    root.rotation_euler = (0, 0, math.radians(90))
    root.location = (-9.3, 6, 13.5)
    B.camera((4.5, -14, 1.7), (-9.3, 6, 12.5), lens=24)


def poster_case(W, H, mat_frame, depth=0.06, glass=True):
    """Lightbox / poster case: print + frame + glass pane (glass lets AOVs through). Face -Y. Returns root."""
    root = B.bpy.data.objects.new('Case', None)
    B.link(root)
    parts = [B.plane(W, H, (0, 0, 0), rot=(90, 0, 0), mat=B.m_paper('PosterP', rough=0.5, fiber=0.0), name='Print')]
    t = 0.05
    for sx, sz, px, pz in [(W + 2 * t, t, 0, H / 2 + t / 2), (W + 2 * t, t, 0, -H / 2 - t / 2),
                           (t, H, W / 2 + t / 2, 0), (t, H, -W / 2 - t / 2, 0)]:
        parts.append(B.box((sx, depth, sz), (px, -depth / 2 + 0.02, pz), mat=mat_frame, bevel=0.005))
    parts.append(B.box((W + 2 * t, 0.05, H + 2 * t), (0, 0.04, 0), mat=mat_frame))
    if glass:
        parts.append(B.plane(W, H, (0, -depth + 0.02, 0), rot=(90, 0, 0),
                             mat=B.m_window_glass('CaseGlass', reflect=0.15), name='Glass'))
    for p in parts:
        p.parent = root
    return root


@mockup('bus-stop', 'Bus stop poster', 'Outdoor', aspect=0.677, res=(1280, 1600), albedo=0.85, target=0.92)
def bus_stop():
    sky((-0.35, -1.0, 1.0), cover=0.5)
    street(width=10, sidewalk=4.5)
    buildings(1, 9.5, [(-40, -18), (-18, 2), (2, 22), (22, 50)], seed=5)
    buildings(-1, -9.5, [(-40, -10), (-10, 12), (12, 40)], seed=6)
    alu = B.m_metal('ShelterAlu', (0.55, 0.56, 0.58), rough=0.35)
    gl = B.m_window_glass('ShelterGlass', reflect=0.2, tint_rgb=(0.92, 0.96, 0.95))
    # shelter along y at x = 7.5 (sidewalk), poster panel at its end facing -Y
    x0, y0 = 7.0, 4.0
    for dy in (0.0, 3.6):
        for dx in (0.0, 1.5):
            B.box((0.08, 0.08, 2.5), (x0 + dx, y0 + dy, 1.25 + 0.15), mat=alu)
    B.box((1.8, 3.9, 0.08), (x0 + 0.75, y0 + 1.8, 2.66), mat=alu, bevel=0.01)
    B.plane(3.6, 2.0, (x0 + 1.5, y0 + 1.8, 1.3), rot=(90, 0, 90), mat=gl)
    B.box((0.5, 3.4, 0.05), (x0 + 1.2, y0 + 1.8, 0.62), mat=alu)  # bench
    case = poster_case(1.185, 1.75, alu)
    case.location = (x0 + 0.75, y0 - 0.05, 1.25)
    B.box((1.5, 0.12, 2.2), (x0 + 0.75, y0 + 0.06, 1.25), mat=alu)
    B.camera((5.0, -1.4, 1.55), (x0 + 0.72, y0, 1.28), lens=50, fstop=4)


@mockup('a-frame-sign', 'Sidewalk A-frame sign', 'Outdoor', aspect=0.707, res=(1280, 1600), albedo=0.85,
        target=0.92)
def a_frame():
    sky((-0.3, -1.0, 1.1), cover=0.5)
    street(width=10, sidewalk=5)
    blds = buildings(1, 10.0, [(-40, -6), (-6, 8), (8, 30)], seed=7)
    # shop front: dark glass + awning at the building beside the sign
    B.box((0.1, 5, 2.6), (9.95, 1.0, 1.45), mat=B.m_window_glass('Shop', 0.3, (0.3, 0.32, 0.33)))
    B.box((0.2, 5.4, 0.4), (9.9, 1.0, 3.0), mat=B.m_simple('Fascia', (0.08, 0.15, 0.12), rough=0.5))
    B.box((1.2, 5.4, 0.05), (9.4, 1.0, 3.2), rot=(0, -15, 0), mat=B.m_linen('Awning', (0.12, 0.3, 0.22), 300))
    B.plane(0.1, 5, (10.0, 1.0, 1.45), rot=(0, 90, 0), mat=B.m_simple('ShopIn', (0.05, 0.04, 0.035), rough=0.6))
    # A-frame: two boards leaning, front face toward camera (-Y-ish)
    wood = B.m_wood('Board', tone=(0.12, 0.1, 0.08), rough=0.5)
    W, H = 0.6, 0.85
    root = B.bpy.data.objects.new('AFrame', None)
    B.link(root)
    ang = 12
    hinge = B.bpy.data.objects.new('Front', None)
    B.link(hinge)
    hinge.parent = root
    hinge.location = (0, 0, 1.0)
    hinge.rotation_euler = (math.radians(-ang), 0, 0)
    fb = B.box((W + 0.08, 0.025, 1.0), (0, 0, -0.5), mat=wood, bevel=0.004)
    fb.parent = hinge
    pp = B.plane(W, H, (0, -0.0131, -0.5), rot=(90, 0, 0), mat=B.m_paper('APoster', rough=0.4, fiber=0.0),
                 name='Print')
    pp.parent = hinge
    bb = B.box((W + 0.08, 0.025, 1.0), (0, 0, -0.5), mat=wood, bevel=0.004)
    hb = B.bpy.data.objects.new('Back', None)
    B.link(hb)
    hb.parent = root
    hb.location = (0, 0, 1.0)
    hb.rotation_euler = (math.radians(ang), 0, 0)
    bb.parent = hb
    root.location = (7.8, 1.2, 0.15 + 0.0)
    root.location.z = 0.15 - (1.0 - 1.0 * math.cos(math.radians(ang)))
    root.rotation_euler = (0, 0, math.radians(20))
    B.camera((6.6, -1.3, 0.85), (7.8, 1.2, 0.62), lens=50, fstop=2.8)


@mockup('storefront-poster', 'Storefront window poster', 'Outdoor', aspect=0.707, res=(1280, 1600), albedo=0.85,
        target=0.92)
def storefront():
    sky((-1.0, -0.5, 1.3), cover=0.5)
    street(width=10, sidewalk=5)
    buildings(-1, -10.0, [(-40, -5), (-5, 20)], seed=9)
    # shop facade plane at x = 10 facing -X: frame + big window
    fac = B.m_simple('ShopPaint', (0.75, 0.72, 0.65), rough=0.6, bump=0.2, bump_scale=30)
    B.box((0.3, 8, 4.5), (10.3, 0, 2.25), mat=fac)
    gl = B.m_window_glass('ShopWin', reflect=0.12, tint_rgb=(0.85, 0.9, 0.9))
    frame = B.m_simple('Mullion', (0.06, 0.07, 0.07), rough=0.4)
    # window opening: cut by making the facade in pieces
    B.bpy.data.objects.remove(B.bpy.data.objects[-1]) if False else None
    for o in list(B.bpy.data.objects):
        if o.name.startswith('Box') and abs(o.location.x - 10.3) < 0.01:
            B.bpy.data.objects.remove(o)
    B.box((0.3, 8, 1.4), (10.3, 0, 3.8), mat=fac)
    B.box((0.3, 8, 0.6), (10.3, 0, 0.45), mat=fac)
    B.box((0.3, 1.0, 2.5), (10.3, -3.5, 2.0), mat=fac)
    B.box((0.3, 3.0, 2.5), (10.3, 2.5, 2.0), mat=fac)
    B.plane(6.0, 2.5, (10.2, -0.5, 2.0), rot=(90, 0, 90), mat=gl, name='Window')
    for y in (-3.0, 1.0):
        B.box((0.1, 0.08, 2.5), (10.2, y, 2.0), mat=frame)
    for z in (0.75, 3.25):
        B.box((0.1, 4.0, 0.08), (10.2, -1.0, z), mat=frame)
    # interior: dark room with shelves, lights
    B.box((0.1, 8, 4.5), (14, 0, 2.25), mat=B.m_simple('In', (0.25, 0.22, 0.2), rough=0.8))
    B.box((3.5, 8, 0.1), (12, 0, 0.75), mat=B.m_wood('InFloor', (0.35, 0.25, 0.18)))
    for k in range(3):
        B.box((0.4, 2.5, 1.6), (13.5, -2 + k * 2.2, 1.6), mat=B.m_wood('Shelf%d' % k, (0.5, 0.36, 0.22)))
    B.point_light((12.5, -1, 3.5), power=200, radius=0.3, color=(1, 0.85, 0.65))
    # poster taped inside the glass, facing street (-X)
    pp = B.plane(0.7, 0.99, (10.18, -0.9, 1.95), rot=(90, 0, -90), mat=B.m_paper('WinPoster', rough=0.5), name='Print')
    tape = B.m_simple('Tape', (0.9, 0.9, 0.85), rough=0.3)
    for dy, dz in ((-0.35, 0.495), (0.35, 0.495), (-0.35, -0.495), (0.35, -0.495)):
        B.box((0.001, 0.06, 0.02), (10.178, -0.9 - dy, 1.95 + dz), rot=(45 if dy * dz > 0 else -45, 0, 0), mat=tape)
    B.camera((6.6, -3.2, 1.65), (10.18, -0.9, 1.9), lens=50, fstop=4)


@mockup('building-banner', 'Building banner', 'Outdoor', aspect=0.333, res=(1200, 1600), albedo=0.85, target=0.92)
def building_banner():
    sky((-0.5, -1.0, 1.3), cover=0.5)
    street()
    buildings(-1, -9.5, [(-40, -10), (-10, 25), (25, 60)], seed=11)
    fac = m_facade('MainFac', wall=(0.72, 0.68, 0.6))
    B.box((12, 30, 26), (9.5 + 6, 10, 13), mat=fac)
    # vertical banner on a bracket, sticking out from the facade at x=9.5
    steel = B.m_metal('Bracket', (0.2, 0.2, 0.21), rough=0.4)
    W, H = 2.4, 7.2
    for z in (16.2, 8.8):
        B.cylinder(0.04, W + 0.6, (9.5 - (W + 0.6) / 2, 6.0, z), rot=(0, 90, 0), mat=steel, verts=12)

    def warp(x, y, s, t):
        return x, y, 0.03 * math.sin(math.pi * t) * math.sin(math.pi * s * 1.0) + 0.015 * math.sin(s * 9 + t * 5)
    vinyl = B.m_paper('BannerVinyl', rough=0.45, fiber=0.0)
    ban = B.sheet(W, H, 0.002, (9.5 - 0.35 - W / 2, 6.0, 12.5), rot=(90, 0, 0), front=vinyl,
                  back=B.m_paper('BannerBack', printable=False), nx=20, ny=50, warp=warp)
    B.camera((2.0, -9.0, 1.7), (8.2, 6.0, 12.0), lens=35)
