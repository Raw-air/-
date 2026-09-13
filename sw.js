// Atomic shell cache: HTML and JS must always come from the same release.
const CACHE_NAME = 'biyuan-v129';
const ASSETS = ['./', './index.html', './style.css?v=166', './phonetic-search.js?v=166', './app.js?v=166', './import.js?v=166',
  './api.js?v=166', './config.js?v=166', './theme.js?v=166',
  './carousel.js?v=166', './navigation.js?v=166', './motion.css?v=166', './liquid-nav.css?v=166', './nav-adapt.css?v=166', './nav-adapt.js?v=166', './folder.css?v=166', './dissolve.js?v=166',
  './quick-menu.css?v=166', './quick-menu.js?v=166', './boot-screen.css?v=166', './boot-screen.js?v=166', './tablet.css?v=166', './tablet.js?v=166', './tablet-transform.css?v=166', './tablet-transform.js?v=166', './color-mode.css?v=166', './color-mode.js?v=166', './phone-leave.css?v=166', './phone-leave.js?v=166', './role-claim.js?v=166'];
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
