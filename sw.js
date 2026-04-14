// 碧苑宿舍點名系統 - Service Worker（PWA 離線支援）
const CACHE_NAME = 'biyuan-v34'; // ← 每次更新 JS/CSS 必須遞增此版號
const ASSETS = [
  './',
  './index.html',
  './style.css',
  './app.js',
  './api.js',
  './config.js',
  './import.js',
  './export.js',
];

// 安裝時快取靜態資源
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(ASSETS))
  );
  self.skipWaiting();
});

// 啟動時清理舊快取
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

// 網路優先，失敗時用快取
self.addEventListener('fetch', (event) => {
  // API 請求不快取
  if (event.request.url.includes('/api/')) return;

  event.respondWith(
    fetch(event.request)
      .then((response) => {
        const clone = response.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
        return response;
      })
      .catch(() => caches.match(event.request))
  );
});
