// Progress measures, all derived from the review events (undone events excluded).
const dayKey = d => { const x = new Date(d); return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`; };
const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
export const today = () => dayKey(new Date());

export function progress(events, days = 30) {
  const live = events.filter(e => !e.undone).sort((a, b) => (a.ts < b.ts ? -1 : a.ts > b.ts ? 1 : a.eid - b.eid));
  const last = {};                       // wordId -> last result so far
  let known = 0;
  const knownByDay = {}, reviewsByDay = {}, runs = new Map();
  for (const e of live) {
    const was = last[e.wordId], k = dayKey(e.ts);
    if (was === 'knew') known--;
    if (e.result === 'knew') known++;
    last[e.wordId] = e.result;
    knownByDay[k] = known; reviewsByDay[k] = (reviewsByDay[k] || 0) + 1;
    const sid = e.sessionId || `day-${k}-${e.lang}-${e.stack}`;
    let r = runs.get(sid);
    if (!r) runs.set(sid, r = { id: sid, lang: e.lang, level: e.level, stack: e.stack, mode: e.mode || 'deck', start: e.ts, end: e.ts, n: 0, knew: 0, before: {}, after: {} });
    if (!(e.wordId in r.before)) r.before[e.wordId] = was;
    r.after[e.wordId] = e.result; r.end = e.ts; r.n++; if (e.result === 'knew') r.knew++;
  }
  // known words at the end of each of the last `days` days (carried forward over days without reviews)
  const timeline = []; let carry = 0;
  const firstDay = addDays(new Date(), -(days - 1)), firstKey = dayKey(firstDay);
  for (const [k, v] of Object.entries(knownByDay)) if (k < firstKey) carry = v;   // keys are in chronological order
  for (let i = 0; i < days; i++) { const k = dayKey(addDays(firstDay, i)); if (k in knownByDay) carry = knownByDay[k]; timeline.push({ day: k, known: carry, reviews: reviewsByDay[k] || 0 }); }
  // streaks: consecutive days with at least one review; the current streak survives until today ends
  const active = new Set(Object.keys(reviewsByDay));
  let streak = 0, d = new Date();
  if (!active.has(dayKey(d))) d = addDays(d, -1);
  while (active.has(dayKey(d))) { streak++; d = addDays(d, -1); }
  let best = 0, cur = 0, prev = null;
  for (const k of [...active].sort()) { cur = prev && dayKey(addDays(new Date(prev + 'T12:00'), 1)) === k ? cur + 1 : 1; best = Math.max(best, cur); prev = k; }
  const runList = [...runs.values()].map(r => {
    const ids = Object.keys(r.after);
    return { id: r.id, lang: r.lang, level: r.level, stack: r.stack, mode: r.mode, start: r.start, end: r.end, n: r.n, knew: r.knew,
      learned: ids.filter(id => r.before[id] !== 'knew' && r.after[id] === 'knew').length,
      forgot: ids.filter(id => r.before[id] === 'knew' && r.after[id] !== 'knew').length };
  }).reverse();
  return { known, timeline, streak, best, todayReviews: reviewsByDay[today()] || 0, total: live.length, runs: runList,
    accuracy7: acc(live.filter(e => e.ts >= addDays(new Date(), -7).toISOString())) };
}
const acc = evs => (evs.length ? evs.filter(e => e.result === 'knew').length / evs.length : null);
