// Redesign (0.4.x) checks: phone emulation with touch at 360/390/412/430 + desktop 1280, no horizontal overflow,
// long real words fit the card, WCAG AA contrast (axe-core) in dark + light, legacy 0.3.0 data still works,
// flip / swipe / undo / history keys, reduced motion, theme persistence, icons + SW cache name.
// Run from a folder with playwright-core + axe-core installed:  BASE=http://localhost:8092/langcards/ node /path/to/test/redesign.mjs
import { createRequire } from 'module';
import path from 'path';
import fs from 'fs';
const req = createRequire(path.join(process.cwd(), 'x.js'));
const { chromium } = req('playwright-core');
const AXE = fs.readFileSync(req.resolve('axe-core/axe.min.js'), 'utf8');
const BASE = process.env.BASE || 'http://localhost:8092/langcards/';
const UA = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Mobile Safari/537.36';
const results = []; const ok = (name, cond, extra = '') => { results.push({ name, pass: !!cond, extra }); console.log(cond ? 'PASS' : 'FAIL', name, cond ? '' : extra); };
const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', headless: true, args: ['--no-sandbox'] });

const LEGACY = {   // exactly what 0.3.0 stored
  shortcuts: [{ kind: 'stack', lang: 'fr', level: 'A1', stack: 'noun', added: '2026-10-23T09:12:00.000Z' }, { kind: 'stack', lang: 'ru', level: 'A1', stack: 'verb', added: '2026-10-23T09:13:00.000Z' }],
  events: [
    { wordId: 'ru-noun-автобус', lang: 'ru', level: 'A1', stack: 'noun', word: 'автобус', result: 'knew', flipped: true, ts: '2026-10-24T18:00:00.000Z', ms: 2100, sessionId: 'old-1', appVersion: '0.3.0', undone: false },
    { wordId: 'ru-noun-август', lang: 'ru', level: 'A1', stack: 'noun', word: 'август', result: 'didnt', flipped: true, ts: '2026-10-24T18:00:05.000Z', ms: 3300, sessionId: 'old-1', appVersion: '0.3.0', undone: false },
    { wordId: 'ru-noun-август', lang: 'ru', level: 'A1', stack: 'noun', word: 'август', result: 'knew', flipped: false, ts: '2026-10-24T18:00:09.000Z', ms: 1200, sessionId: 'old-1', appVersion: '0.3.0', undone: true, undoneAt: '2026-10-24T18:00:10.000Z' }],
  words: [
    { id: 'ru-noun-автобус', lang: 'ru', level: 'A1', stack: 'noun', pack: 'ru-A1-noun', shown: 1, right: 1, left: 0, flips: 1, firstSeen: '2026-10-24T18:00:00.000Z', lastSeen: '2026-10-24T18:00:00.000Z', lastResult: 'knew' },
    { id: 'ru-noun-август', lang: 'ru', level: 'A1', stack: 'noun', pack: 'ru-A1-noun', shown: 1, right: 0, left: 1, flips: 1, firstSeen: '2026-10-24T18:00:05.000Z', lastSeen: '2026-10-24T18:00:05.000Z', lastResult: 'didnt' }],
};
async function seedLegacy(page) {
  await page.evaluate(async L => {
    localStorage.setItem('langapp.shortcuts.v1', JSON.stringify(L.shortcuts));
    await new Promise((res, rej) => {
      const r = indexedDB.open('langapp', 1);
      r.onupgradeneeded = () => { const db = r.result; const ev = db.createObjectStore('events', { keyPath: 'eid', autoIncrement: true }); ev.createIndex('wordId', 'wordId'); ev.createIndex('ts', 'ts');
        const w = db.createObjectStore('words', { keyPath: 'id' }); w.createIndex('pack', 'pack'); };
      r.onsuccess = () => { const db = r.result; const t = db.transaction(['events', 'words'], 'readwrite');
        L.events.forEach(e => t.objectStore('events').add(e)); L.words.forEach(w => t.objectStore('words').put(w));
        t.oncomplete = () => { db.close(); res(); }; t.onerror = () => rej(t.error); };
      r.onerror = () => rej(r.error);
    });
  }, LEGACY);
}
async function newPage(vw, vh, opts = {}) {
  const mobile = vw < 800;
  const ctx = await browser.newContext({ viewport: { width: vw, height: vh }, deviceScaleFactor: mobile ? 2.625 : 1, isMobile: mobile, hasTouch: true, userAgent: mobile ? UA : undefined, serviceWorkers: 'block', ...opts });
  const page = await ctx.newPage();
  const errors = []; page.on('pageerror', e => errors.push(String(e))); page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  const cdp = await ctx.newCDPSession(page);
  // longest real words first (pack order kept by a fixed Math.random; the data itself is untouched)
  await page.addInitScript(() => { Math.random = () => 0.5; });
  await page.route('**/data/*-A1-*.json', async route => { const res = await route.fetch(); const j = await res.json();
    if (opts.longest !== false) j.items.sort((a, b) => (b.a || '').length + (b.d || b.w).length - (a.a || '').length - (a.d || a.w).length);
    route.fulfill({ response: res, json: j }); });
  return { ctx, page, errors, cdp };
}
const cur = page => page.locator('.card:not(.next)');
const touch = (cdp, type, pts) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: pts });
async function tapCard(page, cdp) { const b = await cur(page).boundingBox(); await touch(cdp, 'touchStart', [{ x: b.x + b.width / 2, y: b.y + 40 }]); await touch(cdp, 'touchEnd', []); await page.waitForTimeout(800); }
async function swipe(page, cdp, dir) { const b = await cur(page).boundingBox(); const cx = b.x + b.width / 2, cy = b.y + b.height / 2;
  await touch(cdp, 'touchStart', [{ x: cx, y: cy }]); for (let k = 1; k <= 12; k++) { await touch(cdp, 'touchMove', [{ x: cx + dir * k * 16, y: cy + k }]); await page.waitForTimeout(16); }
  await touch(cdp, 'touchEnd', []); await page.waitForTimeout(700); }
