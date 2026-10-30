"""Blender helpers for the mockup generator (runs inside Blender's Python).

Every scene builds ONE print surface whose material carries the `pc` AOV
(u*c, v*c, c) — premultiplied print UV plus coverage — and product-body
materials carry the `tint` AOV. One Cycles render writes Combined + AOVs
to a 32-bit multilayer EXR; render_one.py turns it into passes.npz and
pack.py (outside Blender) turns that into the contract files.
"""
import bpy, bmesh, math, random
import numpy as np
from mathutils import Vector, Matrix, Euler

# ----------------------------------------------------------------- scene

def reset(res=(1600, 1600), samples=96, bounces=8):
    bpy.ops.wm.read_factory_settings(use_empty=True)
    sc = bpy.context.scene
    sc.render.engine = 'CYCLES'
    prefs = bpy.context.preferences.addons['cycles'].preferences
    prefs.compute_device_type = 'METAL'
    prefs.get_devices()
    for d in prefs.devices:
        d.use = d.type == 'METAL'
    sc.cycles.device = 'GPU'
    sc.cycles.samples = samples
    sc.cycles.use_adaptive_sampling = True
    sc.cycles.adaptive_threshold = 0.02
    sc.cycles.use_denoising = True
    sc.cycles.denoiser = 'OPENIMAGEDENOISE'
    sc.cycles.max_bounces = bounces
    sc.cycles.diffuse_bounces = 4
    sc.cycles.glossy_bounces = 4
    sc.cycles.transmission_bounces = 8
    sc.cycles.transparent_max_bounces = 8
    sc.cycles.caustics_reflective = False
    sc.cycles.caustics_refractive = False
    sc.cycles.blur_glossy = 1.0
    sc.cycles.sample_clamp_indirect = 8.0
    sc.render.resolution_x, sc.render.resolution_y = res
    sc.render.resolution_percentage = 100
    sc.render.film_transparent = False
    sc.view_settings.look = 'None'
    vl = sc.view_layers[0]
    a = vl.aovs.add(); a.name = 'pc'; a.type = 'COLOR'
    a = vl.aovs.add(); a.name = 'tint'; a.type = 'VALUE'
    vl.use_pass_combined = True
    w = bpy.data.worlds.new('World')
    sc.world = w
    world_color((0.6, 0.6, 0.62), 0.5)
    random.seed(7)
    return sc


def world_color(rgb, strength=1.0):
    w = bpy.context.scene.world
    nt = w.node_tree
    nt.nodes.clear()
    bg = nt.nodes.new('ShaderNodeBackground')
    bg.inputs['Color'].default_value = (*rgb, 1)
    bg.inputs['Strength'].default_value = strength
    out = nt.nodes.new('ShaderNodeOutputWorld')
    nt.links.new(bg.outputs[0], out.inputs[0])


def world_sky(sun_elev=35, sun_rot=40, strength=1.0, sun_disc=True, air=1.0, dust=1.0, ozone=1.0,
              cam_strength=None, sky_type='MULTIPLE_SCATTERING'):
    """Physical sky. cam_strength lets the visible sky be dimmer/brighter than its light."""
    w = bpy.context.scene.world
    nt = w.node_tree
    nt.nodes.clear()
    sky = nt.nodes.new('ShaderNodeTexSky')
    sky.sky_type = sky_type
    sky.sun_disc = sun_disc
    sky.sun_elevation = math.radians(sun_elev)
    sky.sun_rotation = math.radians(sun_rot)
    sky.air_density = air
    sky.aerosol_density = dust
    sky.ozone_density = ozone
    bg = nt.nodes.new('ShaderNodeBackground')
    bg.inputs['Strength'].default_value = strength
    nt.links.new(sky.outputs[0], bg.inputs[0])
    out = nt.nodes.new('ShaderNodeOutputWorld')
    if cam_strength is not None:
        bg2 = nt.nodes.new('ShaderNodeBackground')
        bg2.inputs['Strength'].default_value = cam_strength
        nt.links.new(sky.outputs[0], bg2.inputs[0])
        lp = nt.nodes.new('ShaderNodeLightPath')
        mix = nt.nodes.new('ShaderNodeMixShader')
        nt.links.new(lp.outputs['Is Camera Ray'], mix.inputs[0])
        nt.links.new(bg.outputs[0], mix.inputs[1])
        nt.links.new(bg2.outputs[0], mix.inputs[2])
        nt.links.new(mix.outputs[0], out.inputs[0])
    else:
        nt.links.new(bg.outputs[0], out.inputs[0])
    return sky


def world_gradient(top, bottom, strength=1.0):
    """Studio-ish world: vertical gradient by view direction."""
    w = bpy.context.scene.world
    nt = w.node_tree
    nt.nodes.clear()
    tc = nt.nodes.new('ShaderNodeTexCoord')
    sep = nt.nodes.new('ShaderNodeSeparateXYZ')
    nt.links.new(tc.outputs['Generated'], sep.inputs[0])
    ramp = nt.nodes.new('ShaderNodeValToRGB')
    ramp.color_ramp.elements[0].color = (*bottom, 1)
    ramp.color_ramp.elements[1].color = (*top, 1)
    mr = nt.nodes.new('ShaderNodeMapRange')
    mr.inputs['From Min'].default_value = -0.3
    mr.inputs['From Max'].default_value = 1.0
    nt.links.new(sep.outputs['Z'], mr.inputs['Value'])
    nt.links.new(mr.outputs[0], ramp.inputs[0])
    bg = nt.nodes.new('ShaderNodeBackground')
    bg.inputs['Strength'].default_value = strength
    nt.links.new(ramp.outputs[0], bg.inputs[0])
    out = nt.nodes.new('ShaderNodeOutputWorld')
    nt.links.new(bg.outputs[0], out.inputs[0])


def camera(loc, target, lens=50, fstop=None, focus=None, shift=(0, 0), roll=0.0, sensor=36):
    cd = bpy.data.cameras.new('Cam')
    cd.lens = lens
    cd.sensor_width = sensor
    cd.shift_x, cd.shift_y = shift
    cd.clip_start = 0.01
    cd.clip_end = 2000
    cam = bpy.data.objects.new('Cam', cd)
    bpy.context.scene.collection.objects.link(cam)
    cam.location = Vector(loc)
    d = Vector(target) - Vector(loc)
    q = d.to_track_quat('-Z', 'Y')
    cam.rotation_euler = q.to_euler()
    if roll:
        cam.rotation_euler.rotate_axis('Z', math.radians(roll))
    if fstop:
        cd.dof.use_dof = True
        cd.dof.aperture_fstop = fstop
        cd.dof.focus_distance = focus if focus else d.length
    bpy.context.scene.camera = cam
    return cam


