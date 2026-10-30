from . import mockup
import blib as B
import math


def frame(w, h, depth=0.03, border=0.025, mat_border=0.0, loc=(0, 0, 0), frame_mat=None, paper_mat=None,
          glass=True, mount_mat=None):
    """Picture frame hanging on a wall plane y = loc.y (facing -Y). Print area w x h centred at loc."""
    x, y, z = loc
    fm = frame_mat or B.m_wood('FrameWood', tone=(0.05, 0.04, 0.035), rough=0.5, coat=0.1)
    W = w + 2 * mat_border + 2 * border
    H = h + 2 * mat_border + 2 * border
    t = border
    for (sx, sz, px, pz) in [(W, t, 0, H / 2 - t / 2), (W, t, 0, -H / 2 + t / 2),
                             (t, H - 2 * t, W / 2 - t / 2, 0), (t, H - 2 * t, -W / 2 + t / 2, 0)]:
        B.box((sx, depth, sz), (x + px, y - depth / 2, z + pz), mat=fm, bevel=0.002)
    if mat_border:
        mm = mount_mat or B.m_paper('Mount', color=(0.88, 0.88, 0.86), printable=False)
        B.box((W - 2 * t + 0.002, 0.004, H - 2 * t + 0.002), (x, y - 0.006, z), mat=mm)
        # bevelled window edge of mount
    pm = paper_mat or B.m_paper('PosterPaper', color=(0.85, 0.85, 0.84))
    p = B.plane(w, h, (x, y - 0.0085, z), rot=(90, 0, 0), mat=pm, name='Print')
    if glass:
        g = B.plane(W - 2 * t, H - 2 * t, (x, y - depth + 0.004, z), rot=(90, 0, 0),
                    mat=B.m_window_glass('FrameGlass', reflect=0.08, tint_rgb=(0.97, 0.98, 0.97)), name='Glass')
    return p


@mockup('poster-frame-wall', 'Framed poster', 'Print', aspect=0.707, res=(1280, 1600), albedo=0.85)
def poster_frame_wall():
    wall = B.m_plaster('Wall', color=(0.78, 0.76, 0.72))
    floor = B.m_wood('Floor', tone=(0.5, 0.34, 0.2), plank=2.0, rough=0.4, coat=0.3)
    B.room(wall, floor, size=(8, 8, 3.0), back_y=0.0)
    frame((0.5, 0.707)[0], 0.707, depth=0.03, border=0.022, mat_border=0.06, loc=(0, 0, 1.55))
    # sideboard
    sb = B.m_wood('Oak', tone=(0.55, 0.38, 0.22), rough=0.4, coat=0.2)
    B.box((1.6, 0.42, 0.6), (0, -0.22, 0.32), mat=sb, bevel=0.006)
    leg = B.m_simple('Leg', (0.03, 0.03, 0.03), rough=0.4)
    for sx in (-0.75, 0.75):
        for sy in (-0.06, -0.38):
            B.cylinder(0.015, 0.06, (sx, sy, 0.03), mat=leg)
    B.leaf_plant((-0.55, -0.2, 0.62), height=0.45, n=12, pot_r=0.075, seed=5)
    vase = B.m_ceramic('Vase', color=(0.2, 0.25, 0.22), printable=False, tint=False)
    B.lathe('Vase', [(0, 0), (0.05, 0), (0.07, 0.08), (0.05, 0.2), (0.025, 0.26), (0.03, 0.28), (0, 0.28)], 64, vase).location = (0.5, -0.2, 0.62)
    book = B.m_simple('Book', (0.55, 0.2, 0.12), rough=0.6)
    B.box((0.22, 0.16, 0.035), (0.2, -0.2, 0.638), mat=book, bevel=0.002)
    B.box((0.2, 0.15, 0.03), (0.21, -0.2, 0.67), rot=(0, 0, 6), mat=B.m_simple('Book2', (0.8, 0.78, 0.7), rough=0.6), bevel=0.002)
    B.world_color((0.75, 0.8, 0.9), 0.3)
    B.sun_light((-1.0, -0.7, 0.55), strength=3.5, angle=2.0)
    B.window_gobo((-2.0, -1.4, 2.6), (-1.0, -0.7, 0.55), w=1.6, h=2.0, panes=(2, 2), bar=0.07)
    B.area_light((0.5, -3.5, 2.0), (0, 0, 1.3), size=3, power=500, color=(1, 0.97, 0.93))
    B.camera((0.25, -3.1, 1.35), (0, 0, 1.25), lens=45)


