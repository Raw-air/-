// Atomic shell cache: HTML and JS must always come from the same release.
const CACHE_NAME = 'biyuan-v56';
const ASSETS = ['./', './index.html', './style.css?v=92', './app.js?v=92', './import.js?v=92',
  './api.js?v=92', './config.js?v=92', './black-hole.js?v=92', './gravity.js?v=92', './theme.js?v=92',
  './carousel.js?v=92', './navigation.js?v=92', './motion.css?v=92', './liquid-nav.css?v=92',
  './vendor/three.r128.min.js', './vendor/html2canvas.1.4.1.min.js'];
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
