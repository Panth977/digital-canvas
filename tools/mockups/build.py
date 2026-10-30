"""Build the photo mockup library: download -> maps (photo.py) -> contract files (pack.py) -> LICENSES.md.

  python tools/mockups/build.py [ids...]        build (no ids = all)
  python tools/mockups/build.py --grid id ...   write a pixel grid of the prepared photo to read coordinates
  python tools/mockups/build.py --prune         remove folders that are not in specs.py

Needs numpy, opencv-python-headless, Pillow. Photos are cached in DC_PHOTO_CACHE (default /tmp/dc-mockup-photos)
and never committed at full size.
"""
import os, sys, json, subprocess, shutil
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import cv2
import numpy as np
import pack, photo
from specs import SPECS

ROOT = os.path.abspath(os.path.join(HERE, '..', '..'))
OUT = os.path.join(ROOT, 'apps', 'web', 'public', 'mockups')
CACHE = os.environ.get('DC_PHOTO_CACHE', '/tmp/dc-mockup-photos')


def source(s):
    os.makedirs(CACHE, exist_ok=True)
    p = os.path.join(CACHE, s['photo'] + '.jpg')
    if not os.path.exists(p):
        url = f"https://images.unsplash.com/photo-{s['photo']}?w={s.get('dl', 2400)}&q=88&fm=jpg"
        subprocess.run(['curl', '-sSfL', '--retry', '4', '--retry-delay', '10', '-m', '90', '-o', p + '.part', url], check=True)
        os.replace(p + '.part', p)
    return p


def grid(s, dest):
    rgb = photo.prepare(source(s), s.get('crop')).copy()
    h, w = rgb.shape[:2]
    for x in range(0, w, 100):
        cv2.line(rgb, (x, 0), (x, h), (255, 0, 255) if x % 500 == 0 else (0, 255, 255), 1)
        cv2.putText(rgb, str(x), (x + 2, 14), cv2.FONT_HERSHEY_SIMPLEX, .45, (255, 0, 0), 1, cv2.LINE_AA)
    for y in range(0, h, 100):
        cv2.line(rgb, (0, y), (w, y), (255, 0, 255) if y % 500 == 0 else (0, 255, 255), 1)
        cv2.putText(rgb, str(y), (2, y + 14), cv2.FONT_HERSHEY_SIMPLEX, .45, (255, 0, 0), 1, cv2.LINE_AA)
    cv2.imwrite(dest, cv2.cvtColor(rgb, cv2.COLOR_RGB2BGR), [cv2.IMWRITE_JPEG_QUALITY, 85])


def one(s, order):
    base, u, v, cov, shade, tint, asp = photo.build(s, source(s))
    m = {k: s.get(k) for k in ('id', 'label', 'category', 'colors', 'fit')}
    m['aspect'], m['order'] = float(asp), order
    m['colors'] = s.get('colors') or (['#ffffff'] if tint is not None else [])
    m['credit'] = f"Photo by {s['by']} on Unsplash: https://unsplash.com/photos/{s['slug']}"
    pack.write_mockup(m, base, u, v, cov, shade, tint, OUT)


def licenses():
    L = ['# Mockup library licences', '',
         'Every mockup here is built on a real photograph of a blank product. The photos are NOT covered by this',
         "repository's Apache-2.0 licence: each stays under the licence listed below. The maps (uv, shade, tint) are",
         'derived from them by `tools/mockups/`.', '',
         'The [Unsplash License](https://unsplash.com/license) allows free commercial and non-commercial use with no',
         'permission needed. It does not allow selling photos unaltered or compiling them into a competing service.', '',
         '| Mockup | Author | Licence | Source |', '|---|---|---|---|']
    for s in sorted(SPECS, key=lambda s: (pack.CATS.index(s['category']), s['id'])):
        url = f"https://unsplash.com/photos/{s['slug']}"
        L.append(f"| {s['id']} | {s['by']} | Unsplash License | {url} |")
    open(os.path.join(OUT, 'LICENSES.md'), 'w').write('\n'.join(L) + '\n')


if __name__ == '__main__':
    a = sys.argv[1:]
    ids = [x for x in a if not x.startswith('--')]
    by = {s['id']: s for s in SPECS}
    if '--grid' in a:
        os.makedirs('/tmp/r14-dl/grid', exist_ok=True)
        for i in ids:
            grid(by[i], f'/tmp/r14-dl/grid/{i}.jpg')
        sys.exit()
    if '--prune' in a:
        for d in os.listdir(OUT):
            if os.path.isdir(os.path.join(OUT, d)) and d not in by:
                shutil.rmtree(os.path.join(OUT, d))
    order = {s['id']: i for i, s in enumerate(SPECS)}
    fails = []
    for i in ids or [s['id'] for s in SPECS]:
        try:
            one(by[i], order[i])
        except Exception as e:
            fails.append(i)
            print('!!', i, repr(e))
    idx = pack.write_index(OUT)
    licenses()
    print(f"index.json: {len(idx['mockups'])} mockups; failed: {fails}")
