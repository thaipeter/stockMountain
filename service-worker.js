const CACHE_NAME = 'mountain-wms-cache-v3';
const urlsToCache = [
  './index.html',
  './indexqrv1.html',
  './manifest.json'
];

self.addEventListener('install', event => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(urlsToCache))
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys => Promise.all(
      keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k))
    )).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET') return;

  event.respondWith(
    // สำคัญ: cache:'no-store' บังคับให้เบราว์เซอร์ยิงไปเซิร์ฟเวอร์จริงเสมอ
    // ไม่ใช้ไฟล์จาก HTTP cache ของเบราว์เซอร์เอง (คนละชั้นกับ Cache API ที่ service worker คุม)
    // นี่คือจุดที่ทำให้เมื่อก่อนต้องกด Ctrl+Shift+R ถึงจะเห็นไฟล์ใหม่
    fetch(event.request, { cache: 'no-store' })
      .then(networkResponse => {
        if (networkResponse && networkResponse.status === 200) {
          const responseToCache = networkResponse.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(event.request, responseToCache));
        }
        return networkResponse;
      })
      .catch(() => caches.match(event.request))
  );
});
