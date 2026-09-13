// Atomic shell cache: HTML and JS must always come from the same release.
const CACHE_NAME = 'biyuan-v127';
const ASSETS = ['./', './index.html', './style.css?v=164', './phonetic-search.js?v=164', './app.js?v=164', './import.js?v=164',
  './api.js?v=164', './config.js?v=164', './theme.js?v=164',
  './carousel.js?v=164', './navigation.js?v=164', './motion.css?v=164', './liquid-nav.css?v=164', './nav-adapt.css?v=164', './nav-adapt.js?v=164', './folder.css?v=164', './dissolve.js?v=164',
  './quick-menu.css?v=164', './quick-menu.js?v=164', './boot-screen.css?v=164', './boot-screen.js?v=164', './tablet.css?v=164', './tablet.js?v=164', './tablet-transform.css?v=164', './tablet-transform.js?v=164', './color-mode.css?v=164', './color-mode.js?v=164', './phone-leave.css?v=164', './phone-leave.js?v=164', './role-claim.js?v=164'];
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