def desk(top=None, sun_dir=(-0.9, 0.6, 1.0), sun=3.2, gobo=True, wall=True, fill=250, world=0.35,
         wall_color=(0.75, 0.74, 0.71)):
    top = top or B.m_wood('Desk', tone=(0.62, 0.46, 0.3), axis='X', rough=0.35, scale=1.0)
    B.plane(8, 8, (0, 0, 0), mat=top, name='Desk')
    if wall:
        B.plane(10, 5, (0, 2.5, 2.0), rot=(90, 0, 0), mat=B.m_plaster('BackWall', color=wall_color))
    B.world_color((0.78, 0.84, 0.95), world)
    if sun:
        B.sun_light(sun_dir, sun, angle=1.5)
        if gobo:
            d = B.Vector(sun_dir).normalized()
            B.window_gobo(tuple(d * 1.6), sun_dir, w=1.1, h=1.4, panes=(2, 2), bar=0.06)
    if fill:
        B.area_light((1.2, -1.8, 2.2), (0, 0, 0), size=2.5, power=fill, color=(0.95, 0.97, 1.0))


def paper_back(color=(0.86, 0.86, 0.85)):
    return B.m_paper('PaperBack', color=color, printable=False)


@mockup('business-cards', 'Business cards', 'Print', aspect=1.75, res=(1600, 1200), albedo=0.85)
def business_cards():
    desk(top=B.m_marble('Marble', color=(0.8, 0.8, 0.79)), sun_dir=(-0.7, 0.9, 1.1), sun=3.5)
    w, h = 0.0889, 0.0508
    front = B.m_paper('Card', color=(0.86, 0.86, 0.85), rough=0.55, fiber=0.08)
    back = paper_back()
    B.sheet(w, h, 0.0004, (0.012, -0.004, 0.0024), rot=(0, 0, -8), front=front, back=back, name='CardTop')
    # stack beneath
    stack = B.m_paper('Stack', color=(0.84, 0.84, 0.83), printable=False, fiber=0.1)
    for k in range(5):
        B.sheet(w, h, 0.0004, (0.06 + k * 0.0003, 0.03 - k * 0.0002, 0.0004 * (k + 0) + 0.0004),
                rot=(0, 0, 14 + k * 0.6), front=stack, back=stack, name='CardS')
    B.sheet(w, h, 0.0004, (-0.05, 0.05, 0.0004), rot=(0, 0, 25), front=stack, back=stack, name='CardB')
    B.pen_prop((-0.06, -0.055, 0), rot=-28, color=(0.08, 0.08, 0.09))
    B.leaf_plant((0.17, 0.12, 0.0), height=0.18, n=9, pot_r=0.035, seed=11, leaf_len=0.07)
    B.camera((0.02, -0.2, 0.17), (0.02, 0.012, 0.0), lens=58, fstop=4.0, focus=None)


@mockup('magazine-cover', 'Magazine cover', 'Print', aspect=0.75, res=(1600, 1280), albedo=0.85)
def magazine():
    desk(top=B.m_wood('Coffee', tone=(0.35, 0.22, 0.13), axis='X', rough=0.3, coat=0.4), sun_dir=(0.8, 0.9, 1.0),
         sun=3.5)
    w, h = 0.21, 0.28
    gloss = B.m_paper('Gloss', color=(0.86, 0.86, 0.85), rough=0.25, fiber=0.02, gloss=0.6)
    back = paper_back()

    def warp(x, y, s, t):
        z = 0.004 * (1 - s) ** 3 + 0.0015 * math.sin(math.pi * t) * s
        # lifted bottom-right corner
        z += 0.012 * max(0, s - 0.7) ** 2 / 0.09 * max(0, 0.3 - t) ** 2 / 0.09
        return x, y, z
    B.sheet(w, h, 0.0002, (0.0, 0.0, 0.004), rot=(0, 0, 10), front=gloss, back=back, nx=40, ny=40, warp=warp,
            name='Cover')
    pages = B.m_paper('Pages', color=(0.83, 0.83, 0.81), printable=False, fiber=0.0)
    pb = B.box((w - 0.002, h - 0.002, 0.0038), (0, 0, 0.0019), rot=(0, 0, 10), mat=pages, bevel=0.0008)
    # another magazine beneath, offset
    other = B.m_simple('Mag2', (0.6, 0.15, 0.1), rough=0.3)
    B.box((w, h, 0.004), (0.09, 0.08, -0.0018 + 0.0), rot=(0, 0, 24), mat=other, bevel=0.0008)
    B.mug_prop((0.22, 0.12, 0.0), rot=200)
    B.camera((0.05, -0.42, 0.42), (0.02, 0.0, 0.0), lens=50, fstop=5.6)