def look_at(obj, target):
    d = Vector(target) - obj.location
    obj.rotation_euler = d.to_track_quat('-Z', 'Y').to_euler()


def area_light(loc, target, size=1.0, power=200, color=(1, 1, 1), size_y=None, shape='RECTANGLE',
               spread=180, visible=False):
    ld = bpy.data.lights.new('Area', 'AREA')
    ld.shape = shape
    ld.size = size
    ld.size_y = size_y if size_y else size
    ld.energy = power
    ld.color = color
    ld.spread = math.radians(spread)
    o = bpy.data.objects.new('Area', ld)
    bpy.context.scene.collection.objects.link(o)
    o.location = Vector(loc)
    look_at(o, target)
    o.visible_camera = visible
    return o


def sun_light(direction_to_sun, strength=3.0, angle=1.0, color=(1, 0.97, 0.92)):
    ld = bpy.data.lights.new('Sun', 'SUN')
    ld.energy = strength
    ld.angle = math.radians(angle)
    ld.color = color
    o = bpy.data.objects.new('Sun', ld)
    bpy.context.scene.collection.objects.link(o)
    d = Vector(direction_to_sun).normalized()
    o.rotation_euler = (-d).to_track_quat('-Z', 'Y').to_euler()
    return o


def point_light(loc, power=50, radius=0.1, color=(1, 0.9, 0.8)):
    ld = bpy.data.lights.new('Pt', 'POINT')
    ld.energy = power
    ld.shadow_soft_size = radius
    ld.color = color
    o = bpy.data.objects.new('Pt', ld)
    bpy.context.scene.collection.objects.link(o)
    o.location = Vector(loc)
    return o


def spot_light(loc, target, power=200, angle=60, blend=0.5, radius=0.05, color=(1, 0.95, 0.85)):
    ld = bpy.data.lights.new('Spot', 'SPOT')
    ld.energy = power
    ld.spot_size = math.radians(angle)
    ld.spot_blend = blend
    ld.shadow_soft_size = radius
    ld.color = color
    o = bpy.data.objects.new('Spot', ld)
    bpy.context.scene.collection.objects.link(o)
    o.location = Vector(loc)
    look_at(o, target)
    return o


# ----------------------------------------------------------------- nodes

class NB:
    """Tiny node-graph builder. Values may be numbers, tuples or sockets."""

    def __init__(self, mat):
        self.mat = mat
        self.nt = mat.node_tree
        self.nt.nodes.clear()
        self.out = self.nt.nodes.new('ShaderNodeOutputMaterial')

    def _set(self, sock, val):
        if val is None:
            return
        if isinstance(val, bpy.types.NodeSocket):
            self.nt.links.new(val, sock)
        elif isinstance(val, bpy.types.Node):
            self.nt.links.new(val.outputs[0], sock)
        else:
            if isinstance(val, (tuple, list)) and len(val) == 3 and sock.type == 'RGBA':
                val = (*val, 1)
            sock.default_value = val

    def node(self, kind, inputs=None, **props):
        n = self.nt.nodes.new(kind)
        for k, v in props.items():
            setattr(n, k, v)
        for k, v in (inputs or {}).items():
            self._set(n.inputs[k], v)
        return n

    def math(self, op, a, b=0.0, clamp=False):
        n = self.node('ShaderNodeMath', operation=op, use_clamp=clamp)
        self._set(n.inputs[0], a)
        self._set(n.inputs[1], b)
        return n.outputs[0]

    def vmath(self, op, a, b=None, scale=None):
        n = self.node('ShaderNodeVectorMath', operation=op)
        self._set(n.inputs[0], a)
        if b is not None:
            self._set(n.inputs[1], b)
        if scale is not None:
            self._set(n.inputs['Scale'], scale)
        return n.outputs[0]

    def mix(self, fac, a, b, blend='MIX', dtype='RGBA'):
        n = self.node('ShaderNodeMix', data_type=dtype, blend_type=blend)
        if dtype == 'RGBA':
            self._set(n.inputs[0], fac)
            self._set(n.inputs[6], a)
            self._set(n.inputs[7], b)
            return n.outputs[2]
        self._set(n.inputs[0], fac)
        self._set(n.inputs[2], a)
        self._set(n.inputs[3], b)
        return n.outputs[0]

    def coord(self, kind='Object'):
        tc = self.node('ShaderNodeTexCoord')
        return tc.outputs[kind]

    def uv(self, name):
        return self.node('ShaderNodeUVMap', uv_map=name).outputs[0]

    def noise(self, vec=None, scale=5.0, detail=4.0, rough=0.5, dist=0.0, dims='3D'):
        n = self.node('ShaderNodeTexNoise', noise_dimensions=dims,
                      inputs={'Scale': scale, 'Detail': detail, 'Roughness': rough, 'Distortion': dist})
        if vec is not None:
            self._set(n.inputs['Vector'], vec)
        return n

    def voronoi(self, vec=None, scale=5.0, feature='F1', rand=1.0):
        n = self.node('ShaderNodeTexVoronoi', feature=feature, inputs={'Scale': scale, 'Randomness': rand})
        if vec is not None:
            self._set(n.inputs['Vector'], vec)
        return n

    def wave(self, vec=None, scale=5.0, dist=0.0, detail=2.0, axis='X', kind='BANDS', profile='SIN', dscale=1.0):
        n = self.node('ShaderNodeTexWave', wave_type=kind, bands_direction=axis, wave_profile=profile,
                      inputs={'Scale': scale, 'Distortion': dist, 'Detail': detail, 'Detail Scale': dscale})
        if vec is not None:
            self._set(n.inputs['Vector'], vec)
        return n

    def ramp(self, fac, stops):
        n = self.node('ShaderNodeValToRGB')
        cr = n.color_ramp
        while len(cr.elements) < len(stops):
            cr.elements.new(0.5)
        for el, (p, c) in zip(cr.elements, stops):
            el.position = p
            el.color = (*c, 1) if len(c) == 3 else c
        self._set(n.inputs[0], fac)
        return n.outputs[0]

    def bump(self, height, strength=0.2, distance=0.01, normal=None):
        n = self.node('ShaderNodeBump', inputs={'Strength': strength, 'Distance': distance})
        self._set(n.inputs['Height'], height)
        if normal is not None:
            self._set(n.inputs['Normal'], normal)
        return n.outputs[0]

    def bsdf(self, **kw):
        names = {'color': 'Base Color', 'rough': 'Roughness', 'metal': 'Metallic', 'normal': 'Normal',
                 'sheen': 'Sheen Weight', 'sheen_rough': 'Sheen Roughness', 'sss': 'Subsurface Weight',
                 'sss_radius': 'Subsurface Radius', 'sss_scale': 'Subsurface Scale', 'coat': 'Coat Weight',
                 'coat_rough': 'Coat Roughness', 'trans': 'Transmission Weight', 'ior': 'IOR',
                 'alpha': 'Alpha', 'spec': 'Specular IOR Level', 'emit': 'Emission Color',
                 'emit_strength': 'Emission Strength', 'thin': 'Thin Wall', 'coat_normal': 'Coat Normal',
                 'aniso': 'Anisotropic', 'aniso_rot': 'Anisotropic Rotation'}
        n = self.node('ShaderNodeBsdfPrincipled')
        for k, v in kw.items():
            self._set(n.inputs[names.get(k, k)], v)
        return n

    def output(self, shader, disp=None):
        self._set(self.out.inputs['Surface'], shader)
        if disp is not None:
            self._set(self.out.inputs['Displacement'], disp)

    # --- AOVs
    def aov(self, name, color=None, value=None):
        n = self.node('ShaderNodeOutputAOV', aov_name=name)
        if color is not None:
            self._set(n.inputs['Color'], color)
        if value is not None:
            self._set(n.inputs['Value'], value)
        return n

    def print_aov(self, uvmap='print', extra_mask=None):
        """pc AOV = (u*c, v*c, c), v measured DOWN from the design's top edge."""
        sep = self.node('ShaderNodeSeparateXYZ')
        self._set(sep.inputs[0], self.uv(uvmap))
        u = sep.outputs['X']
        v = self.math('SUBTRACT', 1.0, sep.outputs['Y'])
        c = self.math('MULTIPLY', self.math('GREATER_THAN', u, -1e-5), self.math('LESS_THAN', u, 1.00001))
        c = self.math('MULTIPLY', c, self.math('GREATER_THAN', v, -1e-5))
        c = self.math('MULTIPLY', c, self.math('LESS_THAN', v, 1.00001))
        if extra_mask is not None:
            c = self.math('MULTIPLY', c, extra_mask)
        uc = self.math('MULTIPLY', self.math('MAXIMUM', self.math('MINIMUM', u, 1.0), 0.0), c)
        vc = self.math('MULTIPLY', self.math('MAXIMUM', self.math('MINIMUM', v, 1.0), 0.0), c)
        comb = self.node('ShaderNodeCombineXYZ')
        self._set(comb.inputs[0], uc)
        self._set(comb.inputs[1], vc)
        self._set(comb.inputs[2], c)
        self.aov('pc', color=comb.outputs[0])
        return c


