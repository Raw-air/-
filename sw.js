// Atomic shell cache: HTML and JS must always come from the same release.
const CACHE_NAME = 'biyuan-v133';
const ASSETS = ['./', './index.html', './style.css?v=170', './phonetic-search.js?v=170', './app.js?v=170', './import.js?v=170',
  './api.js?v=170', './config.js?v=170', './theme.js?v=170',
  './carousel.js?v=170', './navigation.js?v=170', './motion.css?v=170', './liquid-nav.css?v=170', './nav-adapt.css?v=170', './nav-adapt.js?v=170', './folder.css?v=170', './dissolve.js?v=170',
  './quick-menu.css?v=170', './quick-menu.js?v=170', './boot-screen.css?v=170', './boot-screen.js?v=170', './tablet.css?v=170', './tablet.js?v=170', './tablet-transform.css?v=170', './tablet-transform.js?v=170', './color-mode.css?v=170', './color-mode.js?v=170', './phone-leave.css?v=170', './phone-leave.js?v=170', './role-claim.js?v=170'];
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
