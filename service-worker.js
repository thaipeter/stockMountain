const CACHE_NAME = 'mountain-wms-cache-v5';
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

  // ★ สำคัญ: ปล่อยผ่านทุก request ที่ไม่ใช่ same-origin (เช่น รูปจาก img2.pic.in.th,
  //   Google Apps Script, CDN ต่างๆ) ให้เบราว์เซอร์จัดการโหลดตามปกติ ไม่ต้องยุ่ง
  //   เพราะ Service Worker ดักจับ request ข้ามโดเมนซ้ำแล้วมักโดนบล็อก/ล้มเหลว
  //   (net::ERR_FAILED) และเมื่อ catch ไปหา caches.match() ที่ไม่เคยมี URL นี้อยู่
  //   จะได้ undefined กลับมา ทำให้ respondWith(undefined) พังด้วย
  //   "Failed to convert value to 'Response'"
  if (new URL(event.request.url).origin !== self.location.origin) {
    return;
  }

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
      .catch(() =>
        // ★ กันไม่ให้ respondWith ได้ค่า undefined เด็ดขาด — ถ้าไม่เจอใน cache จริงๆ
        //   ให้คืน Response error ที่ถูกต้องแทน เพื่อไม่ให้เกิด TypeError ซ้ำ
        caches.match(event.request).then(cached =>
          cached || new Response('Offline หรือโหลดไฟล์ไม่สำเร็จ', {
            status: 503,
            statusText: 'Service Unavailable',
            headers: { 'Content-Type': 'text/plain; charset=utf-8' }
          })
        )
      )
  );
});