def new_mat(name):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    return m, NB(m)


# ----------------------------------------------------------------- materials

def m_simple(name, color, rough=0.5, metal=0.0, tint=False, printable=False, bump=0.0, bump_scale=200.0,
             coat=0.0, sheen=0.0, spec=0.5):
    m, nb = new_mat(name)
    nrm = None
    if bump:
        nrm = nb.bump(nb.noise(nb.coord('Object'), scale=bump_scale, detail=3), strength=bump, distance=0.002)
    b = nb.bsdf(color=color, rough=rough, metal=metal, normal=nrm, coat=coat, sheen=sheen, spec=spec)
    nb.output(b)
    if tint:
        nb.aov('tint', value=1.0)
    if printable:
        nb.print_aov()
    return m


def m_paper(name='Paper', color=(0.86, 0.86, 0.85), rough=0.65, printable=True, fiber=0.06, gloss=0.0, tint=False):
    m, nb = new_mat(name)
    co = nb.coord('Object')
    h = nb.noise(co, scale=900, detail=2, rough=0.6)
    h2 = nb.noise(co, scale=60, detail=3)
    hh = nb.math('ADD', nb.math('MULTIPLY', h.outputs[0], 0.6), nb.math('MULTIPLY', h2.outputs[0], 0.4))
    nrm = nb.bump(hh, strength=fiber, distance=0.0005)
    b = nb.bsdf(color=color, rough=rough, normal=nrm, spec=0.3, coat=gloss, coat_rough=0.15, sss=0.0)
    nb.output(b)
    if printable:
        nb.print_aov()
    if tint:
        nb.aov('tint', value=1.0)
    return m


def m_fabric(name='Cotton', color=(0.82, 0.82, 0.81), weave=1100.0, strength=0.25, printable=False, tint=True,
             knit=True, fuzz=0.6, uvmap='print'):
    """Cotton jersey: micro knit bump on UV (follows the cloth), sheen, high roughness."""
    m, nb = new_mat(name)
    vec = nb.uv('weave') if knit else nb.coord('Object')
    w1 = nb.wave(vec, scale=weave, axis='X', dist=1.5, detail=1, profile='SIN')
    w2 = nb.wave(vec, scale=weave * 0.5, axis='Y', dist=0.5, detail=0, profile='SIN')
    n1 = nb.noise(nb.coord('Object'), scale=40, detail=6, rough=0.6)
    hh = nb.math('ADD', nb.math('MULTIPLY', w1.outputs[1], 0.5),
                 nb.math('ADD', nb.math('MULTIPLY', w2.outputs[1], 0.25), nb.math('MULTIPLY', n1.outputs[0], 0.3)))
    nrm = nb.bump(hh, strength=strength, distance=0.0008)
    col = nb.mix(nb.math('MULTIPLY', n1.outputs[0], 0.12), color,
                 tuple(c * 0.93 for c in color))
    b = nb.bsdf(color=col, rough=0.92, normal=nrm, sheen=fuzz, sheen_rough=0.4, spec=0.3)
    nb.output(b)
    if tint:
        nb.aov('tint', value=1.0)
    if printable:
        nb.print_aov(uvmap)
    return m