@mockup('book-hardcover', 'Hardcover book', 'Print', aspect=0.667, res=(1600, 1600), albedo=0.85)
def book():
    desk(top=B.m_wood('Shelf', tone=(0.6, 0.47, 0.33), axis='X', rough=0.4), sun_dir=(-0.6, -0.4, 0.8), sun=3.0,
         wall_color=(0.55, 0.6, 0.58))
    w, h, T = 0.16, 0.24, 0.032
    board = 0.0028
    cover = B.m_paper('CoverPrint', color=(0.86, 0.86, 0.85), rough=0.45, fiber=0.03)
    cloth = B.m_linen('BookCloth', color=(0.12, 0.13, 0.16), scale=1500, strength=0.2)
    pages = B.m_wood('PageEdge', tone=(0.86, 0.84, 0.78), axis='Y', scale=40, rough=0.8, coat=0.0, light=1.05)
    root = B.bpy.data.objects.new('Book', None)
    B.link(root)
    # front cover: printed sheet with board thickness, faces -Y. local: X right, Y up, +Z out
    fc = B.sheet(w, h, board, (0.003, -T / 2 + 0.0, h / 2), rot=(90, 0, 0), front=cover, back=cloth, name='Front')
    fc.location.y = -T / 2
    bc = B.box((w, board, h), (0.003, T / 2 - board / 2, h / 2), mat=cloth, bevel=0.0008)
    pb = B.box((w - 0.006, T - 2 * board, h - 0.008), (0.0, 0, h / 2), mat=pages, bevel=0.0006)
    # rounded spine at x = -w/2
    sp = B.cylinder(T / 2, h, (-w / 2 + 0.003, 0, h / 2), mat=cloth, verts=48)
    sp.scale = (0.45, 1, 1)
    for o in (fc, bc, pb, sp):
        o.parent = root
    root.rotation_euler = (0, 0, math.radians(-28))
    root.location = (0.0, 0.0, 0.0)
    # a lying book behind
    B.box((0.15, 0.22, 0.035), (0.2, 0.18, 0.0175), rot=(0, 0, 70), mat=B.m_linen('B2', (0.55, 0.2, 0.15), 1200),
          bevel=0.002)
    B.leaf_plant((-0.24, 0.2, 0.0), height=0.35, n=12, pot_r=0.06, seed=4)
    B.camera((0.12, -0.62, 0.2), (0.0, 0.0, 0.12), lens=60, fstop=4.0)


