// IndexedDB storage: settings and counters (kv), jobs, and the office register.
const DB_NAME = 'waste-notes';
const VERSION = 1;
let dbPromise;

function open() {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const r = indexedDB.open(DB_NAME, VERSION);
      r.onupgradeneeded = () => {
        const db = r.result;
        if (!db.objectStoreNames.contains('kv')) db.createObjectStore('kv');
        if (!db.objectStoreNames.contains('jobs')) db.createObjectStore('jobs', { keyPath: 'id' });
        if (!db.objectStoreNames.contains('register')) db.createObjectStore('register', { keyPath: 'key' });
      };
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
    });
  }
  return dbPromise;
}

async function run(store, mode, fn) {
  const db = await open();
  return new Promise((resolve, reject) => {
    const t = db.transaction(store, mode);
    const request = fn(t.objectStore(store));
    t.oncomplete = () => resolve(request ? request.result : undefined);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error || new Error('Storage transaction aborted'));
  });
}

export const kvGet = (key) => run('kv', 'readonly', (s) => s.get(key));
export const kvSet = (key, value) => run('kv', 'readwrite', (s) => s.put(value, key));
export const kvDel = (key) => run('kv', 'readwrite', (s) => s.delete(key));

export const jobGet = (id) => run('jobs', 'readonly', (s) => s.get(id));
export const jobPut = (job) => run('jobs', 'readwrite', (s) => s.put({ ...job, updated_at: new Date().toISOString() }));
export const jobDel = (id) => run('jobs', 'readwrite', (s) => s.delete(id));
export const jobAll = () => run('jobs', 'readonly', (s) => s.getAll());

export const regPut = (entry) => run('register', 'readwrite', (s) => s.put(entry));
export const regAll = () => run('register', 'readonly', (s) => s.getAll());
export const regDel = (key) => run('register', 'readwrite', (s) => s.delete(key));

// Ask the browser not to clear our data under storage pressure.
export async function persist() {
  try { return navigator.storage?.persist ? await navigator.storage.persist() : false; } catch { return false; }
}
