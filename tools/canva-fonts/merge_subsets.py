"""Merge subsets of one font (as cut by a PDF writer) into a single font with the union of characters."""
import sys
from fontTools.ttLib import TTFont
out, files = sys.argv[1], sys.argv[2:]
fonts = [TTFont(f) for f in files]
base = max(fonts, key=lambda f: len(f.getBestCmap() or {}))
cmap = dict(base.getBestCmap())
glyf, hmtx = base['glyf'], base['hmtx']
order = list(base.getGlyphOrder())
n = 0
def copy_glyph(src, gname, prefix):
    """Copy a glyph (and the components it is built from) into base; return its new name."""
    global n
    new = f'{prefix}_{gname}'
    if new in glyf.glyphs: return new
    g = src['glyf'][gname]
    if g.isComposite():
        for comp in g.components:
            comp.glyphName = copy_glyph(src, comp.glyphName, prefix)
    glyf.glyphs[new] = g
    hmtx.metrics[new] = src['hmtx'].metrics[gname]
    order.append(new)
    n += 1
    return new
for i, f in enumerate(fonts):
    if f is base: continue
    for code, gname in (f.getBestCmap() or {}).items():
        if code in cmap: continue
        cmap[code] = copy_glyph(f, gname, f's{i}')
base.setGlyphOrder(order)
glyf.glyphOrder = order
base['maxp'].numGlyphs = len(order)
for t in base['cmap'].tables:
    t.cmap = {k: v for k, v in cmap.items() if t.format != 4 or k <= 0xFFFF}
if 'post' in base: base['post'].formatType = 3.0  # no glyph names needed
base.save(out)
print(f'{out}: {len(cmap)} characters ({n} glyphs added)', ''.join(sorted(chr(c) for c in cmap)))
