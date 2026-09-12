// Atomic shell cache: HTML and JS must always come from the same release.
const CACHE_NAME = 'biyuan-v103';
const ASSETS = ['./', './index.html', './style.css?v=141', './phonetic-search.js?v=140', './app.js?v=141', './import.js?v=140',
  './api.js?v=140', './config.js?v=140', './theme.js?v=140',
  './carousel.js?v=140', './navigation.js?v=140', './motion.css?v=140', './liquid-nav.css?v=141', './folder.css?v=140', './dissolve.js?v=140',
  './quick-menu.css?v=140', './quick-menu.js?v=140', './boot-screen.css?v=140', './boot-screen.js?v=140'];
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
