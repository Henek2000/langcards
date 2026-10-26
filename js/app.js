import { recordReview, undoReview, wordStats, allWords, allEvents, clearAll, importBackup } from './db.js';
import { buildRun, split, wordState, RUN_SIZE } from './deck.js';
import { progress } from './progress.js';
import { APP_VERSION } from './version.js';
import { icon } from './icons.js';

const LANGS = { fr: { name: 'French', code: 'FR' }, ru: { name: 'Russian', code: 'RU' }, nl: { name: 'Dutch', code: 'NL' } };
const STACKS = { noun: 'Nouns', verb: 'Verbs' };
const GENDER = { fr: { m: 'masculine', f: 'feminine', mf: 'masc./fem.' }, ru: { m: 'masculine', f: 'feminine', n: 'neuter', mf: 'common' },
  nl: { m: 'masculine', f: 'feminine', n: 'neuter', mf: 'common' } };
const ASPECT = { impf: 'imperfective', pf: 'perfective', 'impf/pf': 'impf. & pf.' };
const MODES = { run: 'Run', unknown: 'Unknown only', retry: 'Retry missed' };
const REDUCED = window.matchMedia('(prefers-reduced-motion: reduce)');

const $view = document.getElementById('view'), $title = document.getElementById('title'), $back = document.getElementById('back'), $undo = document.getElementById('undo');
const h = (tag, attrs = {}, ...kids) => {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') el.className = v; else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (v === true) el.setAttribute(k, ''); else if (v !== false && v != null) el.setAttribute(k, v);
  }
  for (const c of kids.flat()) if (c != null && c !== false) el.append(c.nodeType ? c : document.createTextNode(c));
  return el;
};
let index = null;
async function getIndex() { if (!index) index = await (await fetch('data/index.json')).json(); return index; }
const packCache = {};
async function getPack(file) { if (!packCache[file]) packCache[file] = await (await fetch('data/' + file)).json(); return packCache[file]; }
const packKey = p => `${p.lang}-${p.level}-${p.stack}`;
const deckName = p => `${LANGS[p.lang].name} ${STACKS[p.stack].toLowerCase()}`;
const pct = (n, d) => (d ? Math.floor(100 * n / d) : 0);   // floor: a deck only reads 100% when every word is known
function setTitle(t, back) { $title.textContent = t; $back.hidden = !back; $back.onclick = () => { location.hash = back; }; $undo.hidden = true; $undo.onclick = null; }
$back.replaceChildren(icon('back')); $undo.replaceChildren(icon('undo'), h('span', { class: 'lbl' }, 'Undo'));
const buzz = p => { try { navigator.vibrate && navigator.vibrate(p); } catch { /* not supported */ } };