const idbAll = (page, store) => page.evaluate(s => new Promise(r => { const q = indexedDB.open('langapp'); q.onsuccess = () => { const t = q.result.transaction(s).objectStore(s).getAll(); t.onsuccess = () => { q.result.close(); r(t.result); }; }; }), store);
const overflow = page => page.evaluate(() => {
  const vw = document.documentElement.clientWidth, bad = [];
  if (document.documentElement.scrollWidth > vw + 1) bad.push(`doc scrollWidth ${document.documentElement.scrollWidth} > ${vw}`);
  for (const el of document.querySelectorAll('body *')) {
    if (el.closest('.card') || el.closest('[hidden]') || el.closest('svg')) continue;
    const r = el.getBoundingClientRect(); if (!r.width || !r.height) continue;
    if (r.right > vw + 1 || r.left < -1) bad.push(`${el.tagName}.${el.className} ${Math.round(r.left)}..${Math.round(r.right)}`);
  }
  for (const w of document.querySelectorAll('.card .front .word')) { const box = w.parentElement, cs = getComputedStyle(box);
    const avail = box.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight); if (w.scrollWidth > avail + 1) bad.push(`word "${w.textContent}" ${w.scrollWidth} > ${avail}`); }
  for (const f of document.querySelectorAll('.card .face')) if (f.scrollWidth > f.clientWidth + 1) bad.push(`face scrollWidth ${f.scrollWidth} > ${f.clientWidth}`);
  return bad;
});
async function contrast(page, label) {
  if (!(await page.evaluate(() => !!window.axe))) await page.addScriptTag({ content: AXE });
  const r = await page.evaluate(async () => (await axe.run(document, { runOnly: { type: 'rule', values: ['color-contrast'] } })).violations);
  const nodes = r.flatMap(v => v.nodes.map(n => `${n.target.join(' ')}: ${n.any[0] && n.any[0].message}`));
  ok(`WCAG AA contrast: ${label}`, nodes.length === 0, nodes.slice(0, 6).join(' | '));
}

