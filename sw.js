// Service worker: keeps the app usable offline.
// Updates are applied only when the coach presses 「更新する」 (spec 5章).
// When releasing, bump VERSION here AND APP_VERSION in app.js.
const VERSION = '0.3.3';
const CACHE = 'fpt-' + VERSION;
const FB = 'https://www.gstatic.com/firebasejs/10.12.2/';
const SHELL = [
  './', './index.html', './style.css', './app.js', './manifest.webmanifest',
  './js/store.js', './js/ui.js', './js/views.js', './js/engine.js', './js/matchplay.js',
  './icons/icon-180.png', './icons/icon-192.png', './icons/icon-512.png',
  FB + 'firebase-app.js', FB + 'firebase-auth.js', FB + 'firebase-firestore.js',
];

self.addEventListener('install', (e) => {
  // No skipWaiting here: a new version waits until the user presses 「更新する」.
  // cache:'reload' bypasses the browser's HTTP cache so a new version never stores stale files.
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL.map((u) => new Request(u, { cache: 'reload' })))));
});

self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    for (const k of await caches.keys()) if (k !== CACHE) await caches.delete(k);
    await self.clients.claim();
  })());
});

self.addEventListener('message', (e) => {
  if (e.data === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  const sameOrigin = url.origin === self.location.origin;
  const firebaseLib = url.href.startsWith(FB);
  if (!sameOrigin && !firebaseLib) return; // Firestore / Auth traffic goes straight to the network
  e.respondWith((async () => {
    const cache = await caches.open(CACHE);
    if (req.mode === 'navigate') {
      return (await cache.match('./index.html')) || fetch(req);
    }
    const hit = await cache.match(req, { ignoreSearch: sameOrigin });
    if (hit) return hit;
    const res = await fetch(req);
    if (res.ok && sameOrigin) cache.put(req, res.clone());
    return res;
  })());
});
