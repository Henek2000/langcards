// Word states and practice runs.
// A word is 'new' (never answered), 'unknown' (last answer was "again") or 'known' (last answer was "knew").
export const RUN_SIZE = 20;
export const wordState = s => (!s || !s.shown ? 'new' : s.lastResult === 'knew' ? 'known' : 'unknown');

export function split(items, statsById) {
  const by = { new: [], unknown: [], known: [] };
  for (const it of items) by[wordState(statsById[it.id])].push(it);
  return by;
}
const shuffle = a => { a = a.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
const stalest = (list, statsById) => list.slice().sort((a, b) => (statsById[a.id].lastSeen < statsById[b.id].lastSeen ? -1 : 1));

// mode 'run': up to 12 unknown words, new words (in pack order) to fill, then more unknown, then the known words seen longest ago.
// mode 'unknown': only unknown words, the ones seen longest ago first.
export function buildRun(items, statsById, mode, size = RUN_SIZE) {
  const by = split(items, statsById);
  let pick;
  if (mode === 'unknown') pick = stalest(by.unknown, statsById).slice(0, size);
  else {
    const unk = shuffle(by.unknown), first = unk.slice(0, Math.min(12, size));
    pick = [...first, ...by.new, ...unk.slice(first.length), ...stalest(by.known, statsById)].slice(0, size);
  }
  return shuffle(pick);
}