// ---------- 1. every phone width + desktop: layout, overflow, contrast, no console errors
const SIZES = process.env.QUICK ? [] : [[360, 740], [390, 844], [412, 915], [430, 932], [1280, 800]];
for (const [vw, vh] of SIZES) {
  const { ctx, page, errors, cdp } = await newPage(vw, vh);
  await page.goto(BASE); await page.waitForSelector('[data-test=menu-flashcards]'); await seedLegacy(page); await page.reload(); await page.waitForSelector('[data-test^=shortcut-stack]');
  const screens = [['home', '', '[data-test^=shortcut-stack]'], ['languages', '#/fc', '[data-test=lang-ru]'], ['levels', '#/fc/fr', '[data-test=level-A1]'], ['stacks', '#/fc/ru/A1', '[data-test=pin-noun]'],
    ['stats', '#/stats', '[data-test=event-count]'], ['about', '#/about', '.credits']];
  const bad = [];
  for (const theme of ['dark', 'light']) {
    await page.evaluate(t => localStorage.setItem('langapp.theme.v1', t), theme);
    for (const [name, hash, sel] of screens) {
      await page.goto(BASE + hash); await page.reload(); await page.waitForSelector(sel); await page.waitForTimeout(450);
      bad.push(...(await overflow(page)).map(b => `${theme}/${name}: ${b}`));
      if (vw === 390 || vw === 360) await contrast(page, `${vw}px ${theme} ${name}`);
    }
    for (const deck of ['fr/A1/noun', 'fr/A1/verb', 'ru/A1/noun', 'ru/A1/verb']) {
      await page.goto(BASE + '#/fc/' + deck); await page.reload(); await page.waitForSelector('.card:not(.next)'); await page.waitForTimeout(700);
      bad.push(...(await overflow(page)).map(b => `${theme}/${deck} front: ${b}`));
      if (vw === 390 || vw === 360) await contrast(page, `${vw}px ${theme} ${deck} front`);
      await tapCard(page, cdp);
      bad.push(...(await overflow(page)).map(b => `${theme}/${deck} back: ${b}`));
      if ((vw === 390 || vw === 360) && deck.endsWith('noun')) await contrast(page, `${vw}px ${theme} ${deck} back`);
    }
  }
  ok(`${vw}px: no horizontal overflow on any screen (dark+light), longest words fit their card`, bad.length === 0, bad.slice(0, 8).join(' | '));
  const sz = await page.evaluate(() => { const c = document.querySelector('.card:not(.next)').getBoundingClientRect(), s = document.querySelector('.stage').getBoundingClientRect(); return { r: c.width / s.width, b: c.bottom, vh: innerHeight }; });
  ok(`${vw}px: card ~87% of the stage and fully on screen`, sz.r > 0.84 && sz.r < 0.9 && sz.b <= sz.vh, JSON.stringify(sz));
  ok(`${vw}px: no console errors`, errors.length === 0, errors.join(' | '));
  await ctx.close();
}

