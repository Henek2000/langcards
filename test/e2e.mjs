// Phone-viewport e2e for langcards 0.3.x. Starts on the OLD deployed build (OLD_DIR), records reviews there,
// swaps in the NEW build (NEW_DIR) under the same URL and checks the auto-update, then tests the new UI.
import { chromium } from 'playwright-core';
import fs from 'fs';
import { execSync } from 'child_process';
const BASE = process.env.BASE || 'http://localhost:8081/langcards/', SITE = process.env.SITE_DIR || '/workspace/ghp-site/langcards';
const OLD_DIR = process.env.OLD_DIR, NEW_DIR = process.env.NEW_DIR || '/workspace/langapp', SHOTS = process.env.SHOTS || '/workspace/langapp/shots/';
const EXPECT = fs.readFileSync(NEW_DIR + '/VERSION', 'utf8').trim();
const results = []; const ok = (name, cond, extra = '') => { results.push({ name, pass: !!cond, extra }); console.log(cond ? 'PASS' : 'FAIL', name, extra); };
const assemble = dir => execSync(`bash ${dir}/test/assemble.sh ${dir} ${SITE}`);
fs.rmSync('/tmp/langapp-profile', { recursive: true, force: true });
const ctx = await chromium.launchPersistentContext('/tmp/langapp-profile', { executablePath: '/usr/bin/google-chrome', headless: true, args: ['--no-sandbox'], viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, acceptDownloads: true,
  userAgent: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Mobile Safari/537.36' });
const page = ctx.pages()[0] || await ctx.newPage();
const errors = []; page.on('pageerror', e => errors.push(String(e))); page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
const shot = async n => page.screenshot({ path: SHOTS + n + '.png' });
const idbAll = store => page.evaluate(async s => (await indexedDB.databases()).some(d => d.name === 'langapp') ? new Promise(r => { const q = indexedDB.open('langapp'); q.onsuccess = () => { const t = q.result.transaction(s).objectStore(s).getAll(); t.onsuccess = () => r(t.result); }; }) : [], store);
const cdp = await ctx.newCDPSession(page);
const curCard = () => page.locator('.card:not(.next)');
async function touchSwipe(dir, dy = 0) {
  const b = await curCard().boundingBox(); const cx = b.x + b.width / 2, cy = b.y + b.height / 2 + dy;
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: cx, y: cy }] });
  for (let k = 1; k <= 12; k++) { await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: cx + dir * k * 16, y: cy + k }] }); await page.waitForTimeout(16); }
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }); await page.waitForTimeout(700);
}
async function tapAt(x, y) { await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] }); await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }); await page.waitForTimeout(600); }
async function tapCard() { const b = await curCard().boundingBox(); await tapAt(b.x + b.width / 2, b.y + 40); }
const packItem = async (file, id) => page.evaluate(async ([f, id]) => (await (await fetch('data/' + f)).json()).items.find(x => x.id === id), [file, id]);
// consistency: every word aggregate equals a recomputation from its non-undone events
async function consistent() {
  const evs = (await idbAll('events')).filter(e => !e.undone), words = await idbAll('words'); const by = {};
  for (const e of evs) (by[e.wordId] ||= []).push(e);
  const bad = [];
  for (const [id, es] of Object.entries(by)) {
    const w = words.find(w => w.id === id); es.sort((a, b) => a.ts < b.ts ? -1 : a.ts > b.ts ? 1 : a.eid - b.eid);
    const exp = { shown: es.length, right: es.filter(e => e.result === 'knew').length, left: es.filter(e => e.result !== 'knew').length, flips: es.filter(e => e.flipped).length, lastResult: es.at(-1).result };
    if (!w || Object.entries(exp).some(([k, v]) => w[k] !== v)) bad.push({ id, exp, w });
  }
  for (const w of words) if (!by[w.id]) bad.push({ id: w.id, orphan: true });
  return bad;
}

