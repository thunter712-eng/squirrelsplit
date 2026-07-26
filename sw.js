// SquirrelSplit service worker — network-first, with tap-to-update.
// Bump CACHE_NAME on every deploy so home-screen apps get an "Update available" banner.

const CACHE_NAME = 'squirrelsplit-v3';
const ASSETS = [
  './',
  './index.html',
  './app.js',
  './styles.css',
  './confetti.js',
  './config.js',
  './manifest.webmanifest',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/apple-touch-icon.png',
];

// Pre-cache core assets. No skipWaiting here — the new version waits until the
// user taps the in-app "Update available" banner (which posts SKIP_WAITING).
self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE_NAME).then(cache => cache.addAll(ASSETS)));
});

self.addEventListener('message', e => {
  if (e.data === 'SKIP_WAITING') self.skipWaiting();
});

// Drop old caches on activate.
self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// Network-first: always try fresh, cache for offline, fall back to cache when offline.
self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;                       // never cache POSTs to the backend
  if (!e.request.url.startsWith(self.location.origin)) return;  // skip Apps Script / Drive / etc.
  e.respondWith(
    fetch(e.request)
      .then(resp => {
        const clone = resp.clone();
        caches.open(CACHE_NAME).then(cache => cache.put(e.request, clone));
        return resp;
      })
      .catch(() => caches.match(e.request))
  );
});
