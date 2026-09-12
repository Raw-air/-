// Atomic shell cache: HTML and JS must always come from the same release.
const CACHE_NAME = 'biyuan-v98';
const ASSETS = ['./', './index.html', './style.css?v=138', './phonetic-search.js?v=138', './app.js?v=138', './import.js?v=138',
  './api.js?v=138', './config.js?v=138', './theme.js?v=138',
  './carousel.js?v=138', './navigation.js?v=138', './motion.css?v=138', './liquid-nav.css?v=138', './folder.css?v=138', './dissolve.js?v=138',
  './quick-menu.css?v=138', './quick-menu.js?v=138', './boot-screen.css?v=138', './boot-screen.js?v=138'];
self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE_NAME).then(cache => cache.addAll(ASSETS)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(keys
    .filter(k => k.startsWith('biyuan-') && k !== CACHE_NAME).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'GET' || url.origin !== self.location.origin || url.pathname.includes('/api/')) return;
  event.respondWith((async () => {
    const cache = await caches.open(CACHE_NAME);
    const cached = await cache.match(event.request);
    if (cached) return cached;
    try {
      const response = await fetch(event.request);
      if (response.ok && /\.(svg|png|woff2?|mp3)$/.test(url.pathname)) {
        event.waitUntil(cache.put(event.request, response.clone()).catch(() => {}));
      }
      return response;
    } catch (error) {
      if (event.request.mode === 'navigate') return (await cache.match('./index.html')) || Response.error();
      return Response.error();
    }
  })());
});