def m_wood(name='Wood', tone=(0.42, 0.26, 0.15), scale=1.0, rough=0.45, plank=0.0, coat=0.2, axis='X', light=1.0):
    """Straight-grain wood; grain runs along object X (axis='X') or Y."""
    m, nb = new_mat(name)
    co = nb.coord('Object')
    st = (0.12, 1.0, 1.0) if axis == 'X' else (1.0, 0.12, 1.0)
    mp = nb.node('ShaderNodeMapping', inputs={'Scale': tuple(x * scale for x in st)})
    nb._set(mp.inputs['Vector'], co)
    rings = nb.wave(mp, scale=14, axis='Y' if axis == 'X' else 'X', dist=7, detail=4, dscale=1.5, profile='SIN')
    mp2 = nb.node('ShaderNodeMapping', inputs={'Scale': tuple(x * scale for x in ((0.02, 1, 1) if axis == 'X' else (1, 0.02, 1)))})
    nb._set(mp2.inputs['Vector'], co)
    pores = nb.noise(mp2, scale=300, detail=2)
    big = nb.noise(co, scale=1.5 * scale, detail=3)
    f = nb.math('ADD', nb.math('MULTIPLY', rings.outputs[1], 0.55),
                nb.math('ADD', nb.math('MULTIPLY', pores.outputs[0], 0.3), nb.math('MULTIPLY', big.outputs[0], 0.3)))
    dark = tuple(c * 0.62 * light for c in tone)
    lite = tuple(min(1, c * 1.25 * light) for c in tone)
    col = nb.ramp(f, [(0.3, dark), (0.72, lite)])
    if plank:
        br = nb.node('ShaderNodeTexBrick', inputs={'Scale': plank, 'Mortar Size': 0.006, 'Bias': 0.0,
                                                   'Color1': (1, 1, 1), 'Color2': (0.8, 0.78, 0.76),
                                                   'Mortar': (0.15, 0.15, 0.15)}, offset=0.37, squash=1.0)
        br.inputs['Brick Width'].default_value = 4.0
        br.inputs['Row Height'].default_value = 0.4
        if axis != 'X':
            mpb = nb.node('ShaderNodeMapping', inputs={'Rotation': (0, 0, math.pi / 2)})
            nb._set(mpb.inputs['Vector'], co)
            nb._set(br.inputs['Vector'], mpb)
        else:
            nb._set(br.inputs['Vector'], co)
        col = nb.mix(1.0, col, br.outputs['Color'], blend='MULTIPLY')
        hb = nb.math('MULTIPLY', nb.math('SUBTRACT', 1.0, br.outputs['Fac']), 1.0)
    else:
        hb = 0.0
    hh = nb.math('ADD', nb.math('MULTIPLY', pores.outputs[0], 0.15), hb)
    nrm = nb.bump(hh, strength=0.08, distance=0.002)
    b = nb.bsdf(color=col, rough=rough, normal=nrm, coat=coat, coat_rough=0.25)
    nb.output(b)
    return m


def m_plaster(name='Wall', color=(0.8, 0.79, 0.76), strength=0.08, scale=25.0, rough=0.9):
    m, nb = new_mat(name)
    co = nb.coord('Object')
    n1 = nb.noise(co, scale=scale, detail=8, rough=0.65)
    n2 = nb.noise(co, scale=2, detail=3)
    col = nb.mix(nb.math('MULTIPLY', n2.outputs[0], 0.25), color, tuple(c * 0.94 for c in color))
    nrm = nb.bump(n1.outputs[0], strength=strength, distance=0.003)
    nb.output(nb.bsdf(color=col, rough=rough, normal=nrm, spec=0.3))
    return m


def m_concrete(name='Concrete', color=(0.5, 0.5, 0.48), scale=6.0, rough=0.85, strength=0.25, stains=0.3):
    m, nb = new_mat(name)
    co = nb.coord('Object')
    n1 = nb.noise(co, scale=scale, detail=10, rough=0.62)
    n2 = nb.noise(co, scale=scale * 40, detail=2)
    v = nb.voronoi(co, scale=scale * 12)
    col = nb.ramp(n1.outputs[0], [(0.3, tuple(c * (1 - stains) for c in color)), (0.7, color)])
    col = nb.mix(nb.math('MULTIPLY', n2.outputs[0], 0.25), col, tuple(c * 0.8 for c in color))
    hh = nb.math('ADD', n2.outputs[0], nb.math('MULTIPLY', v.outputs[0], 0.4))
    nrm = nb.bump(hh, strength=strength, distance=0.002)
    nb.output(nb.bsdf(color=col, rough=rough, normal=nrm, spec=0.35))
    return m


def m_asphalt(name='Asphalt', color=(0.09, 0.09, 0.09), scale=120.0):
    m, nb = new_mat(name)
    co = nb.coord('Object')
    v = nb.voronoi(co, scale=scale)
    n = nb.noise(co, scale=2.0, detail=6)
    col = nb.ramp(nb.math('ADD', v.outputs[0], nb.math('MULTIPLY', n.outputs[0], 0.6)),
                  [(0.2, tuple(c * 0.6 for c in color)), (0.9, tuple(min(1, c * 2.2) for c in color))])
    nrm = nb.bump(v.outputs[0], strength=0.35, distance=0.003)
    rgh = nb.math('ADD', 0.75, nb.math('MULTIPLY', n.outputs[0], 0.2))
    nb.output(nb.bsdf(color=col, rough=rgh, normal=nrm))
    return m


def m_grass(name='Grass', color=(0.12, 0.2, 0.05), scale=30.0):
    m, nb = new_mat(name)
    co = nb.coord('Object')
    n = nb.noise(co, scale=scale, detail=8, rough=0.7)
    n2 = nb.noise(co, scale=0.6, detail=4)
    col = nb.ramp(nb.math('ADD', nb.math('MULTIPLY', n.outputs[0], 0.6), nb.math('MULTIPLY', n2.outputs[0], 0.6)),
                  [(0.25, tuple(c * 0.5 for c in color)), (0.55, color), (0.85, (color[0] * 1.8, color[1] * 1.5, color[2]))])
    nrm = nb.bump(n.outputs[0], strength=0.6, distance=0.02)
    nb.output(nb.bsdf(color=col, rough=0.9, normal=nrm, sheen=0.3))
    return m


def m_metal(name='Metal', color=(0.7, 0.7, 0.72), rough=0.3, brushed=0.0, tint=False):
    m, nb = new_mat(name)
    nrm = None
    if brushed:
        co = nb.coord('Object')
        mp = nb.node('ShaderNodeMapping', inputs={'Scale': (1, 1, 300)})
        nb._set(mp.inputs['Vector'], co)
        nrm = nb.bump(nb.noise(mp, scale=30, detail=2), strength=brushed, distance=0.001)
    nb.output(nb.bsdf(color=color, rough=rough, metal=1.0, normal=nrm))
    if tint:
        nb.aov('tint', value=1.0)
    return m


