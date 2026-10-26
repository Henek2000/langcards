import { recordReview, undoReview, wordStats, allWords, allEvents, countEvents, clearAll } from './db.js';
import { order } from './deck.js';
import { APP_VERSION } from './version.js';
import { getShortcuts, isPinned, togglePin, removeShortcut, deckKey } from './shortcuts.js';
import { icon } from './icons.js';

const LANGS = { fr: { name: 'French', native: 'Français', glyph: 'Fr' }, ru: { name: 'Russian', native: 'Русский', glyph: 'Ру' } };
const LEVELS = ['A1', 'A2', 'B1', 'B2', 'C1', 'C2'];
const LEVEL_NAMES = { A1: 'Beginner', A2: 'Elementary', B1: 'Intermediate', B2: 'Upper intermediate', C1: 'Advanced', C2: 'Proficient' };
const AVAILABLE = { A1: true };
const STACKS = { noun: { name: 'Nouns', ico: 'noun' }, verb: { name: 'Verbs', ico: 'verb' } };
const GENDER = { fr: { m: 'masculine', f: 'feminine', mf: 'masc./fem.' }, ru: { m: 'masculine', f: 'feminine', n: 'neuter', mf: 'common' } };
const ASPECT = { impf: 'imperfective', pf: 'perfective', 'impf/pf': 'impf. & pf.' };
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
function setTitle(t, back) { $title.textContent = t; $back.hidden = !back; $back.onclick = () => { location.hash = back; }; $undo.hidden = true; $undo.onclick = null; }
$back.replaceChildren(icon('back')); $undo.replaceChildren(icon('undo'), h('span', { class: 'lbl' }, 'Undo'));

