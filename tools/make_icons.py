#!/usr/bin/env python3
"""Build the app mark (icons/lc-mark.svg, lc-maskable.svg): a black-ruled card with hard shadows on yellow.
The "Aя" letters are outlines (tools/mark-glyphs.txt, Unbounded Bold, SIL OFL) so the icon needs no font at runtime.
PNGs and iOS launch screens are rendered from these SVGs by tools/render_icons.mjs (headless Chromium)."""
import pathlib
ROOT = pathlib.Path(__file__).resolve().parent.parent
GLYPHS = (ROOT / 'tools/mark-glyphs.txt').read_text().strip()   # drawn around x=256, baseline y=290, 86px

def mark(maskable):
    k = 0.78 if maskable else 1.0          # maskable: keep the artwork inside the 80% safe zone
    return f'''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
<rect width="512" height="512" fill="#ffe14d"/>
<g transform="translate(256 256) scale({k}) translate(-256 -256)" stroke="#0a0a0a" stroke-width="14" stroke-linejoin="miter">
<rect x="168" y="132" width="230" height="300" fill="#0a0a0a"/>
<rect x="150" y="112" width="230" height="300" fill="#2f5bff"/>
<rect x="118" y="84" width="230" height="300" fill="#0a0a0a" stroke="none" transform="translate(16 16)"/>
<rect x="118" y="84" width="230" height="300" fill="#ffffff"/>
<rect x="118" y="84" width="230" height="38" fill="#7c3aed"/>
</g>
<g transform="translate(256 256) scale({k}) translate(-256 -256)">
<path transform="translate(233 262) scale(1.32) translate(-256 -259)" d="{GLYPHS}" fill="#0a0a0a"/>
</g>
</svg>
'''
(ROOT / 'icons/lc-mark.svg').write_text(mark(False))
(ROOT / 'icons/lc-maskable.svg').write_text(mark(True))
print('ok')
