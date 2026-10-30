"""Blender entry: blender -b --factory-startup -P tools/mockups/render_one.py -- <id> [--out DIR] [--samples N] [--pct P]

Builds the scene, renders Combined + AOVs (pc, tint) to a 32-bit multilayer EXR and writes
<out>/<id>/passes.npz (+ meta.json) for pack.py. --pct renders at that resolution percentage (previews).
"""
import sys, os, json, time
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import bpy
import numpy as np
import importlib
import blib
import scenes

argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
ids, out, samples, pct = [], '/tmp/dc-mockups-raw', None, 100
i = 0
while i < len(argv):
    a = argv[i]
    if a == '--out':
        out = argv[i + 1]; i += 2; continue
    if a == '--samples':
        samples = int(argv[i + 1]); i += 2; continue
    if a == '--pct':
        pct = int(argv[i + 1]); i += 2; continue
    ids.append(a); i += 1

reg = scenes.load_all()
if ids == ['--list'] or ids == ['list']:
    print('IDS ' + ' '.join(scenes.ORDER)); sys.exit(0)


def read_exr(path):
    """Blender 5 writes multilayer EXR as multi-part: one subimage per pass."""
    import OpenImageIO as oiio
    inp = oiio.ImageInput.open(path)
    planes, names = [], []
    k = 0
    while inp.seek_subimage(k, 0):
        spec = inp.spec()
        px = np.asarray(inp.read_image(k, 0, 0, spec.nchannels, 'float')).reshape(spec.height, spec.width, spec.nchannels)
        for c, n in enumerate(spec.channelnames):
            names.append(n)
            planes.append(px[:, :, c])
        k += 1
    inp.close()
    px = np.stack(planes, -1)

    def ch(*cands):
        for c in cands:
            for k, n in enumerate(names):
                if n.endswith(c):
                    return px[:, :, k]
        raise KeyError(f'{cands} not in {names}')
    comb = np.stack([ch('Combined.R'), ch('Combined.G'), ch('Combined.B')], -1)
    pc = np.stack([ch('pc.R'), ch('pc.G'), ch('pc.B')], -1)
    try:
        tint = ch('tint.X', 'tint.V', 'tint')
    except KeyError:
        tint = np.zeros(comb.shape[:2], np.float32)
    return comb.astype(np.float32), pc.astype(np.float32), tint.astype(np.float32), names


for mid in ids:
    m = reg[mid]
    t0 = time.time()
    blib.reset(res=(m['width'], m['height']), samples=samples or m['samples'])
    sc = bpy.context.scene
    sc.render.resolution_percentage = pct
    m['build']()
    d = os.path.join(out, mid)
    os.makedirs(d, exist_ok=True)
    if hasattr(sc.render.image_settings, 'media_type'):
        sc.render.image_settings.media_type = 'MULTI_LAYER_IMAGE'
    sc.render.image_settings.file_format = 'OPEN_EXR_MULTILAYER'
    sc.render.image_settings.color_depth = '32'
    sc.render.image_settings.exr_codec = 'ZIP'
    exr = os.path.join(d, 'passes.exr')
    sc.render.filepath = exr
    bpy.ops.render.render(write_still=True)
    comb, pc, tint, names = read_exr(exr)
    np.savez(os.path.join(d, 'passes.npz'), combined=comb, pc=pc, tint=tint)
    os.remove(exr)
    meta = {k: v for k, v in m.items() if k != 'build'}
    meta['render_pct'] = pct
    meta['order'] = scenes.ORDER.index(mid)
    meta['seconds'] = round(time.time() - t0, 1)
    json.dump(meta, open(os.path.join(d, 'meta.json'), 'w'), indent=1)
    print(f'RENDERED {mid} in {meta["seconds"]}s channels={names}', flush=True)