def m_glass(name='Glass', color=(0.95, 0.97, 0.96), rough=0.0, thin=False, ior=1.45):
    m, nb = new_mat(name)
    nb.output(nb.bsdf(color=color, rough=rough, trans=1.0, ior=ior, thin=thin))
    return m


def m_window_glass(name='WinGlass', reflect=0.25, tint_rgb=(0.9, 0.95, 0.95)):
    """Thin pane that lets AOVs through: transparent + fresnel glossy."""
    m, nb = new_mat(name)
    tr = nb.node('ShaderNodeBsdfTransparent', inputs={'Color': tint_rgb})
    gl = nb.node('ShaderNodeBsdfGlossy', inputs={'Roughness': 0.02})
    lw = nb.node('ShaderNodeLayerWeight', inputs={'Blend': reflect})
    mx = nb.node('ShaderNodeMixShader')
    nb._set(mx.inputs[0], lw.outputs['Fresnel'])
    nb._set(mx.inputs[1], tr)
    nb._set(mx.inputs[2], gl)
    nb.output(mx)
    return m


def m_skin(name='Skin', color=(0.72, 0.47, 0.36)):
    m, nb = new_mat(name)
    co = nb.coord('Object')
    n = nb.noise(co, scale=600, detail=3)
    n2 = nb.noise(co, scale=30, detail=4)
    col = nb.mix(nb.math('MULTIPLY', n2.outputs[0], 0.3), color, (color[0] * 1.05, color[1] * 0.85, color[2] * 0.85))
    nrm = nb.bump(n.outputs[0], strength=0.15, distance=0.0003)
    nb.output(nb.bsdf(color=col, rough=0.48, sss=0.35, sss_radius=(1.0, 0.35, 0.2), sss_scale=0.006,
                      normal=nrm, spec=0.45))
    return m


def m_ceramic(name='Ceramic', color=(0.86, 0.86, 0.85), printable=True, tint=True):
    m, nb = new_mat(name)
    nb.output(nb.bsdf(color=color, rough=0.25, coat=0.6, coat_rough=0.04, spec=0.5))
    if printable:
        nb.print_aov()
    if tint:
        nb.aov('tint', value=1.0)
    return m


def m_screen(name='Screen', strength=1.0, glass=True, printable=True):
    """Lit white display under glass. Its 'albedo' is the emission (1.0)."""
    m, nb = new_mat(name)
    em = nb.node('ShaderNodeEmission', inputs={'Color': (1, 1, 1), 'Strength': strength})
    if glass:
        gl = nb.node('ShaderNodeBsdfGlossy', inputs={'Roughness': 0.03})
        lw = nb.node('ShaderNodeLayerWeight', inputs={'Blend': 0.12})
        tr = nb.node('ShaderNodeBsdfTransparent', inputs={'Color': (0, 0, 0)})
        mixg = nb.node('ShaderNodeMixShader')
        nb._set(mixg.inputs[0], lw.outputs['Fresnel'])
        nb._set(mixg.inputs[1], tr)
        nb._set(mixg.inputs[2], gl)
        add2 = nb.node('ShaderNodeAddShader')
        nb._set(add2.inputs[0], em)
        nb._set(add2.inputs[1], mixg)
        nb.output(add2)
    else:
        nb.output(em)
    if printable:
        nb.print_aov()
    return m


def m_emission(name='Emit', color=(1, 1, 1), strength=5.0):
    m, nb = new_mat(name)
    nb.output(nb.node('ShaderNodeEmission', inputs={'Color': color, 'Strength': strength}))
    return m


def m_leaf(name='Leaf', color=(0.08, 0.22, 0.05)):
    m, nb = new_mat(name)
    nb.output(nb.bsdf(color=color, rough=0.45, sss=0.2, sss_radius=(0.2, 1.0, 0.1), sss_scale=0.01, spec=0.5))
    return m


# ----------------------------------------------------------------- objects

def link(obj):
    bpy.context.scene.collection.objects.link(obj)
    return obj


def mesh_obj(name, verts, faces, mat=None, smooth=True):
    me = bpy.data.meshes.new(name)
    me.from_pydata([tuple(v) for v in verts], [], [tuple(f) for f in faces])
    me.update()
    o = link(bpy.data.objects.new(name, me))
    if mat:
        o.data.materials.append(mat)
    if smooth:
        for p in me.polygons:
            p.use_smooth = True
    return o


def set_mat(o, mat):
    o.data.materials.clear()
    o.data.materials.append(mat)


def box(size, loc=(0, 0, 0), rot=(0, 0, 0), mat=None, bevel=0.0, segs=3, name='Box'):
    bpy.ops.mesh.primitive_cube_add(size=1, location=loc, rotation=[math.radians(r) for r in rot])
    o = bpy.context.active_object
    o.name = name
    o.scale = size
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    if bevel:
        b = o.modifiers.new('Bevel', 'BEVEL')
        b.width = bevel
        b.segments = segs
        b.limit_method = 'NONE'
        b.harden_normals = False
        bpy.ops.object.shade_smooth()
        o.data.set_sharp_from_angle(angle=math.radians(40)) if hasattr(o.data, 'set_sharp_from_angle') else None
    if mat:
        set_mat(o, mat)
    return o


def cylinder(r, h, loc=(0, 0, 0), rot=(0, 0, 0), mat=None, verts=64, bevel=0.0, name='Cyl'):
    bpy.ops.mesh.primitive_cylinder_add(radius=r, depth=h, vertices=verts, location=loc,
                                        rotation=[math.radians(x) for x in rot])
    o = bpy.context.active_object
    o.name = name
    bpy.ops.object.shade_smooth()
    if hasattr(o.data, 'set_sharp_from_angle'):
        o.data.set_sharp_from_angle(angle=math.radians(35))
    if bevel:
        b = o.modifiers.new('Bevel', 'BEVEL')
        b.width = bevel
        b.segments = 3
        b.limit_method = 'ANGLE'
    if mat:
        set_mat(o, mat)
    return o


def sphere(r, loc=(0, 0, 0), mat=None, scale=(1, 1, 1), name='Sph'):
    bpy.ops.mesh.primitive_uv_sphere_add(radius=r, location=loc, segments=48, ring_count=24)
    o = bpy.context.active_object
    o.name = name
    o.scale = scale
    bpy.ops.object.shade_smooth()
    if mat:
        set_mat(o, mat)
    return o


