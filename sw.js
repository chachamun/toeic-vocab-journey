/* 多益字彙旅程 — Service Worker
   離線可用：App 殼層預先快取，音檔第一次播過之後才快取。
   改版時把 VER 加一，舊快取會自動清掉。 */
const VER = 'tvj-v13';
const SHELL = ['./', './index.html', './data.js', './courses/daily-video.js', './courses/bbc-6min.js', './app.js', './manifest.webmanifest',
  './icons/icon-192.png', './icons/icon-512.png', './icons/apple-touch-icon.png'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(VER).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== VER).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  /* 只處理自己網域；YouTube、字型、同步 API 都直接走網路 */
  if (url.origin !== self.location.origin) return;

  /* 音檔：範圍請求不快取，完整請求播過一次後存起來 */
  if (/\.(mp4|m4a|mp3|ogg|wav)$/i.test(url.pathname)) {
    if (req.headers.get('range')) return;
    e.respondWith(caches.match(req).then(hit => hit || fetch(req).then(res => {
      if (res.ok) { const cp = res.clone(); caches.open(VER).then(c => c.put(req, cp)); }
      return res;
    })));
    return;
  }

  /* 其他：網路優先，失敗才用快取（這樣改版不會卡舊檔，離線仍可開） */
  e.respondWith(
    fetch(req).then(res => {
      if (res.ok) { const cp = res.clone(); caches.open(VER).then(c => c.put(req, cp)); }
      return res;
    }).catch(() => caches.match(req).then(hit => hit || caches.match('./index.html')))
  );
});
