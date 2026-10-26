// Render the PNG icons and iOS launch screens from icons/lc-*.svg with headless Chromium (playwright-core or playwright):
//   node tools/render_icons.mjs        (CHROME=/path/to/chrome to pick the browser binary)
import { createRequire } from 'module';
import path from 'path';
import fs from 'fs';
const req = createRequire(path.join(process.cwd(), 'x.js'));
const { chromium } = (() => { try { return req('playwright-core'); } catch { return req('playwright'); } })();
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const OUT = [['lc-mark.svg', 'lc-icon-512.png', 512], ['lc-mark.svg', 'lc-icon-192.png', 192], ['lc-maskable.svg', 'lc-maskable-512.png', 512],
  ['lc-maskable.svg', 'lc-apple-touch-180.png', 180], ['lc-mark.svg', 'lc-favicon-32.png', 32]];
const b = await chromium.launch({ executablePath: process.env.CHROME || '/opt/pw-browsers/chromium', args: ['--no-sandbox'] });
for (const [src, out, size] of OUT) {
  const p = await b.newPage({ viewport: { width: size, height: size }, deviceScaleFactor: 1 });
  const svg = fs.readFileSync(path.join(ROOT, 'icons', src), 'utf8');
  await p.setContent(`<html><body style="margin:0;background:transparent">${svg.replace('<svg ', `<svg width="${size}" height="${size}" `)}</body></html>`);
  await p.screenshot({ path: path.join(ROOT, 'icons', out), omitBackground: true, clip: { x: 0, y: 0, width: size, height: size } });
  await p.close();
}
// iOS launch screens (apple-touch-startup-image): yellow, the mark and a heavy system-grotesk wordmark
const SPLASH = [[430, 932, 3], [393, 852, 3], [390, 844, 3], [428, 926, 3], [414, 896, 2], [375, 812, 3], [375, 667, 2]];
const mark = fs.readFileSync(path.join(ROOT, 'icons', 'lc-mark.svg'), 'utf8').replace('<svg ', '<svg width="210" height="210" ');
for (const [w, hgt, dpr] of SPLASH) {
  const p = await b.newPage({ viewport: { width: w, height: hgt }, deviceScaleFactor: dpr });
  await p.setContent(`<html><head><style>html,body{margin:0;height:100%}body{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:6px;background:#ffe14d}
    h1{margin:0;font:900 44px/1 "Helvetica Neue",Helvetica,Arial,sans-serif;letter-spacing:-.04em;text-transform:uppercase;color:#0a0a0a}</style></head>
    <body>${mark}<h1>Langcards</h1></body></html>`);
  await p.screenshot({ path: path.join(ROOT, 'icons', `lc-splash-${w * dpr}x${hgt * dpr}.png`) });
  await p.close();
}
await b.close();
console.log('rendered', OUT.length, 'icons +', SPLASH.length, 'launch screens');
