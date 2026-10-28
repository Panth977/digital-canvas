"""Recover a Canva video design's scene durations and text animations from Canva's own MP4.

  python tools/canva-timing.py <file.dcanvas> <ref-dir with page1.png…> <canva.mp4> [--write]

Canva's API reports neither how long each scene lasts nor element animations. Its MP4 export has
both, so:
1. Scene timing: every frame (10 fps) is compared with each scene's still (Canva's PNG export of
   that page); a left-to-right dynamic programme splits the video into the pages in order, which
   gives each page's duration.
2. Text animations: for each text element, the pixels of its own colour inside its box are tracked
   over the first 1.5 s of its scene. Moving into place → Rise / Pan (direction from the shift),
   appearing in place → Fade, growing → Pop. Speed = time until it settles.
With --write the durations and animations go into the file (`animation: {type, duration,
direction}` as the editor's Animate panel writes them). Needs numpy, Pillow and ffmpeg.
"""
import io, json, os, subprocess, sys, zipfile
import numpy as np
from PIL import Image

src, ref_dir, mp4 = sys.argv[1:4]
write = '--write' in sys.argv
FPS = 10
z = zipfile.ZipFile(src)
doc = json.loads(z.read('document.json'))
files = {n: z.read(n) for n in z.namelist()}
z.close()
pages = doc['pages']
W0, H0 = doc['width'], doc['height']
# small frames for timing, larger for animations
SW = 160
SH = round(SW * H0 / W0)


