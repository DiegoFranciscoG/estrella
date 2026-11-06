// Offline support: static files are served from cache and refreshed in the background.
// The API is never cached: account data must always come from the server.
const CACHE = "estrella-static-v1";

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(["/", "/index.html", "/estrella.svg", "/manifest.webmanifest"])));
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))));
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== "GET" || url.origin !== self.location.origin || url.pathname.startsWith("/api/")) return;
  event.respondWith(
    caches.open(CACHE).then(async (cache) => {
      const cached = await cache.match(event.request, { ignoreSearch: url.pathname === "/" });
      const network = fetch(event.request)
        .then((response) => {
          if (response.ok && response.type === "basic") cache.put(event.request, response.clone());
          return response;
        })
        .catch(() => cached || (event.request.mode === "navigate" ? cache.match("/index.html") : Response.error()));
      return cached || network;
    }),
  );
});
