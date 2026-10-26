// Phone-viewport tests for langcards 0.5. Serve an assembled site first (test/assemble.sh), e.g.
//   bash test/assemble.sh . /tmp/site/langcards && (cd /tmp/site && python3 -m http.server 8081) &
//   node test/app.mjs                     (BASE, SHOTS, CHROME env vars override the defaults)
import { createRequire } from 'module';
import path from 'path';
import fs from 'fs';
const req = createRequire(path.join(process.cwd(), 'x.js'));
const { chromium } = (() => { try { return req('playwright-core'); } catch { return req('playwright'); } })();
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const BASE = process.env.BASE || 'http://localhost:8081/langcards/', SHOTS = process.env.SHOTS || path.join(ROOT, 'shots') + '/';
const EXPECT = fs.readFileSync(path.join(ROOT, 'VERSION'), 'utf8').trim();
const results = []; const ok = (name, cond, extra = '') => { results.push({ name, pass: !!cond }); console.log(cond ? 'PASS' : 'FAIL', name, extra); };
fs.mkdirSync(SHOTS, { recursive: true });

const browser = await chromium.launch({ executablePath: process.env.CHROME || '/opt/pw-browsers/chromium', args: ['--no-sandbox'] });
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, acceptDownloads: true, colorScheme: 'light' });
const page = await ctx.newPage();
const errors = []; page.on('pageerror', e => errors.push(String(e))); page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
const shot = n => page.screenshot({ path: SHOTS + n + '.png' });
const cdp = await ctx.newCDPSession(page);
const curCard = () => page.locator('.card:not(.next)');
const idbAll = store => page.evaluate(s => new Promise(r => { const q = indexedDB.open('langapp'); q.onsuccess = () => { const t = q.result.transaction(s).objectStore(s).getAll(); t.onsuccess = () => r(t.result); }; }), store);
async function touchSwipe(dir) {
  const b = await curCard().boundingBox(); const cx = b.x + b.width / 2, cy = b.y + b.height / 2;
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: cx, y: cy }] });
  for (let k = 1; k <= 12; k++) { await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: cx + dir * k * 16, y: cy + k }] }); await page.waitForTimeout(16); }
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }); await page.waitForTimeout(450);
}
async function tapCard() { const b = await curCard().boundingBox(); await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: b.x + b.width / 2, y: b.y + 60 }] }); await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }); await page.waitForTimeout(550); }
const key = async (k, n = 1) => { for (let j = 0; j < n; j++) { await page.keyboard.press(k); await page.waitForTimeout(300); } };
const go = async (hash, sel) => { await page.goto(BASE + hash); await page.waitForSelector(sel); await page.waitForTimeout(350); };
const pack = f => page.evaluate(async f => (await (await fetch('data/' + f)).json()).items, f);
// consistency: every word aggregate equals a recomputation from its non-undone events
async function consistent() {
  const evs = (await idbAll('events')).filter(e => !e.undone), words = await idbAll('words'); const by = {};
  for (const e of evs) (by[e.wordId] ||= []).push(e);
  let bad = 0;
  for (const [id, es] of Object.entries(by)) {
    const w = words.find(w => w.id === id); es.sort((a, b) => a.ts < b.ts ? -1 : a.ts > b.ts ? 1 : a.eid - b.eid);
    if (!w || w.shown !== es.length || w.right !== es.filter(e => e.result === 'knew').length || w.lastResult !== es.at(-1).result) bad++;
  }
  return bad + words.filter(w => !by[w.id]).length;
}
// write v0.4-shaped history straight into IndexedDB (events without `mode`, aggregates as v0.4 wrote them)
async function seed(entries) {
  await page.evaluate(async entries => {
    const db = await new Promise(r => { const q = indexedDB.open('langapp', 1); q.onupgradeneeded = () => { const d = q.result;
      if (!d.objectStoreNames.contains('events')) { const ev = d.createObjectStore('events', { keyPath: 'eid', autoIncrement: true }); ev.createIndex('wordId', 'wordId'); ev.createIndex('ts', 'ts'); }
      if (!d.objectStoreNames.contains('words')) d.createObjectStore('words', { keyPath: 'id' }).createIndex('pack', 'pack'); }; q.onsuccess = () => r(q.result); });
    await new Promise(r => { const t = db.transaction(['events', 'words'], 'readwrite'); const es = t.objectStore('events'), ws = t.objectStore('words'); const agg = {};
      for (const [id, lang, stack, result, ts] of entries) {
        es.add({ wordId: id, lang, level: 'A1', stack, word: id.split('-').pop(), result, flipped: false, ts, ms: 900, sessionId: 'old-' + ts.slice(0, 10), appVersion: '0.4.0', undone: false });
        const a = agg[id] ||= { id, lang, level: 'A1', stack, pack: `${lang}-A1-${stack}`, shown: 0, right: 0, left: 0, flips: 0, firstSeen: ts };
        a.shown++; result === 'knew' ? a.right++ : a.left++; a.lastSeen = ts; a.lastResult = result;
      }
      for (const a of Object.values(agg)) ws.put(a); t.oncomplete = r; });
    db.close();
  }, entries);
}
const daysAgo = n => new Date(Date.now() - n * 864e5).toISOString();

