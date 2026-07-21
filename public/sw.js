// Org Memo — Service Worker
//
// 戦略:
//   - ナビゲーション (HTML)  : ネットワーク優先。失敗時のみキャッシュへフォールバック。
//                             → デプロイ後の更新が「永遠に古いHTMLを見続ける」事故を防ぐ。
//   - 同オリジンの静的アセット : キャッシュ優先 (Vite のハッシュ付きファイルは不変のため安全)。
//   - /api/ 配下             : 常にネットワーク (キャッシュしない)。
//   - それ以外 (クロスオリジン): ブラウザ既定に委ねる (横取りしない)。
//
// 更新時: skipWaiting + clients.claim で、新しいSWを即座に全タブへ適用する。
//         古いバージョンのキャッシュは activate 時に掃除する。

const CACHE_NAME = "org-memo-v2";

// インストール時に先読みするアプリシェル。1つでも404だと install が失敗するので、
// 確実に存在するものだけに絞る (アイコンは generate-icons.mjs で生成済み)。
const APP_SHELL = ["/", "/manifest.json", "/icon-192.png", "/icon-512.png"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then((cache) => cache.addAll(APP_SHELL))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((key) => key !== CACHE_NAME)
            .map((key) => caches.delete(key))
        )
      )
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;

  // GET 以外は横取りしない (フォーム送信・プリフライト等を壊さない)
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  const sameOrigin = url.origin === self.location.origin;

  // API は常にネットワークへ (キャッシュしない)
  if (sameOrigin && url.pathname.startsWith("/api/")) return;

  // ナビゲーションはネットワーク優先 → オフライン時はキャッシュのシェルへ
  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request)
        .then((response) => {
          // エラー応答(500/404等)をキャッシュすると、オフライン時に本来の
          // "/" フォールバック 대신 エラーページを返し続けてしまう。
          // 静的アセット側と同様に成功応答のみキャッシュする。
          if (response.status === 200 && response.type === "basic") {
            const clone = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(request, clone));
          }
          return response;
        })
        .catch(() =>
          caches.match(request).then((cached) => cached || caches.match("/"))
        )
    );
    return;
  }

  // 同オリジンの静的アセットはキャッシュ優先
  if (sameOrigin) {
    event.respondWith(
      caches.match(request).then((cached) => {
        if (cached) return cached;
        return fetch(request)
          .then((response) => {
            if (response && response.status === 200 && response.type === "basic") {
              const clone = response.clone();
              caches.open(CACHE_NAME).then((cache) => cache.put(request, clone));
            }
            return response;
          })
          .catch(() => new Response("Offline", { status: 503 }));
      })
    );
  }
});
