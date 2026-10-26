// Navigation race: a screen that is still loading must not draw into, or add key handlers to, the screen you moved to.
// Data responses are delayed 400 ms (slow phone / first load). Run from a folder with playwright-core installed:
//   BASE=http://localhost:8092/langcards/ CHROME=/path/to/chrome node /path/to/test/race.mjs
import { createRequire } from 'module';
import path from 'path';
const req = createRequire(path.join(process.cwd(), 'x.js'));
const { chromium } = req('playwright-core');
const BASE = process.env.BASE || 'http://localhost:8092/langcards/';
const results = []; const ok = (name, cond, extra = '') => { results.push({ name, pass: !!cond }); console.log(cond ? 'PASS' : 'FAIL', name, cond ? '' : extra); };
const browser = await chromium.launch({ executablePath: process.env.CHROME || '/usr/bin/google-chrome', headless: true, args: ['--no-sandbox'] });
const events = page => page.evaluate(() => new Promise(r => { const q = indexedDB.open('langapp'); q.onsuccess = () => { const t = q.result.transaction('events').objectStore('events').getAll(); t.onsuccess = () => { q.result.close(); r(t.result); }; }; }));
async function newPage() {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: 'block' });
  const page = await ctx.newPage(); const errors = []; page.on('pageerror', e => errors.push(String(e)));
  await page.route('**/data/*.json', async route => { await new Promise(r => setTimeout(r, 400)); route.continue(); });
  return { ctx, page, errors };
}

{ // tap a deck, then Back before it has loaded
  const { ctx, page, errors } = await newPage();
  await page.goto(BASE + '#/fc/fr/A1'); await page.waitForSelector('[data-test=stack-noun]');
  await page.click('[data-test=stack-noun]'); await page.waitForTimeout(100); await page.click('#back'); await page.waitForTimeout(2000);
  ok('deck then quick Back: stack picker only, no session cards, no Undo', await page.locator('.deck').count() === 2 && await page.locator('.card').count() === 0 && !(await page.locator('#undo').isVisible()));
  await page.keyboard.press('ArrowRight'); await page.waitForTimeout(600);
  ok('deck then quick Back: arrow key on the stack picker records nothing', (await events(page)).length === 0);
  ok('deck then quick Back: no page errors', !errors.length, errors.join(' | '));
  await ctx.close();
}
{ // open one deck, then another before the first has loaded
  const { ctx, page, errors } = await newPage();
  await page.goto(BASE); await page.waitForSelector('[data-test=menu-flashcards]');
  await page.evaluate(() => { location.hash = '#/fc/fr/A1/noun'; setTimeout(() => { location.hash = '#/fc/ru/A1/verb'; }, 50); });
  await page.waitForSelector('.card:not(.next)'); await page.waitForTimeout(1500);
  ok('two decks in a row: one session on screen', await page.locator('.session').count() === 1 && await page.locator('.card').count() === 2);
  await page.keyboard.press('ArrowRight'); await page.waitForTimeout(800);
  const evs = await events(page);
  ok('two decks in a row: one key press records one review, in the deck on screen', evs.length === 1 && evs[0].wordId.startsWith('ru-verb-'), JSON.stringify(evs.map(e => e.wordId)));
  await page.evaluate(() => { location.hash = '#/'; }); await page.waitForSelector('[data-test=menu-flashcards]');
  await page.keyboard.press('ArrowRight'); await page.waitForTimeout(800);
  ok('two decks in a row: no review recorded from the menu', (await events(page)).length === 1);
  ok('two decks in a row: no page errors', !errors.length, errors.join(' | '));
  await ctx.close();
}
{ // stats / about: leave before they load
  const { ctx, page } = await newPage();
  await page.goto(BASE); await page.waitForSelector('[data-test=menu-flashcards]');
  await page.evaluate(() => { location.hash = '#/about'; setTimeout(() => { location.hash = '#/'; }, 50); }); await page.waitForTimeout(1500);
  ok('about then quick Back: menu only', await page.locator('.credits').count() === 0 && await page.locator('[data-test=menu-flashcards]').count() === 1);
  await ctx.close();
}
await browser.close();
console.log(`${results.filter(r => r.pass).length}/${results.length} passed`);
process.exit(results.every(r => r.pass) ? 0 : 1);