// ---------- 1. v0.4 history carries over
await page.goto(BASE); await page.waitForSelector('[data-test=deck-fr-A1-noun]');
ok('version shown', (await page.locator('.hint').innerText()) === `v${EXPECT}`);
const frn = await pack('fr-A1-noun.json'), ruv = await pack('ru-A1-verb.json');
await seed([...frn.slice(0, 30).map((it, k) => [it.id, 'fr', 'noun', k % 3 ? 'knew' : 'didnt', daysAgo(3 - (k % 3))]),
  ...ruv.slice(0, 145).map(it => [it.id, 'ru', 'verb', 'knew', daysAgo(1)]), ...ruv.slice(145).map(it => [it.id, 'ru', 'verb', 'didnt', daysAgo(1)])]);
await go('#/', '[data-test=deck-fr-A1-noun]');
ok('old history counted on home', (await page.locator('[data-test=deck-fr-A1-noun] .deck-sub').innerText()).toLowerCase().includes('20 known · 10 unknown'), await page.locator('[data-test=deck-fr-A1-noun] .deck-sub').innerText());
ok('home stats: known total and streak', (await page.locator('[data-test=home-known] b').innerText()) === '165' && (await page.locator('[data-test=home-streak] b').innerText()) === '3');
await shot('01-home');

// ---------- 2. deck screen
await page.locator('[data-test=deck-fr-A1-noun]').click(); await page.waitForSelector('[data-test=deck-big-pct]');
ok('deck: percent and unknown tab', (await page.locator('[data-test=deck-big-pct]').innerText()).startsWith('3') && (await page.locator('[data-test=word-list] li').count()) === 10, await page.locator('[data-test=deck-big-pct]').innerText());
await shot('02-deck');
await page.locator('[data-test=tab-new]').click();
ok('deck: new tab lists 60 then show all', (await page.locator('[data-test=word-list] li').count()) === 61);
await page.locator('[data-test=show-all]').click();
ok('deck: show all', (await page.locator('[data-test=word-list] li').count()) === frn.length - 30);

// ---------- 3. a practice run
await page.goto(BASE + '#/deck/fr-A1-noun'); await page.waitForSelector('[data-test=start-run]');
await page.locator('[data-test=start-run]').click(); await page.waitForSelector('.card:not(.next)'); await page.waitForTimeout(300);
const runIds = await page.evaluate(() => [...document.querySelectorAll('.card')].map(c => c.dataset.id));
ok('run: 20 cards, counter', (await page.locator('.count').innerText()).replace(/\s/g, '') === '1/20');
await shot('03-front');
await tapCard(); ok('tap flips', await curCard().evaluate(e => e.classList.contains('flipped')));
await shot('04-back');
await touchSwipe(1); await touchSwipe(-1);
ok('swipes record knew + again', (await page.locator('[data-test=tally]').innerText()).replace(/\s/g, '') === '✓1✗1');
await page.locator('#undo').click(); await page.waitForTimeout(500);
ok('undo brings the card back', (await page.locator('.count').innerText()).replace(/\s/g, '') === '2/20' && (await consistent()) === 0);
const seen = []; for (let j = 0; j < 19; j++) { seen.push(await curCard().getAttribute('data-id')); await key(j % 4 === 0 ? 'ArrowLeft' : 'ArrowRight'); }
await page.waitForSelector('[data-test=summary]');
const evRun = (await idbAll('events')).filter(e => e.mode === 'run' && !e.undone);
ok('run: 20 live events saved with mode', evRun.length === 20 && (await consistent()) === 0, String(evRun.length));
ok('run: results numbers', (await page.locator('[data-test=score]').innerText()) === '15' && /\+\d+/.test(await page.locator('[data-test=learned]').innerText()));
await page.waitForTimeout(1200); await shot('05-results');
const missed = await page.locator('.chips.bad li').count();
await page.locator('[data-test=retry]').click(); await page.waitForSelector('.card:not(.next)');
ok('retry missed runs only the missed words', (await page.locator('.count').innerText()).replace(/\s/g, '') === `1/${missed}`, String(missed));

