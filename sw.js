// Atomic shell cache: HTML and JS must always come from the same release.
const CACHE_NAME = 'biyuan-v148';
const ASSETS = ['./', './index.html', './style.css?v=185', './phonetic-search.js?v=185', './app.js?v=185', './import.js?v=185',
  './api.js?v=185', './config.js?v=185', './theme.js?v=185',
  './carousel.js?v=185', './navigation.js?v=185', './motion.css?v=185', './liquid-nav.css?v=185', './nav-adapt.css?v=185', './nav-adapt.js?v=185', './folder.css?v=185', './dissolve.js?v=185',
  './quick-menu.css?v=185', './quick-menu.js?v=185', './boot-screen.css?v=185', './boot-fish.js?v=185', './boot-screen.js?v=185', './tablet.css?v=185', './tablet.js?v=185', './tablet-transform.css?v=185', './tablet-transform.js?v=185', './color-mode.css?v=185', './color-mode.js?v=185', './phone-leave.css?v=185', './phone-leave.js?v=185', './role-claim.js?v=185', './yellow-card.css?v=185', './yellow-card.js?v=185', './leave-all.css?v=185', './leave-all.js?v=185',
  './vendor/firebase/firebase-app-compat.js?v=185', './vendor/firebase/firebase-auth-compat.js?v=185', './vendor/firebase/firebase-firestore-compat.js?v=185', './firebase-backend.js?v=185', './release-notice.js?v=185', './manifest.json?v=185', './icon-192.png?v=185',
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
