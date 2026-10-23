// Home-screen shortcuts (pinned decks), kept in localStorage so they survive app updates.
// A shortcut is a deck descriptor: {kind:'stack', lang, level, stack}. Other kinds (e.g. {kind:'topic', lang, topic})
// can be pinned the same way; deckKey() gives every descriptor a stable id.
const KEY = 'langapp.shortcuts.v1';
export const deckKey = sc => [sc.kind, sc.lang, sc.level, sc.stack, sc.topic].filter(Boolean).join('-');
export function getShortcuts() {
  try { const v = JSON.parse(localStorage.getItem(KEY) || '[]'); return Array.isArray(v) ? v.filter(x => x && x.kind) : []; }
  catch { return []; }
}
function save(list) { localStorage.setItem(KEY, JSON.stringify(list)); }
export const isPinned = sc => getShortcuts().some(x => deckKey(x) === deckKey(sc));
export function addShortcut(sc) { const l = getShortcuts(); if (!l.some(x => deckKey(x) === deckKey(sc))) { l.push({ ...sc, added: new Date().toISOString() }); save(l); } }
export function removeShortcut(sc) { save(getShortcuts().filter(x => deckKey(x) !== deckKey(sc))); }
export function togglePin(sc) { if (isPinned(sc)) { removeShortcut(sc); return false; } addShortcut(sc); return true; }
