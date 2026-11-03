"""Rebuild the font fixtures (WOFF / WOFF2 of Inter, OFL, from apps/web/public/fonts).

    python3 -m venv /tmp/ftvenv && /tmp/ftvenv/bin/pip install fonttools brotli
    /tmp/ftvenv/bin/python packages/render/test/fixtures/fonts/make.py

Inter is subset to a few characters (with composite accents) to keep the files small.
inter-sub.ttf is the reference; .woff is zlib; .woff2 has the glyf/loca transform;
-hmtx.woff2 also has the hmtx transform. inter-bi.woff2 is Bold Italic (for fontInfo).
"""
import os
from fontTools import subset
from fontTools.ttLib import TTFont
from fontTools.ttLib import woff2

HERE = os.path.dirname(os.path.abspath(__file__))
FONTS = os.path.join(HERE, '../../../../../apps/web/public/fonts')
TEXT = 'Hello Wörld éàüñ 0123 MW'

def sub(src, out_ttf):
    opts = subset.Options()
    opts.name_IDs = ['*']
    opts.layout_features = []
    opts.notdef_outline = True
    opts.hinting = True
    f = TTFont(os.path.join(FONTS, src))
    s = subset.Subsetter(opts)
    s.populate(text=TEXT)
    s.subset(f)
    f.flavor = None
    f.save(out_ttf)

ttf = os.path.join(HERE, 'inter-sub.ttf')
sub('Inter-Regular.ttf', ttf)
f = TTFont(ttf); f.flavor = 'woff'; f.save(os.path.join(HERE, 'inter-sub.woff'))
woff2.compress(ttf, os.path.join(HERE, 'inter-sub.woff2'))
woff2.compress(ttf, os.path.join(HERE, 'inter-sub-hmtx.woff2'), transform_tables={'glyf', 'loca', 'hmtx'})
bi = os.path.join(HERE, '_bi.ttf')
sub('Inter-BoldItalic.ttf', bi)
woff2.compress(bi, os.path.join(HERE, 'inter-bi.woff2'))
os.remove(bi)
