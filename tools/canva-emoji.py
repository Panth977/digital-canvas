"""Embed the emoji a design uses, from Noto Color Emoji (OFL), so they draw in colour anywhere.

  python tools/canva-emoji.py <file.dcanvas>

Canva draws emoji with its own images; our text renderer falls back to the family
"Noto Color Emoji". This subsets that font (COLRv1, ~25 MB whole) to the emoji in the design
and embeds the few-KB result in Doc.fonts. The full font is downloaded once from Google Fonts
into ~/.cache/digital-canvas/. Needs fontTools.
"""
import hashlib, io, json, os, re, sys, urllib.request, zipfile
from fontTools import subset
from fontTools.ttLib import TTFont

src = sys.argv[1]
cache = os.path.expanduser('~/.cache/digital-canvas/NotoColorEmoji.ttf')
z = zipfile.ZipFile(src)
doc = json.loads(z.read('document.json'))
files = {n: z.read(n) for n in z.namelist()}
z.close()


def texts(els):
    for e in els:
        if e.get('type') == 'group':
            yield from texts(e.get('children', []))
        elif e.get('type') == 'text':
            yield e.get('text', '')
        elif e.get('type') == 'table':
            for row in e.get('cells', []):
                for c in row:
                    yield c.get('text', '')


if any(f.get('family') == 'Noto Color Emoji' for f in doc.get('fonts', [])):
    print('already embedded'); sys.exit()
chars = {c for p in doc['pages'] for t in texts(p['elements']) for c in t}
if not os.path.exists(cache):
    css = urllib.request.urlopen('https://fonts.googleapis.com/css?family=Noto%20Color%20Emoji', timeout=30).read().decode()
    url = re.search(r'url\((https:[^)]+\.ttf)\)', css).group(1)
    os.makedirs(os.path.dirname(cache), exist_ok=True)
    open(cache, 'wb').write(urllib.request.urlopen(url, timeout=300).read())
font = TTFont(cache)
if 'SVG ' in font:
    del font['SVG ']  # COLR/CPAL colour glyphs are what CanvasKit draws
cmap = font.getBestCmap()
emoji = sorted(c for c in chars if ord(c) in cmap and ord(c) > 0x2000 and not c.isalnum())
if not emoji:
    print('no emoji'); sys.exit()
# keep variation selectors / ZWJ so sequences still shape
opts = subset.Options()
opts.layout_features = ['*']
sub = subset.Subsetter(opts)
sub.populate(unicodes=[ord(c) for c in emoji] + [0x200D, 0xFE0F, 0x20E3])
sub.subset(font)
buf = io.BytesIO(); font.save(buf); data = buf.getvalue()
aid = hashlib.sha256(data).hexdigest()[:20] + '.ttf'
files[f'assets/{aid}'] = data
doc['assets'][aid] = {'mime': 'font/ttf', 'name': 'Noto Color Emoji (subset)'}
doc.setdefault('fonts', []).append({'family': 'Noto Color Emoji', 'asset': aid, 'weight': 400, 'source': 'google:noto-color-emoji'})
files['document.json'] = json.dumps(doc).encode()
tmp = src + '.tmp'
with zipfile.ZipFile(tmp, 'w') as zo:
    zo.writestr(zipfile.ZipInfo('mimetype'), files.pop('mimetype', b'application/vnd.digital-canvas+zip'))
    for k, v in files.items():
        zo.writestr(k, v, zipfile.ZIP_STORED if k.startswith('assets/') else zipfile.ZIP_DEFLATED)
os.replace(tmp, src)
print(f'embedded {len(emoji)} emoji ({len(data) // 1024} KB): {"".join(emoji)}')