// ---------- 4. finishing a deck
await go('#/deck/ru-A1-verb', '[data-test=start-unknown]');
await page.locator('[data-test=start-unknown]').click(); await page.waitForSelector('.card:not(.next)'); await page.waitForTimeout(200);
await key('ArrowRight', 4);
await page.waitForSelector('[data-test=deck-complete-overlay]');
await page.waitForTimeout(1300); await shot('06-deck-complete');
ok('deck complete takeover', (await page.locator('[data-test=deck-complete-overlay] h2').innerText()).toUpperCase().includes('COMPLETE'));
await page.locator('[data-test=ov-close]').click();
ok('results say deck complete 97% -> 100%', (await page.locator('[data-test=deck-delta]').innerText()).includes('→ 100%'));
await go('#/', '[data-test=deck-ru-A1-verb]');
ok('home marks the deck complete', (await page.locator('[data-test=deck-ru-A1-verb]').getAttribute('class')).includes('done'));
await go('#/deck/ru-A1-verb', '[data-test=deck-complete]'); ok('deck screen badge + review run', (await page.locator('[data-test=start-run]').innerText()).toUpperCase().includes('REVIEW'));

// ---------- 5. progress
await go('#/progress', '[data-test=chart]');
ok('progress: total known, streak, runs', (await page.locator('[data-test=total-known]').innerText()) === String((await idbAll('words')).filter(w => w.lastResult === 'knew').length)
  && (await page.locator('[data-test=streak] b').innerText()) === '4' && (await page.locator('[data-test=runs] li').count()) >= 4);
await shot('07-progress');

// ---------- 6. backup export + import round trip
const [dl] = await Promise.all([page.waitForEvent('download'), page.locator('[data-test=export-json]').click()]);
const backup = JSON.parse(fs.readFileSync(await dl.path(), 'utf8'));
const before = (await idbAll('words')).length;
await page.evaluate(() => new Promise(r => { const q = indexedDB.open('langapp'); q.onsuccess = () => { const t = q.result.transaction(['events', 'words'], 'readwrite'); t.objectStore('events').clear(); t.objectStore('words').clear(); t.oncomplete = r; }; }));
page.once('dialog', d => d.accept());
await page.locator('[data-test=import-file]').setInputFiles({ name: 'b.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(backup)) });
await page.waitForTimeout(800);
ok('import restores history', (await idbAll('words')).length === before && (await idbAll('events')).length === backup.events.length && (await consistent()) === 0);
page.once('dialog', d => d.accept());
await page.locator('[data-test=import-file]').setInputFiles({ name: 'x.json', mimeType: 'application/json', buffer: Buffer.from('{"foo":1}') });
await page.waitForTimeout(400);
ok('import rejects a non-backup', (await page.locator('#toast').innerText()).includes('not a Langcards backup') && (await idbAll('events')).length === backup.events.length);

// ---------- 7. fast navigation never stacks screens or records into a deck you left
const n0 = (await idbAll('events')).length;
await page.route('**/data/fr-A1-verb.json', async r => { await new Promise(x => setTimeout(x, 400)); r.continue(); });
await page.evaluate(() => { location.hash = '#/deck/fr-A1-verb/run'; }); await page.waitForTimeout(50);
await page.evaluate(() => { location.hash = '#/'; }); await page.waitForTimeout(700);
await page.keyboard.press('ArrowRight'); await page.waitForTimeout(300);
ok('race: no session behind home, no stray event', (await page.locator('.session').count()) === 0 && (await page.locator('#undo').isHidden()) && (await idbAll('events')).length === n0);
await page.unroute('**/data/fr-A1-verb.json');

// ---------- 8. old v0.4 links, dark mode
await page.goto(BASE + '#/fc/fr/A1/verb'); await page.waitForTimeout(500);
ok('old #/fc link opens the deck', page.url().endsWith('#/deck/fr-A1-verb'));
await page.emulateMedia({ colorScheme: 'dark' });
await go('#/', '[data-test=deck-fr-A1-noun]'); await shot('08-home-dark');
await go('#/deck/fr-A1-noun/run', '.card:not(.next)'); await page.waitForTimeout(300); await tapCard(); await shot('09-back-dark');
await page.emulateMedia({ colorScheme: 'light' });

// ---------- 9. no horizontal overflow on any screen, no errors
let overflow = [];
for (const hsh of ['#/', '#/deck/fr-A1-noun', '#/progress', '#/about']) { await go(hsh, 'main > *'); if (await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)) overflow.push(hsh); }
ok('no horizontal overflow', !overflow.length, overflow.join(' '));
ok('no console errors', !errors.length, errors.join(' | '));

await browser.close();
const fail = results.filter(r => !r.pass).length;
console.log(`\n${results.length - fail}/${results.length} passed`);
process.exit(fail ? 1 : 0);
