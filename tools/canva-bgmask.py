"""Put back the background removal Canva did on imported photos.

  python tools/canva-bgmask.py <file.dcanvas> <ref-dir with page1.png…> <ours-dir with ours-page1.png…>

Canva's API gives the original upload of a photo even when the design shows it with its
background removed. For each image whose box differs from Canva's render, this keeps the
pixels where our render already matches Canva (the subject) and makes the rest transparent,
then writes that cut-out as a new content-hashed asset (the old one stays on the element as
`original`). `ours-dir` is a `tools/diff.ts` out-dir made with DIFF_OURS=1.

It works in passes: a photo is only cut when no other photo to fix lies on top of it (what is
underneath can't be judged until the photo above is cut). After each pass, render again
(diff.ts with DIFF_OURS=1) and run it again: it first checks the photos cut last time and puts
back any whose box did not get closer to Canva, then cuts the next layer. It prints
"0 photo(s) cut out" when there is nothing more to do. State between passes is kept in
<file.dcanvas>.bgmask.json. tools/canva-exact.sh runs the loop. Needs Pillow and numpy.
"""
import hashlib, io, json, os, sys, zipfile
import numpy as np
from PIL import Image, ImageFilter

src, ref_dir, ours_dir = sys.argv[1:4]
state_file = src + '.bgmask.json'
state = json.load(open(state_file)) if os.path.exists(state_file) else {}
state = {'last': {}, 'skip': [], 'made': [], **state}
z = zipfile.ZipFile(src)
doc = json.loads(z.read('document.json'))
files = {n: z.read(n) for n in z.namelist()}
z.close()

BAD = 40      # a channel off by more than this = a pixel that differs
FLAG = 0.12   # share of differing pixels in a box that marks a photo to fix
SAME = 28     # pixels closer than this are the subject
GAIN = 0.02   # a cut must lower the box's differing share by this much to stay


def walk(els):
    for e in els:
        if e.get('type') == 'group':
            yield from walk(e.get('children', []))
        else:
            yield e


def candidate(e):
    return (e.get('type') == 'image' and e.get('asset') and not e.get('locked') and not e.get('mask')
            and abs(e.get('rotation', 0)) <= 0.01 and e['id'] not in state['skip'])


def overlap(a, b):
    ix = max(0, min(a[2], b[2]) - max(a[0], b[0]))
    iy = max(0, min(a[3], b[3]) - max(a[1], b[1]))
    return ix * iy / max(1, (a[2] - a[0]) * (a[3] - a[1]))


