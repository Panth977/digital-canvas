"""Find where each imported Canva video clip starts, from Canva's own render of the page.

  python tools/canva-videotrim.py <file.dcanvas> <ref-dir with page1.png…>

Canva's API reports which clip a video element plays but not its trim, so a clip split over
several pages imports as the whole clip on each. Canva's PNG export shows each page's first
frame; this samples the clip, finds the time whose frame (cropped and scaled like the element)
looks most like that render, and sets `trimStart` there with a matching `poster`. When the next
page plays the same clip from later on, this page's `trimEnd` is where that one starts, and
each page lasts as long as its piece of the clip. Needs Pillow, numpy and ffmpeg.
"""
import hashlib, io, json, os, subprocess, sys, tempfile, zipfile
import numpy as np
from PIL import Image

src, ref_dir = sys.argv[1:3]
z = zipfile.ZipFile(src)
doc = json.loads(z.read('document.json'))
files = {n: z.read(n) for n in z.namelist()}
z.close()
tmp = tempfile.mkdtemp()
SW = 96  # width the comparison runs at


def walk(els):
    for e in els:
        if e.get('type') == 'group':
            yield from walk(e.get('children', []))
        else:
            yield e


def clip_file(asset):
    f = os.path.join(tmp, asset)
    if not os.path.exists(f):
        open(f, 'wb').write(files[f'assets/{asset}'])
    return f


def frames(f, start, end, fps, size):
    """Frames from start to end at fps, each WxH RGB, with their times."""
    w, h = size
    raw = subprocess.run(['ffmpeg', '-v', 'error', '-ss', f'{start:.3f}', '-to', f'{end:.3f}', '-i', f,
                          '-vf', f'fps={fps},scale={w}:{h}', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'],
                         capture_output=True, check=True).stdout
    n = len(raw) // (w * h * 3)
    arr = np.frombuffer(raw[:n * w * h * 3], dtype=np.uint8).reshape(n, h, w, 3).astype(np.int16)
    return [(start + i / fps, arr[i]) for i in range(n)]


def best_time(e, meta, target):
    """The clip time whose frame, shown through the element's crop, is closest to target."""
    f = clip_file(e['asset'])
    dur = meta.get('duration') or 0
    vw, vh = meta.get('width') or 1920, meta.get('height') or 1080
    c = e.get('crop') or {'x': 0, 'y': 0, 'w': 1, 'h': 1}
    # scale the whole frame so that its cropped part is target-sized, then cut that part
    th, tw = target.shape[:2]
    fw, fh = max(2, round(tw / c['w'])), max(2, round(th / c['h']))
    fw += fw % 2; fh += fh % 2
    ox, oy = round(c['x'] * fw), round(c['y'] * fh)

    def score(fr):
        part = fr[oy:oy + th, ox:ox + tw]
        if part.shape != target.shape:
            return 1e9
        return float(np.abs(part - target).mean())

    first = [(0.0, score(fr)) for _, fr in frames(f, 0, min(dur, 0.2), 10, (fw, fh))[:1]]
    coarse = [(t, score(fr)) for t, fr in frames(f, 0, dur, 2, (fw, fh))]
    if not coarse or not first:
        return None, None
    t0 = min(coarse, key=lambda x: x[1])[0]
    fine = [(t, score(fr)) for t, fr in frames(f, max(0, t0 - 0.6), min(dur, t0 + 0.6), 15, (fw, fh))]
    best = min(fine + coarse, key=lambda x: x[1])
    # the untrimmed start wins unless a later frame is clearly closer
    return best if best[1] < first[0][1] * 0.8 else first[0]


found = []  # (page index, element, start)
for n, page in enumerate(doc['pages'], 1):
    rp = f'{ref_dir}/page{n}.png'
    if not os.path.exists(rp):
        continue
    ref = Image.open(rp).convert('RGB')
    s = ref.width / doc['width']
    for e in walk(page['elements']):
        if e.get('type') != 'video' or abs(e.get('rotation', 0)) > 0.01 or f"assets/{e['asset']}" not in files:
            continue
        meta = doc['assets'].get(e['asset'], {})
        box = (max(0, round(e['x'] * s)), max(0, round(e['y'] * s)),
               min(ref.width, round((e['x'] + e['w']) * s)), min(ref.height, round((e['y'] + e['h']) * s)))
        k = SW / max(1, box[2] - box[0])
        tw, th = SW, max(8, round((box[3] - box[1]) * k))
        target = np.asarray(ref.crop(box).resize((tw, th), Image.BILINEAR), dtype=np.int16)
        if e.get('flipX'):
            target = target[:, ::-1]
        if e.get('flipY'):
            target = target[::-1]
        t, err = best_time(e, meta, target)
        if t is None:
            continue
        found.append((n - 1, e, t))
        print(f'page {n} {e["id"]}: starts at {t:.2f}s (frame error {err:.1f})')

changed = 0
for i, (pi, e, t) in enumerate(found):
    dur = doc['assets'].get(e['asset'], {}).get('duration') or 0
    nxt = next(((pj, t2) for pj, e2, t2 in found[i + 1:] if pj == pi + 1 and e2['asset'] == e['asset']), None)
    if t > 0.15:
        e['trimStart'] = round(t, 2)
    if nxt and nxt[1] > t + 0.3:
        e['trimEnd'] = round(nxt[1], 2)
    if e.get('trimStart') or e.get('trimEnd'):
        page = doc['pages'][pi]
        piece = (e.get('trimEnd') or dur) - (e.get('trimStart') or 0)
        if dur and abs((page.get('duration') or 0) - dur) < 0.2 and piece > 0.2:
            page['duration'] = round(piece, 3)  # the importer gave it the whole clip
        # poster: the frame the page opens on, full size
        png = subprocess.run(['ffmpeg', '-v', 'error', '-ss', f'{t:.3f}', '-i', clip_file(e['asset']), '-frames:v', '1',
                              '-f', 'image2', '-vcodec', 'png', '-'], capture_output=True, check=True).stdout
        pid = hashlib.sha256(png).hexdigest()[:20] + '.png'
        im = Image.open(io.BytesIO(png))
        files[f'assets/{pid}'] = png
        doc['assets'][pid] = {'mime': 'image/png', 'width': im.width, 'height': im.height, 'name': 'poster'}
        e['poster'] = pid
        changed += 1

if changed:
    files['document.json'] = json.dumps(doc).encode()
    out = src + '.tmp'
    with zipfile.ZipFile(out, 'w') as zo:
        zo.writestr(zipfile.ZipInfo('mimetype'), files.pop('mimetype', b'application/vnd.digital-canvas+zip'))
        for k, v in files.items():
            zo.writestr(k, v, zipfile.ZIP_STORED if k.startswith('assets/') else zipfile.ZIP_DEFLATED)
    os.replace(out, src)
print(f'{changed} clip(s) trimmed')
