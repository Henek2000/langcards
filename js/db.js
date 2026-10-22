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
    Promise.resolve(fn(t)).then(v => out = v);
    t.oncomplete = () => res(out); t.onerror = () => rej(t.error); t.onabort = () => rej(t.error);
  });
};
const req = r => new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });

export async function recordReview(ev) {
  // ev: {wordId, lang, level, stack, result:'knew'|'didnt', flipped, ts, ms, sessionId, appVersion}
  return tx(['events', 'words'], 'readwrite', async t => {
    t.objectStore('events').add(ev);
    const ws = t.objectStore('words');
    const cur = await req(ws.get(ev.wordId)) || { id: ev.wordId, lang: ev.lang, level: ev.level, stack: ev.stack,
      pack: `${ev.lang}-${ev.level}-${ev.stack}`, shown: 0, right: 0, left: 0, flips: 0, firstSeen: ev.ts };
    cur.shown++; ev.result === 'knew' ? cur.right++ : cur.left++;
    if (ev.flipped) cur.flips++;
    cur.lastSeen = ev.ts; cur.lastResult = ev.result;
    ws.put(cur);
  });
}
export async function wordStats(pack) {
  return tx(['words'], 'readonly', t => req(t.objectStore('words').index('pack').getAll(pack)));
}
export async function allWords() { return tx(['words'], 'readonly', t => req(t.objectStore('words').getAll())); }
export async function allEvents() { return tx(['events'], 'readonly', t => req(t.objectStore('events').getAll())); }
export async function countEvents() { return tx(['events'], 'readonly', t => req(t.objectStore('events').count())); }
export async function clearAll() {
  return tx(['events', 'words'], 'readwrite', t => { t.objectStore('events').clear(); t.objectStore('words').clear(); });
}
