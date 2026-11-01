const CACHE_NAME = "courier-bill-app-v7";
const ASSETS = [
  "./",
  "./index.html",
  "./styles.css?v=5",
  "./app.js?v=6",
  "./auth.js?v=1",
  "./manifest.webmanifest",
  "./assets/icon.svg",
  "./assets/logo.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(ASSETS)));
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))),
    ).then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;
  const url = new URL(event.request.url);
  // Cache only this exact static-asset allowlist. API responses never enter CacheStorage.
  if (url.origin !== self.location.origin || !ASSETS.some((asset) => new URL(asset, self.location.href).href === url.href)) return;
  event.respondWith(
    caches.match(event.request).then((cached) =>
      fetch(event.request)
        .then((response) => {
          if (response.ok && response.headers.get('Cache-Control') !== 'no-store') {
            const copy = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
          }
          return response;
        })
        .catch(() => cached),
    ),
  );
});
