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