def plane(w, h, loc=(0, 0, 0), rot=(0, 0, 0), mat=None, name='Plane', cuts=0):
    """Plane in its local XY, w along X, h along Y. UV 'print' = 0..1 (v up)."""
    bpy.ops.mesh.primitive_plane_add(size=1, location=loc, rotation=[math.radians(r) for r in rot])
    o = bpy.context.active_object
    o.name = name
    o.scale = (w, h, 1)
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    if cuts:
        bpy.ops.object.mode_set(mode='EDIT')
        bpy.ops.mesh.subdivide(number_cuts=cuts)
        bpy.ops.object.mode_set(mode='OBJECT')
    o.data.uv_layers[0].name = 'print'
    if mat:
        set_mat(o, mat)
    return o


def grid_mesh(name, nx, ny, fn, uvfn=None, mat=None, extra_uv=None):
    """Mesh from a param grid: fn(s,t)->(x,y,z), s,t in [0,1]. uvfn(s,t)->(u,v) for 'print' UV."""
    s = np.linspace(0, 1, nx + 1)
    t = np.linspace(0, 1, ny + 1)
    verts = []
    for j in range(ny + 1):
        for i in range(nx + 1):
            verts.append(fn(s[i], t[j]))
    faces = []
    for j in range(ny):
        for i in range(nx):
            a = j * (nx + 1) + i
            faces.append((a, a + 1, a + nx + 2, a + nx + 1))
    o = mesh_obj(name, verts, faces, mat)
    me = o.data
    for nm, f in (('print', uvfn), ) + tuple(extra_uv or ()):
        if f is None:
            continue
        uvl = me.uv_layers.new(name=nm)
        for p in me.polygons:
            for li in p.loop_indices:
                vi = me.loops[li].vertex_index
                jj, ii = divmod(vi, nx + 1)
                uvl.data[li].uv = f(s[ii], t[jj])
    return o


def set_uv(o, name, fn, per_face_ref=False):
    """fn(co: Vector object-space rest position, face_center: Vector) -> (u, v)."""
    me = o.data
    uvl = me.uv_layers.get(name) or me.uv_layers.new(name=name)
    for p in me.polygons:
        c = p.center
        for li in p.loop_indices:
            vi = me.loops[li].vertex_index
            uvl.data[li].uv = fn(me.vertices[vi].co, c)
    return uvl


def cyl_uv(theta_c, span, z0, z1, axis_center=(0, 0)):
    """Cylindrical print UV centred on angle theta_c (radians), span radians wide, v up z0..z1.
    Seen from outside, increasing theta goes to the RIGHT. Unwrapped per face (no seam artefacts)."""
    cx, cy = axis_center

    def wrap(a):
        return (a + math.pi) % (2 * math.pi) - math.pi

    def fn(co, fc):
        tc = math.atan2(fc.y - cy, fc.x - cx)
        t = math.atan2(co.y - cy, co.x - cx)
        off = wrap(t - tc) + wrap(tc - theta_c)
        return (off / span + 0.5, (co.z - z0) / (z1 - z0))
    return fn


def lathe(name, profile, segs=96, mat=None, close_bottom=True):
    """Revolve [(r, z), ...] around Z. Returns object; vertex ring order follows profile."""
    verts, faces = [], []
    n = len(profile)
    for k in range(segs):
        a = 2 * math.pi * k / segs
        for r, z in profile:
            verts.append((r * math.cos(a), r * math.sin(a), z))
    for k in range(segs):
        k2 = (k + 1) % segs
        for i in range(n - 1):
            faces.append((k * n + i, k2 * n + i, k2 * n + i + 1, k * n + i + 1))
    o = mesh_obj(name, verts, faces, mat)
    return o


def subsurf(o, levels=2, render=None):
    m = o.modifiers.new('Sub', 'SUBSURF')
    m.levels = levels
    m.render_levels = render if render is not None else levels
    return m


def solidify(o, t, offset=-1.0):
    m = o.modifiers.new('Solid', 'SOLIDIFY')
    m.thickness = t
    m.offset = offset
    return m


def curve_tube(name, pts, radius, mat=None, res=12, bevel_res=6):
    cd = bpy.data.curves.new(name, 'CURVE')
    cd.dimensions = '3D'
    cd.bevel_depth = radius
    cd.bevel_resolution = bevel_res
    cd.resolution_u = res
    cd.use_fill_caps = True
    sp = cd.splines.new('BEZIER')
    sp.bezier_points.add(len(pts) - 1)
    for bp, p in zip(sp.bezier_points, pts):
        bp.co = p
        bp.handle_left_type = bp.handle_right_type = 'AUTO'
    o = link(bpy.data.objects.new(name, cd))
    if mat:
        o.data.materials.append(mat)
    return o


def displace_fn(o, fn):
    """Move every vertex: fn(co: np.ndarray (N,3)) -> new co array."""
    me = o.data
    co = np.zeros(len(me.vertices) * 3)
    me.vertices.foreach_get('co', co)
    co = co.reshape(-1, 3)
    co = fn(co)
    me.vertices.foreach_set('co', co.reshape(-1))
    me.update()


def apply_mods(o):
    bpy.context.view_layer.objects.active = o
    for m in list(o.modifiers):
        bpy.ops.object.modifier_apply(modifier=m.name)


def hide_from_camera(o):
    o.visible_camera = False
    return o


def window_gobo(center, normal_to_sun, w=3.0, h=3.0, panes=(2, 3), bar=0.08, rot=0.0):
    """A window frame between the sun and the scene, invisible to camera: casts soft window shadows."""
    objs = []
    nx, ny = panes
    m = m_simple('Gobo', (0.02, 0.02, 0.02), rough=1)
    # outer wall with hole = 4 slabs, mullions
    big = 20
    parts = [((big, big / 2 - h / 2 + 0.0, 0.02), (0, h / 2 + (big / 2 - h / 2) / 2 + h / 4, 0))]
    slabs = []
    slabs.append(((big, (big - h) / 2), (0, h / 2 + (big - h) / 4)))
    slabs.append(((big, (big - h) / 2), (0, -h / 2 - (big - h) / 4)))
    slabs.append((((big - w) / 2, h), (w / 2 + (big - w) / 4, 0)))
    slabs.append((((big - w) / 2, h), (-w / 2 - (big - w) / 4, 0)))
    for i in range(1, nx):
        slabs.append(((bar, h), (-w / 2 + w * i / nx, 0)))
    for j in range(1, ny):
        slabs.append(((w, bar), (0, -h / 2 + h * j / ny)))
    for (sw, sh), (px, py) in slabs:
        o = box((sw, sh, 0.02), (px, py, 0), mat=m)
        objs.append(o)
    empty = bpy.data.objects.new('GoboRoot', None)
    link(empty)
    for o in objs:
        o.parent = empty
        o.visible_camera = False
        o.visible_glossy = False
    empty.location = Vector(center)
    d = Vector(normal_to_sun).normalized()
    empty.rotation_euler = d.to_track_quat('Z', 'Y').to_euler()
    empty.rotation_euler.rotate_axis('Z', math.radians(rot))
    return empty