// ---------- 1. old deployed version
if (OLD_DIR) {
  assemble(OLD_DIR);
  await page.goto(BASE); await page.waitForSelector('[data-test=menu-flashcards]');
  await page.evaluate(() => navigator.serviceWorker.ready); await page.reload(); await page.waitForSelector('[data-test=menu-flashcards]');
  const vOld = await page.locator('.hint').innerText();
  await page.goto(BASE + '#/fc/fr/A1/verb'); await page.waitForSelector('.card:not(.next)'); await page.waitForTimeout(300);
  await touchSwipe(1); await touchSwipe(-1);
  await page.goto(BASE); await page.waitForSelector('[data-test=menu-flashcards]');
  ok('old build running with 2 reviews recorded', /^Version \d+\.\d+\.\d+$/.test(vOld) && vOld !== `Version ${EXPECT}` && (await idbAll('events')).length === 2, vOld);
  // ---------- 2. deploy new build at the same URL; app must pick it up by itself
  assemble(NEW_DIR);
  await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
  await page.waitForFunction(v => document.querySelector('.hint') && !document.querySelector('.hint').innerText.includes(v), vOld.replace('Version ', ''), { timeout: 20000 }).catch(() => {});
  await page.waitForSelector('[data-test=menu-flashcards]'); await page.waitForTimeout(500);
  const vNew = await page.locator('.hint').innerText();
  const toastTxt = await page.evaluate(() => document.getElementById('toast').hidden ? '' : document.getElementById('toast').innerText);
  ok(`auto-update ${vOld.replace('Version ', '')} -> ${EXPECT} with toast`, vNew === `Version ${EXPECT}` && toastTxt.includes(`Updated to v${EXPECT}`), `${vOld} -> ${vNew} | toast: ${toastTxt}`);
  await shot('20-updated-toast');
  const ck = await page.evaluate(async () => caches.keys());
  ok('only the semver cache remains', ck.length === 1 && ck[0] === `langapp-${EXPECT}`, ck.join(','));
  ok('reviews from the old version survive the update', (await idbAll('events')).length === 2 && (await consistent()).length === 0);
} else { assemble(NEW_DIR); await page.goto(BASE); await page.waitForSelector('[data-test=menu-flashcards]'); await page.evaluate(() => navigator.serviceWorker.ready); await page.reload(); }
const swState = await page.evaluate(async () => { const r = await navigator.serviceWorker.ready; return { state: r.active && r.active.state, scope: r.scope, ctl: !!navigator.serviceWorker.controller }; });
ok('service worker active, scoped to the subpath, controlling the page', swState.state === 'activated' && swState.scope === BASE && swState.ctl, JSON.stringify(swState));
const verJs = await page.evaluate(async () => (await (await fetch('js/version.js')).text()).trim());
ok('version.js is a plain 3-part semver', new RegExp(`^export const APP_VERSION = '${EXPECT.replace(/\./g, '\\.')}';$`).test(verJs) && /^\d+\.\d+\.\d+$/.test(EXPECT), verJs);
await shot('21-menu');

// ---------- 3. French nouns: front, back, swipes, undo
const ev0 = (await idbAll('events')).length;
await page.tap('[data-test=menu-flashcards]'); await page.tap('[data-test=lang-fr]'); await page.tap('[data-test=level-A1]'); await page.tap('[data-test=stack-noun]');
await page.waitForSelector('.card:not(.next)'); await page.waitForTimeout(400);
ok('no bottom buttons / End session', await page.locator('.actions, [data-test^=btn-]').count() === 0 && await page.locator('main button, main .btn').count() === 0,
  await page.locator('main button').allInnerTexts().then(t => t.join('|')));
