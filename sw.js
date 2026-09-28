// Offline cache for the app shell. Bump VERSION on every release.
const VERSION = 'wn-0.1.2';
const SHELL = [
  './', './index.html', './styles.css', './manifest.webmanifest', './settings.example.json',
  './js/app.js', './js/db.js', './js/pack.js', './js/pdf.js', './js/notes.js', './js/rules.js', './js/seal.js', './js/sign.js',
  './icons/icon-192.png', './icons/icon-512.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});

// Cache first (works in a basement), refresh the cache in the background when online.
self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== location.origin) return;
  e.respondWith(caches.open(VERSION).then(async (cache) => {
    const cached = await cache.match(req, { ignoreSearch: true });
    const network = fetch(req).then((res) => { if (res.ok) cache.put(req, res.clone()); return res; }).catch(() => null);
    if (cached) return cached;
    const res = await network;
    if (res) return res;
    // Offline and not cached: pages fall back to the app shell, files fail cleanly.
    return req.mode === 'navigate' ? cache.match('./index.html') : Response.error();
  }));
});