def frames(w, h, t0=0.0, t1=None, fps=FPS):
    args = ['ffmpeg', '-v', 'error', '-ss', f'{t0:.3f}'] + (['-to', f'{t1:.3f}'] if t1 else []) + ['-i', mp4, '-vf', f'fps={fps},scale={w}:{h}', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-']
    raw = subprocess.run(args, capture_output=True, check=True).stdout
    n = len(raw) // (w * h * 3)
    return np.frombuffer(raw[:n * w * h * 3], dtype=np.uint8).reshape(n, h, w, 3).astype(np.int16)


# ---- 1. scene timing ----
F = frames(SW, SH)
stills = []
for i in range(len(pages)):
    p = f'{ref_dir}/page{i + 1}.png'
    stills.append(np.asarray(Image.open(p).convert('RGB').resize((SW, SH), Image.BILINEAR), dtype=np.int16) if os.path.exists(p) else None)
N, P = len(F), len(pages)
cost = np.zeros((N, P))
for j, s in enumerate(stills):
    cost[:, j] = 60.0 if s is None else np.abs(F - s[None]).mean(axis=(1, 2, 3))
# hidden pages are not in the video
visible = [j for j, p in enumerate(pages) if not p.get('hidden')]
C = cost[:, visible]
V = len(visible)
dp = np.full((N, V), np.inf)
back = np.zeros((N, V), dtype=np.int8)  # 0 = stayed, 1 = came from previous page
dp[0, 0] = C[0, 0]
for t in range(1, N):
    stay = dp[t - 1]
    move = np.concatenate([[np.inf], dp[t - 1, :-1]])
    back[t] = move < stay
    dp[t] = np.minimum(stay, move) + C[t]
k, starts = V - 1, [0] * V
for t in range(N - 1, 0, -1):
    if back[t, k]:
        starts[k] = t
        k -= 1
total = N / FPS
starts_s = [s / FPS for s in starts]
durs = [round((starts_s[i + 1] if i + 1 < V else total) - starts_s[i], 2) for i in range(V)]
print('scene durations:')
for i, j in enumerate(visible):
    print(f'  page {j + 1}: {pages[j].get("duration", 5)} → {durs[i]} s (starts {starts_s[i]:.1f} s)')


# ---- 2. text animations ----
def hexrgb(h):
    h = h.lstrip('#')
    return np.array([int(h[i:i + 2], 16) for i in (0, 2, 4)], dtype=np.int16)


def walk(els):
    for e in els:
        if e.get('type') == 'group':
            yield from walk(e.get('children', []))
        else:
            yield e


AW = 540
AH = round(AW * H0 / W0)
s = AW / W0
FPS2 = 20
found = 0
for i, j in enumerate(visible):
    page = pages[j]
    els = [e for e in walk(page['elements']) if e.get('type') in ('text', 'image', 'path', 'shape') and abs(e.get('rotation', 0)) < 1
           and not e.get('animation') and not e.get('locked') and e['w'] * e['h'] < W0 * H0 * 0.6]
    if not els:
        continue
    t0 = starts_s[i]
    G = frames(AW, AH, t0, t0 + min(2.5, durs[i]), fps=FPS2)
    if len(G) < 10:
        continue
    settled = G[-1]
    hits = []
    for e in els:
        x0, y0 = max(0, int(e['x'] * s)), max(0, int(e['y'] * s))
        x1, y1 = min(AW, int((e['x'] + e['w']) * s) + 1), min(AH, int((e['y'] + e['h']) * s) + 1)
        if x1 - x0 < 6 or y1 - y0 < 4:
            continue
        pad = int(max(x1 - x0, y1 - y0) * 0.5)  # room to see where it came from
        X0, Y0, X1, Y1 = max(0, x0 - pad), max(0, y0 - pad), min(AW, x1 + pad), min(AH, y1 + pad)
        if e['type'] == 'text':
            col = hexrgb(e['style']['color'])
            mask = lambda fr: np.abs(fr[Y0:Y1, X0:X1] - col).max(axis=2) < 40   # its own colour
        else:
            ref_px = settled[Y0:Y1, X0:X1]
            mask = lambda fr: np.abs(fr[Y0:Y1, X0:X1] - ref_px).max(axis=2) < 30  # matches its final look
        ref = mask(settled)
        inbox = np.zeros_like(ref); inbox[y0 - Y0:y1 - Y0, x0 - X0:x1 - X0] = True
        ref &= inbox
        if e['type'] != 'text':
            ref &= np.abs(settled[Y0:Y1, X0:X1] - G[0][Y0:Y1, X0:X1]).max(axis=2) > 30  # only what changed since the cut
        if ref.sum() < 20:
            continue  # nothing distinct to follow
        ry, rx = np.nonzero(ref)
        pres, cen = [], []
        for fr in G:
            m = mask(fr)
            pres.append((m & ref).sum() / ref.sum())
            ys, xs = np.nonzero(m & ~(~inbox & False))
            cen.append((xs.mean() - rx.mean(), ys.mean() - ry.mean()) if len(xs) > 10 else (0.0, 0.0))
        if pres[0] > 0.8:
            continue  # there from the cut: no entrance
        ka = next((k for k, p in enumerate(pres) if p > (0.12 if e['type'] == 'text' else 0.3)), None)
        ks = next((k for k, p in enumerate(pres) if p > 0.9), None)
        if ka is None or ks is None or ks <= ka or ka < 2:
            continue  # never settles, or already there within 0.1 s of the cut (cuts are found to ±1 frame)
        km = (ka + ks) // 2
        dx, dy = cen[km]
        if e['type'] == 'text' and (abs(dy) > 3 or abs(dx) > 3):
            if abs(dy) >= abs(dx):
                # comes up from below → Rise; only its top showing first (clipped at its baseline) → Baseline
                kind = {'type': 'rise'} if dy > 0 else {'type': 'baseline'}
            else:
                kind = {'type': 'pan', 'direction': 'right' if dx > 0 else 'left'}  # where it comes from
        else:
            kind = {'type': 'fade'}
        start = round(max(0.0, (ka - 1) / FPS2), 2)
        dur = round(max(0.3, (ks - ka + 1) / FPS2), 2)
        hits.append((e, kind, start, dur))
    # one scene's texts usually share Canva's effect: the motion most of them show wins
    kinds = [json.dumps(k, sort_keys=True) for e, k, _, _ in hits if e['type'] == 'text' and k['type'] != 'fade']
    common = json.loads(max(set(kinds), key=kinds.count)) if kinds else None
    for e, kind, start, dur in hits:
        if e['type'] == 'text' and common:
            kind = common
        found += 1
        label = e.get('text', e['type'])[:24]
        print(f'  page {j + 1} {label!r}: {kind["type"]}{" from " + kind["direction"] if "direction" in kind else ""} at {start} s over {dur} s')
        if write:
            e['animation'] = {**kind, 'duration': dur}
            if start > 0.1:
                e['timing'] = {**(e.get('timing') or {}), 'start': start}

print(f'{found} entrance animation(s) found')
if write:
    for i, j in enumerate(visible):
        pages[j]['duration'] = durs[i]
    files['document.json'] = json.dumps(doc).encode()
    tmp = src + '.tmp'
    with zipfile.ZipFile(tmp, 'w') as zo:
        zo.writestr(zipfile.ZipInfo('mimetype'), files.pop('mimetype', b'application/vnd.digital-canvas+zip'))
        for k2, v in files.items():
            zo.writestr(k2, v, zipfile.ZIP_STORED if k2.startswith('assets/') else zipfile.ZIP_DEFLATED)
    os.replace(tmp, src)
