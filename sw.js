// Atomic shell cache: HTML and JS must always come from the same release.
const CACHE_NAME = 'biyuan-v68';
const ASSETS = ['./', './index.html', './style.css?v=108', './app.js?v=108', './import.js?v=108',
  './api.js?v=108', './config.js?v=108', './theme.js?v=108', './archive-model.js?v=108', './liquid-glass.js?v=108',
  './carousel.js?v=108', './navigation.js?v=108', './motion.css?v=108', './liquid-nav.css?v=108', './folder.css?v=108', './dissolve.js?v=108'];
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
