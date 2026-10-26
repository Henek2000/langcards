#!/usr/bin/env python3
"""Version-stamp the app from VERSION (3-part semver, e.g. 0.2.0) -> js/version.js + sw.js
(cache name langapp-<version> + precache list). Run after any change (and after build_packs.py).
The content hash of all shipped files is kept only as a comment in sw.js and in tools/stamp.lock.json;
if shipped files changed but VERSION did not, stamping fails so every release gets a new version."""
import hashlib, json, pathlib, re, sys
ROOT = pathlib.Path(__file__).resolve().parent.parent
SHIP = ['index.html', 'manifest.webmanifest', 'css', 'js', 'data', 'icons']
LOCK = ROOT / 'tools' / 'stamp.lock.json'
version = (ROOT / 'VERSION').read_text().strip()
if not re.fullmatch(r'(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)', version):
    sys.exit(f'VERSION must be MAJOR.MINOR.PATCH, got {version!r}')
files = []
for s in SHIP:
    p = ROOT / s
    files += [p] if p.is_file() else sorted(x for x in p.rglob('*') if x.is_file())
files = [f for f in files if f.name != 'version.js']
h = hashlib.sha256()
for f in files: h.update(str(f.relative_to(ROOT)).encode()); h.update(f.read_bytes())
digest = h.hexdigest()[:12]
lock = json.loads(LOCK.read_text()) if LOCK.exists() else {}
if lock.get('version') == version and lock.get('hash') != digest and '--force' not in sys.argv:
    sys.exit(f'Shipped files changed but VERSION is still {version}: bump VERSION (or pass --force)')
(ROOT / 'js' / 'version.js').write_text(f"export const APP_VERSION = '{version}';\n")
# iOS launch screens are fetched by iOS only at add-to-home-screen time: hash them, but don't make every client precache ~1 MB
assets = ['./'] + [str(f.relative_to(ROOT)) for f in files if not f.name.startswith('lc-splash-')] + ['js/version.js']
sw = (ROOT / 'tools' / 'sw.template.js').read_text().replace('__VERSION__', version).replace('__BUILD__', digest) \
    .replace('__ASSETS__', json.dumps(sorted(set(assets)), indent=1))
(ROOT / 'sw.js').write_text(sw)
LOCK.write_text(json.dumps({'version': version, 'hash': digest}) + '\n')
print(version, f'build {digest}', len(assets), 'assets')
