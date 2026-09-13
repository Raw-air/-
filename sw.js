// Atomic shell cache: HTML and JS must always come from the same release.
const CACHE_NAME = 'biyuan-v126';
const ASSETS = ['./', './index.html', './style.css?v=163', './phonetic-search.js?v=163', './app.js?v=163', './import.js?v=163',
  './api.js?v=163', './config.js?v=163', './theme.js?v=163',
  './carousel.js?v=163', './navigation.js?v=163', './motion.css?v=163', './liquid-nav.css?v=163', './nav-adapt.css?v=163', './nav-adapt.js?v=163', './folder.css?v=163', './dissolve.js?v=163',
  './quick-menu.css?v=163', './quick-menu.js?v=163', './boot-screen.css?v=163', './boot-screen.js?v=163', './tablet.css?v=163', './tablet.js?v=163', './tablet-transform.css?v=163', './tablet-transform.js?v=163', './color-mode.css?v=163', './color-mode.js?v=163', './phone-leave.css?v=163', './phone-leave.js?v=163', './role-claim.js?v=163'];
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
