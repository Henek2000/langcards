// IndexedDB storage: every review event + per-word aggregates.
const DB_NAME = 'langapp', DB_VER = 1;
let dbp;
function open() {
  if (dbp) return dbp;
  dbp = new Promise((res, rej) => {
    const r = indexedDB.open(DB_NAME, DB_VER);
    r.onupgradeneeded = () => {
      const db = r.result;
      if (!db.objectStoreNames.contains('events')) {
        const ev = db.createObjectStore('events', { keyPath: 'eid', autoIncrement: true });
        ev.createIndex('wordId', 'wordId'); ev.createIndex('ts', 'ts');
      }
      if (!db.objectStoreNames.contains('words')) {
        const w = db.createObjectStore('words', { keyPath: 'id' });
        w.createIndex('pack', 'pack');
      }
    };
    r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
  });
  return dbp;
}
const tx = async (stores, mode, fn) => {
  const db = await open();
  return new Promise((res, rej) => {
    const t = db.transaction(stores, mode); let out;
    // a throw inside fn aborts the whole transaction, so no half-written aggregates are committed
    Promise.resolve().then(() => fn(t)).then(v => { out = v; }, e => { try { t.abort(); } catch { /* already finished */ } rej(e); });
    t.oncomplete = () => res(out); t.onerror = () => rej(t.error); t.onabort = () => rej(t.error);
  });
};
const req = r => new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });

function aggregate(id, evs, base) {
  // per-word aggregates, always derived from the word's events that are not undone
  const live = evs.filter(e => !e.undone).sort((x, y) => (x.ts < y.ts ? -1 : x.ts > y.ts ? 1 : x.eid - y.eid));
  if (!live.length) return null;
  const f = live[0], l = live[live.length - 1];
  return { id, lang: f.lang, level: f.level, stack: f.stack, pack: `${f.lang}-${f.level}-${f.stack}`, ...(base || {}),
    shown: live.length, right: live.filter(e => e.result === 'knew').length, left: live.filter(e => e.result !== 'knew').length,
    flips: live.filter(e => e.flipped).length, firstSeen: f.ts, lastSeen: l.ts, lastResult: l.result };
}
export async function recordReview(ev) {
  // ev: {wordId, lang, level, stack, word, result:'knew'|'didnt', flipped, ts, ms, sessionId, mode, appVersion}; returns the event id
  ev = { ...ev, undone: false };
  persist();
  return tx(['events', 'words'], 'readwrite', async t => {
    const eid = await req(t.objectStore('events').add(ev));
    const ws = t.objectStore('words');
    const cur = await req(ws.get(ev.wordId)) || { id: ev.wordId, lang: ev.lang, level: ev.level, stack: ev.stack,
      pack: `${ev.lang}-${ev.level}-${ev.stack}`, shown: 0, right: 0, left: 0, flips: 0, firstSeen: ev.ts };
    cur.shown++; ev.result === 'knew' ? cur.right++ : cur.left++;
    if (ev.flipped) cur.flips++;
    cur.lastSeen = ev.ts; cur.lastResult = ev.result;
    ws.put(cur);
    return eid;
  });
}
export async function undoReview(eid) {
  // mark the event undone (kept for history/export) and rebuild that word's aggregates without it
  return tx(['events', 'words'], 'readwrite', async t => {
    const es = t.objectStore('events'), ws = t.objectStore('words');
    const ev = await req(es.get(eid));
    if (!ev || ev.undone) return false;
    ev.undone = true; ev.undoneAt = new Date().toISOString();
    es.put(ev);
    const evs = (await req(es.index('wordId').getAll(ev.wordId))).map(e => (e.eid === eid ? ev : e));
    const agg = aggregate(ev.wordId, evs);
    if (agg) ws.put(agg); else ws.delete(ev.wordId);
    return true;
  });
}
export async function wordStats(pack) {
  return tx(['words'], 'readonly', t => req(t.objectStore('words').index('pack').getAll(pack)));
}
export async function allWords() { return tx(['words'], 'readonly', t => req(t.objectStore('words').getAll())); }
export async function allEvents() { return tx(['events'], 'readonly', t => req(t.objectStore('events').getAll())); }
export async function clearAll() {
  return tx(['events', 'words'], 'readwrite', t => { t.objectStore('events').clear(); t.objectStore('words').clear(); });
}
export async function importBackup(data) {
  // replaces everything on this device with the events of a JSON export; word aggregates are rebuilt from them
  const evs = data && Array.isArray(data.events) ? data.events : null;
  if (!evs || evs.some(e => !e || typeof e.wordId !== 'string' || typeof e.ts !== 'string' || !e.lang || !e.stack))
    throw new Error('This file is not a Langcards backup');
  return tx(['events', 'words'], 'readwrite', async t => {
    const es = t.objectStore('events'), ws = t.objectStore('words');
    es.clear(); ws.clear();
    const by = {};
    for (const e of evs) { const eid = await req(es.add(e)); (by[e.wordId] ||= []).push({ ...e, eid }); }
    for (const [id, list] of Object.entries(by)) { const agg = aggregate(id, list); if (agg) ws.put(agg); }
    return evs.length;
  });
}
// ask the browser not to evict the history (Safari tabs can drop IndexedDB after ~7 days unvisited)
let persisted = false;
function persist() { if (!persisted && navigator.storage && navigator.storage.persist) { persisted = true; navigator.storage.persist().catch(() => {}); } }
