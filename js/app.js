import { recordReview, undoReview, wordStats, allWords, allEvents, countEvents, clearAll } from './db.js';
import { order } from './deck.js';
import { APP_VERSION } from './version.js';

const LANGS = { fr: { name: 'French', native: 'Français', flag: '🇫🇷' }, ru: { name: 'Russian', native: 'Русский', flag: '🇷🇺' } };
const LEVELS = ['A1', 'A2', 'B1', 'B2', 'C1', 'C2'];
const AVAILABLE = { A1: true };
const STACKS = { noun: { name: 'Nouns', ico: '📦' }, verb: { name: 'Verbs', ico: '🏃' } };
const GENDER = { fr: { m: 'masculine', f: 'feminine', mf: 'masc./fem.' }, ru: { m: 'masculine', f: 'feminine', n: 'neuter', mf: 'common' } };
const ASPECT = { impf: 'imperfective', pf: 'perfective', 'impf/pf': 'impf. & pf.' };

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
function setTitle(t, back) { $title.textContent = t; $back.hidden = !back; $back.onclick = () => { location.hash = back; }; $undo.hidden = true; $undo.onclick = null; }

// ---------------- screens
const routes = [
  [/^#?\/?$/, menu],
  [/^#\/fc$/, chooseLang],
  [/^#\/fc\/(fr|ru)$/, chooseLevel],
  [/^#\/fc\/(fr|ru)\/(A1|A2|B1|B2|C1|C2)$/, chooseStack],
  [/^#\/fc\/(fr|ru)\/(A1)\/(noun|verb)$/, session],
  [/^#\/stats$/, statsScreen],
  [/^#\/about$/, about],
];
let cleanup = null;
async function render() {
  if (cleanup) { cleanup(); cleanup = null; }
  const hash = location.hash || '#/';
  for (const [re, fn] of routes) { const m = hash.match(re); if (m) { $view.replaceChildren(); await fn(...m.slice(1)); return; } }
  location.hash = '#/';
}
window.addEventListener('hashchange', render);

function menu() {
  setTitle('Flashcards', null);
  $view.append(h('div', { class: 'list' },
    h('a', { class: 'item', href: '#/fc', 'data-test': 'menu-flashcards' }, h('span', { class: 'ico' }, '🃏'),
      h('span', { class: 'grow' }, 'Flashcards', h('span', { class: 'sub' }, 'French & Russian vocabulary, Spanish + English'))),
    h('button', { class: 'item', disabled: true }, h('span', { class: 'ico' }, '🎧'), h('span', { class: 'grow' }, 'Listening', h('span', { class: 'sub' }, 'Future feature')), h('span', { class: 'badge' }, 'coming soon')),
    h('button', { class: 'item', disabled: true }, h('span', { class: 'ico' }, '✍️'), h('span', { class: 'grow' }, 'Writing practice', h('span', { class: 'sub' }, 'Future feature')), h('span', { class: 'badge' }, 'coming soon')),
    h('a', { class: 'item', href: '#/stats', 'data-test': 'menu-stats' }, h('span', { class: 'ico' }, '📊'), h('span', { class: 'grow' }, 'Stats & settings', h('span', { class: 'sub' }, 'Progress, export, updates'))),
    h('a', { class: 'item', href: '#/about', 'data-test': 'menu-about' }, h('span', { class: 'ico' }, 'ℹ️'), h('span', { class: 'grow' }, 'About & credits', h('span', { class: 'sub' }, 'Data sources and licences')))),
    h('p', { class: 'hint' }, `Version ${APP_VERSION}`));
}
function chooseLang() {
  setTitle('Choose a language', '#/');
  $view.append(h('div', { class: 'list' }, Object.entries(LANGS).map(([k, l]) =>
    h('a', { class: 'item', href: `#/fc/${k}`, 'data-test': `lang-${k}` }, h('span', { class: 'ico' }, l.flag), h('span', { class: 'grow' }, l.name, h('span', { class: 'sub' }, l.native))))));
}
async function chooseLevel(lang) {
  setTitle(`${LANGS[lang].name} · level`, '#/fc');
  const idx = await getIndex();
  $view.append(h('div', { class: 'list' }, LEVELS.map(lv => {
    const n = idx.packs.filter(p => p.lang === lang && p.level === lv).reduce((a, p) => a + p.count, 0);
    return AVAILABLE[lv] && n
      ? h('a', { class: 'item', href: `#/fc/${lang}/${lv}`, 'data-test': `level-${lv}` }, h('span', { class: 'ico' }, lv), h('span', { class: 'grow' }, `Level ${lv}`, h('span', { class: 'sub' }, `${n} words`)))
      : h('button', { class: 'item', disabled: true }, h('span', { class: 'ico' }, lv), h('span', { class: 'grow' }, `Level ${lv}`), h('span', { class: 'badge' }, 'coming soon'));
  })));
}
async function chooseStack(lang, lv) {
  setTitle(`${LANGS[lang].name} ${lv}`, `#/fc/${lang}`);
  const idx = await getIndex();
  const list = h('div', { class: 'list' });
  for (const [k, s] of Object.entries(STACKS)) {
    const p = idx.packs.find(p => p.lang === lang && p.level === lv && p.stack === k);
    if (!p) continue;
    const ws = await wordStats(`${lang}-${lv}-${k}`);
    const known = ws.filter(w => w.lastResult === 'knew').length;
    list.append(h('a', { class: 'item', href: `#/fc/${lang}/${lv}/${k}`, 'data-test': `stack-${k}` }, h('span', { class: 'ico' }, s.ico),
      h('span', { class: 'grow' }, s.name, h('span', { class: 'sub' }, `${p.count} cards · ${ws.length} seen · ${known} known`))));
  }
  $view.append(list);
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
      it.ex[1] ? h('span', { class: 't', lang: 'en' }, it.ex[1]) : null, h('span', { class: 'src' }, 'Wiktionary')) : null;
  }
  const box = h('div', { class: 'ex', 'data-test': 'example', 'data-src': 'tatoeba' });
  let k = 0;
  const draw = () => {
    const x = xs[k];
    box.dataset.idx = k;
    box.replaceChildren(h('span', { class: 's', lang }, x.t),
      x.es ? h('span', { class: 't', lang: 'es' }, x.es[0]) : null,
      x.en ? h('span', { class: 't', lang: 'en' }, x.en[0]) : null,
      h('span', { class: 'src' }, `Tatoeba #${x.id}${x.by ? ' · ' + x.by : ''} · CC BY 2.0 FR`, xs.length > 1 ? h('b', { class: 'cyc' }, ` ${k + 1}/${xs.length} ›`) : null));
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
    exampleEl(it, lang),
    h('div', { class: 'small' }, `Level: ${it.lv.join(', ')} · Wiktionary: ${it.k.split('|')[0]}`));
}
function cardEl(it, lang) {
  return h('div', { class: 'card', 'data-id': it.id }, h('div', { class: 'stamp yes' }, 'KNEW'), h('div', { class: 'stamp no' }, 'NOPE'),
    h('div', { class: 'inner' }, front(it, lang), back(it, lang)));
}

// ---------------- session (swipe right = knew, left = didn't, tap = flip; ↶ undo in the top bar)
async function session(lang, lv, stack) {
  const meta = (await getIndex()).packs.find(p => p.lang === lang && p.level === lv && p.stack === stack);
  setTitle(`${LANGS[lang].name} ${lv} · ${STACKS[stack].name}`, `#/fc/${lang}/${lv}`);
  const pack = await getPack(meta.file);
  const stats = Object.fromEntries((await wordStats(`${lang}-${lv}-${stack}`)).map(s => [s.id, s]));
  const deck = order(pack.items, stats);
  const sessionId = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
  let i = 0, knew = 0, didnt = 0, busy = false, finished = false;
  const history = [];   // [{i, result, eid: Promise<number>}]
  const $prog = h('div', { class: 'progress' }), $bar = h('i'), stage = h('div', { class: 'stage', 'data-test': 'stage' });
  const $sess = h('div', { class: 'session' }, $prog, h('div', { class: 'bar' }, $bar), stage);
  $view.append($sess);
  $undo.hidden = false; $undo.onclick = () => undo();
  let cur = null, nxt = null, flipped = false, shownAt = 0;
  const syncUndo = () => { $undo.disabled = !history.length || busy; };
  function updateProg() {
    $prog.replaceChildren(h('span', {}, `${Math.min(i + 1, deck.length)} / ${deck.length}`), h('span', { 'data-test': 'tally' }, `✓ ${knew}  ✗ ${didnt}`));
    $bar.style.width = `${100 * i / deck.length}%`;
    syncUndo();
  }
  function show(enterFrom = 0) {
    updateProg();
    if (i >= deck.length) return finish();
    if (nxt) { cur = nxt; cur.classList.remove('next'); } else { cur = cardEl(deck[i], lang); stage.append(cur); }
    nxt = deck[i + 1] ? cardEl(deck[i + 1], lang) : null;
    if (nxt) { nxt.classList.add('next'); stage.prepend(nxt); }
    if (enterFrom) {   // undo: the card flies back in from the side it left
      const el = cur;
      el.style.transition = 'none'; el.style.transform = `translate(${enterFrom * (window.innerWidth + 200)}px, 40px) rotate(${enterFrom * 28}deg)`; el.style.opacity = '0';
      requestAnimationFrame(() => requestAnimationFrame(() => { el.style.transition = 'transform .3s ease-out, opacity .3s'; el.style.transform = ''; el.style.opacity = ''; }));
    }
    flipped = false; shownAt = performance.now(); attachDrag(cur);
  }
  function flip() { flipped = true; cur.classList.toggle('flipped'); }
  async function decide(result, fromDrag = 0) {
    if (busy || !cur || finished) return; busy = true; syncUndo();
    const it = deck[i], el = cur, dir = result === 'knew' ? 1 : -1;
    el.style.transition = 'transform .32s ease-out, opacity .32s';
    el.style.transform = `translate(${dir * (window.innerWidth + 200)}px, ${fromDrag || 40}px) rotate(${dir * 28}deg)`;
    el.style.opacity = '0';
    result === 'knew' ? knew++ : didnt++;
    const eid = recordReview({ wordId: it.id, lang, level: lv, stack, word: it.w, result, flipped, ts: new Date().toISOString(),
      ms: Math.round(performance.now() - shownAt), sessionId, appVersion: APP_VERSION });
    eid.catch(e => console.error(e));
    history.push({ i, result, eid });
    i++;
    setTimeout(() => { el.remove(); busy = false; show(); }, 260);
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
    const yes = el.querySelector('.stamp.yes'), no = el.querySelector('.stamp.no');
    el.addEventListener('pointerdown', e => { if (busy) return; down = true; moved = false; target = e.target; sx = e.clientX; sy = e.clientY; dx = dy = 0; t0 = performance.now(); el.setPointerCapture(e.pointerId); el.style.transition = 'none'; el.classList.add('dragging'); });
    el.addEventListener('pointermove', e => {
      if (!down) return; dx = e.clientX - sx; dy = e.clientY - sy;
      if (Math.abs(dx) > 6 || Math.abs(dy) > 6) moved = true;
      if (!moved) return;
      el.style.transform = `translate(${dx}px, ${dy * 0.3}px) rotate(${dx / 18}deg)`;
      yes.style.opacity = Math.max(0, Math.min(1, dx / 100)); no.style.opacity = Math.max(0, Math.min(1, -dx / 100));
      if (nxt) nxt.style.transform = `scale(${0.94 + Math.min(Math.abs(dx) / 2000, 0.06)}) translateY(${14 - Math.min(Math.abs(dx) / 20, 14)}px)`;
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
      el.style.transition = 'transform .3s cubic-bezier(.2,.9,.3,1.3)'; el.style.transform = ''; yes.style.opacity = no.style.opacity = 0;
      if (nxt) nxt.style.transform = '';
    };
    el.addEventListener('pointerup', end); el.addEventListener('pointercancel', end);
  }
  const onKey = e => {   // desktop shortcuts: → knew, ← didn't, space/enter flip, Backspace/Ctrl+Z undo
    if (e.key === 'ArrowRight') decide('knew'); else if (e.key === 'ArrowLeft') decide('didnt');
    else if ((e.key === ' ' || e.key === 'Enter') && !finished) { e.preventDefault(); cur && flip(); }
    else if (e.key === 'Backspace' || (e.key === 'z' && (e.ctrlKey || e.metaKey))) { e.preventDefault(); undo(); }
  };
  document.addEventListener('keydown', onKey);
  cleanup = () => document.removeEventListener('keydown', onKey);
  function finish() {
    finished = true; cur = nxt = null;   // the summary keeps ↶ (and Backspace) so the last card can still be undone
    const total = knew + didnt;
    syncUndo();
    $view.replaceChildren(h('div', { class: 'summary', 'data-test': 'summary' },
      h('div', { class: 'big' }, total ? `${Math.round(100 * knew / total)}%` : '—'),
      h('div', {}, `${total} cards reviewed · ✓ ${knew} · ✗ ${didnt}`),
      h('button', { class: 'btn primary', onclick: render }, 'Practice again'),
      h('a', { class: 'btn ghost', href: `#/fc/${lang}/${lv}` }, 'Back to stacks')));
  }
  show();
}

// ---------------- stats / settings
function download(name, text, type) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = h('a', { href: url, download: name }); document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
const csvCell = v => { const s = v == null ? '' : String(v); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
const toCSV = (rows, cols) => [cols.join(','), ...rows.map(r => cols.map(c => csvCell(r[c])).join(','))].join('\n');
async function statsScreen() {
  setTitle('Stats & settings', '#/');
  const [words, nEv, idx] = [await allWords(), await countEvents(), await getIndex()];
  const tbl = h('table', {}, h('tr', {}, h('th', {}, 'Stack'), h('th', {}, 'Cards'), h('th', {}, 'Seen'), h('th', {}, 'Known'), h('th', {}, 'Accuracy')));
  for (const p of idx.packs) {
    const ws = words.filter(w => w.pack === `${p.lang}-${p.level}-${p.stack}`);
    const r = ws.reduce((a, w) => a + w.right, 0), s = ws.reduce((a, w) => a + w.shown, 0);
    tbl.append(h('tr', {}, h('td', {}, `${LANGS[p.lang].name} ${p.level} ${STACKS[p.stack].name}`), h('td', {}, p.count), h('td', {}, ws.length),
      h('td', {}, ws.filter(w => w.lastResult === 'knew').length), h('td', {}, s ? `${Math.round(100 * r / s)}%` : '—')));
  }
  const stamp = new Date().toISOString().slice(0, 10);
  $view.append(
    h('div', { class: 'panel' }, h('h2', {}, 'Progress'), tbl, h('p', { class: 'hint', 'data-test': 'event-count' }, `${nEv.live} review events stored on this device${nEv.undone ? ` (+${nEv.undone} undone, excluded)` : ''}`)),
    h('div', { class: 'panel' }, h('h2', {}, 'Export'),
      h('div', { class: 'row' },
        h('button', { class: 'btn primary', 'data-test': 'export-json', onclick: async () => download(`flashcards-${stamp}.json`, JSON.stringify({ app: 'langapp', version: APP_VERSION, exportedAt: new Date().toISOString(), events: await allEvents(), words: await allWords() }, null, 1), 'application/json') }, 'Export JSON'),
        h('button', { class: 'btn ghost', 'data-test': 'export-csv', onclick: async () => download(`flashcards-events-${stamp}.csv`, toCSV(await allEvents(), ['eid', 'ts', 'wordId', 'word', 'lang', 'level', 'stack', 'result', 'flipped', 'ms', 'sessionId', 'appVersion', 'undone', 'undoneAt']), 'text/csv') }, 'Events CSV'),
        h('button', { class: 'btn ghost', 'data-test': 'export-words-csv', onclick: async () => download(`flashcards-words-${stamp}.csv`, toCSV(await allWords(), ['id', 'lang', 'level', 'stack', 'shown', 'right', 'left', 'flips', 'firstSeen', 'lastSeen', 'lastResult']), 'text/csv') }, 'Words CSV'))),
    h('div', { class: 'panel' }, h('h2', {}, 'App'),
      h('p', { class: 'hint', style: 'text-align:left' }, `Version ${APP_VERSION}`),
      h('div', { class: 'row' },
        h('button', { class: 'btn ghost', onclick: () => checkForUpdate(true) }, 'Check for updates'),
        h('button', { class: 'btn no', onclick: async () => { if (confirm('Delete all review history on this device?')) { await clearAll(); render(); } } }, 'Reset stats'))));
}
async function about() {
  setTitle('About & credits', '#/');
  const credits = await (await fetch('data/credits.json')).json();
  const idx = await getIndex();
  $view.append(h('div', { class: 'panel credits' }, h('h2', {}, 'About'),
      h('p', {}, 'Every word, definition, translation and example sentence in this app comes from the open datasets below. Nothing was written by hand. Cards were picked automatically from the CEFR A1 lists; translations are limited to direct or multi-source links. Example sentences are chosen automatically from Tatoeba (short, simple sentences with Spanish/English translations, shown with their Tatoeba ID); Wiktionary examples are used only where Tatoeba has none.'),
      h('p', {}, `Packs: ${idx.packs.map(p => `${p.file} (${p.count})`).join(', ')}.`),
      h('p', {}, 'For personal, non-commercial use. Share-alike licences apply to the data.')),
    ...credits.map(c => h('div', { class: 'panel credits' }, h('h2', {}, c.name),
      h('p', {}, c.required_notice), c.citation ? h('p', {}, c.citation) : null,
      h('p', {}, 'Licence: ', c.license_url ? h('a', { href: c.license_url, target: '_blank', rel: 'noopener' }, c.license) : c.license,
        c.url ? [' · ', h('a', { href: c.url, target: '_blank', rel: 'noopener' }, 'source')] : null))));
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
    if (!location.hash.startsWith('#/fc/') || location.hash.split('/').length < 5) location.reload();   // not mid-session: reload now
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
