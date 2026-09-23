// Atomic shell cache: HTML and JS must always come from the same release.
const CACHE_NAME = 'biyuan-v138';
const ASSETS = ['./', './index.html', './style.css?v=175', './phonetic-search.js?v=175', './app.js?v=175', './import.js?v=175',
  './api.js?v=175', './config.js?v=175', './theme.js?v=175',
  './carousel.js?v=175', './navigation.js?v=175', './motion.css?v=175', './liquid-nav.css?v=175', './nav-adapt.css?v=175', './nav-adapt.js?v=175', './folder.css?v=175', './dissolve.js?v=175',
  './quick-menu.css?v=175', './quick-menu.js?v=175', './boot-screen.css?v=175', './boot-screen.js?v=175', './tablet.css?v=175', './tablet.js?v=175', './tablet-transform.css?v=175', './tablet-transform.js?v=175', './color-mode.css?v=175', './color-mode.js?v=175', './phone-leave.css?v=175', './phone-leave.js?v=175', './role-claim.js?v=175', './yellow-card.css?v=175', './yellow-card.js?v=175', './leave-all.css?v=175', './leave-all.js?v=175',
  './manifest.json?v=175', './icon-192.png?v=175',
  './Lp/ICON/COPY.svg', './Lp/ICON/HOME.svg', './Lp/ICON/NEW.svg', './Lp/ICON/RESET.svg', './Lp/ICON/SETTIN.svg'];
self.addEventListener('install', event => {
  // cache:'reload' 繞過瀏覽器 HTTP 快取，避免裝新版 SW 時把舊的 index.html 誤存進去
  event.waitUntil(caches.open(CACHE_NAME).then(cache => cache.addAll(ASSETS.map(u => new Request(u, { cache: 'reload' })))).then(() => self.skipWaiting()));
});
self.addEventListener('activate', event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(keys
    .filter(k => k.startsWith('biyuan-') && k !== CACHE_NAME).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'GET' || url.origin !== self.location.origin || url.pathname.includes('/api/')) return;
  // 殼層本體 (./、./index.html) 用 network-first：同一版下改版也能立刻拿到新內容，抓不到才退回快取
  const isShell = event.request.mode === 'navigate' || /\/index\.html$/.test(url.pathname);
  event.respondWith((async () => {
    const cache = await caches.open(CACHE_NAME);
    if (isShell) {
      try {
        const response = await fetch(event.request);
        if (response.ok) event.waitUntil(cache.put('./index.html', response.clone()).catch(() => {}));
        return response;
      } catch (error) {
        return (await cache.match('./index.html')) || Response.error();
      }
    }
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
