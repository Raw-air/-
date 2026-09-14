// Atomic shell cache: HTML and JS must always come from the same release.
const CACHE_NAME = 'biyuan-v132';
const ASSETS = ['./', './index.html', './style.css?v=169', './phonetic-search.js?v=169', './app.js?v=169', './import.js?v=169',
  './api.js?v=169', './config.js?v=169', './theme.js?v=169',
  './carousel.js?v=169', './navigation.js?v=169', './motion.css?v=169', './liquid-nav.css?v=169', './nav-adapt.css?v=169', './nav-adapt.js?v=169', './folder.css?v=169', './dissolve.js?v=169',
  './quick-menu.css?v=169', './quick-menu.js?v=169', './boot-screen.css?v=169', './boot-screen.js?v=169', './tablet.css?v=169', './tablet.js?v=169', './tablet-transform.css?v=169', './tablet-transform.js?v=169', './color-mode.css?v=169', './color-mode.js?v=169', './phone-leave.css?v=169', './phone-leave.js?v=169', './role-claim.js?v=169'];
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
