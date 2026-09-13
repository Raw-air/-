// Atomic shell cache: HTML and JS must always come from the same release.
const CACHE_NAME = 'biyuan-v121';
const ASSETS = ['./', './index.html', './style.css?v=158', './phonetic-search.js?v=158', './app.js?v=158', './import.js?v=158',
  './api.js?v=158', './config.js?v=158', './theme.js?v=158',
  './carousel.js?v=158', './navigation.js?v=158', './motion.css?v=158', './liquid-nav.css?v=158', './nav-adapt.css?v=158', './nav-adapt.js?v=158', './folder.css?v=158', './dissolve.js?v=158',
  './quick-menu.css?v=158', './quick-menu.js?v=158', './boot-screen.css?v=158', './boot-screen.js?v=158', './tablet.css?v=158', './tablet.js?v=158', './tablet-transform.css?v=158', './tablet-transform.js?v=158', './color-mode.css?v=158', './color-mode.js?v=158'];
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
