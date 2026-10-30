// Service Worker: Alle Dateien werden bei der Installation zwischengespeichert,
// danach läuft die App vollständig ohne Netz. Die Platzhalter ersetzt tools/build.py.
const BUILD = 'dev';
const CACHE = `mathe-${BUILD}`;
const PRECACHE = /*__PRECACHE__*/ [];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.addAll(PRECACHE.map((url) => new Request(url, { cache: 'reload' }))))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('mathe-') && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) return;
  event.respondWith(
    caches.match(req, { ignoreSearch: true }).then(
      (hit) => hit || (req.mode === 'navigate' ? caches.match('./index.html') : fetch(req)),
    ),
  );
});
