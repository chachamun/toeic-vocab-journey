/* 追分計劃 — Service Worker
   開 App 要快：App 殼層（HTML／JS／課程檔）先用手機裡存好的版本「立刻」顯示，同時在背景抓新版存起來。
   改版時把 VER 加一 → 瀏覽器發現 sw.js 變了 → 新版安裝好後頁面自動重新整理一次（app.js 監聽 controllerchange）。
   音檔第一次播過之後才快取；逐字稿等其他檔案網路優先、離線用快取。 */
const VER = 'tvj-v41';
const SHELL = ['./', './index.html', './data.js', './courses/daily-video.js', './courses/bbc-6min.js', './app.js', './manifest.webmanifest',
  './icons/icon-192.png', './icons/icon-512.png', './icons/apple-touch-icon.png'];
const SHELL_PATHS = new Set(SHELL.map(p => new URL(p, self.location).pathname));

self.addEventListener('install', e => {
  /* cache:'reload' 繞過瀏覽器的 HTTP 快取，確保存進去的是這一版的檔案 */
  e.waitUntil(caches.open(VER).then(c => c.addAll(SHELL.map(u => new Request(u, { cache: 'reload' })))).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== VER).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});

function saveCopy(req, res) {
  if (res && res.ok) { const cp = res.clone(); caches.open(VER).then(c => c.put(req, cp)); }
  return res;
}

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  /* 只處理自己網域；YouTube、字型、同步 API 都直接走網路 */
  if (url.origin !== self.location.origin) return;

  /* 音檔：範圍請求不快取，完整請求播過一次後存起來 */
  if (/\.(mp4|m4a|mp3|ogg|wav)$/i.test(url.pathname)) {
    if (req.headers.get('range')) return;
    e.respondWith(caches.match(req).then(hit => hit || fetch(req).then(res => saveCopy(req, res))));
    return;
  }

  /* App 殼層：有存好的就立刻用（不等網路），背景順便更新 */
  if (SHELL_PATHS.has(url.pathname) || req.mode === 'navigate') {
    e.respondWith(caches.match(req, { ignoreSearch: true }).then(hit => {
      const net = fetch(req).then(res => saveCopy(req, res)).catch(() => null);
      if (hit) { e.waitUntil(net); return hit; }
      return net.then(res => res || caches.match('./index.html'));
    }));
    return;
  }

  /* 其他（逐字稿等）：網路優先，失敗才用快取 */
  e.respondWith(
    fetch(req).then(res => saveCopy(req, res))
      .catch(() => caches.match(req).then(hit => hit || caches.match('./index.html')))
  );
});