ok('undo button in top bar, disabled before any swipe', await page.locator('#undo').isVisible() && await page.locator('#undo').isDisabled());
let cid = await curCard().getAttribute('data-id'), it = await packItem('fr-A1-noun.json', cid);
const frontTxt = (await curCard().locator('.front').innerText()).trim();
const frontKids = await curCard().locator('.front > *').count();
ok('front shows only article + word', frontTxt === `${it.a ? it.a + ' ' : ''}${it.d}` && frontKids === 1 && await curCard().locator('.front .tag, .front .tap').count() === 0, JSON.stringify(frontTxt));
await shot('22-fr-noun-front');
await tapCard();
ok('tap flips the card', await page.locator('.card:not(.next).flipped').count() === 1);
ok('gender shown on the back', !it.g || (await curCard().locator('.back-face [data-test=gender]').count()) === 1, it.g);
const fs1 = await curCard().locator('[data-test=tr-es]').evaluate(e => { const s = getComputedStyle(e); return [s.fontSize, s.fontWeight, s.fontFamily]; });
const fs2 = await curCard().locator('[data-test=tr-en]').evaluate(e => { const s = getComputedStyle(e); return [s.fontSize, s.fontWeight, s.fontFamily]; });
ok('Spanish and English translations have equal size and weight', JSON.stringify(fs1) === JSON.stringify(fs2), JSON.stringify(fs1) + ' vs ' + JSON.stringify(fs2));
const exTxt = await curCard().locator('[data-test=example] .s').innerText().catch(() => null);
ok('best Tatoeba example rendered on the back', it.x ? exTxt === it.x[0].t : true, exTxt);
const backTxt = await curCard().locator('.back-face').innerText();
ok('no source/attribution line under the example', !/Tatoeba|CC BY|Wiktionary/.test(backTxt) && await curCard().locator('.ex .src').count() === 0, backTxt.slice(-120));
const nullHits = await page.evaluate(async () => { let n = 0; for (const f of ['fr-A1-noun.json', 'fr-A1-verb.json', 'ru-A1-noun.json', 'ru-A1-verb.json']) n += (await (await fetch('data/' + f)).json()).items.filter(i => (i.x || []).some(x => !x.es || !x.en)).length; return n; });
ok('examples missing a translation never print "null"', !/\bnull\b/.test(backTxt), `${nullHits} cards have an example with one translation missing`);
ok('no level/source footer on the card', await curCard().locator('.small').count() === 0 && !/Level:|FLELex|SMARTool|KELLY/.test(backTxt));
const sz = await page.evaluate(() => { const c = document.querySelector('.card:not(.next)').getBoundingClientRect(), s = document.querySelector('.stage').getBoundingClientRect(); return { cw: c.width, ch: c.height, sw: s.width, sh: s.height, vw: innerWidth, vh: innerHeight, right: c.right, bottom: c.bottom }; });
ok('card ~13% smaller than the stage and fully on screen', sz.cw / sz.sw > 0.84 && sz.cw / sz.sw < 0.9 && sz.ch / sz.sh > 0.84 && sz.ch / sz.sh < 0.9 && sz.right <= sz.vw && sz.bottom <= sz.vh, JSON.stringify(sz));
const fsz = await curCard().locator('[data-test=tr-es]').evaluate(e => parseFloat(getComputedStyle(e).fontSize));
ok('translations stay readable (>= 20px)', fsz >= 20, String(fsz));
await shot('23-fr-noun-back');
if (it.x && it.x.length > 1) {
  const eb = await curCard().locator('[data-test=example]').boundingBox(); await tapAt(eb.x + eb.width / 2, eb.y + eb.height / 2);
  const ex2 = await curCard().locator('[data-test=example] .s').innerText();
  ok('tapping the example cycles to the next one (card stays flipped)', ex2 === it.x[1].t && await page.locator('.card:not(.next).flipped').count() === 1, ex2);
  await shot('24-fr-noun-back-example2');
}
const firstId = cid;
await touchSwipe(1, 60);                                    // swipe on the back face: knew
let evs = await idbAll('events'); ok('touch swipe right (on back face) records a "knew"', evs.length === ev0 + 1 && evs.at(-1).result === 'knew' && evs.at(-1).flipped === true && evs.at(-1).wordId === firstId);
cid = await curCard().getAttribute('data-id');
const b = await curCard().boundingBox(); await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2); await page.mouse.down();
for (let k = 1; k <= 10; k++) await page.mouse.move(b.x + b.width / 2 - k * 16, b.y + b.height / 2); await page.mouse.up(); await page.waitForTimeout(700);
evs = await idbAll('events'); ok('mouse drag left records a "didnt"', evs.length === ev0 + 2 && evs.at(-1).result === 'didnt' && evs.at(-1).wordId === cid);
const id3 = await curCard().getAttribute('data-id');
await page.keyboard.press('ArrowRight'); await page.waitForTimeout(600);
evs = await idbAll('events'); ok('keyboard shortcut still works (ArrowRight)', evs.length === ev0 + 3 && evs.at(-1).wordId === id3);
const tally0 = await page.locator('[data-test=tally]').innerText();
// undo twice
await page.tap('#undo'); await page.waitForTimeout(700);
evs = await idbAll('events');
ok('undo brings the previous card back', (await curCard().getAttribute('data-id')) === id3, await curCard().getAttribute('data-id'));
ok('undo marks the event undone instead of deleting it', evs.length === ev0 + 3 && evs.at(-1).undone === true && evs.at(-1).undoneAt && evs.slice(0, -1).every(e => !e.undone));
ok('word aggregate removed for a word whose only review was undone', !(await idbAll('words')).some(w => w.id === id3));
await page.tap('#undo'); await page.waitForTimeout(700);
ok('second undo goes back one more card', (await curCard().getAttribute('data-id')) === cid);
ok('tally adjusted after undo', (await page.locator('[data-test=tally]').innerText()).replace(/\s+/g, ' ') === '✓ 1 ✗ 0', `${tally0} -> ${await page.locator('[data-test=tally]').innerText()}`);
await shot('25-after-undo');
await touchSwipe(1);                                         // re-answer differently
evs = await idbAll('events'); const live = evs.filter(e => !e.undone);
ok('re-answering after undo records a fresh event', evs.length === ev0 + 4 && evs.at(-1).wordId === cid && evs.at(-1).result === 'knew' && !evs.at(-1).undone);
const bad = await consistent(); ok('aggregates consistent with non-undone events', bad.length === 0, JSON.stringify(bad).slice(0, 300));
const wc = (await idbAll('words')).find(w => w.id === cid);
ok('re-answered word counts only the live event', wc && wc.shown === 1 && wc.right === 1 && wc.left === 0 && wc.lastResult === 'knew', JSON.stringify(wc));

