// Minimal hand-written service worker (no next-pwa/Serwist — this repo avoids
// unnecessary dependencies and Next 16 here builds with Turbopack, which
// those plugins don't cleanly support yet). Only registered in production
// builds (see components/ServiceWorkerRegister.tsx) so it never interferes
// with `next dev` fast refresh.
//
// Strategy:
// - /api/* and any non-GET request: never intercepted — this is a live
//   dashboard, so order/telegram/provider data must always be fresh.
// - /_next/static/*: cache-first (content-hashed, safe to cache forever).
// - Navigations (HTML pages): network-first, falling back to a cached copy
//   or the offline page if the network is unavailable.
// - Everything else (icons, fonts, css): stale-while-revalidate.

const CACHE_NAME = "panelist-shell-v1";
const OFFLINE_URL = "/offline.html";
const PRECACHE_URLS = [
  "/",
  OFFLINE_URL,
  "/manifest.json",
  "/icon-192.png",
  "/icon-512.png",
  "/favicon.svg",
  "/logo.svg",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then((cache) => cache.addAll(PRECACHE_URLS))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith("/api/")) return;

  if (url.pathname.startsWith("/_next/static/")) {
    event.respondWith(
      caches.open(CACHE_NAME).then(async (cache) => {
        const cached = await cache.match(request);
        if (cached) return cached;
        const response = await fetch(request);
        if (response.ok) cache.put(request, response.clone());
        return response;
      })
    );
    return;
  }

  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request)
        .then((response) => {
          const copy = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
          return response;
        })
        .catch(async () => {
          const cache = await caches.open(CACHE_NAME);
          return (await cache.match(request)) || (await cache.match(OFFLINE_URL));
        })
    );
    return;
  }

  event.respondWith(
    caches.open(CACHE_NAME).then(async (cache) => {
      const cached = await cache.match(request);
      const fetchPromise = fetch(request)
        .then((response) => {
          if (response.ok) cache.put(request, response.clone());
          return response;
        })
        .catch(() => cached);
      return cached || fetchPromise;
    })
  );
});
