// Atomic shell cache: HTML and JS must always come from the same release.
const CACHE_NAME = 'biyuan-v125';
const ASSETS = ['./', './index.html', './style.css?v=162', './phonetic-search.js?v=162', './app.js?v=162', './import.js?v=162',
  './api.js?v=162', './config.js?v=162', './theme.js?v=162',
  './carousel.js?v=162', './navigation.js?v=162', './motion.css?v=162', './liquid-nav.css?v=162', './nav-adapt.css?v=162', './nav-adapt.js?v=162', './folder.css?v=162', './dissolve.js?v=162',
  './quick-menu.css?v=162', './quick-menu.js?v=162', './boot-screen.css?v=162', './boot-screen.js?v=162', './tablet.css?v=162', './tablet.js?v=162', './tablet-transform.css?v=162', './tablet-transform.js?v=162', './color-mode.css?v=162', './color-mode.js?v=162', './phone-leave.css?v=162', './phone-leave.js?v=162'];
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
