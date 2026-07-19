// ─── Service Worker ───────────────────────────────────────────────────────────
// Makes the game installable (PWA) and fast on repeat visits.
// - Versioned static assets (?v=N) are cache-first: they're immutable by contract.
// - /play navigations are network-first with a cached fallback, so the game
//   shell still opens on a flaky connection (gameplay itself needs the server).
// - Everything socket.io-related is never touched.
// Bump CACHE_VERSION together with the ?v= asset versions in index.html.
// ──────────────────────────────────────────────────────────────────────────────

const CACHE_VERSION = 'uno-v47';

const CORE_ASSETS = [
  '/play',
  '/style.css?v=43',
  '/main.js?v=45',
  '/game.js?v=39',
  '/renderer.js?v=40',
  '/sounds.js?v=1',
  '/shared/game-modes.js?v=4',
  '/shared/cosmetics.js?v=1',
  '/assets/cards.js?v=31',
  '/manifest.json',
  '/images/favicon.svg?v=30',
  '/images/icon-192.png',
  '/images/icon-512.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_VERSION)
      .then(cache => cache.addAll(CORE_ASSETS))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE_VERSION).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;       // fonts/CDNs: browser default
  if (url.pathname.startsWith('/socket.io')) return;      // realtime: never intercept

  // Versioned static assets: cache-first (immutable by ?v= contract)
  if (url.searchParams.has('v') || url.pathname === '/manifest.json' || url.pathname.startsWith('/images/icon-')) {
    event.respondWith(
      caches.match(req).then(hit => hit || fetch(req).then(res => {
        if (res.ok) {
          const copy = res.clone();
          caches.open(CACHE_VERSION).then(cache => cache.put(req, copy));
        }
        return res;
      }))
    );
    return;
  }

  // Game shell navigation: network-first, cached /play as offline fallback
  if (req.mode === 'navigate' && url.pathname === '/play') {
    event.respondWith(
      fetch(req).then(res => {
        if (res.ok) {
          const copy = res.clone();
          caches.open(CACHE_VERSION).then(cache => cache.put('/play', copy));
        }
        return res;
      }).catch(() => caches.match('/play'))
    );
  }
  // All other requests (SEO pages, OG images, API): straight to network
});
