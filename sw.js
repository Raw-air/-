// Atomic shell cache: HTML and JS must always come from the same release.
const CACHE_NAME = 'biyuan-v96';
const ASSETS = ['./', './index.html', './style.css?v=135', './phonetic-search.js?v=135', './app.js?v=135', './import.js?v=135',
  './api.js?v=135', './config.js?v=135', './theme.js?v=135',
  './carousel.js?v=135', './navigation.js?v=135', './motion.css?v=135', './liquid-nav.css?v=136', './folder.css?v=135', './dissolve.js?v=135',
  './quick-menu.css?v=135', './quick-menu.js?v=135', './boot-screen.css?v=135', './boot-screen.js?v=135'];
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
