// Render the PNG icons from icons/lc-*.svg with headless Chrome. Run from a folder that has playwright-core installed:
//   node /path/to/langapp/tools/render_icons.mjs
import { createRequire } from 'module';
import path from 'path';
import fs from 'fs';
const { chromium } = createRequire(path.join(process.cwd(), 'x.js'))('playwright-core');
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const OUT = [['lc-mark.svg', 'lc-icon-512.png', 512], ['lc-mark.svg', 'lc-icon-192.png', 192], ['lc-maskable.svg', 'lc-maskable-512.png', 512],
  ['lc-maskable.svg', 'lc-apple-touch-180.png', 180], ['lc-mark.svg', 'lc-favicon-32.png', 32]];
const b = await chromium.launch({ executablePath: '/usr/bin/google-chrome', args: ['--no-sandbox'] });
for (const [src, out, size] of OUT) {
  const p = await b.newPage({ viewport: { width: size, height: size }, deviceScaleFactor: 1 });
  const svg = fs.readFileSync(path.join(ROOT, 'icons', src), 'utf8');
  await p.setContent(`<html><body style="margin:0;background:transparent">${svg.replace('<svg ', `<svg width="${size}" height="${size}" `)}</body></html>`);
  await p.screenshot({ path: path.join(ROOT, 'icons', out), omitBackground: true, clip: { x: 0, y: 0, width: size, height: size } });
  await p.close();
}
// iOS launch screens (apple-touch-startup-image): dark background, the mark and the wordmark in Unbounded (self-hosted font)
const SPLASH = [[430, 932, 3], [393, 852, 3], [390, 844, 3], [428, 926, 3], [414, 896, 2], [375, 812, 3], [375, 667, 2]];
const mark = fs.readFileSync(path.join(ROOT, 'icons', 'lc-mark.svg'), 'utf8').replace('<svg ', '<svg width="132" height="132" ');
const font = fs.readFileSync(path.join(ROOT, 'fonts', 'unbounded-latin.woff2')).toString('base64');
for (const [w, hgt, dpr] of SPLASH) {
  const p = await b.newPage({ viewport: { width: w, height: hgt }, deviceScaleFactor: dpr });
  await p.setContent(`<html><head><style>@font-face{font-family:U;src:url(data:font/woff2;base64,${font}) format("woff2");font-weight:200 900}
    html,body{margin:0;height:100%}body{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:22px;
    background:radial-gradient(90% 50% at 50% 38%,rgba(255,194,75,.13),transparent 70%),linear-gradient(#141821,#0b0d12)}
    svg{filter:drop-shadow(0 18px 40px rgba(0,0,0,.55))}h1{margin:0;font:700 26px/1 U;letter-spacing:-.03em;color:#f4f1ea}
    p{margin:-12px 0 0;font:500 12px/1 U;letter-spacing:.16em;text-transform:uppercase;color:#a7adbb}</style></head>
    <body>${mark}<h1>Flashcards</h1><p>French · Russian</p></body></html>`);
  await p.evaluate(() => document.fonts.ready);
  await p.screenshot({ path: path.join(ROOT, 'icons', `lc-splash-${w * dpr}x${hgt * dpr}.png`) });
  await p.close();
}
await b.close();
console.log('rendered', OUT.length, 'icons +', SPLASH.length, 'launch screens');
