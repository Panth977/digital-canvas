#!/bin/bash
# Exact rebuild of one Canva design
#   tools/canva-exact.sh <design-id> "<title>"
# Inputs in $CANVA_DIR/<id>/ (default /tmp/canva): page*.json (Canva read-design pages), hi/page*.png
# (Canva PNG export), canva.pdf (Canva PDF export, for fonts); $CANVA_DIR/assets-exact/ holds Canva's
# original assets. Writes out3.dcanvas and diff3/. $PY needs pypdf, fontTools, Pillow, numpy.
#
# Steps: fonts (from its PDF) → import with Canva's original assets →
# per-element text alignment (twice) → pixel diff against Canva's render. Big designs go page by page.
set -e
id=$1; title=$2; d=${CANVA_DIR:-/tmp/canva}/$id; PY=${PY:-python3}
cd "$(dirname "$0")/.."
n=$(ls $d/page*.json | wc -l | tr -d ' ')
if [ -f $d/canva.pdf ] && [ ! -f $d/fonts.json -o -n "$REFONT" ]; then $PY tools/canva-fonts/fontmap.py $d > $d/fontmap.log 2>&1 || echo "fontmap failed"; fi
FONTS=""; [ -f $d/fonts.json ] && FONTS="--fonts $d/fonts.json"
mkdir -p $d/assets
EX="--exact ${CANVA_DIR:-/tmp/canva}/assets-exact"
if [ "$n" -le 2 ]; then
  pages=$(ls $d/page*.json | sort -V | tr '\n' ',' | sed 's/,$//')
  npx tsx tools/canva-import.ts $pages $d/assets $d/out3.dcanvas "$title" --crops $d/hi $FONTS $EX > $d/import3.log 2>&1
else
  parts=""
  for i in $(seq 1 $n); do
    mkdir -p $d/one/$i; ln -sf $d/hi/page$i.png $d/one/$i/page1.png
    npx tsx tools/canva-import.ts $d/page$i.json $d/assets $d/one/$i.dcanvas "$title" --crops $d/one/$i $FONTS $EX > $d/import3-p$i.log 2>&1
    parts="$parts $d/one/$i.dcanvas"
  done
  npx tsx tools/merge-dcanvas.ts $d/out3.dcanvas $parts > $d/import3.log 2>&1
fi
# video clips: where each starts (Canva doesn't report trims)
$PY tools/canva-videotrim.py $d/out3.dcanvas $d/hi < /dev/null > $d/videotrim.log 2>&1 || true
npx tsx tools/canva-align.ts $d/out3.dcanvas $d/hi > $d/align3.log 2>&1 || true
npx tsx tools/canva-align.ts $d/out3.dcanvas $d/hi 0.15 >> $d/align3.log 2>&1 || true
DIFF_OURS=1 npx tsx tools/diff.ts $d/out3.dcanvas $d/hi $d/diff3 > $d/diff3.log 2>&1
# photos Canva shows with the background removed: cut them out layer by layer (render after each
# pass); keep the result only if the whole design matches better
cp $d/out3.dcanvas $d/out3.pre.dcanvas; rm -f $d/out3.dcanvas.bgmask.json $d/bgmask.log
src=$d/diff3; moved=0
for pass in 1 2 3 4 5 6; do
  $PY tools/canva-bgmask.py $d/out3.dcanvas $d/hi $src >> $d/bgmask.log 2>&1 || break
  tail -1 $d/bgmask.log | grep -q '^0 photo(s) cut out, 0 put back' && break
  rm -rf $d/diff3m; DIFF_OURS=1 npx tsx tools/diff.ts $d/out3.dcanvas $d/hi $d/diff3m > $d/diff3m.log 2>&1; src=$d/diff3m; moved=1
done
if [ $moved = 1 ]; then
  a=$(grep -i average $d/diff3.log | grep -o '[0-9.]*%' | tr -d %); b=$(grep -i average $d/diff3m.log | grep -o '[0-9.]*%' | tr -d %)
  if python3 -c "import sys; sys.exit(0 if $b > $a else 1)"; then rm -rf $d/diff3; mv $d/diff3m $d/diff3; mv $d/diff3m.log $d/diff3.log; else cp $d/out3.pre.dcanvas $d/out3.dcanvas; echo "bgmask reverted ($b <= $a)" >> $d/bgmask.log; fi
fi
rm -f $d/diff3/ours-page*.png
echo "$id $(grep -i 'average' $d/diff3.log | tail -1)"