// ---------- 2. legacy (pre-redesign) data + functionality at 390px
{
  const { ctx, page, errors, cdp } = await newPage(390, 844, { longest: false });
  await page.goto(BASE); await page.waitForSelector('[data-test=menu-flashcards]'); await seedLegacy(page); await page.reload(); await page.waitForSelector('[data-test^=shortcut-stack]');
  const tiles = await page.locator('[data-test^=shortcut-stack]').allInnerTexts();
  ok('legacy shortcuts (langapp.shortcuts.v1) still show on home', tiles.length === 2 && /French A1\s*Nouns/.test(tiles[0]) && /Russian A1\s*Verbs/.test(tiles[1]), tiles.join(' | '));
  await page.goto(BASE + '#/stats'); await page.waitForSelector('[data-test=event-count]');
  const cnt = await page.locator('[data-test=event-count]').innerText();
  ok('legacy history counted in stats (2 live + 1 undone)', cnt.startsWith('2 review events') && cnt.includes('+1 undone'), cnt);
  const row = await page.locator('tr', { hasText: 'Russian A1 Nouns' }).innerText();
  ok('legacy per-word stats shown (Russian A1 nouns: 2 seen, 1 known, 50%)', /564\s+2\s+1\s+50%/.test(row.replace(/\t/g, ' ')), row);
  await page.goto(BASE + '#/fc/ru/A1'); await page.waitForSelector('[data-test=stack-noun]');
  ok('legacy stats on the stack picker', (await page.locator('[data-test=stack-noun]').innerText()).includes('564 cards · 2 seen · 1 known'));
  ok('legacy pin state shown', await page.getAttribute('[data-test=pin-verb]', 'aria-pressed') === 'true' && await page.getAttribute('[data-test=pin-noun]', 'aria-pressed') === 'false');
  await page.tap('[data-test=stack-noun]'); await page.waitForSelector('.card:not(.next)'); await page.waitForTimeout(500);
  ok('flashcard screen stays minimal: no bottom buttons, no End session', await page.locator('main button, main .btn, .actions').count() === 0);
  ok('undo in the top bar, disabled before a swipe', await page.locator('#undo').isVisible() && await page.locator('#undo').isDisabled());
  const pack = await page.evaluate(async () => (await (await fetch('data/ru-A1-noun.json')).json()).items);
  const id1 = await cur(page).getAttribute('data-id'), it = pack.find(x => x.id === id1);
  ok('front shows only the word (+article), one child, no tags', (await cur(page).locator('.front').innerText()).trim() === `${it.a ? it.a + ' ' : ''}${it.d || it.w}` && await cur(page).locator('.front > *').count() === 1);
  await tapCard(page, cdp);
  ok('tap flips the card', await page.locator('.card:not(.next).flipped').count() === 1);
  const back = cur(page).locator('.back-face');
  ok('back keeps translation, gender, definition and Tatoeba example from the data', (await back.locator('[data-test=tr-es]').innerText()) === (it.es.length ? it.es.join(', ') : '—')
    && (await back.locator('[data-test=tr-en]').innerText()) === (it.en.length ? it.en.join(', ') : '—') && (!it.g || await back.locator('[data-test=gender]').count() === 1)
    && (!it.def || (await back.locator('.def').innerText()) === it.def) && (!it.x || (await back.locator('[data-test=example] .s').innerText()) === it.x[0].t));
  await swipe(page, cdp, 1);
  let evs = await idbAll(page, 'events');
  const e = evs.at(-1);
  ok('swipe right appends a "knew" event after the legacy ones', evs.length === 4 && e.eid === 4 && e.result === 'knew' && e.wordId === id1 && e.flipped === true && evs.slice(0, 3).every((x, k) => x.wordId === LEGACY.events[k].wordId));
  ok('new event has exactly the legacy event fields', JSON.stringify(Object.keys(e).filter(k => k !== 'eid').sort()) === JSON.stringify(Object.keys(LEGACY.events[0]).sort()), Object.keys(e).join(','));
  const id2 = await cur(page).getAttribute('data-id');
  await swipe(page, cdp, -1);
  evs = await idbAll(page, 'events');
  ok('swipe left records a "didnt"', evs.length === 5 && evs.at(-1).result === 'didnt' && evs.at(-1).wordId === id2);
  ok('tally shows ✓ 1 ✗ 1', (await page.locator('[data-test=tally]').innerText()).replace(/\s+/g, ' ') === '✓ 1 ✗ 1');
  await page.tap('#undo'); await page.waitForTimeout(700);
  evs = await idbAll(page, 'events');
  ok('undo brings the card back and flags the event undone', (await cur(page).getAttribute('data-id')) === id2 && evs.length === 5 && evs.at(-1).undone === true && !!evs.at(-1).undoneAt);
  const words = await idbAll(page, 'words');
  const untouched = LEGACY.words.filter(w => w.id !== id1 && w.id !== id2);
  const w1 = words.find(w => w.id === id1), l1 = LEGACY.words.find(w => w.id === id1), w2 = words.find(w => w.id === id2), l2 = LEGACY.words.find(w => w.id === id2);
  ok('word aggregates: legacy ones kept, reviewed one updated, undone one rolled back', untouched.every(l => JSON.stringify(words.find(w => w.id === l.id)) === JSON.stringify(l))
    && w1 && w1.shown === (l1 ? l1.shown : 0) + 1 && w1.right === (l1 ? l1.right : 0) + 1 && (l2 ? w2 && w2.shown === l2.shown && w2.left === l2.left : !w2), JSON.stringify({ id1, id2, w1, w2 }));
  ok('IndexedDB still "langapp" v1 with stores events+words', await page.evaluate(() => new Promise(r => { const q = indexedDB.open('langapp'); q.onsuccess = () => { r(q.result.version === 1 && [...q.result.objectStoreNames].join() === 'events,words'); q.result.close(); }; })));
  ok('localStorage shortcuts unchanged', await page.evaluate(() => localStorage.getItem('langapp.shortcuts.v1')) === JSON.stringify(LEGACY.shortcuts));
  // mid-swipe colour wash
  const b = await cur(page).boundingBox(); await touch(cdp, 'touchStart', [{ x: b.x + b.width / 2, y: b.y + b.height / 2 }]);
  for (let k = 1; k <= 6; k++) await touch(cdp, 'touchMove', [{ x: b.x + b.width / 2 + k * 15, y: b.y + b.height / 2 }]);
  const mid = await page.evaluate(() => { const c = document.querySelector('.card:not(.next)'); return { wy: +c.querySelector('.wash.yes').style.opacity, wn: +c.querySelector('.wash.no').style.opacity, tf: c.style.transform }; });
  ok('mid-swipe right: green wash + tilt, no red', mid.wy > 0.5 && mid.wn === 0 && /rotate\(/.test(mid.tf), JSON.stringify(mid));
  await touch(cdp, 'touchMove', [{ x: b.x + b.width / 2, y: b.y + b.height / 2 }]); await touch(cdp, 'touchEnd', []); await page.waitForTimeout(600);
  ok('releasing near the start snaps back without recording', (await idbAll(page, 'events')).length === 5);
  // theme persistence
  await page.goto(BASE + '#/stats'); await page.waitForSelector('[data-test=event-count]'); await page.waitForTimeout(500);
  // headless Chrome swallows the first synthetic tap after a cancelled CDP drag (reproduces on a blank page), so tap a neutral spot first
  await page.tap('.panel h2'); await page.waitForTimeout(200); await page.tap('[data-test=theme-light]');
  ok('theme switch saves langapp.theme.v1 and recolours the status bar', await page.evaluate(() => localStorage.getItem('langapp.theme.v1') === 'light' && document.documentElement.dataset.theme === 'light' && document.querySelector('meta[name=theme-color]').content === '#f2eee6'));
  await page.reload(); await page.waitForSelector('[data-test=theme-light]');
  ok('light theme survives a reload', await page.evaluate(() => document.documentElement.dataset.theme === 'light') && await page.getAttribute('[data-test=theme-light]', 'aria-pressed') === 'true');
  await page.tap('[data-test=theme-dark]');
  // fonts: self-hosted, Cyrillic face really used on a Russian card
  await page.goto(BASE + '#/fc/ru/A1/noun'); await page.waitForSelector('.card:not(.next)'); await page.waitForTimeout(600);
  const fonts = await page.evaluate(async () => { await document.fonts.ready; return [...document.fonts].filter(f => f.status === 'loaded').map(f => f.family + ' ' + f.unicodeRange.slice(0, 12)); });
  ok('Unbounded + Onest Cyrillic faces load from the app (no CDN)', fonts.some(f => /^Unbounded U\+0?301/.test(f)) && fonts.some(f => /^Onest U\+0?301/.test(f)), fonts.join(' | '));
  const ext = await page.evaluate(() => performance.getEntriesByType('resource').map(r => r.name).filter(u => !u.startsWith(location.origin)));
  ok('no third-party requests', ext.length === 0, ext.join(','));
  // end of deck (shortest deck) by keyboard
  await page.goto(BASE + '#/fc/ru/A1/verb'); await page.waitForSelector('.card:not(.next)');
  for (let k = 0; k < 400 && await page.locator('[data-test=summary]').count() === 0; k++) { await page.keyboard.press('ArrowRight'); await page.waitForTimeout(285); }
  await page.waitForTimeout(1200);
  ok('end-of-deck summary shows 100% with both actions', (await page.locator('[data-test=summary] .big').innerText()) === '100%' && await page.locator('[data-test=summary] .btn').count() === 2);
  ok('summary: no overflow', (await overflow(page)).length === 0);
  await contrast(page, '390px dark end of deck');
  ok('undo still available on the summary', await page.locator('#undo').isEnabled());
  await page.tap('#undo'); await page.waitForTimeout(700);
  ok('undo from the summary returns to the last card', await page.locator('.card:not(.next)').count() === 1 && await page.locator('[data-test=summary]').count() === 0);
  ok('390px functional run: no console errors', errors.length === 0, errors.join(' | '));
  await ctx.close();
}

// ---------- 3. reduced motion
{
  const { ctx, page, errors, cdp } = await newPage(390, 844, { reducedMotion: 'reduce', longest: false });
  await page.goto(BASE + '#/fc/fr/A1/noun'); await page.waitForSelector('.card:not(.next)'); await page.waitForTimeout(400);
  const t = await page.evaluate(() => getComputedStyle(document.querySelector('.card:not(.next) .inner')).transitionDuration);
  await tapCard(page, cdp);
  const vis = await page.evaluate(() => { const c = document.querySelector('.card:not(.next)'); return [getComputedStyle(c.querySelector('.back-face')).visibility, getComputedStyle(c.querySelector('.front')).visibility, getComputedStyle(c.querySelector('.inner')).transform]; });
  ok('reduced motion: no 3D flip animation, back face shown instantly', t === '0s' && vis[0] === 'visible' && vis[1] === 'hidden' && vis[2] === 'none', `${t} ${vis}`);
  const b = await cur(page).boundingBox(); await touch(cdp, 'touchStart', [{ x: b.x + b.width / 2, y: b.y + b.height / 2 }]);
  for (let k = 1; k <= 6; k++) await touch(cdp, 'touchMove', [{ x: b.x + b.width / 2 + k * 15, y: b.y + b.height / 2 + k * 4 }]);
  ok('reduced motion: drag follows the finger without tilt', !/rotate/.test(await cur(page).evaluate(c => c.style.transform)));
  await touch(cdp, 'touchMove', [{ x: b.x + b.width / 2 + 160, y: b.y + b.height / 2 }]); await touch(cdp, 'touchEnd', []); await page.waitForTimeout(500);
  ok('reduced motion: swipe still records', (await idbAll(page, 'events')).filter(e => e.result === 'knew').length === 1);
  ok('reduced motion: no console errors', errors.length === 0, errors.join(' | '));
  await ctx.close();
}

// ---------- 4. manifest, icons, service worker
{
  const { ctx, page } = await newPage(390, 844);
  await page.goto(BASE);
  const m = await page.evaluate(async () => (await fetch('manifest.webmanifest')).json());
  const codes = await page.evaluate(async srcs => Promise.all(srcs.map(async s => (await fetch(s)).status)), m.icons.map(i => i.src));
  ok('manifest: new icon files exist and colours match the dark theme', m.theme_color === '#0b0d12' && m.background_color === '#0b0d12' && m.icons.every(i => i.src.includes('lc-')) && codes.every(c => c === 200) && m.icons.some(i => i.purpose === 'maskable'), JSON.stringify(codes));
  const sw = await page.evaluate(async () => (await fetch('sw.js')).text());
  const ver = (await page.evaluate(async () => (await fetch('js/version.js')).text())).match(/'(.+)'/)[1];
  ok(`service worker cache bumped (langapp-${ver}), precaches fonts and new icons only`, sw.includes(`const VERSION = '${ver}'`) && ver !== '0.3.0' && sw.includes('fonts/unbounded-cyrillic.woff2') && sw.includes('icons/lc-icon-512.png') && !/icons\/(icon-192|icon-512|maskable-512|apple-touch-icon|favicon-32)\.png/.test(sw));
  await ctx.close();
}
await browser.close();
fs.writeFileSync('/tmp/redesign-results.json', JSON.stringify(results, null, 1));
console.log(`${results.filter(r => r.pass).length}/${results.length} passed`);