@mockup('greeting-card', 'Greeting card', 'Print', aspect=0.7, res=(1600, 1600), albedo=0.85)
def greeting():
    desk(top=B.m_linen('Cloth', color=(0.82, 0.8, 0.75), scale=700), sun_dir=(0.7, -0.3, 0.8), sun=3.0,
         wall_color=(0.85, 0.8, 0.75))
    w, h = 0.125, 0.178
    front = B.m_paper('CardFront', color=(0.86, 0.86, 0.85), rough=0.6, fiber=0.1)
    back = paper_back()
    lean = 8
    # front panel standing, hinge on its left edge at x=-w/2
    fp = B.sheet(w, h, 0.0004, (0, 0, h / 2), rot=(90 - lean, 0, 0), front=front, back=back, name='CardFront')
    hinge = B.Vector((-w / 2, 0, 0))
    bp = B.sheet(w, h, 0.0004, (0, 0, 0), rot=(0, 0, 0), front=back, back=back, name='CardIn')
    root = B.bpy.data.objects.new('Hinge', None)
    B.link(root)
    root.location = (-w / 2, 0.0, 0)
    bp.parent = root
    bp.location = (w / 2, 0, h / 2)
    bp.rotation_euler = (math.radians(90 - lean), 0, 0)
    root.rotation_euler = (0, 0, math.radians(55))
    # envelope lying
    env = B.m_paper('Env', color=(0.7, 0.55, 0.42), printable=False)
    B.sheet(0.19, 0.135, 0.0006, (0.13, -0.05, 0.0006), rot=(0, 0, -12), front=env, back=env)
    B.camera((0.06, -0.55, 0.16), (0.0, 0.0, 0.085), lens=70, fstop=4.0)


@mockup('letterhead-desk', 'Letterhead A4', 'Print', aspect=0.707, res=(1280, 1600), albedo=0.85)
def letterhead():
    desk(top=B.m_wood('Walnut', tone=(0.32, 0.2, 0.12), axis='Y', rough=0.35, coat=0.3), sun_dir=(-0.8, 0.5, 1.0),
         sun=3.8, wall=False)
    w, h = 0.21, 0.297
    front = B.m_paper('A4', color=(0.86, 0.86, 0.85), rough=0.65, fiber=0.05)
    back = paper_back()

    def warp(x, y, s, t):
        return x, y, 0.0025 * (1 - math.cos(math.pi * (s - 0.5))) * 0.5 + 0.004 * max(0, t - 0.88) ** 2 / 0.0144
    B.sheet(w, h, 0.0001, (0, 0, 0.0003), rot=(0, 0, -4), front=front, back=back, nx=24, ny=24, warp=warp)
    B.sheet(w, h, 0.0001, (0.012, 0.01, 0.0001), rot=(0, 0, 3), front=back, back=back, name='Under')
    B.pen_prop((0.14, -0.03, 0.0), rot=72)
    B.mug_prop((0.2, 0.16, 0.0), rot=150)
    nb = B.m_linen('Notebook', (0.15, 0.25, 0.3), 1000)
    B.box((0.15, 0.21, 0.012), (-0.2, 0.14, 0.006), rot=(0, 0, 15), mat=nb, bevel=0.002)
    B.camera((0.0, -0.06, 0.62), (0.0, 0.005, 0.0), lens=42)


@mockup('menu-table', 'Restaurant menu', 'Print', aspect=0.47, res=(1600, 1280), albedo=0.85)
def menu():
    desk(top=B.m_wood('Table', tone=(0.45, 0.3, 0.18), plank=3.0, axis='X', rough=0.4, coat=0.15),
         sun_dir=(0.5, 1.0, 0.7), sun=3.0, gobo=False, wall=False, fill=120)
    B.bokeh_lights((0, 3.5, 1.2), n=30, spread=(3, 0.5, 0.6), strength=25)
    w, h = 0.1, 0.212
    front = B.m_paper('Menu', color=(0.86, 0.86, 0.85), rough=0.6, fiber=0.08)
    back = paper_back()
    B.sheet(w, h, 0.0005, (0.0, 0.0, 0.0006), rot=(0, 0, -6), front=front, back=back)
    B.plate_prop((0.2, 0.02, 0.0))
    B.cutlery_knife((0.075, -0.005, 0.0), rot=88, length=0.21)
    B.glass_prop((0.16, 0.2, 0.0))
    B.glass_prop((-0.13, 0.17, 0.0), kind='tumbler')
    nap = B.m_linen('Napkin', (0.75, 0.73, 0.68), 700)
    B.box((0.12, 0.2, 0.006), (-0.16, -0.02, 0.003), rot=(0, 0, 4), mat=nap, bevel=0.002)
    B.point_light((0.0, 0.2, 0.7), power=25, radius=0.1, color=(1, 0.8, 0.6))
    B.camera((0.02, -0.38, 0.38), (0.03, 0.03, 0.0), lens=45, fstop=2.8)
    B.world_color((0.5, 0.42, 0.35), 0.4)


