"""Extract the font subsets Canva embedded in its PDF export, per page, and give each a Unicode
cmap rebuilt from the PDF's ToUnicode map, so they can render text again."""
import io, re, sys, json
from pypdf import PdfReader
from fontTools.ttLib import TTFont, newTable
from fontTools.ttLib.tables._c_m_a_p import cmap_format_4, cmap_format_12

pdf = PdfReader(sys.argv[1]); out = sys.argv[2]
want = set(sys.argv[3].split(',')) if len(sys.argv) > 3 else None
index = {}
def parse_tounicode(data):
    m = {}
    for block in re.findall(rb'beginbfchar(.*?)endbfchar', data, re.S):
        for a, b in re.findall(rb'<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>', block):
            try: m[int(a, 16)] = bytes.fromhex(b.decode()).decode('utf-16-be')
            except Exception: pass
    for block in re.findall(rb'beginbfrange(.*?)endbfrange', data, re.S):
        for a, b, c in re.findall(rb'<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>', block):
            s, e, u = int(a, 16), int(b, 16), int(c, 16)
            for k in range(s, e + 1): m[k] = chr(u + k - s)
    return m
def all_fonts(res, seen):
    res = res.get_object() if res is not None else {}
    for key, ref in (res.get('/Font') or {}).items():
        yield ref
    for key, xo in (res.get('/XObject') or {}).items():
        o = xo.get_object()
        if id(o) in seen: continue
        seen.add(id(o))
        if o.get('/Subtype') == '/Form' and '/Resources' in o:
            yield from all_fonts(o['/Resources'], seen)
for pi, page in enumerate(pdf.pages, 1):
    done = set()
    for ref in all_fonts(page['/Resources'], set()):
        if ref.idnum in done if hasattr(ref, 'idnum') else False: continue
        if hasattr(ref, 'idnum'): done.add(ref.idnum)
        f = ref.get_object()
        base = str(f.get('/BaseFont', ''))[1:]
        name = base.split('+', 1)[-1]
        if want and name not in want: continue
        desc_font = f['/DescendantFonts'][0].get_object() if '/DescendantFonts' in f else f
        fd = desc_font.get('/FontDescriptor')
        if not fd: continue
        fd = fd.get_object()
        ff = fd.get('/FontFile2') or fd.get('/FontFile3') or fd.get('/FontFile')
        if not ff: continue
        data = ff.get_object().get_data()
        tu = parse_tounicode(f['/ToUnicode'].get_object().get_data()) if '/ToUnicode' in f else {}
        cid2gid = None
        c2g = desc_font.get('/CIDToGIDMap')
        if c2g is not None and not isinstance(c2g.get_object(), str) and hasattr(c2g.get_object(), 'get_data'):
            raw = c2g.get_object().get_data(); cid2gid = {i // 2: (raw[i] << 8) | raw[i + 1] for i in range(0, len(raw), 2)}
        font = TTFont(io.BytesIO(data))
        order = font.getGlyphOrder()
        mapping = {}
        for cid, uni in tu.items():
            gid = cid2gid.get(cid, cid) if cid2gid else cid
            if len(uni) == 1 and gid < len(order): mapping[ord(uni)] = order[gid]
        cm = newTable('cmap'); cm.tableVersion = 0; cm.tables = []
        t4 = cmap_format_4(4); t4.platformID, t4.platEncID, t4.language = 3, 1, 0
        t4.cmap = {k: v for k, v in mapping.items() if k <= 0xFFFF}; cm.tables.append(t4)
        t12 = cmap_format_12(12); t12.platformID, t12.platEncID, t12.language = 3, 10, 0
        t12.cmap = dict(mapping); cm.tables.append(t12)
        font['cmap'] = cm
        # make sure the name table says what it is
        file = f'{out}/p{pi}-{name}.ttf'
        font.save(file)
        index[f'p{pi}-{name}'] = {'page': pi, 'name': name, 'file': file, 'chars': ''.join(sorted(chr(c) for c in mapping))}
json.dump(index, open(f'{out}/index.json', 'w'), ensure_ascii=False, indent=1)
for k, v in index.items(): print(k, len(v['chars']), v['chars'][:60])
