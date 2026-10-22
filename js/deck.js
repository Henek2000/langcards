// Ordering: weighted shuffle. Unseen and missed cards get higher weight, so they tend to come first.
export function weight(s) {
  if (!s || !s.shown) return 4;                       // never seen
  const missRate = s.left / s.shown;
  if (s.lastResult === 'didnt') return 3 + missRate;  // missed last time
  return 0.6 + 2 * missRate;                          // known: lower, but older misses still count
}
export function order(items, statsById) {
  // Efraimidis–Spirakis weighted random permutation: key = -ln(U)/w, ascending.
  return items.map(it => ({ it, k: -Math.log(1 - Math.random()) / weight(statsById[it.id]) }))
    .sort((a, b) => a.k - b.k).map(x => x.it);
}