def sofa(x=0.0, y=-0.5, color=(0.25, 0.3, 0.36)):
    fab = B.m_linen('SofaFab', color=color, scale=500, strength=0.4)
    W = 2.1
    B.box((W, 0.85, 0.22), (x, y, 0.27), mat=fab, bevel=0.03, segs=4)
    for k in range(3):
        c = B.box((W / 3 - 0.02, 0.62, 0.14), (x - W / 3 + k * W / 3, y - 0.08, 0.45), mat=fab, bevel=0.05, segs=5)
        B.subsurf(c, 1)
    for k in range(3):
        c = B.box((W / 3 - 0.03, 0.2, 0.45), (x - W / 3 + k * W / 3, y + 0.3, 0.68), rot=(-10, 0, 0), mat=fab,
                  bevel=0.07, segs=5)
        B.subsurf(c, 1)
    for s in (-1, 1):
        B.box((0.18, 0.85, 0.55), (x + s * (W / 2 + 0.06), y, 0.42), mat=fab, bevel=0.06, segs=5)
    leg = B.m_wood('SofaLeg', tone=(0.3, 0.18, 0.1))
    for sx in (-1, 1):
        for sy in (-1, 1):
            B.cylinder(0.022, 0.16, (x + sx * (W / 2 + 0.05), y + sy * 0.36, 0.08), mat=leg)
    pil = B.m_linen('Pillow', (0.75, 0.55, 0.35), 700)
    p = B.box((0.42, 0.14, 0.42), (x - 0.7, y + 0.12, 0.72), rot=(-12, 0, 12), mat=pil, bevel=0.06, segs=5)
    B.subsurf(p, 2)


@mockup('poster-room', 'Poster in a living room', 'Print', aspect=0.75, res=(1600, 1200), albedo=0.85)
def poster_room():
    wall = B.m_plaster('Wall', color=(0.62, 0.66, 0.62))
    floor = B.m_wood('Floor', tone=(0.55, 0.4, 0.26), plank=1.6, rough=0.4, coat=0.3)
    B.room(wall, floor, size=(9, 9, 3.0), back_y=0.0, side=False)
    frame(0.75, 1.0, depth=0.035, border=0.022, mat_border=0.0, loc=(0.0, 0.0, 1.62), glass=False,
          frame_mat=B.m_wood('LightFrame', tone=(0.72, 0.56, 0.38), rough=0.5))
    sofa(0.0, -0.48)
    rug = B.m_linen('Rug', (0.78, 0.74, 0.66), 250, 0.6)
    B.box((2.6, 1.8, 0.01), (0.2, -1.4, 0.005), mat=rug, bevel=0.004)
    # floor lamp
    blk = B.m_metal('Black', (0.03, 0.03, 0.03), rough=0.4)
    B.cylinder(0.012, 1.5, (1.55, -0.3, 0.75), mat=blk)
    B.cylinder(0.15, 0.015, (1.55, -0.3, 0.008), mat=blk)
    shade = B.m_linen('Shade', (0.85, 0.82, 0.75), 600)
    sh = B.lathe('Shade', [(0.16, 1.45), (0.12, 1.7)], 48, shade)
    B.solidify(sh, 0.003, 0)
    sh.location = (1.55, -0.3, 0)
    B.point_light((1.55, -0.3, 1.55), power=12, radius=0.05, color=(1, 0.8, 0.55))
    B.leaf_plant((-1.55, -0.25, 0.0), height=1.0, n=18, pot_r=0.16, seed=8, leaf_len=0.3)
    B.world_color((0.75, 0.82, 0.95), 0.4)
    B.sun_light((-1.0, -0.8, 0.6), strength=3.2, angle=2.0)
    B.window_gobo((-2.4, -2.0, 2.8), (-1.0, -0.8, 0.6), w=1.4, h=2.2, panes=(2, 3), bar=0.07)
    B.area_light((0.5, -4.5, 1.8), (0, 0, 1.2), size=4, power=700, color=(1, 0.97, 0.93))
    B.camera((0.6, -3.6, 1.3), (0.0, 0.0, 1.2), lens=30)