def leaf_plant(loc, height=0.6, n=14, pot_r=0.1, seed=3, leaf_mat=None, pot_mat=None, leaf_len=0.22):
    """Simple potted plant: tapered leaf blades on curved stems."""
    rnd = random.Random(seed)
    leaf_mat = leaf_mat or m_leaf()
    pot_mat = pot_mat or m_simple('Pot', (0.75, 0.72, 0.68), rough=0.7, bump=0.2)
    x, y, z = loc
    prof = [(0.0, 0.0), (pot_r * 0.75, 0.0), (pot_r * 0.8, 0.01), (pot_r, pot_r * 1.7), (pot_r * 0.93, pot_r * 1.7),
            (pot_r * 0.9, pot_r * 1.5), (0.0, pot_r * 1.5)]
    pot = lathe('Pot', prof, 48, pot_mat)
    pot.location = (x, y, z)
    top = z + pot_r * 1.5
    for i in range(n):
        a = rnd.uniform(0, 2 * math.pi)
        tilt = rnd.uniform(0.15, 0.9)
        L = height * rnd.uniform(0.55, 1.0)
        base = Vector((x, y, top))
        dirv = Vector((math.cos(a) * math.sin(tilt), math.sin(a) * math.sin(tilt), math.cos(tilt)))
        # leaf blade as a bent grid
        ll = leaf_len * rnd.uniform(0.8, 1.2)
        lw = ll * 0.38
        side = Vector((-math.sin(a), math.cos(a), 0))
        def fn(s, t, base=base, dirv=dirv, L=L, side=side, ll=ll, lw=lw):
            # s along length 0..1 (stem then blade), t across -1..1
            p = base + dirv * (L * s) + Vector((0, 0, -0.35 * L * s * s))
            if s < 0.45:
                width = 0.004
            else:
                q = (s - 0.45) / 0.55
                width = lw * math.sin(math.pi * min(1, q) ** 0.8) * 0.5
            p = p + side * ((t - 0.5) * 2 * width)
            p.z += abs(t - 0.5) * width * 0.6
            return tuple(p)
        o = grid_mesh('Leaf', 24, 4, fn, mat=leaf_mat)
        sol = solidify(o, 0.0015, 0)
    return pot


def floor_plane(mat, size=20, z=0.0):
    return plane(size, size, (0, 0, z), mat=mat, name='Floor')


def room(wall_mat, floor_mat, size=(8, 8, 3.2), back_y=1.0, side=False):
    """Back wall at y=back_y (facing -Y), floor z=0."""
    W, D, H = size
    f = plane(W, D, (0, back_y - D / 2, 0), mat=floor_mat, name='Floor')
    wall = plane(W, H, (0, back_y, H / 2), rot=(90, 0, 0), mat=wall_mat, name='BackWall')
    walls = [wall]
    if side:
        walls.append(plane(D, H, (-W / 2, back_y - D / 2, H / 2), rot=(90, 0, 90), mat=wall_mat, name='SideL'))
    ceil = plane(W, D, (0, back_y - D / 2, H), rot=(180, 0, 0), mat=m_simple('Ceil', (0.85, 0.85, 0.85), rough=0.9),
                 name='Ceil')
    ceil.visible_camera = False
    return f, walls


# ----------------------------------------------------------------- printed things / props

def sheet(w, h, thick=0.0002, loc=(0, 0, 0), rot=(0, 0, 0), front=None, back=None, nx=1, ny=1, warp=None,
          name='Sheet'):
    """Paper-like sheet in local XY (w along X, h along Y, front faces +Z), print UV = (s, t).
    warp(x, y, s, t) -> (x, y, z) bends it. Back + edges get `back` material."""
    def fn(s, t):
        x, y, z = (s - 0.5) * w, (t - 0.5) * h, 0.0
        if warp:
            x, y, z = warp(x, y, s, t)
        return (x, y, z)
    o = grid_mesh(name, nx, ny, fn, uvfn=lambda s, t: (s, t), mat=front)
    if back:
        o.data.materials.append(back)
    if thick:
        sol = solidify(o, thick, offset=-1)
        sol.material_offset = 1
        sol.material_offset_rim = 1
        sol.use_even_offset = True
    o.location = Vector(loc)
    o.rotation_euler = [math.radians(r) for r in rot]
    return o


def m_marble(name='Marble', color=(0.85, 0.85, 0.84), vein=(0.35, 0.35, 0.37), rough=0.12):
    m, nb = new_mat(name)
    co = nb.coord('Object')
    n = nb.noise(co, scale=1.2, detail=12, rough=0.6, dist=3.0)
    w = nb.wave(n.outputs[1], scale=2.5, axis='X', dist=6, detail=8, profile='SIN')
    f = nb.math('POWER', nb.math('ABSOLUTE', nb.math('SUBTRACT', w.outputs[1], 0.5)), 0.35)
    col = nb.ramp(f, [(0.0, vein), (0.45, tuple(c * 0.95 for c in color)), (1.0, color)])
    nb.output(nb.bsdf(color=col, rough=rough, coat=0.4, coat_rough=0.05, sss=0.05, sss_radius=(0.5, 0.5, 0.5), sss_scale=0.01))
    return m


def m_linen(name='Linen', color=(0.75, 0.72, 0.66), scale=900.0, strength=0.3):
    m, nb = new_mat(name)
    co = nb.coord('Object')
    w1 = nb.wave(co, scale=scale, axis='X', dist=2.0, detail=2, profile='SIN')
    w2 = nb.wave(co, scale=scale, axis='Y', dist=2.0, detail=2, profile='SIN')
    n = nb.noise(co, scale=8, detail=6)
    slub = nb.noise(nb.node('ShaderNodeMapping', inputs={'Scale': (60, 1, 1), 'Vector': co}), scale=40, detail=2)
    hh = nb.math('ADD', nb.math('MULTIPLY', w1.outputs[1], w2.outputs[1]), nb.math('MULTIPLY', slub.outputs[0], 0.3))
    col = nb.mix(nb.math('ADD', nb.math('MULTIPLY', n.outputs[0], 0.25), nb.math('MULTIPLY', slub.outputs[0], 0.2)),
                 color, tuple(c * 0.85 for c in color))
    nb.output(nb.bsdf(color=col, rough=0.95, sheen=0.5, normal=nb.bump(hh, strength=strength, distance=0.001)))
    return m