// ---------------- routing
// Each render gets a sequence number; a screen still loading when the hash changes sees a newer number after its awaits and stops,
// so two screens never stack up and a stale session never registers key handlers.
const routes = [
  [/^#?\/?$/, home],
  [/^#\/deck\/(fr|ru|nl)-(A1)-(noun|verb)$/, deckScreen],
  [/^#\/deck\/(fr|ru|nl)-(A1)-(noun|verb)\/(run|unknown|retry)$/, session],
  [/^#\/progress$/, progressScreen],
  [/^#\/about$/, about],
];
let cleanup = null, seq = 0;
const stale = my => my !== seq;
async function render() {
  const my = ++seq;
  if (cleanup) { cleanup(); cleanup = null; }
  let hash = location.hash || '#/';
  const old = hash.match(/^#\/fc\/(fr|ru)\/(A1)\/(noun|verb)$/);            // links and bookmarks from v0.4
  if (old) { location.replace(`#/deck/${old[1]}-${old[2]}-${old[3]}`); return; }
  const lang = (hash.match(/^#\/deck\/(fr|ru|nl)/) || [])[1];
  document.body.className = [lang && `lang-${lang}`, routes[0][0].test(hash) && 'route-home'].filter(Boolean).join(' ');
  for (const [re, fn] of routes) {
    const m = hash.match(re);
    if (m) { $view.replaceChildren(); $view.classList.remove('enter'); void $view.offsetWidth; $view.classList.add('enter'); window.scrollTo(0, 0); await fn(my, ...m.slice(1)); return; }
  }
  location.replace('#/');
}
window.addEventListener('hashchange', render);

// ---------------- shared pieces
function meter(c, total, cls = '') {
  // segmented bar: known | unknown | new
  const seg = (k, n) => (n ? h('i', { class: k, style: `flex-grow:${n}` }) : null);
  return h('div', { class: `meter ${cls}`, role: 'img', 'aria-label': `${c.known} known, ${c.unknown} unknown, ${c.new} new of ${total}` },
    seg('known', c.known), seg('unknown', c.unknown), seg('new', c.new));
}
const counts = by => ({ known: by.known.length, unknown: by.unknown.length, new: by.new.length });
const stat = (n, label, test) => h('div', { class: 'stat', 'data-test': test }, h('b', {}, String(n)), h('span', {}, label));

// ---------------- home: every deck with its progress
async function home(my) {
  setTitle('Langcards', null);
  const [idx, words, evs] = [await getIndex(), await allWords(), await allEvents()];
  if (stale(my)) return;
  const pr = progress(evs, 1), total = idx.packs.reduce((a, p) => a + p.count, 0);
  const decks = h('div', { class: 'decks' });
  for (const p of idx.packs) {
    const ws = words.filter(w => w.pack === packKey(p));
    const c = { known: ws.filter(w => wordState(w) === 'known').length, unknown: ws.filter(w => wordState(w) === 'unknown').length };
    c.new = p.count - c.known - c.unknown;
    const done = c.known === p.count;
    decks.append(h('a', { class: `deck lang-${p.lang}${done ? ' done' : ''}`, href: `#/deck/${packKey(p)}`, 'data-test': `deck-${packKey(p)}` },
      h('span', { class: 'deck-top' }, h('span', { class: 'code' }, LANGS[p.lang].code), h('span', { class: 'lvl' }, p.level),
        h('span', { class: 'pct', 'data-test': 'deck-pct' }, `${pct(c.known, p.count)}%`)),
      h('span', { class: 'deck-name' }, STACKS[p.stack]),
      meter(c, p.count),
      h('span', { class: 'deck-sub' }, done ? '■ Complete' : `${c.known} known · ${c.unknown} unknown · ${c.new} new`)));
  }
  $view.append(
    h('header', { class: 'masthead' }, h('h2', {}, 'Lang', h('br'), 'cards'), h('p', {}, 'French, Russian & Dutch A1 · learn the words')),
    h('div', { class: 'stats' }, stat(words.filter(w => wordState(w) === 'known').length, `of ${total} known`, 'home-known'), stat(pr.streak, 'day streak', 'home-streak'),
      stat(pr.todayReviews, 'cards today', 'home-today')),
    h('h3', { class: 'label' }, 'Decks'), decks,
    h('nav', { class: 'links' },
      h('a', { class: 'link', href: '#/progress', 'data-test': 'menu-progress' }, 'Progress', icon('arrow')),
      h('a', { class: 'link', href: '#/about', 'data-test': 'menu-about' }, 'About & credits', icon('arrow'))),
    h('p', { class: 'hint' }, `v${APP_VERSION}`));
}

// ---------------- deck: progress, start a run, browse words by state
async function deckScreen(my, lang, lv, stack) {
  const key = `${lang}-${lv}-${stack}`;
  setTitle(deckName({ lang, stack }), '#/');
  const meta = (await getIndex()).packs.find(p => packKey(p) === key);
  const [pack, ws] = [await getPack(meta.file), await wordStats(key)];
  if (stale(my)) return;
  const stats = Object.fromEntries(ws.map(s => [s.id, s]));
  const by = split(pack.items, stats), c = counts(by), done = c.known === pack.items.length;
  const btn = (mode, label, n, cls) => h('a', { class: `btn ${cls}`, href: `#/deck/${key}/${mode}`, 'data-test': `start-${mode}` }, icon('play'), label, h('small', {}, `· ${n}`));
  const head = h('section', { class: `deck-head${done ? ' done' : ''}` },
    h('div', { class: 'big-pct', 'data-test': 'deck-big-pct' }, `${pct(c.known, pack.items.length)}`, h('small', {}, '%')),
    h('p', { class: 'deck-of' }, `${c.known} of ${pack.items.length} words known`),
    meter(c, pack.items.length, 'lg'),
    h('ul', { class: 'legend' }, h('li', { class: 'known' }, `${c.known} known`), h('li', { class: 'unknown' }, `${c.unknown} unknown`), h('li', { class: 'new' }, `${c.new} new`)),
    done ? h('p', { class: 'complete-badge', 'data-test': 'deck-complete' }, 'Deck complete') : null);
  const actions = h('div', { class: 'actions' },
    btn('run', done ? 'Review run' : 'Start run', Math.min(RUN_SIZE, pack.items.length), 'primary'),
    c.unknown ? btn('unknown', 'Unknown only', Math.min(RUN_SIZE, c.unknown), '') : null);
  // word list with tabs
  const tabs = h('div', { class: 'tabs', role: 'tablist' }), list = h('ol', { class: 'words', 'data-test': 'word-list' });
  const sorted = {
    unknown: by.unknown.slice().sort((a, b) => (stats[a.id].lastSeen > stats[b.id].lastSeen ? -1 : 1)),
    known: by.known.slice().sort((a, b) => (stats[a.id].lastSeen > stats[b.id].lastSeen ? -1 : 1)), new: by.new };
  let tab = c.unknown ? 'unknown' : c.known ? 'known' : 'new';
  const drawList = (limit = 60) => {
    const items = sorted[tab];
    tabs.replaceChildren(...['unknown', 'known', 'new'].map(k => h('button', { role: 'tab', class: k, 'aria-selected': String(k === tab), 'data-test': `tab-${k}`,
      onclick: () => { tab = k; drawList(); } }, k, h('b', {}, String(c[k])))));
    list.replaceChildren(...items.slice(0, limit).map(it => {
      const s = stats[it.id];
      return h('li', { class: wordState(s) }, h('span', { class: 'w', lang }, it.a ? h('span', { class: 'article' }, it.a + ' ') : null, it.d || it.w),
        h('span', { class: 'g' }, (it.en[0] || it.es[0] || '—')), s ? h('span', { class: 'n' }, `${s.right}✓ ${s.left}✗`) : null);
    }), ...(items.length > limit ? [h('li', { class: 'more' }, h('button', { class: 'btn', 'data-test': 'show-all', onclick: () => drawList(Infinity) }, `Show all ${items.length}`))] : []),
    ...(!items.length ? [h('li', { class: 'empty' }, tab === 'unknown' ? 'No unknown words. Nice.' : tab === 'known' ? 'Nothing known yet. Start a run.' : 'You have seen every word.')] : []));
  };
  drawList();
  $view.append(head, actions, h('h3', { class: 'label' }, 'Words'), tabs, list);
}

// ---------------- card rendering
function front(it, lang) {
  // front: the word only (with its article where the language has one)
  return h('div', { class: 'face front' },
    h('div', { class: 'word', lang, 'data-test': 'front-word' }, it.a ? h('span', { class: 'article' }, it.a + ' ') : null, it.d || it.w));
}
function exampleEl(it, lang) {
  const xs = it.x || [];
  if (!xs.length) {   // Wiktionary example, only when Tatoeba has none
    return it.ex ? h('div', { class: 'ex', 'data-test': 'example', 'data-src': 'wiktionary' }, h('span', { class: 's', lang }, it.ex[0]),
      it.ex[1] ? h('span', { class: 't', lang: 'en' }, it.ex[1]) : null) : null;
  }
  const box = h('div', { class: 'ex', 'data-test': 'example', 'data-src': 'tatoeba' });
  let k = 0;
  const draw = () => {
    const x = xs[k];
    box.dataset.idx = k;
    box.replaceChildren(...[h('span', { class: 's', lang }, x.t),
      x.es ? h('span', { class: 't', lang: 'es' }, x.es[0]) : null,
      x.en ? h('span', { class: 't', lang: 'en' }, x.en[0]) : null,
      xs.length > 1 ? h('span', { class: 'cyc', 'data-test': 'ex-count' }, `${k + 1}/${xs.length}`) : null].filter(Boolean));   // a missing translation is skipped, never printed as "null"
  };
  box.cycle = () => { if (xs.length < 2) return false; k = (k + 1) % xs.length; draw(); return true; };
  draw();
  return box;
}
function back(it, lang) {
  const tags = [];
  if (it.g && GENDER[lang][it.g]) tags.push(h('span', { class: `tag ${it.g}`, 'data-test': 'gender' }, GENDER[lang][it.g]));
  if (it.asp) tags.push(h('span', { class: 'tag', 'data-test': 'aspect' }, ASPECT[it.asp] || it.asp));
  return h('div', { class: 'face back-face' },
    h('div', { class: 'head' }, h('span', { class: 'hw', lang }, it.a ? it.a + ' ' : '', it.d || it.w), tags),
    h('h3', {}, 'Español'), h('p', { class: 'tr', lang: 'es', 'data-test': 'tr-es' }, it.es.length ? it.es.join(', ') : '—'),
    h('h3', {}, 'English'), h('p', { class: 'tr', lang: 'en', 'data-test': 'tr-en' }, it.en.length ? it.en.join(', ') : '—'),
    it.def ? h('p', { class: 'def', lang: 'en' }, it.def) : null,
    exampleEl(it, lang));
}
function cardEl(it, lang) {
  return h('div', { class: 'card', 'data-id': it.id },
    h('div', { class: 'wash yes' }), h('div', { class: 'wash no' }),
    h('div', { class: 'stamp yes' }, 'Knew'), h('div', { class: 'stamp no' }, 'Again'),
    h('div', { class: 'inner' }, front(it, lang), back(it, lang)));
}
// shrink the front word until it fits the card on one line per word (long Russian compounds, phrases)
function fitWord(card) {
  const w = card && card.querySelector('.front .word'); if (!w) return;
  const box = w.parentElement, cs = getComputedStyle(box);
  const availW = box.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight), availH = box.clientHeight * 0.8;
  w.style.fontSize = ''; w.classList.remove('tight');
  let s = parseFloat(getComputedStyle(w).fontSize);
  while (s > 20 && (w.scrollWidth > availW + 0.5 || w.offsetHeight > availH)) { s -= 2; w.style.fontSize = s + 'px'; }
  if (w.scrollWidth > availW + 0.5) w.classList.add('tight');
}

// ---------------- practice run (swipe right = knew, left = again, tap = flip; ↶ undo in the top bar)
let retryIds = null;   // word ids for a "retry missed" run, set by the results screen
async function session(my, lang, lv, stack, mode) {
  const key = `${lang}-${lv}-${stack}`, deckHref = `#/deck/${key}`;
  const meta = (await getIndex()).packs.find(p => packKey(p) === key);
  const [pack, ws] = [await getPack(meta.file), await wordStats(key)];
  if (stale(my)) return;
  const stats = Object.fromEntries(ws.map(s => [s.id, s]));
  const deck = mode === 'retry' ? pack.items.filter(it => retryIds && retryIds.includes(it.id)) : buildRun(pack.items, stats, mode);
  if (!deck.length) { location.replace(deckHref); return; }
  setTitle(`${deckName({ lang, stack })} · ${MODES[mode]}`, deckHref);
  const before = counts(split(pack.items, stats));
  const sessionId = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
  let i = 0, knew = 0, didnt = 0, busy = false, finished = false;
  const history = [];   // [{i, result, eid: Promise<number>}]
  const $prog = h('div', { class: 'progress' }), $bar = h('i'), stage = h('div', { class: 'stage', 'data-test': 'stage' });
  // screen-reader / switch access: the same actions as the swipes, visually hidden
  const sr = h('div', { class: 'sr-only' },
    h('button', { onclick: () => cur && flip() }, 'Show answer'), h('button', { onclick: () => decide('didnt') }, 'Again'), h('button', { onclick: () => decide('knew') }, 'Knew it'));
  const $sess = h('div', { class: 'session' }, $prog, h('div', { class: 'bar' }, $bar), stage, sr);
  $view.append($sess);
  $undo.hidden = false; $undo.onclick = () => undo();
  let cur = null, nxt = null, flipped = false, shownAt = 0;
  const syncUndo = () => { $undo.disabled = !history.length || busy; };
  function updateProg() {
    $prog.replaceChildren(h('span', { class: 'count' }, `${Math.min(i + 1, deck.length)}`, h('small', {}, ` / ${deck.length}`)),
      h('span', { class: 'tally', 'data-test': 'tally' }, h('b', { class: 'k' }, `✓ ${knew}`), h('b', { class: 'd' }, `✗ ${didnt}`)));
    $bar.style.width = `${100 * i / deck.length}%`;
    syncUndo();
  }
  function show(enterFrom = 0) {
    updateProg();
    if (i >= deck.length) return finish();
    if (nxt) { cur = nxt; cur.classList.remove('next'); } else { cur = cardEl(deck[i], lang); stage.append(cur); }
    nxt = deck[i + 1] ? cardEl(deck[i + 1], lang) : null;
    if (nxt) { nxt.classList.add('next'); stage.prepend(nxt); }
    fitWord(cur); fitWord(nxt);
    if (enterFrom) {   // undo: the card flies back in from the side it left
      const el = cur;
      el.style.transition = 'none'; el.style.transform = REDUCED.matches ? 'none' : `translate(${enterFrom * (window.innerWidth + 200)}px, 40px) rotate(${enterFrom * 20}deg)`; el.style.opacity = '0';
      requestAnimationFrame(() => requestAnimationFrame(() => { el.style.transition = 'transform .28s ease-out, opacity .28s'; el.style.transform = ''; el.style.opacity = ''; }));
    }
    flipped = false; shownAt = performance.now(); attachDrag(cur);
  }
  function flip() { flipped = true; cur.classList.toggle('flipped'); }
  async function decide(result, fromDrag = 0) {
    if (busy || !cur || finished) return; busy = true; syncUndo();
    const it = deck[i], el = cur, dir = result === 'knew' ? 1 : -1;
    el.style.transition = REDUCED.matches ? 'opacity .2s' : 'transform .3s cubic-bezier(.4,0,.8,.6), opacity .3s';
    if (!REDUCED.matches) el.style.transform = `translate(${dir * (window.innerWidth + 200)}px, ${fromDrag || 40}px) rotate(${dir * 20}deg)`;
    el.querySelector(`.wash.${dir > 0 ? 'yes' : 'no'}`).style.opacity = 1;
    el.querySelector(`.stamp.${dir > 0 ? 'yes' : 'no'}`).style.opacity = 1;
    el.style.opacity = '0';
    result === 'knew' ? knew++ : didnt++;
    buzz(result === 'knew' ? 8 : [6, 40, 6]);
    const eid = recordReview({ wordId: it.id, lang, level: lv, stack, word: it.w, result, flipped, ts: new Date().toISOString(),
      ms: Math.round(performance.now() - shownAt), sessionId, mode, appVersion: APP_VERSION });
    eid.catch(e => console.error(e));
    history.push({ i, result, eid });
    i++;
    setTimeout(() => { el.remove(); busy = false; show(); }, 240);
  }
  async function undo() {
    if (busy || !history.length) return; busy = true; syncUndo();
    const last = history.pop();
    try { await undoReview(await last.eid); } catch (e) { console.error(e); }
    last.result === 'knew' ? knew-- : didnt--;
    i = last.i;
    if (finished) { finished = false; $view.replaceChildren($sess); }
    stage.replaceChildren(); cur = nxt = null;
    busy = false;
    show(last.result === 'knew' ? 1 : -1);
  }
  function attachDrag(el) {
    let sx = 0, sy = 0, dx = 0, dy = 0, t0 = 0, down = false, moved = false, target = null;
    const yes = el.querySelector('.stamp.yes'), no = el.querySelector('.stamp.no'), wy = el.querySelector('.wash.yes'), wn = el.querySelector('.wash.no');
    el.addEventListener('pointerdown', e => { if (busy) return; down = true; moved = false; target = e.target; sx = e.clientX; sy = e.clientY; dx = dy = 0; t0 = performance.now(); el.setPointerCapture(e.pointerId); el.style.transition = 'none'; el.classList.add('dragging'); });
    el.addEventListener('pointermove', e => {
      if (!down) return; dx = e.clientX - sx; dy = e.clientY - sy;
      if (Math.abs(dx) > 6 || Math.abs(dy) > 6) moved = true;
      if (!moved) return;
      el.style.transform = REDUCED.matches ? `translate(${dx}px, 0)` : `translate(${dx}px, ${dy * 0.3}px) rotate(${dx / 22}deg)`;
      const py = Math.max(0, Math.min(1, dx / 90)), pn = Math.max(0, Math.min(1, -dx / 90));
      yes.style.opacity = py; no.style.opacity = pn; wy.style.opacity = py; wn.style.opacity = pn;
      if (nxt) nxt.style.transform = `translate(${10 - Math.min(Math.abs(dx) / 10, 10)}px, ${10 - Math.min(Math.abs(dx) / 10, 10)}px)`;
    });
    const end = () => {
      if (!down) return; down = false; el.classList.remove('dragging');
      const v = Math.abs(dx) / Math.max(1, performance.now() - t0), thr = Math.min(110, el.clientWidth * 0.28);
      if (!moved) {   // tap: on the back's example it shows the next example, anywhere else it flips
        const ex = el.classList.contains('flipped') && target && target.closest && target.closest('.ex');
        if (ex && ex.cycle && ex.cycle()) return;
        flip(); return;
      }
      if (Math.abs(dx) > thr || (v > 0.6 && Math.abs(dx) > 40)) return decide(dx > 0 ? 'knew' : 'didnt', dy * 0.3);
      el.style.transition = REDUCED.matches ? 'none' : 'transform .3s cubic-bezier(.2,.9,.3,1.2)'; el.style.transform = ''; yes.style.opacity = no.style.opacity = wy.style.opacity = wn.style.opacity = 0;
      if (nxt) nxt.style.transform = '';
    };
    el.addEventListener('pointerup', end); el.addEventListener('pointercancel', end);
  }
  const onKey = e => {   // desktop shortcuts: → knew, ← again, space/enter flip, Backspace/Ctrl+Z undo
    if (e.target.closest && e.target.closest('button, a')) return;
    if (e.key === 'ArrowRight') decide('knew'); else if (e.key === 'ArrowLeft') decide('didnt');
    else if ((e.key === ' ' || e.key === 'Enter') && !finished) { e.preventDefault(); cur && flip(); }
    else if (e.key === 'Backspace' || (e.key === 'z' && (e.ctrlKey || e.metaKey))) { e.preventDefault(); undo(); }
  };
  const onResize = () => { fitWord(cur); fitWord(nxt); };
  document.addEventListener('keydown', onKey); window.addEventListener('resize', onResize);
  cleanup = () => { document.removeEventListener('keydown', onKey); window.removeEventListener('resize', onResize); };

  function finish() {
    finished = true; cur = nxt = null;   // the results keep ↶ (and Backspace) so the last card can still be undone
    syncUndo();
    // what this run changed: each word's state before the run vs. its last answer in the run
    const after = {};
    for (const x of history) after[deck[x.i].id] = x.result;
    const learned = [], forgot = [], missed = [];
    for (const it of deck) {
      const was = wordState(stats[it.id]), now = after[it.id];
      if (now === 'knew' && was !== 'known') learned.push(it);
      if (now === 'didnt') { missed.push(it); if (was === 'known') forgot.push(it); }
    }
    const total = pack.items.length, k0 = before.known, k1 = k0 + learned.length - forgot.length, n = knew + didnt;
    const p0 = pct(k0, total), p1 = pct(k1, total);
    const milestone = [25, 50, 75].filter(m => p0 < m && p1 >= m).pop();
    const deckDone = k1 === total, justDone = deckDone && k0 < total;
    const chips = (list, cls) => h('ul', { class: `chips ${cls}` }, list.map(it => h('li', { lang }, it.a ? `${it.a} ` : '', it.d || it.w)));
    const again = () => { if (location.hash === `${deckHref}/${mode}`) render(); else location.hash = `${deckHref}/${mode}`; };
    const retry = () => { retryIds = missed.map(it => it.id); if (location.hash === `${deckHref}/retry`) render(); else location.hash = `${deckHref}/retry`; };
    const bar = h('div', { class: 'meter lg delta', role: 'img', 'aria-label': `Deck ${p0}% to ${p1}% known` }, h('i', { class: 'known', style: `width:${100 * k0 / total}%` }));
    const res = h('div', { class: 'results', 'data-test': 'summary' },
      h('p', { class: 'kicker' }, deckDone ? 'Deck complete' : 'Run complete'),
      h('div', { class: 'score' }, h('b', { 'data-test': 'score' }, `${knew}`), h('span', {}, `/ ${n}`)),
      h('p', { class: 'score-sub' }, n ? `${Math.round(100 * knew / n)}% knew` : '—'),
      h('div', { class: 'deltas' },
        h('div', { class: 'delta-box good', 'data-test': 'learned' }, h('b', {}, `+${learned.length}`), h('span', {}, 'learned')),
        h('div', { class: 'delta-box bad', 'data-test': 'forgot' }, h('b', {}, `${forgot.length ? '−' : ''}${forgot.length}`), h('span', {}, 'forgotten'))),
      h('div', { class: 'deck-progress' }, h('div', { class: 'dp-head' }, h('span', {}, deckName({ lang, stack })), h('b', { 'data-test': 'deck-delta' }, `${p0}% → ${p1}%`)), bar,
        milestone ? h('p', { class: 'milestone', 'data-test': 'milestone' }, `▲ Passed ${milestone}% of the deck`) : null),
      learned.length ? [h('h3', { class: 'label' }, 'Learned'), chips(learned, 'good')] : null,
      missed.length ? [h('h3', { class: 'label' }, 'Still to learn'), chips(missed, 'bad')] : null,
      h('div', { class: 'actions' },
        missed.length ? h('button', { class: 'btn primary', 'data-test': 'retry', onclick: retry }, icon('play'), 'Retry missed', h('small', {}, `· ${missed.length}`)) : null,
        h('button', { class: `btn ${missed.length ? '' : 'primary'}`, 'data-test': 'again', onclick: again }, icon('play'), 'Another run'),
        h('a', { class: 'btn ghost', href: deckHref, 'data-test': 'to-deck' }, 'Back to deck')));
    $view.replaceChildren(res);
    window.scrollTo(0, 0);
    requestAnimationFrame(() => requestAnimationFrame(() => { bar.firstChild.style.width = `${100 * k1 / total}%`; }));
    if (justDone) celebrate(total);
    else if (milestone) buzz([20, 60, 20]);
  }
  function celebrate(total) {
    buzz([40, 80, 40, 80, 120]);
    const ov = h('div', { class: `complete-ov lang-${lang}`, role: 'dialog', 'aria-label': 'Deck complete', 'data-test': 'deck-complete-overlay' },
      h('div', { class: 'blocks', 'aria-hidden': 'true' }, Array.from({ length: 14 }, (_, k) => h('i', {
        style: `left:${k * 7.2}%;width:${24 + k % 4 * 14}px;height:${24 + k % 3 * 18}px;--rot:${(k % 5 - 2) * 14}deg;--fall:${40 + k % 4 * 6}dvh;animation-delay:${k * 70}ms` }))),
      h('p', { class: 'kicker' }, `${LANGS[lang].name} · ${lv}`),
      h('h2', {}, 'Deck', h('br'), 'complete'),
      h('p', { class: 'ov-sub' }, `All ${total} ${STACKS[stack].toLowerCase()} known.`),
      h('button', { class: 'btn', 'data-test': 'ov-close', onclick: () => ov.remove() }, 'Continue', icon('arrow')));
    $view.append(ov);
  }
  show();
}

// ---------------- progress: known words over time, streaks, runs, backup
function download(name, text, type) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = h('a', { href: url, download: name }); document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function chart(timeline) {
  const W = 300, H = 120, n = timeline.length, max = Math.max(10, ...timeline.map(d => d.known)), bw = W / n;
  const bars = timeline.map((d, k) => `<rect x="${(k * bw + 1).toFixed(1)}" y="${(H - H * d.known / max).toFixed(1)}" width="${(bw - 2).toFixed(1)}" height="${(H * d.known / max).toFixed(1)}"${k === n - 1 ? ' class="now"' : ''}/>`).join('');
  const box = h('figure', { class: 'chart', 'data-test': 'chart' });
  const first = timeline[0].known, last = timeline[n - 1].known;
  box.innerHTML = `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img" aria-label="Known words over the last ${n} days: ${first} to ${last}">${bars}</svg>`;
  box.append(h('figcaption', {}, h('span', {}, `${n} days ago`), h('span', {}, `max ${max}`), h('span', {}, 'today')));
  return box;
}
const fmtDay = ts => new Date(ts).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
async function progressScreen(my) {
  setTitle('Progress', '#/');
  const [idx, words, evs] = [await getIndex(), await allWords(), await allEvents()];
  if (stale(my)) return;
  const pr = progress(evs, 30), total = idx.packs.reduce((a, p) => a + p.count, 0), kAll = words.filter(w => wordState(w) === 'known').length;
  const rows = idx.packs.map(p => {
    const ws = words.filter(w => w.pack === packKey(p)), k = ws.filter(w => wordState(w) === 'known').length, u = ws.length - k;
    return h('a', { class: `prow lang-${p.lang}`, href: `#/deck/${packKey(p)}` }, h('span', { class: 'code' }, LANGS[p.lang].code),
      h('span', { class: 'nm' }, STACKS[p.stack]), meter({ known: k, unknown: u, new: p.count - ws.length }, p.count), h('b', {}, `${pct(k, p.count)}%`));
  });
  const runs = pr.runs.slice(0, 12).map(r => h('li', { class: `lang-${r.lang}` }, h('span', { class: 'code' }, LANGS[r.lang] ? LANGS[r.lang].code : r.lang),
    h('span', { class: 'rd' }, `${fmtDay(r.start)} · ${STACKS[r.stack] || r.stack}`), h('span', { class: 'rs' }, `${r.knew}/${r.n}`),
    h('b', { class: r.learned ? 'up' : '' }, `+${r.learned}`)));
  const stamp = new Date().toISOString().slice(0, 10);
  const file = h('input', { type: 'file', accept: 'application/json,.json', hidden: true, 'data-test': 'import-file', onchange: async () => {
    const f = file.files[0]; file.value = ''; if (!f) return;
    try {
      const data = JSON.parse(await f.text());
      const n = (data.events || []).length;
      if (!confirm(`Replace all progress on this device with this backup (${n} reviews)?`)) return;
      await importBackup(data); toast(`Imported ${n} reviews`); render();
    } catch (e) { toast(e.message.includes('backup') ? e.message : 'Could not read that file'); }
  } });
  $view.append(
    h('section', { class: 'hero-num' }, h('b', { 'data-test': 'total-known' }, String(kAll)), h('span', {}, `of ${total} words known`),
      meter({ known: kAll, unknown: words.length - kAll, new: total - words.length }, total, 'lg')),
    h('div', { class: 'stats' }, stat(pr.streak, 'day streak', 'streak'), stat(pr.best, 'best streak', 'best'),
      stat(pr.accuracy7 == null ? '—' : `${Math.round(100 * pr.accuracy7)}%`, 'knew, 7 days', 'acc7')),
    h('h3', { class: 'label' }, 'Known words · 30 days'), chart(pr.timeline),
    h('h3', { class: 'label' }, 'Decks'), h('div', { class: 'prows' }, rows),
    h('h3', { class: 'label' }, `Runs · ${pr.runs.length}`),
    runs.length ? h('ol', { class: 'runs', 'data-test': 'runs' }, runs) : h('p', { class: 'empty' }, 'No runs yet.'),
    h('h3', { class: 'label' }, 'Backup'),
    h('p', { class: 'note' }, `${pr.total} reviews stored on this device. Export a backup now and then; import restores it on any device.`),
    h('div', { class: 'actions row' },
      h('button', { class: 'btn', 'data-test': 'export-json', onclick: async () => download(`langcards-${stamp}.json`, JSON.stringify({ app: 'langapp', version: APP_VERSION, exportedAt: new Date().toISOString(), events: await allEvents(), words: await allWords() }, null, 1), 'application/json') }, icon('download'), 'Export'),
      h('button', { class: 'btn', 'data-test': 'import-json', onclick: () => file.click() }, icon('upload'), 'Import'), file),
    h('div', { class: 'actions row' },
      h('button', { class: 'btn', onclick: () => checkForUpdate(true) }, icon('refresh'), 'Updates'),
      h('button', { class: 'btn danger', onclick: async () => { if (confirm('Delete all review history on this device?')) { await clearAll(); render(); } } }, icon('trash'), 'Reset')),
    h('p', { class: 'hint' }, `v${APP_VERSION}`));
}

async function about(my) {
  setTitle('About & credits', '#/');
  const credits = await (await fetch('data/credits.json')).json();
  const idx = await getIndex();
  if (stale(my)) return;
  $view.append(h('div', { class: 'panel credits' }, h('h2', {}, 'About'),
      h('p', {}, 'Every word, definition, translation and example sentence in this app comes from the open datasets below. Nothing was written by hand. Cards were picked automatically from the CEFR A1 lists; translations are limited to direct or multi-source links. Example sentences are chosen automatically from Tatoeba (short, simple sentences with Spanish/English translations); Wiktionary examples are used only where Tatoeba has none. The Tatoeba ID and author of every example sentence are listed below.'),
      h('p', {}, `Packs: ${idx.packs.map(p => `${p.file} (${p.count})`).join(', ')}.`),
      h('p', {}, 'For personal, non-commercial use. Share-alike licences apply to the data.')),
    ...credits.map(c => h('div', { class: 'panel credits' }, h('h2', {}, c.name),
      h('p', {}, c.required_notice), c.citation ? h('p', {}, c.citation) : null,
      h('p', {}, 'Licence: ', c.license_url ? h('a', { href: c.license_url, target: '_blank', rel: 'noopener' }, c.license) : c.license,
        c.url ? [' · ', h('a', { href: c.url, target: '_blank', rel: 'noopener' }, 'source')] : null),
      c.source_id === 'tatoeba' ? sentenceCredits(idx) : null)));
}
function sentenceCredits(idx) {
  // CC BY 2.0 FR attribution for every Tatoeba sentence used on the cards (built when opened)
  return idx.packs.map(p => {
    const d = h('details', { 'data-test': `credits-${p.file}` }, h('summary', {}, `Sentences in ${LANGS[p.lang].name} ${p.level} ${STACKS[p.stack].toLowerCase()}`));
    d.addEventListener('toggle', async () => {
      if (!d.open || d.dataset.done) return; d.dataset.done = '1';
      const rows = [];
      for (const it of (await getPack(p.file)).items) for (const x of it.x || []) {
        const link = id => h('a', { href: `https://tatoeba.org/sentences/show/${id}`, target: '_blank', rel: 'noopener' }, `#${id}`);
        rows.push(h('li', {}, link(x.id), x.by ? ` ${x.by}` : '', x.es ? [' · es ', link(x.es[1])] : null, x.en ? [' · en ', link(x.en[1])] : null));
      }
      d.append(h('ul', { class: 'sent-credits' }, rows));
    });
    return d;
  });
}

// ---------------- toast + service worker auto-update
const $toast = document.getElementById('toast');
function toast(msg, action, ms = 5000) {
  $toast.replaceChildren(...[h('span', {}, msg), action && h('button', { onclick: action.fn }, action.label)].filter(Boolean));
  $toast.hidden = false; clearTimeout(toast.t);
  if (ms) toast.t = setTimeout(() => { $toast.hidden = true; }, ms);
}
let swReg = null;
async function checkForUpdate(manual) {
  if (!swReg) return manual && toast('Offline support not available');
  try { await swReg.update(); if (manual) toast(swReg.installing || swReg.waiting ? 'Downloading update…' : `Up to date (v${APP_VERSION})`); }
  catch { if (manual) toast('Could not check for updates (offline?)'); }
}
if ('serviceWorker' in navigator) {
  const hadController = !!navigator.serviceWorker.controller;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!hadController) return;                       // first install, nothing to announce
    sessionStorage.setItem('updatedFrom', APP_VERSION);
    if (!/^#\/deck\/[^/]+\/\w+$/.test(location.hash)) location.reload();   // not mid-run: reload now
    else toast('A new version is ready', { label: 'Reload', fn: () => location.reload() }, 0);
  });
  window.addEventListener('load', async () => {
    try {
      swReg = await navigator.serviceWorker.register('./sw.js', { scope: './', updateViaCache: 'none' });
      checkForUpdate();
      setInterval(checkForUpdate, 30 * 60 * 1000);
      document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') checkForUpdate(); });
    } catch (e) { console.warn('SW registration failed', e); }
  });
}
const from = sessionStorage.getItem('updatedFrom');
if (from && from !== APP_VERSION) toast(`Updated to v${APP_VERSION}`);
sessionStorage.removeItem('updatedFrom');
render();
