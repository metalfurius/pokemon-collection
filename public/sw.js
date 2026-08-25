const CACHE_NAME = "pocketdex-shell-v2";
const APP_SHELL = ["./", "./index.html", "./manifest.webmanifest", "./icon.svg", "./revision.json"];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET" || new URL(event.request.url).origin !== self.location.origin) return;
  const url = new URL(event.request.url);
  const networkFirst = event.request.mode === "navigate"
    || url.pathname.endsWith("/revision.json")
    || /\.(?:js|css|webmanifest)$/.test(url.pathname);
  if (networkFirst) {
    event.respondWith(fetch(event.request).then(async (response) => {
      if (response.ok) {
        try {
          const cache = await caches.open(CACHE_NAME);
          await cache.put(event.request, response.clone());
        } catch {
          // A cache write must never prevent the online response from rendering.
        }
      }
      return response;
    }).catch(() => caches.match(event.request).then((cached) => cached ?? Response.error())));
    return;
  }
  event.respondWith(
    caches.match(event.request).then(async (cached) => {
      if (cached) return cached;
      const response = await fetch(event.request);
      if (response.ok) {
        try {
          const cache = await caches.open(CACHE_NAME);
          await cache.put(event.request, response.clone());
        } catch {
          // A cache write must never prevent the online response from rendering.
        }
      }
      return response;
    }),
  );
});
