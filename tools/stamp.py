#!/usr/bin/env python3
"""Version-stamp the app: hash all shipped files -> js/version.js + sw.js (cache name + precache list).
Run after any change (and after build_packs.py). A changed sw.js makes installed apps update."""
import hashlib, json, os, pathlib
ROOT = pathlib.Path(__file__).resolve().parent.parent
SHIP = ['index.html', 'manifest.webmanifest', 'css', 'js', 'data', 'icons']
files = []
for s in SHIP:
    p = ROOT / s
    files += [p] if p.is_file() else sorted(x for x in p.rglob('*') if x.is_file())
files = [f for f in files if f.name != 'version.js']
h = hashlib.sha256()
for f in files: h.update(str(f.relative_to(ROOT)).encode()); h.update(f.read_bytes())
base = (ROOT / 'VERSION').read_text().strip()
version = f'{base}+{h.hexdigest()[:8]}'
(ROOT / 'js' / 'version.js').write_text(f"export const APP_VERSION = '{version}';\n")
assets = ['./'] + [str(f.relative_to(ROOT)) for f in files] + ['js/version.js']
sw = (ROOT / 'tools' / 'sw.template.js').read_text().replace('__VERSION__', version).replace('__ASSETS__', json.dumps(sorted(set(assets)), indent=1))
(ROOT / 'sw.js').write_text(sw)
print(version, len(assets), 'assets')
