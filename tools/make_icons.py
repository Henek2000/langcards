#!/usr/bin/env python3
"""Build the app mark (icons/lc-mark.svg, lc-maskable.svg) from the Unbounded font (OFL): glyph outlines are
converted to SVG paths so the icon needs no font at runtime. PNGs are rendered from these SVGs by
tools/render_icons.mjs (headless Chrome). Needs fontTools + brotli."""
import pathlib
from fontTools.ttLib import TTFont
from fontTools.varLib.instancer import instantiateVariableFont
from fontTools.pens.svgPathPen import SVGPathPen
from fontTools.pens.transformPen import TransformPen
ROOT = pathlib.Path(__file__).resolve().parent.parent

def glyph_paths(text, size, cx, baseline):
    out, adv_total, runs = [], 0, []
    for ch in text:
        sub = 'cyrillic' if ord(ch) >= 0x400 else 'latin'
        f = instantiateVariableFont(TTFont(ROOT / f'fonts/unbounded-{sub}.woff2'), {'wght': 700})
        gs, cmap, upm = f.getGlyphSet(), f.getBestCmap(), f['head'].unitsPerEm
        g = cmap[ord(ch)]; runs.append((gs, g, upm)); adv_total += gs[g].width * size / upm
    x = cx - adv_total / 2
    for gs, g, upm in runs:
        s = size / upm; pen = SVGPathPen(gs)
        gs[g].draw(TransformPen(pen, (s, 0, 0, -s, x, baseline)))
        out.append(pen.getCommands()); x += gs[g].width * s
    return ' '.join(out)

def mark(maskable):
    glyphs = glyph_paths('Aя', 86, 256, 290)
    k = 0.8 if maskable else 1.0          # maskable: keep the artwork inside the 80% safe zone
    t = f'translate(256 256) scale({k}) translate(-256 -256)'
    bg = '<rect width="512" height="512" fill="url(#bg)"/>' if maskable else '<rect width="512" height="512" rx="116" fill="url(#bg)"/>'
    return f'''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
<defs>
<linearGradient id="bg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#1a1f2b"/><stop offset="1" stop-color="#0b0d12"/></linearGradient>
<radialGradient id="glow" cx=".5" cy=".38" r=".55"><stop offset="0" stop-color="#ffc24b" stop-opacity=".32"/><stop offset="1" stop-color="#ffc24b" stop-opacity="0"/></radialGradient>
<linearGradient id="back" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#7fa6ff"/><stop offset="1" stop-color="#b18cff"/></linearGradient>
<linearGradient id="paper" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#fffdf7"/><stop offset="1" stop-color="#ece5d6"/></linearGradient>
</defs>
{bg}
<rect width="512" height="512" fill="url(#glow)"{'' if maskable else ' rx="116"'}/>
<g transform="{t}">
<rect x="146" y="116" width="220" height="290" rx="34" fill="url(#back)" transform="rotate(-13 256 261)" opacity=".95"/>
<g transform="rotate(7 256 256)">
<rect x="146" y="110" width="220" height="292" rx="34" fill="#000" opacity=".28" transform="translate(6 12)"/>
<rect x="146" y="110" width="220" height="292" rx="34" fill="url(#paper)"/>
<rect x="186" y="110" width="140" height="12" rx="6" fill="#ffc24b"/>
<path d="{glyphs}" fill="#15171d"/>
</g>
</g>
</svg>
'''
(ROOT / 'icons/lc-mark.svg').write_text(mark(False))
(ROOT / 'icons/lc-maskable.svg').write_text(mark(True))
print('ok')
