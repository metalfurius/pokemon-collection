const RELEASE_REVISION = "__POCKETDEX_REVISION__";
const BASE_PATH = "__POCKETDEX_BASE_PATH__";
const CACHE_PREFIX = "pocketdex-shell-v3-";
const CACHE_NAME = `${CACHE_PREFIX}${RELEASE_REVISION}`;
const BASE_URL = new URL(BASE_PATH, self.location.origin);
const BASE_PATHNAME = BASE_URL.pathname;
const APP_SHELL = ["", "index.html", "manifest.webmanifest", "icon.svg", "revision.json"]
  .map((path) => new URL(path, BASE_URL).href);

function isInScope(url) {
  return url.pathname.startsWith(BASE_PATHNAME);
}

async function cacheResponse(request, response) {
  if (!response.ok) return response;
  try {
    const cache = await caches.open(CACHE_NAME);
    await cache.put(request, response.clone());
  } catch {
    // A cache write must never prevent the online response from rendering.
  }
  return response;
}

async function navigationResponse(request) {
  try {
    const response = await fetch(request);
    if (response.ok) return cacheResponse(request, response);
    const fallback = await caches.match(APP_SHELL[0]);
    return fallback ?? response;
  } catch {
    const cached = await caches.match(request);
    return cached ?? (await caches.match(APP_SHELL[0])) ?? Response.error();
  }
}

async function assetResponse(request) {
  const cached = await caches.match(request);
  if (cached) return cached;
  try {
    return await cacheResponse(request, await fetch(request));
  } catch {
    return Response.error();
  }
}

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys
      .filter((key) => key !== CACHE_NAME && (key.startsWith(CACHE_PREFIX) || key === "pocketdex-shell-v2"))
      .map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin || !isInScope(url)) return;

  const networkFirst = event.request.mode === "navigate"
    || url.pathname.endsWith("/revision.json")
    || /\.(?:js|css|webmanifest)$/.test(url.pathname);
  event.respondWith(networkFirst ? navigationResponse(event.request) : assetResponse(event.request));
});