// multi-step undo: 5 swipes in a row, then 5 undos in a row
const startId = await curCard().getAttribute('data-id'); const nBefore = (await idbAll('events')).length; const seq = [];
for (let k = 0; k < 5; k++) { seq.push(await curCard().getAttribute('data-id')); await touchSwipe(k % 2 ? -1 : 1); }
const undoneBack = [];
for (let k = 0; k < 5; k++) { await page.tap('#undo'); await page.waitForTimeout(650); undoneBack.push(await curCard().getAttribute('data-id')); }
evs = await idbAll('events');
ok('multi-step undo: 5 undos walk back through all 5 cards in order', JSON.stringify(undoneBack) === JSON.stringify([...seq].reverse()) && (await curCard().getAttribute('data-id')) === startId, undoneBack.join(','));
ok('multi-step undo: all 5 events flagged undone, none deleted', evs.length === nBefore + 5 && evs.slice(-5).every(e => e.undone));
ok('multi-step undo: stats consistent afterwards', (await consistent()).length === 0);
ok('undo stack goes back to the start of the session', await page.locator('#undo').isEnabled());
for (let k = 0; k < 3; k++) { await page.locator('#undo').tap({ force: true }); await page.waitForTimeout(650); }
ok('undo disabled once the whole session is undone', await page.locator('#undo').isDisabled() && (await page.locator('[data-test=tally]').innerText()).replace(/\s+/g, ' ') === '✓ 0 ✗ 0' && (await consistent()).length === 0);
await touchSwipe(1); await touchSwipe(-1);
// ---------- 4. Russian verb + noun backs
await page.goto(BASE + '#/fc/ru/A1/verb'); await page.waitForSelector('.card:not(.next)'); await page.waitForTimeout(400);
cid = await curCard().getAttribute('data-id'); it = await packItem('ru-A1-verb.json', cid);
ok('Russian front shows only the word (no article, no aspect)', (await curCard().locator('.front').innerText()).trim() === it.d && await curCard().locator('.front .tag').count() === 0, it.d);
await shot('26-ru-verb-front'); await tapCard();
ok('aspect shown on the back', !it.asp || (await curCard().locator('.back-face [data-test=aspect]').count()) === 1, it.asp);
ok('Russian example rendered', !it.x || (await curCard().locator('[data-test=example] .s').innerText()) === it.x[0].t);
await shot('27-ru-verb-back');
await page.goto(BASE + '#/fc/ru/A1/noun'); await page.waitForSelector('.card:not(.next)'); await page.waitForTimeout(400); await shot('28-ru-noun-front'); await tapCard(); await shot('29-ru-noun-back');
await page.goto(BASE + '#/fc/fr/A1/verb'); await page.waitForSelector('.card:not(.next)'); await page.waitForTimeout(400); await tapCard(); await shot('30-fr-verb-back');
ok('undo hidden outside a session', await page.goto(BASE + '#/stats').then(() => page.waitForSelector('[data-test=event-count]')).then(() => page.locator('#undo').isHidden()));

