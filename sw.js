// Atomic shell cache: HTML and JS must always come from the same release.
const CACHE_NAME = 'biyuan-v91';
const ASSETS = ['./', './index.html', './style.css?v=131', './phonetic-search.js?v=131', './app.js?v=131', './import.js?v=131',
  './api.js?v=131', './config.js?v=131', './theme.js?v=131',
  './carousel.js?v=131', './navigation.js?v=131', './motion.css?v=131', './liquid-nav.css?v=131', './folder.css?v=131', './dissolve.js?v=131'];
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