// ---------------- theme (dark default; light or follow the system), kept in localStorage
const THEME_KEY = 'langapp.theme.v1', THEME_COLORS = { dark: '#0b0d12', light: '#f2eee6' };
const getTheme = () => { const t = localStorage.getItem(THEME_KEY); return t === 'light' || t === 'system' ? t : 'dark'; };
function applyTheme() {
  const t = getTheme(), eff = t === 'system' ? (matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark') : t;
  document.documentElement.dataset.theme = eff;
  document.querySelector('meta[name=theme-color]').setAttribute('content', THEME_COLORS[eff]);
}
matchMedia('(prefers-color-scheme: light)').addEventListener('change', applyTheme);
applyTheme();

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
let cleanup = null, prevHash = null, curHash = null, gen = 0;
// every render bumps gen; an async screen checks stale(g) after each await and stops if the user has moved on,
// so a screen still loading never draws into (or adds key handlers to) the next one
const stale = g => g !== gen;
async function render() {
  gen++;
  if (cleanup) { cleanup(); cleanup = null; }
  const hash = location.hash || '#/';
  if (hash !== curHash) { prevHash = curHash; curHash = hash; }
  const lang = (hash.match(/^#\/fc\/(fr|ru)/) || [])[1];
  document.body.className = [lang ? `lang-${lang}` : '', routes[0][0].test(hash) ? 'route-home' : ''].filter(Boolean).join(' ');
  for (const [re, fn] of routes) {
    const m = hash.match(re);
    if (m) { $view.replaceChildren(); $view.classList.remove('enter'); void $view.offsetWidth; $view.classList.add('enter'); await fn(...m.slice(1)); return; }
  }
  location.hash = '#/';
}
window.addEventListener('hashchange', render);

// ---------------- home shortcuts (pinned decks); long-press a tile to edit, × removes
function shortcutTile(sc, editing, rerender) {
  const d = deckInfo(sc);
  if (!d) return null;
  let timer = null, long = false;
  const tile = h('a', { class: `tile lang-${sc.lang}`, href: editing ? null : d.route, 'data-test': `shortcut-${deckKey(sc)}`, title: d.label },
    h('span', { class: 'tile-top' }, icon(d.flag, 'ico flagdot'), icon(d.ico, 'i topic')), h('span', { class: 'lbl' }, d.line1, h('b', {}, d.line2)),
    editing ? h('button', { class: 'rm', 'aria-label': `Remove ${d.label}`, 'data-test': `rm-${deckKey(sc)}`,
      onclick: e => { e.preventDefault(); e.stopPropagation(); removeShortcut(sc); rerender(getShortcuts().length > 0); } }, icon('x')) : null);
  tile.addEventListener('pointerdown', () => { long = false; clearTimeout(timer); timer = setTimeout(() => { long = true; rerender(true); }, 550); });
  for (const ev of ['pointerup', 'pointercancel', 'pointerleave']) tile.addEventListener(ev, () => clearTimeout(timer));
  tile.addEventListener('click', e => { if (long || editing) e.preventDefault(); });
  tile.addEventListener('contextmenu', e => e.preventDefault());
  return tile;
}
function shortcutsEl() {
  const box = h('div', { class: 'shortcuts', 'data-test': 'shortcuts' });
  const draw = editing => {
    const tiles = getShortcuts().map(sc => shortcutTile(sc, editing, draw)).filter(Boolean);
    box.classList.toggle('editing', editing);
    box.replaceChildren(...tiles,
      editing ? h('button', { class: 'tile add done', 'aria-label': 'Done editing', 'data-test': 'shortcuts-done', onclick: () => draw(false) }, icon('check'))
        : h('a', { class: 'tile add', href: '#/fc', 'aria-label': 'Add shortcut', 'data-test': 'shortcut-add' }, icon('plus')),
      ...(!tiles.length && !editing ? [h('p', { class: 'sc-empty' }, 'Pin a deck with ', icon('star'), ' to start it here in one tap.')] : []));
  };
  draw(false);
  return box;
}
const logo = () => { const s = h('span'); s.innerHTML = '<img class="logo" src="icons/lc-mark.svg" alt="" width="52" height="52">'; return s.firstChild; };
function menu() {
  setTitle('Flashcards', null);
  const item = (cls, href, ico, title, sub, extra, test) => h(href ? 'a' : 'button', { class: `item ${cls}`, href, disabled: !href, 'data-test': test },
    h('span', { class: 'ico' }, icon(ico)), h('span', { class: 'grow' }, title, h('span', { class: 'sub' }, sub)), extra || icon('chev', 'i chev'));
  $view.append(
    h('header', { class: 'hero' }, logo(), h('div', {}, h('h2', {}, 'Flashcards'), h('p', {}, 'French & Russian · Spanish + English'))),
    h('h3', { class: 'section-label' }, 'Pinned decks'), shortcutsEl(),
    h('h3', { class: 'section-label' }, 'Practice'),
    h('div', { class: 'list' },
      item('feature', '#/fc', 'cards', 'Flashcards', 'Swipe through A1 nouns and verbs', null, 'menu-flashcards'),
      item('', null, 'listen', 'Listening', 'Future feature', h('span', { class: 'badge' }, 'coming soon')),
      item('', null, 'write', 'Writing practice', 'Future feature', h('span', { class: 'badge' }, 'coming soon')),
      item('', '#/stats', 'stats', 'Stats & settings', 'Progress, appearance, export, updates', null, 'menu-stats'),
      item('', '#/about', 'info', 'About & credits', 'Data sources and licences', null, 'menu-about')),
    h('p', { class: 'hint' }, `Version ${APP_VERSION}`));
}
function chooseLang() {
  setTitle('Choose a language', '#/');
  $view.append(h('div', { class: 'langs' }, Object.entries(LANGS).map(([k, l]) =>
    h('a', { class: `lang-card lang-${k}`, href: `#/fc/${k}`, 'data-test': `lang-${k}`, 'data-glyph': l.glyph },
      icon(k, 'flag'), h('span', { class: 'grow' }, h('span', { class: 'name' }, l.name), h('span', { class: 'native', lang: k }, l.native)), icon('chev', 'i chev')))));
}
async function chooseLevel(lang) {
  const g = gen;
  setTitle(`${LANGS[lang].name} · level`, '#/fc');
  const idx = await getIndex();
  if (stale(g)) return;
  $view.append(h('div', { class: 'levels' }, LEVELS.map(lv => {
    const n = idx.packs.filter(p => p.lang === lang && p.level === lv).reduce((a, p) => a + p.count, 0);
    return AVAILABLE[lv] && n
      ? h('a', { class: 'level', href: `#/fc/${lang}/${lv}`, 'data-test': `level-${lv}`, 'aria-label': `Level ${lv}, ${n} words` },
        h('span', { class: 'lv' }, lv), h('span', { class: 'nm' }, LEVEL_NAMES[lv]), h('span', { class: 'sub' }, `${n} words`))
      : h('button', { class: 'level', disabled: true, 'aria-label': `Level ${lv}, coming soon` },
        h('span', { class: 'lv' }, lv), h('span', { class: 'nm' }, LEVEL_NAMES[lv]), h('span', { class: 'badge' }, 'soon'));
  })));
}
async function chooseStack(lang, lv) {
  const g = gen;
  setTitle(`${LANGS[lang].name} ${lv}`, `#/fc/${lang}`);
  const idx = await getIndex();
  const list = h('div', { class: 'decks' });
  for (const [k, s] of Object.entries(STACKS)) {
    const p = idx.packs.find(p => p.lang === lang && p.level === lv && p.stack === k);
    if (!p) continue;
    const ws = await wordStats(`${lang}-${lv}-${k}`);
    if (stale(g)) return;
    const known = ws.filter(w => w.lastResult === 'knew').length, pct = Math.round(100 * known / p.count);
    const sc = { kind: 'stack', lang, level: lv, stack: k };
    const pin = h('button', { class: 'pin', 'aria-label': `Pin ${s.name} to home`, 'aria-pressed': String(isPinned(sc)), 'data-test': `pin-${k}`,
      onclick: e => { e.preventDefault(); e.stopPropagation(); pin.setAttribute('aria-pressed', String(togglePin(sc))); } }, icon('star'));
    list.append(h('a', { class: `deck lang-${lang}`, href: `#/fc/${lang}/${lv}/${k}`, 'data-test': `stack-${k}` },
      h('span', { class: 'deck-top' }, h('span', { class: 'ico' }, icon(s.ico)), h('span', { class: 'lvl', 'aria-label': `Level ${lv}` }, lv), pin),
      h('span', { class: 'deck-name' }, s.name),
      h('span', { class: 'sub' }, `${p.count} cards · ${ws.length} seen · ${known} known`),
      h('span', { class: 'deck-foot' }, h('span', { class: 'meter', role: 'presentation' }, h('i', { style: `width:${(100 * known / p.count).toFixed(1)}%` })),
        h('span', { class: 'pct' }, `${pct}%`)),
      icon('chev', 'i chev')));
  }
  $view.append(h('div', { class: `deck-hero lang-${lang}` }, icon(lang, 'flag'), h('span', { class: 'grow' }, h('span', { class: 'name', lang }, LANGS[lang].native),
    h('span', { class: 'meta' }, `${lv} · ${LEVEL_NAMES[lv]}`))), list, h('p', { class: 'pin-hint' }, 'Tap ', icon('star'), ' to pin a deck to the home screen.'));
}

// deck descriptors: {kind:'stack', lang, level, stack}; future: {kind:'topic', lang, topic}
function deckInfo(sc) {
  if (sc.kind === 'stack' && LANGS[sc.lang] && STACKS[sc.stack])
    return { route: `#/fc/${sc.lang}/${sc.level}/${sc.stack}`, flag: sc.lang, line1: `${LANGS[sc.lang].name} ${sc.level}`, line2: STACKS[sc.stack].name, ico: STACKS[sc.stack].ico,
      label: `${LANGS[sc.lang].name} ${sc.level} ${STACKS[sc.stack].name.toLowerCase()}` };
  return null;   // unknown kinds (e.g. from a newer version) are kept in storage but not shown
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
    h('div', { class: 'stamp yes' }, icon('check'), 'KNEW'), h('div', { class: 'stamp no' }, icon('again'), 'AGAIN'),
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

// ---------------- session (swipe right = knew, left = didn't, tap = flip; ↶ undo in the top bar)
async function session(lang, lv, stack) {
  const g = gen;
  const meta = (await getIndex()).packs.find(p => p.lang === lang && p.level === lv && p.stack === stack);
  setTitle(`${LANGS[lang].name} ${lv} · ${STACKS[stack].name}`, prevHash === '#/' ? '#/' : `#/fc/${lang}/${lv}`);
  const pack = await getPack(meta.file);
  const stats = Object.fromEntries((await wordStats(`${lang}-${lv}-${stack}`)).map(s => [s.id, s]));
  if (stale(g)) return;
  const deck = order(pack.items, stats);
  const sessionId = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
  let i = 0, knew = 0, didnt = 0, busy = false, finished = false;
  const history = [];   // [{i, result, eid: Promise<number>}]
  const $prog = h('div', { class: 'progress' }), $bar = h('i'), stage = h('div', { class: 'stage', 'data-test': 'stage' });
  try { await Promise.all(['Aa', 'Яя', 'Āā'].map(t => document.fonts.load('600 40px Unbounded', t))); } catch { /* fonts are optional */ }
  if (stale(g)) return;
  const $sess = h('div', { class: 'session' }, $prog, h('div', { class: 'bar' }, $bar), stage);
  $view.append($sess);
  $undo.hidden = false; $undo.onclick = () => undo();
  let cur = null, nxt = null, flipped = false, shownAt = 0;
  const syncUndo = () => { $undo.disabled = !history.length || busy; };
  function updateProg() {
    $prog.replaceChildren(h('span', { class: 'count' }, `${Math.min(i + 1, deck.length)} `, h('small', {}, `/ ${deck.length}`)),
      h('span', { class: 'tally', 'data-test': 'tally' }, h('b', { class: 'k' }, `✓ ${knew}`), ' ', h('b', { class: 'd' }, `✗ ${didnt}`)));
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
      el.style.transition = 'none'; el.style.transform = REDUCED.matches ? 'none' : `translate(${enterFrom * (window.innerWidth + 200)}px, 40px) rotate(${enterFrom * 28}deg)`; el.style.opacity = '0';
      requestAnimationFrame(() => requestAnimationFrame(() => { el.style.transition = 'transform .3s ease-out, opacity .3s'; el.style.transform = ''; el.style.opacity = ''; }));
    }
    flipped = false; shownAt = performance.now(); attachDrag(cur);
  }
  function flip() { flipped = true; cur.classList.toggle('flipped'); }
  async function decide(result, fromDrag = 0) {
    if (busy || !cur || finished) return; busy = true; syncUndo();
    const it = deck[i], el = cur, dir = result === 'knew' ? 1 : -1;
    el.style.transition = REDUCED.matches ? 'opacity .2s' : 'transform .34s cubic-bezier(.4,0,.8,.6), opacity .34s';
    if (!REDUCED.matches) el.style.transform = `translate(${dir * (window.innerWidth + 200)}px, ${fromDrag || 40}px) rotate(${dir * 28}deg)`;
    el.querySelector(`.wash.${dir > 0 ? 'yes' : 'no'}`).style.opacity = 1;
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
    const yes = el.querySelector('.stamp.yes'), no = el.querySelector('.stamp.no'), wy = el.querySelector('.wash.yes'), wn = el.querySelector('.wash.no');
    el.addEventListener('pointerdown', e => { if (busy) return; down = true; moved = false; target = e.target; sx = e.clientX; sy = e.clientY; dx = dy = 0; t0 = performance.now(); el.setPointerCapture(e.pointerId); el.style.transition = 'none'; el.classList.add('dragging'); });
    el.addEventListener('pointermove', e => {
      if (!down) return; dx = e.clientX - sx; dy = e.clientY - sy;
      if (Math.abs(dx) > 6 || Math.abs(dy) > 6) moved = true;
      if (!moved) return;
      el.style.transform = REDUCED.matches ? `translate(${dx}px, 0)` : `translate(${dx}px, ${dy * 0.3}px) rotate(${dx / 18}deg)`;
      const py = Math.max(0, Math.min(1, dx / 100)), pn = Math.max(0, Math.min(1, -dx / 100));
      yes.style.opacity = py; no.style.opacity = pn; wy.style.opacity = py * 0.9; wn.style.opacity = pn * 0.9;
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
      el.style.transition = REDUCED.matches ? 'none' : 'transform .38s cubic-bezier(.2,.9,.3,1.3)'; el.style.transform = ''; yes.style.opacity = no.style.opacity = wy.style.opacity = wn.style.opacity = 0;
      if (nxt) nxt.style.transform = '';
    };
    el.addEventListener('pointerup', end); el.addEventListener('pointercancel', end);
  }
  const onKey = e => {   // desktop shortcuts: → knew, ← didn't, space/enter flip, Backspace/Ctrl+Z undo
    if (e.key === 'ArrowRight') decide('knew'); else if (e.key === 'ArrowLeft') decide('didnt');
    else if ((e.key === ' ' || e.key === 'Enter') && !finished) { e.preventDefault(); cur && flip(); }
    else if (e.key === 'Backspace' || (e.key === 'z' && (e.ctrlKey || e.metaKey))) { e.preventDefault(); undo(); }
  };
  const onResize = () => { fitWord(cur); fitWord(nxt); };
  document.addEventListener('keydown', onKey); window.addEventListener('resize', onResize); document.fonts.addEventListener('loadingdone', onResize);
  cleanup = () => { document.removeEventListener('keydown', onKey); window.removeEventListener('resize', onResize); document.fonts.removeEventListener('loadingdone', onResize); };
  function finish() {
    finished = true; cur = nxt = null;   // the summary keeps ↶ (and Backspace) so the last card can still be undone
    const total = knew + didnt;
    syncUndo();
    const pct = total ? knew / total : 0, C = 2 * Math.PI * 52;
    const ring = h('div', { class: 'ring' }); ring.innerHTML = `<svg viewBox="0 0 120 120" aria-hidden="true"><circle class="track" cx="60" cy="60" r="52" fill="none" stroke-width="10"/><circle class="val" cx="60" cy="60" r="52" fill="none" stroke-width="10" stroke-dasharray="${C}" stroke-dashoffset="${C}"/></svg>`;
    ring.append(h('div', { class: 'big' }, total ? `${Math.round(100 * pct)}%` : '—'));
    $view.replaceChildren(h('div', { class: 'summary', 'data-test': 'summary' }, ring,
      h('h2', {}, 'Deck complete'),
      h('p', { class: 'sub' }, `${total} cards reviewed`),
      h('span', { class: 'tally' }, h('b', { class: 'k' }, `✓ ${knew} knew`), ' ', h('b', { class: 'd' }, `✗ ${didnt} again`)),
      h('div', { class: 'btns' },
        h('button', { class: 'btn primary', onclick: render }, icon('again'), 'Practice again'),
        h('a', { class: 'btn ghost', href: `#/fc/${lang}/${lv}` }, 'Back to stacks'))));
    requestAnimationFrame(() => requestAnimationFrame(() => { const v = ring.querySelector('.val'); if (v) v.style.strokeDashoffset = String(C * (1 - pct)); }));
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
  const g = gen;
  setTitle('Stats & settings', '#/');
  const [words, nEv, idx] = [await allWords(), await countEvents(), await getIndex()];
  if (stale(g)) return;
  const tbl = h('table', {}, h('tr', {}, h('th', {}, 'Stack'), h('th', {}, 'Cards'), h('th', {}, 'Seen'), h('th', {}, 'Known'), h('th', {}, 'Accuracy')));
  for (const p of idx.packs) {
    const ws = words.filter(w => w.pack === `${p.lang}-${p.level}-${p.stack}`);
    const r = ws.reduce((a, w) => a + w.right, 0), s = ws.reduce((a, w) => a + w.shown, 0);
    tbl.append(h('tr', {}, h('td', {}, `${LANGS[p.lang].name} ${p.level} ${STACKS[p.stack].name}`), h('td', {}, p.count), h('td', {}, ws.length),
      h('td', {}, ws.filter(w => w.lastResult === 'knew').length), h('td', {}, s ? `${Math.round(100 * r / s)}%` : '—')));
  }
  const stamp = new Date().toISOString().slice(0, 10);
  const seg = h('div', { class: 'seg', role: 'group', 'aria-label': 'Theme' });
  const drawSeg = () => seg.replaceChildren(...[['dark', 'moon', 'Dark'], ['light', 'sun', 'Light'], ['system', 'auto', 'System']].map(([k, ic, label]) =>
    h('button', { 'aria-pressed': String(getTheme() === k), 'data-test': `theme-${k}`, onclick: () => { localStorage.setItem(THEME_KEY, k); applyTheme(); drawSeg(); } }, icon(ic), label)));
  drawSeg();
  $view.append(
    h('div', { class: 'panel' }, h('h2', {}, 'Progress'), h('div', { class: 'tablewrap' }, tbl), h('p', { class: 'hint', 'data-test': 'event-count' }, `${nEv.live} review events stored on this device${nEv.undone ? ` (+${nEv.undone} undone, excluded)` : ''}`)),
    h('div', { class: 'panel' }, h('h2', {}, 'Appearance'), seg),
    h('div', { class: 'panel' }, h('h2', {}, 'Export'),
      h('div', { class: 'row' },
        h('button', { class: 'btn primary', 'data-test': 'export-json', onclick: async () => download(`flashcards-${stamp}.json`, JSON.stringify({ app: 'langapp', version: APP_VERSION, exportedAt: new Date().toISOString(), events: await allEvents(), words: await allWords() }, null, 1), 'application/json') }, icon('download'), 'Export JSON'),
        h('button', { class: 'btn ghost', 'data-test': 'export-csv', onclick: async () => download(`flashcards-events-${stamp}.csv`, toCSV(await allEvents(), ['eid', 'ts', 'wordId', 'word', 'lang', 'level', 'stack', 'result', 'flipped', 'ms', 'sessionId', 'appVersion', 'undone', 'undoneAt']), 'text/csv') }, 'Events CSV'),
        h('button', { class: 'btn ghost', 'data-test': 'export-words-csv', onclick: async () => download(`flashcards-words-${stamp}.csv`, toCSV(await allWords(), ['id', 'lang', 'level', 'stack', 'shown', 'right', 'left', 'flips', 'firstSeen', 'lastSeen', 'lastResult']), 'text/csv') }, 'Words CSV'))),
    h('div', { class: 'panel' }, h('h2', {}, 'App'),
      h('div', { class: 'row' },
        h('button', { class: 'btn ghost', onclick: () => checkForUpdate(true) }, icon('refresh'), 'Check for updates'),
        h('button', { class: 'btn no', onclick: async () => { if (confirm('Delete all review history on this device?')) { await clearAll(); render(); } } }, icon('trash'), 'Reset stats')),
      h('p', { class: 'hint' }, `Version ${APP_VERSION}`)));
}
async function about() {
  const g = gen;
  setTitle('About & credits', '#/');
  const credits = await (await fetch('data/credits.json')).json();
  const idx = await getIndex();
  if (stale(g)) return;
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
    const d = h('details', { 'data-test': `credits-${p.file}` }, h('summary', {}, `Sentences in ${LANGS[p.lang].name} ${p.level} ${STACKS[p.stack].name.toLowerCase()}`));
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
