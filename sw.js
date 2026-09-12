// Atomic shell cache: HTML and JS must always come from the same release.
const CACHE_NAME = 'biyuan-v110';
const ASSETS = ['./', './index.html', './style.css?v=147', './phonetic-search.js?v=147', './app.js?v=147', './import.js?v=147',
  './api.js?v=147', './config.js?v=147', './theme.js?v=147',
  './carousel.js?v=147', './navigation.js?v=147', './motion.css?v=147', './liquid-nav.css?v=147', './folder.css?v=147', './dissolve.js?v=147',
  './quick-menu.css?v=147', './quick-menu.js?v=147', './boot-screen.css?v=147', './boot-screen.js?v=147'];
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
