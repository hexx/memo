const CACHE_NAME = "org-memo-v1";

const STATIC_ASSETS = ["/", "/manifest.json"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(STATIC_ASSETS))
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;

  // API リクエストはネットワークオンリー
  if (request.url.includes("/api/")) {
    return;
  }

  // 静的アセットはキャッシュファースト
  event.respondWith(
    caches.match(request).then((cached) => {
      if (cached) return cached;
      return fetch(request)
        .then((response) => {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(request, clone));
          return response;
        })
        .catch(() => {
          return new Response("Offline", { status: 503 });
        });
    })
  );
});
