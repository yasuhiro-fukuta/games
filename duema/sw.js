/* デュエルトランプ サービスワーカー
   ネットワーク優先+キャッシュフォールバック: 常に最新を取りに行き、
   オフライン時は最後に成功したレスポンスを返す */
const CACHE = "dueltrump-v1";

self.addEventListener("install", () => self.skipWaiting());

self.addEventListener("activate", e => {
  e.waitUntil(
    caches.keys()
      .then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", e => {
  if (e.request.method !== "GET" || !e.request.url.startsWith(self.location.origin)) return;
  e.respondWith(
    fetch(e.request)
      .then(r => {
        if (r && r.ok) {
          const cp = r.clone();
          caches.open(CACHE).then(c => c.put(e.request, cp)).catch(() => {});
        }
        return r;
      })
      .catch(() => caches.match(e.request))
  );
});