def mug_prop(loc, r=0.042, h=0.095, mat=None, coffee=True, rot=0.0):
    mat = mat or m_ceramic('PropMug', color=(0.88, 0.87, 0.85), printable=False, tint=False)
    t = 0.004
    prof = [(0.0, 0.0), (r - 0.006, 0.0), (r, 0.006), (r, h), (r - t, h), (r - t, 0.008), (0.0, 0.008)]
    o = lathe('PropMug', prof, 64, mat)
    subsurf(o, 1)
    pts = [(r - 0.002, 0, h * 0.8), (r + 0.03, 0, h * 0.72), (r + 0.033, 0, h * 0.4), (r - 0.002, 0, h * 0.25)]
    hd = curve_tube('Handle', pts, 0.0055, mat)
    hd.parent = o
    if coffee:
        cm = m_simple('Coffee', (0.06, 0.03, 0.015), rough=0.05)
        c = cylinder(r - t - 0.0005, 0.002, (0, 0, h * 0.82), mat=cm)
        c.parent = o
    o.location = loc
    o.rotation_euler = (0, 0, math.radians(rot))
    return o


def pen_prop(loc, rot=0.0, length=0.14, color=(0.05, 0.05, 0.06)):
    body = m_simple('PenBody', color, rough=0.25, coat=0.5)
    metal = m_metal('PenMetal', (0.8, 0.75, 0.6), rough=0.2)
    o = cylinder(0.0045, length, (0, 0, 0), rot=(0, 90, 0), mat=body, verts=32)
    tip = cylinder(0.0045, 0.018, (length / 2 + 0.009, 0, 0), rot=(0, 90, 0), mat=metal, verts=32)
    tip.parent = o
    clip = box((0.05, 0.0015, 0.002), (-length / 2 + 0.03, 0, 0.0055), mat=metal, bevel=0.0005)
    clip.parent = o
    o.location = (loc[0], loc[1], loc[2] + 0.0045)
    o.rotation_euler = (0, 0, math.radians(rot))
    return o


def glass_prop(loc, kind='wine', mat=None):
    mat = mat or m_glass('PropGlass', thin=False)
    if kind == 'wine':
        prof = [(0, 0), (0.035, 0), (0.036, 0.002), (0.004, 0.006), (0.0035, 0.09), (0.02, 0.1), (0.04, 0.14),
                (0.038, 0.2), (0.036, 0.2), (0.038, 0.14), (0.019, 0.102), (0, 0.098)]
    else:
        prof = [(0, 0), (0.033, 0), (0.036, 0.11), (0.033, 0.11), (0.03, 0.006), (0, 0.006)]
    o = lathe('Glass', prof, 64, mat)
    subsurf(o, 1)
    o.location = loc
    return o


def plate_prop(loc, r=0.13, mat=None):
    mat = mat or m_ceramic('Plate', color=(0.9, 0.9, 0.88), printable=False, tint=False)
    prof = [(0, 0.004), (r * 0.6, 0.004), (r * 0.62, 0.0), (r * 0.68, 0.0), (r * 0.72, 0.008), (r, 0.018),
            (r, 0.021), (r * 0.72, 0.012), (r * 0.62, 0.007), (0, 0.007)]
    o = lathe('Plate', prof, 96, mat)
    subsurf(o, 1)
    o.location = loc
    return o


def cutlery_knife(loc, rot=0.0, length=0.22):
    metal = m_metal('Steel', (0.85, 0.85, 0.86), rough=0.18)
    def fn(s, t):
        x = (s - 0.5) * length
        if s < 0.45:
            w = 0.009
        else:
            q = (s - 0.45) / 0.55
            w = 0.011 * (1 - q ** 3) + 0.001
        y = (t - 0.5) * 2 * w
        return (x, y, 0.0)
    o = grid_mesh('Knife', 30, 2, fn, mat=metal)
    solidify(o, 0.0025, 0)
    subsurf(o, 1)
    o.location = (loc[0], loc[1], loc[2] + 0.0013)
    o.rotation_euler = (0, 0, math.radians(rot))
    return o


def bokeh_lights(center, n=40, spread=(6, 1, 2), size=(0.02, 0.06), color=(1.0, 0.75, 0.45), strength=30, seed=1):
    rnd = random.Random(seed)
    m = m_emission('Bokeh', color, strength)
    for i in range(n):
        p = (center[0] + rnd.uniform(-1, 1) * spread[0], center[1] + rnd.uniform(-1, 1) * spread[1],
             center[2] + rnd.uniform(-1, 1) * spread[2])
        sphere(rnd.uniform(*size), p, mat=m)


def metaball_obj(name, elems, mat=None, res=0.004, thresh=0.6):
    """elems: list of (co, radius, kind, size_xyz or None, rotation quaternion or None)."""
    mb = bpy.data.metaballs.new(name)
    mb.resolution = res
    mb.render_resolution = res
    mb.threshold = thresh
    for co, r, kind, size, rot in elems:
        e = mb.elements.new()
        e.co = co
        e.radius = r
        e.type = kind
        if size is not None:
            e.size_x, e.size_y, e.size_z = size
        if rot is not None:
            e.rotation = rot
    o = link(bpy.data.objects.new(name, mb))
    if mat:
        o.data.materials.append(mat)
    return o


def capsule_chain(pts, radii, stiff=2.0):
    """Metaball elements along a polyline: (co, radius, 'BALL', None, None) sampled densely."""
    els = []
    for (a, ra), (b, rb) in zip(zip(pts, radii), zip(pts[1:], radii[1:])):
        a, b = Vector(a), Vector(b)
        n = max(2, int((b - a).length / (min(ra, rb) * 0.35)))
        for k in range(n):
            f = k / n
            els.append((a.lerp(b, f), ra + (rb - ra) * f, 'BALL', None, None))
    els.append((Vector(pts[-1]), radii[-1], 'BALL', None, None))
    return els