changed, reverted, last = 0, 0, {}
for n, page in enumerate(doc['pages'], 1):
    rp, op = f'{ref_dir}/page{n}.png', f'{ours_dir}/ours-page{n}.png'
    if not (os.path.exists(rp) and os.path.exists(op)):
        continue
    ref = np.asarray(Image.open(rp).convert('RGB'), dtype=np.int16)
    ours = np.asarray(Image.open(op).convert('RGB'), dtype=np.int16)
    if abs(ref.shape[0] - ours.shape[0]) > 2 or abs(ref.shape[1] - ours.shape[1]) > 2:
        continue
    H, W = min(ref.shape[0], ours.shape[0]), min(ref.shape[1], ours.shape[1])
    diff = np.abs(ref[:H, :W] - ours[:H, :W]).max(axis=2)
    s = W / doc['width']

    def box_of(e):
        return (max(0, round(e['x'] * s)), max(0, round(e['y'] * s)),
                min(W, round((e['x'] + e['w']) * s)), min(H, round((e['y'] + e['h']) * s)))

    def bad(b):
        return float((diff[b[1]:b[3], b[0]:b[2]] > BAD).mean())

    els = list(walk(page['elements']))
    # 1. check last pass's cuts: keep those that brought the box closer to Canva
    for e in els:
        before = state['last'].get(e['id'])
        if before is None or not e.get('original'):
            continue
        after = bad(box_of(e))
        if after > before - GAIN:
            e['asset'] = e.pop('original')
            state['skip'].append(e['id'])
            reverted += 1
            print(f"page {n} {e['id']}: put back ({before:.0%} → {after:.0%} differing)")
    # 2. photos to fix this pass: off from Canva, and no other such photo on top of them
    flagged = []
    for e in els:
        if not candidate(e) or e.get('original'):
            continue
        b = box_of(e)
        if b[2] - b[0] < 24 or b[3] - b[1] < 24 or bad(b) < FLAG:
            continue
        flagged.append((e, b))
    for i, (e, b) in enumerate(flagged):
        if any(overlap(b, b2) > 0.05 for _, b2 in flagged[i + 1:]):
            continue  # judged in a later pass, once the photo above it is cut
        name = f"assets/{e['asset']}"
        if name not in files:
            continue
        box = diff[b[1]:b[3], b[0]:b[2]]
        # subject = pixels that already match, cleaned up: close small holes, drop specks, soften
        m = Image.fromarray(((box < SAME) * 255).astype(np.uint8))
        m = m.filter(ImageFilter.MaxFilter(5)).filter(ImageFilter.MinFilter(5))   # close
        m = m.filter(ImageFilter.MinFilter(3)).filter(ImageFilter.MaxFilter(3))   # open
        m = m.filter(ImageFilter.GaussianBlur(1.2))
        cover = np.asarray(m).mean() / 255
        if cover < 0.08 or cover > 0.97:
            state['skip'].append(e['id'])
            continue  # nothing matched, or almost all of it did: not a removed background
        # the box shows `crop` of the asset stretched over it (flips mirror it)
        img = Image.open(io.BytesIO(files[name])).convert('RGBA')
        AW, AH = img.size
        c = e.get('crop') or {'x': 0, 'y': 0, 'w': 1, 'h': 1}
        cw, ch = max(1, round(c['w'] * AW)), max(1, round(c['h'] * AH))
        m = m.resize((cw, ch), Image.BILINEAR)
        if e.get('flipX'):
            m = m.transpose(Image.FLIP_LEFT_RIGHT)
        if e.get('flipY'):
            m = m.transpose(Image.FLIP_TOP_BOTTOM)
        alpha = Image.new('L', (AW, AH), 0)
        alpha.paste(m, (round(c['x'] * AW), round(c['y'] * AH)))
        a = np.asarray(img.getchannel('A'), dtype=np.uint16) * np.asarray(alpha, dtype=np.uint16) // 255
        img.putalpha(Image.fromarray(a.astype(np.uint8)))
        buf = io.BytesIO()
        img.save(buf, 'PNG', optimize=True)
        data = buf.getvalue()
        nid = hashlib.sha256(data).hexdigest()[:20] + '.png'
        files[f'assets/{nid}'] = data
        doc['assets'][nid] = {**doc['assets'].get(e['asset'], {}), 'mime': 'image/png', 'width': AW, 'height': AH}
        state['made'].append(nid)
        e['original'] = e['asset']
        e['asset'] = nid
        last[e['id']] = bad(b)
        changed += 1
        print(f"page {n} {e['id']}: {bad(b):.0%} of the box differed, kept {cover:.0%} as subject")

state['last'] = last
if changed or reverted:
    # drop cut-outs made here that nothing uses any more
    used = {e.get(k) for p in doc['pages'] for e in walk(p['elements']) for k in ('asset', 'original')}
    for nid in [x for x in state['made'] if x not in used]:
        files.pop(f'assets/{nid}', None)
        doc['assets'].pop(nid, None)
    state['made'] = [x for x in state['made'] if x in used]
    files['document.json'] = json.dumps(doc).encode()
    tmp = src + '.tmp'
    with zipfile.ZipFile(tmp, 'w') as out:
        out.writestr(zipfile.ZipInfo('mimetype'), files.pop('mimetype', b'application/vnd.digital-canvas+zip'))
        for k, v in files.items():
            out.writestr(k, v, zipfile.ZIP_STORED if k.startswith('assets/') else zipfile.ZIP_DEFLATED)
    os.replace(tmp, src)
json.dump(state, open(state_file, 'w'))
print(f'{changed} photo(s) cut out, {reverted} put back')
