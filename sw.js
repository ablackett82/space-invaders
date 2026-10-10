// Service worker: caches the whole app on install so it launches offline.
// Bump VERSION whenever any file changes, so clients pick up the new build.
const VERSION = 'v2';
const CACHE = `invaders-${VERSION}`;
const FILES = [
  './', 'index.html', 'moved.js', 'style.css', 'manifest.webmanifest', 'data/tables.json',
  'src/main.js',
  'src/game/machine.js', 'src/game/draw.js', 'src/game/isr.js', 'src/game/flow.js',
  'src/render/screen.js', 'src/render/audio.js',
  'src/input/keyboard.js', 'src/input/gamepad.js', 'src/input/touch.js',
  'icons/icon-180.png', 'icons/icon-192.png', 'icons/icon-512.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(FILES)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k.startsWith(CACHE.slice(0, -VERSION.length)) && k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});

// cache first, falling back to the network (and caching what it returns)
self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET') return;
  e.respondWith(caches.match(e.request, { ignoreSearch: true }).then((hit) => hit || fetch(e.request).then((res) => {
    if (res.ok && new URL(e.request.url).origin === location.origin) {
      const copy = res.clone();
      caches.open(CACHE).then((c) => c.put(e.request, copy));
    }
    return res;
  })));
});
