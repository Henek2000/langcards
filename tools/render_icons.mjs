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
await b.close();
console.log('rendered', OUT.length, 'icons');