// ---------- 5. stats + exports
const cnt = await page.locator('[data-test=event-count]').innerText();
evs = await idbAll('events');
ok('stats count excludes undone events', cnt.startsWith(`${evs.filter(e => !e.undone).length} review events`) && cnt.includes(`+${evs.filter(e => e.undone).length} undone`), cnt);
await shot('31-stats');
const [dl] = await Promise.all([page.waitForEvent('download'), page.tap('[data-test=export-json]')]);
const ej = JSON.parse(fs.readFileSync(await dl.path(), 'utf8'));
ok('JSON export keeps undone events flagged', ej.version === EXPECT && ej.events.length === evs.length && ej.events.filter(e => e.undone).length === evs.filter(e => e.undone).length);
const [dl2] = await Promise.all([page.waitForEvent('download'), page.tap('[data-test=export-csv]')]);
const csv = fs.readFileSync(await dl2.path(), 'utf8').trim().split('\n');
ok('events CSV has an undone column', csv[0].split(',').includes('undone') && csv.length === evs.length + 1, csv[0]);
await page.goto(BASE + '#/about'); await page.waitForSelector('.credits');
ok('About credits Tatoeba CC BY 2.0 FR, Wiktionary, FLELex, SMARTool, KELLY, OMW', await page.evaluate(() => ['Tatoeba', 'CC BY 2.0 FR', 'Wiktionary', 'CC BY-SA 4.0', 'FLELex', 'SMARTool', 'KELLY', 'Open Multilingual Wordnet'].every(t => document.body.innerText.includes(t))));
await page.locator('[data-test="credits-fr-A1-noun.json"] summary').tap(); await page.waitForSelector('[data-test="credits-fr-A1-noun.json"] li');
const frPack = await page.evaluate(async () => (await (await fetch('data/fr-A1-noun.json')).json()).items.flatMap(i => i.x || []));
const nLi = await page.locator('[data-test="credits-fr-A1-noun.json"] li').count();
const li0 = await page.locator('[data-test="credits-fr-A1-noun.json"] li').first().innerText();
ok('About lists every Tatoeba sentence ID + author', nLi === frPack.length && li0.includes(`#${frPack[0].id}`) && li0.includes(frPack[0].by), `${nLi}/${frPack.length} · ${li0}`);
await shot('32-about');
// ---------- 5b. home shortcuts
const LS = () => page.evaluate(() => JSON.parse(localStorage.getItem('langapp.shortcuts.v1') || '[]'));
await page.goto(BASE); await page.waitForSelector('[data-test=shortcuts]');
ok('home starts with only the + tile', await page.locator('[data-test=shortcuts] .tile').count() === 1 && await page.locator('[data-test=shortcut-add]').count() === 1);
await page.tap('[data-test=shortcut-add]'); await page.waitForSelector('[data-test=lang-fr]');
ok('+ tile opens the deck picker', (await page.evaluate(() => location.hash)) === '#/fc');
await page.tap('[data-test=lang-fr]'); await page.tap('[data-test=level-A1]'); await page.waitForSelector('[data-test=pin-noun]');
await page.tap('[data-test=pin-noun]');
ok('★ pins French A1 nouns (and does not open the deck)', (await page.evaluate(() => location.hash)) === '#/fc/fr/A1' && await page.getAttribute('[data-test=pin-noun]', 'aria-pressed') === 'true' && (await LS()).length === 1);
await page.tap('[data-test=pin-verb]'); await page.tap('[data-test=pin-verb]');
ok('★ again unpins', await page.getAttribute('[data-test=pin-verb]', 'aria-pressed') === 'false' && (await LS()).length === 1);
await page.tap('[data-test=pin-verb]');
await shot('33-stack-pins');
await page.goto(BASE + '#/fc/ru/A1'); await page.waitForSelector('[data-test=pin-noun]'); await page.tap('[data-test=pin-noun]');
await page.goto(BASE); await page.waitForSelector('[data-test=shortcuts]');
const tiles = await page.locator('[data-test^=shortcut-stack]').allInnerTexts();
ok('home shows the 3 pinned decks in pin order', tiles.length === 3 && /French A1\s*Nouns/.test(tiles[0]) && /French A1\s*Verbs/.test(tiles[1]) && /Russian A1\s*Nouns/.test(tiles[2]), tiles.map(t => t.replace(/\s+/g, ' ')).join(' | '));
await shot('34-home-shortcuts');
await page.reload(); await page.waitForSelector('[data-test=shortcuts]');
ok('shortcuts survive a reload', await page.locator('[data-test^=shortcut-stack]').count() === 3);
await page.tap('[data-test=shortcut-stack-fr-A1-noun]'); await page.waitForSelector('.card:not(.next)');
ok('one tap on a shortcut starts that deck', (await page.evaluate(() => location.hash)) === '#/fc/fr/A1/noun' && (await page.locator('#title').innerText()).includes('French A1'));
const evBefore = (await idbAll('events')).length; await touchSwipe(1);
ok('reviews from a shortcut session are recorded', (await idbAll('events')).length === evBefore + 1 && (await idbAll('events')).at(-1).result === 'knew' && (await consistent()).length === 0);
await page.tap('#back'); await page.waitForSelector('[data-test=shortcuts]');
ok('back from a shortcut session returns home', (await page.evaluate(() => location.hash)) === '#/');
// long-press -> edit mode -> remove
const tb = await page.locator('[data-test=shortcut-stack-ru-A1-noun]').boundingBox();
await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: tb.x + tb.width / 2, y: tb.y + tb.height / 2 }] });
await page.waitForTimeout(800); await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }); await page.waitForTimeout(400);
ok('long-press enters edit mode without opening the deck', (await page.evaluate(() => location.hash)) === '#/' && await page.locator('.shortcuts.editing [data-test^=rm-]').count() === 3);
await shot('35-home-edit');
await page.locator('[data-test=rm-stack-ru-A1-noun]').tap({ force: true }); await page.waitForTimeout(200);
ok('× removes the shortcut', await page.locator('[data-test^=shortcut-stack]').count() === 2 && (await LS()).length === 2 && !(await LS()).some(x => x.lang === 'ru'));
await page.locator('[data-test=shortcuts-done]').tap({ force: true });
ok('✓ leaves edit mode', await page.locator('.shortcuts.editing').count() === 0 && await page.locator('[data-test=shortcut-add]').count() === 1);
await page.goto(BASE + '#/fc/ru/A1'); await page.waitForSelector('[data-test=pin-noun]');
ok('deck picker reflects the removal', await page.getAttribute('[data-test=pin-noun]', 'aria-pressed') === 'false');
await page.evaluate(() => { const l = JSON.parse(localStorage.getItem('langapp.shortcuts.v1')); l.push({ kind: 'topic', lang: 'fr', topic: 'countries' }); localStorage.setItem('langapp.shortcuts.v1', JSON.stringify(l)); });
await page.goto(BASE); await page.waitForSelector('[data-test=shortcuts]');
ok('unknown future deck kinds are kept but not shown', await page.locator('[data-test^=shortcut-]:not([data-test=shortcut-add])').count() === 2 && (await LS()).length === 3);
await page.evaluate(() => { const l = JSON.parse(localStorage.getItem('langapp.shortcuts.v1')).filter(x => x.kind !== 'topic'); localStorage.setItem('langapp.shortcuts.v1', JSON.stringify(l)); });
await page.reload(); await page.waitForSelector('[data-test=shortcuts]'); await shot('34-home-shortcuts');

// ---------- 6. installability + offline
const inst = await cdp.send('Page.getInstallabilityErrors');
ok('installable (no installability errors)', inst.installabilityErrors.length === 0, JSON.stringify(inst.installabilityErrors));
await ctx.setOffline(true);
await page.goto(BASE + '#/fc/ru/A1/noun'); await page.waitForSelector('.card:not(.next)', { timeout: 5000 }).catch(() => {});
ok('works offline', await page.locator('.card:not(.next)').count() === 1);
await ctx.setOffline(false);
ok('no page errors', errors.length === 0, errors.join(' | '));
fs.writeFileSync('/workspace/langapp-test/results.json', JSON.stringify(results, null, 1));
await ctx.close();
console.log(`${results.filter(r => r.pass).length}/${results.length} passed`);
