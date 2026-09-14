// Atomic shell cache: HTML and JS must always come from the same release.
const CACHE_NAME = 'biyuan-v134';
const ASSETS = ['./', './index.html', './style.css?v=171', './phonetic-search.js?v=171', './app.js?v=171', './import.js?v=171',
  './api.js?v=171', './config.js?v=171', './theme.js?v=171',
  './carousel.js?v=171', './navigation.js?v=171', './motion.css?v=171', './liquid-nav.css?v=171', './nav-adapt.css?v=171', './nav-adapt.js?v=171', './folder.css?v=171', './dissolve.js?v=171',
  './quick-menu.css?v=171', './quick-menu.js?v=171', './boot-screen.css?v=171', './boot-screen.js?v=171', './tablet.css?v=171', './tablet.js?v=171', './tablet-transform.css?v=171', './tablet-transform.js?v=171', './color-mode.css?v=171', './color-mode.js?v=171', './phone-leave.css?v=171', './phone-leave.js?v=171', './role-claim.js?v=171'];
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
