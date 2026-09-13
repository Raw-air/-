// Atomic shell cache: HTML and JS must always come from the same release.
const CACHE_NAME = 'biyuan-v131';
const ASSETS = ['./', './index.html', './style.css?v=168', './phonetic-search.js?v=168', './app.js?v=168', './import.js?v=168',
  './api.js?v=168', './config.js?v=168', './theme.js?v=168',
  './carousel.js?v=168', './navigation.js?v=168', './motion.css?v=168', './liquid-nav.css?v=168', './nav-adapt.css?v=168', './nav-adapt.js?v=168', './folder.css?v=168', './dissolve.js?v=168',
  './quick-menu.css?v=168', './quick-menu.js?v=168', './boot-screen.css?v=168', './boot-screen.js?v=168', './tablet.css?v=168', './tablet.js?v=168', './tablet-transform.css?v=168', './tablet-transform.js?v=168', './color-mode.css?v=168', './color-mode.js?v=168', './phone-leave.css?v=168', './phone-leave.js?v=168', './role-claim.js?v=168'];
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
