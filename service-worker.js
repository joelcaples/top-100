const CACHE_NAME = "listflair-shell-v4";
const SHELL_ASSETS = [
  "/",
  "/styles.css",
  "/app.js",
  "/public/site.webmanifest",
  "/public/logos/listflair-favicon.svg",
  "/public/logos/listflair-favicon-32.png",
  "/public/logos/listflair-apple-touch-icon.png",
  "/public/logos/listflair-header-lockup-tight.svg",
  "/public/logos/listflair-icon-192.png",
  "/public/logos/listflair-icon-512.png",
  "/public/logos/listflair-icon-maskable-512.png"
];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(SHELL_ASSETS)));
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key)))
    )
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") {
    return;
  }

  const url = new URL(request.url);
  if (url.origin !== self.location.origin || url.pathname.startsWith("/api/")) {
    return;
  }

  event.respondWith(
    caches.match(request).then((cachedResponse) => {
      const networkResponse = fetch(request)
        .then((response) => {
          if (response.ok) {
            const responseClone = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(request, responseClone));
          }
          return response;
        })
        .catch(() => cachedResponse);

      return cachedResponse || networkResponse;
    })
  );
});