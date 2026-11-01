// Atomic shell cache: HTML and JS must always come from the same release.
const CACHE_NAME = 'biyuan-v154';
const ASSETS = ['./', './index.html', './style.css?v=191', './phonetic-search.js?v=191', './app.js?v=191', './import.js?v=191',
  './api.js?v=191', './config.js?v=191', './theme.js?v=191',
  './carousel.js?v=191', './navigation.js?v=191', './motion.css?v=191', './liquid-nav.css?v=191', './nav-adapt.css?v=191', './nav-adapt.js?v=191', './folder.css?v=191', './dissolve.js?v=191',
  './quick-menu.css?v=191', './quick-menu.js?v=191', './boot-screen.css?v=191', './boot-fish.js?v=191', './boot-screen.js?v=191', './tablet.css?v=191', './tablet.js?v=191', './tablet-transform.css?v=191', './tablet-transform.js?v=191', './color-mode.css?v=191', './color-mode.js?v=191', './phone-leave.css?v=191', './phone-leave.js?v=191', './role-claim.js?v=191', './yellow-card.css?v=191', './yellow-card.js?v=191', './leave-all.css?v=191', './leave-all.js?v=191',
  './vendor/firebase/firebase-app-compat.js?v=191', './vendor/firebase/firebase-auth-compat.js?v=191', './vendor/firebase/firebase-firestore-compat.js?v=191', './firebase-backend.js?v=191', './release-notice.js?v=191', './rollcall-tray.css?v=191', './rollcall-tray.js?v=191', './manifest.json?v=191', './icon-192.png?v=191',
  './Lp/ICON/COPY.svg', './Lp/ICON/HOME.svg', './Lp/ICON/NEW.svg', './Lp/ICON/RESET.svg', './Lp/ICON/SETTIN.svg'];
self.addEventListener('install', event => {
  // cache:'reload' 繞過瀏覽器 HTTP 快取，避免裝新版 SW 時把舊的 index.html 誤存進去
  event.waitUntil(caches.open(CACHE_NAME).then(cache => cache.addAll(ASSETS.map(u => new Request(u, { cache: 'reload' })))).then(() => self.skipWaiting()));
});
self.addEventListener('activate', event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(keys
    .filter(k => k.startsWith('biyuan-') && k !== CACHE_NAME).map(k => caches.delete(k))))
    .then(() => self.clients.claim())
    // 不能放進 waitUntil：換頁請求要等 SW 啟動完，SW 又在等換頁，會互相卡死
    .then(() => { reloadOldPages().catch(() => {}); }));
});
// 切到 Firebase 之前的舊畫面只會寫 Notion，別台看不到，所以換版時要自動重新載入。
// 新畫面會回 pong，不會被重新載入；舊畫面沒送出的點名存在本機，載入後會自動重送。
async function reloadOldPages() {
  const pages = await self.clients.matchAll({ type: 'window' });
  await Promise.all(pages.map(async page => {
    const isNew = await new Promise(resolve => {
      const channel = new MessageChannel();
      channel.port1.onmessage = () => resolve(true);
      page.postMessage('biyuan-ping', [channel.port2]);
      setTimeout(() => resolve(false), 1500);
    });
    if (!isNew) await page.navigate(page.url).catch(() => {});
  }));
}
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
