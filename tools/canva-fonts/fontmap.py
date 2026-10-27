"""Build fonts.json for tools/canva-import.ts from a Canva design's PDF export.

  python tools/canva-fonts/fontmap.py <design-dir>      (needs <dir>/canva.pdf and <dir>/page*.json)

Extracts the font subsets Canva embedded per page, merges each font's subsets, and maps every Canva
fontRef (+ weight/style) to the PDF font whose characters best cover the text it was used for."""
import glob, json, os, re, subprocess, sys, collections, urllib.parse
d = sys.argv[1]
py = sys.executable
here = os.path.dirname(os.path.abspath(__file__))
out = f'{d}/pdffonts'
os.makedirs(out, exist_ok=True)
subprocess.run([py, f'{here}/extract_fonts.py', f'{d}/canva.pdf', out], check=True, capture_output=True)
index = json.load(open(f'{out}/index.json'))
# merge per font name
byname = collections.defaultdict(list)
for k, v in index.items(): byname[v['name']].append(v)
merged = {}
for name, items in byname.items():
    f = f'{out}/{name}-merged.ttf'
    subprocess.run([py, f'{here}/merge_subsets.py', f] + [i['file'] for i in items], check=True, capture_output=True)
    merged[name] = f
# A subset whose glyphs have no Unicode map can't draw text: use the whole font from Google Fonts
import urllib.request
def google(name):
    fam, w, it = parse(name)
    url = 'https://fonts.googleapis.com/css?family=' + urllib.parse.quote(fam) + f':{w}{"i" if it else ""}'
    try:
        css = urllib.request.urlopen(url, timeout=20).read().decode()
        ttf = re.search(r'url\((https:[^)]+\.ttf)\)', css).group(1)
        f = f'{out}/{name}-google.ttf'
        open(f, 'wb').write(urllib.request.urlopen(ttf, timeout=60).read())
        return f
    except Exception:
        return None
blind = {v['name'] for v in index.values() if not set(v['chars']) - {' '}}
blind -= {v['name'] for v in index.values() if set(v['chars']) - {' '}}
# Canva side: chars per (page, fontRef, weight, style)
def leaves(els):
    for e in els:
        if e.get('type') == 'group': yield from leaves(e.get('children', []))
        else: yield e
uses = collections.defaultdict(lambda: collections.defaultdict(set))  # key -> page -> chars
for pf in sorted(glob.glob(f'{d}/page*.json'), key=lambda p: int(re.findall(r'\d+', os.path.basename(p))[0])):
    pn = int(re.findall(r'\d+', os.path.basename(pf))[0])
    page = json.load(open(pf))
    for e in leaves(page.get('elements', [])):
        for r in e.get('textRegions') or []:
            fm = r['formatting']
            key = (fm['fontRef'].split(',')[0], fm.get('fontWeight', 'normal'), fm.get('fontStyle', 'normal'))
            uses[key][pn] |= set(c for c in r['characters'] if not c.isspace())
WEIGHTS = [('Thin', 100), ('ExtraLight', 200), ('UltraLight', 200), ('Light', 300), ('Regular', 400), ('Book', 400), ('Medium', 500),
           ('SemiBold', 600), ('DemiBold', 600), ('ExtraBold', 800), ('UltraBold', 800), ('Bold', 700), ('Black', 900), ('Heavy', 900)]
def parse(name):
    fam, _, style = name.partition('-')
    w = 400
    for word, val in WEIGHTS:
        if word.lower() in style.lower().replace('italic', ''): w = val; break
    italic = 'italic' in style.lower() or 'oblique' in style.lower()
    family = re.sub(r'(?<=[a-z])(?=[A-Z])|(?<=[A-Z])(?=[A-Z][a-z])', ' ', fam).strip()
    return family, w, italic
for name in blind:
    g = google(name)
    if g: merged[name] = g; print('google font for', name)
want_w = {'thin': 100, 'light': 300, 'normal': 400, 'regular': 400, 'medium': 500, 'semibold': 600, 'bold': 700, 'heavy': 800, 'black': 900}
assign = {}
for key, pages in uses.items():
    ref, weight, style = key
    votes = collections.Counter()
    upper = 0
    for pn, chars in pages.items():
        cands = [v for v in index.values() if v['page'] == pn]
        if not cands or not chars: continue
        def score(v):
            F = set(v['chars'])
            hit = sum(1 for c in chars if c in F or c.upper() in F)
            fam, w, it = parse(v['name'])
            bonus = -abs(w - want_w.get(weight, 400)) / 2000 + (0.05 if it == (style == 'italic') else 0)
            return hit / len(chars) + bonus
        best = max(cands, key=score)
        if score(best) < 0.99:
            # text in a font whose subset has no readable cmap (chars unknown): take an unknown one
            blind = [v for v in cands if not set(v['chars']) - {' '}]
            if blind: best = blind[0]
        votes[best['name']] += len(chars)
        F = set(best['chars'])
        lows = [c for c in chars if c.islower()]
        if lows and all(c not in F and c.upper() in F for c in lows): upper += 1
    if votes: assign[key] = (votes.most_common(1)[0][0], upper > 0)
fonts = {}
for (ref, weight, style), (name, up) in assign.items():
    fam, w, it = parse(name)
    m = fonts.setdefault(ref, {'family': fam, 'faces': []})
    pass  # ALL CAPS is decided per text box by the importer
    if not any(f['weight'] == w and f.get('italic', False) == it for f in m['faces']):
        m['faces'].append({'weight': w, **({'italic': True} if it else {}), 'file': merged[name]})
# fonts in the PDF no text maps to (e.g. Canva's fallback for ₹) become fallbacks
used = {n for n, _ in assign.values()}
fb = []
for name in merged:
    if name in used: continue
    fam, w, it = parse(name)
    fb.append({'family': fam, 'faces': [{'weight': w, **({'italic': True} if it else {}), 'file': merged[name]}]})
if fb: fonts['_fallback'] = fb
json.dump(fonts, open(f'{d}/fonts.json', 'w'), indent=1)
for k, v in fonts.items():
    if k != '_fallback': print(k, '→', v['family'], [f['weight'] for f in v['faces']], 'UPPER' if v.get('uppercase') else '')
    else: print('fallback:', [x['family'] for x in v])
