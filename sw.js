// Atomic shell cache: HTML and JS must always come from the same release.
const CACHE_NAME = 'biyuan-v119';
const ASSETS = ['./', './index.html', './style.css?v=156', './phonetic-search.js?v=156', './app.js?v=156', './import.js?v=156',
  './api.js?v=156', './config.js?v=156', './theme.js?v=156',
  './carousel.js?v=156', './navigation.js?v=156', './motion.css?v=156', './liquid-nav.css?v=156', './folder.css?v=156', './dissolve.js?v=156',
  './quick-menu.css?v=156', './quick-menu.js?v=156', './boot-screen.css?v=156', './boot-screen.js?v=156', './tablet.css?v=156', './tablet.js?v=156', './tablet-transform.css?v=156', './tablet-transform.js?v=156', './color-mode.css?v=156', './color-mode.js?v=156'];
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
