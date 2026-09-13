// Atomic shell cache: HTML and JS must always come from the same release.
const CACHE_NAME = 'biyuan-v122';
const ASSETS = ['./', './index.html', './style.css?v=159', './phonetic-search.js?v=159', './app.js?v=159', './import.js?v=159',
  './api.js?v=159', './config.js?v=159', './theme.js?v=159',
  './carousel.js?v=159', './navigation.js?v=159', './motion.css?v=159', './liquid-nav.css?v=159', './nav-adapt.css?v=159', './nav-adapt.js?v=159', './folder.css?v=159', './dissolve.js?v=159',
  './quick-menu.css?v=159', './quick-menu.js?v=159', './boot-screen.css?v=159', './boot-screen.js?v=159', './tablet.css?v=159', './tablet.js?v=159', './tablet-transform.css?v=159', './tablet-transform.js?v=159', './color-mode.css?v=159', './color-mode.js?v=159'];
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
