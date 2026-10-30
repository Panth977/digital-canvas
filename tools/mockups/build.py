"""Orchestrate: render (Blender, one process per mockup) -> pack -> contact sheet.

  python tools/mockups/build.py [ids...] [--preview] [--skip-render] [--all]

--preview: 50 % size, 32 samples, into /tmp/dcm-raw-prev + /tmp/dcm-prev (library untouched).
Without ids renders every registered mockup. Run with the venv python (numpy, scipy, Pillow).
"""
import sys, os, subprocess, time
HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, '..', '..'))
PY = sys.executable
args = sys.argv[1:]
preview = '--preview' in args
skip = '--skip-render' in args
ids = [a for a in args if not a.startswith('--')]
raw = '/tmp/dcm-raw-prev' if preview else '/tmp/dc-mockups-raw'
out = '/tmp/dcm-prev' if preview else os.path.join(ROOT, 'apps', 'web', 'public', 'mockups')
BL = ['blender', '-b', '--factory-startup', '-P', os.path.join(HERE, 'render_one.py'), '--']
if not ids:
    r = subprocess.run(BL + ['--list'], capture_output=True, text=True)
    ids = next(l for l in r.stdout.splitlines() if l.startswith('IDS ')).split()[1:]
fails = []
if not skip:
    for mid in ids:
        t = time.time()
        extra = ['--pct', '50', '--samples', '32'] if preview else []
        r = subprocess.run(BL + [mid, '--out', raw] + extra, capture_output=True, text=True)
        ok = 'RENDERED' in r.stdout
        print(f'{mid}: {"ok" if ok else "FAILED"} {time.time() - t:.0f}s', flush=True)
        if not ok:
            fails.append(mid)
            print('\n'.join((r.stdout + r.stderr).splitlines()[-25:]))
good = [m for m in ids if m not in fails]
if good:
    subprocess.run([PY, os.path.join(HERE, 'pack.py'), *good, '--raw', raw, '--out', out], check=True)
    env = dict(os.environ, DC_MOCKUP_LIB=out)
    sheet = os.path.join(out, 'sheet.jpg') if preview else '/tmp/orch27-rw/r13-mockups-sheet.jpg'
    subprocess.run([PY, os.path.join(HERE, 'composite.py'), '--sheet', sheet, '--big', ','.join(good),
                    '--bigdir', '/tmp/dcm-big', *good], env=env, check=True)
print('FAILED:', fails)
