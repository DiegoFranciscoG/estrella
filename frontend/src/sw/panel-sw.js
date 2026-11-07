// Service worker of the panel. The build writes dist/sw.js from this file, with the exact list of
// files of that version (scripts/sw-build.ts and the Vite config).
// - Install: keeps the whole panel (about 140 KB) so it opens without internet.
// - Pages are asked to the network first: online, the student always gets the current version;
//   offline, the copy kept here. Hashed files never change, so they come from the copy.
// - A new version waits until the student presses "Actualizar" (message below), so a version
//   never changes under an open program.
// - The API is never cached: account data always comes from the server.
const VERSION = "__VERSION__";
const PRECACHE = __PRECACHE__;
const CACHE = `estrella-panel-${VERSION}`;
const NAVIGATION_TIMEOUT_MS = 4000;

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(PRECACHE)));
});

self.addEventListener("message", (event) => {
  if (event.data === "estrella:activate-update") self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((k) => k.startsWith("estrella-") && k !== CACHE).map((k) => caches.delete(k)));
    await self.clients.claim();
  })());
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method !== "GET" || url.origin !== self.location.origin || url.pathname.startsWith("/api/")) return;
  if (url.pathname.startsWith("/assets/")) event.respondWith(cacheFirst(request));
  else event.respondWith(networkFirst(request, request.mode === "navigate"));
});

async function cacheFirst(request) {
  const cache = await caches.open(CACHE);
  const cached = await cache.match(request);
  if (cached) return cached;
  const response = await fetch(request);
  if (response.ok && response.type === "basic") await cache.put(request, response.clone());
  return response;
}

async function networkFirst(request, navigation) {
  const cache = await caches.open(CACHE);
  // A navigation is one page for every route (#/...): the kept index.html answers all of them.
  const key = navigation ? "/index.html" : request;
  const cached = await cache.match(key, { ignoreSearch: navigation });
  try {
    const network = fetch(request).then(async (response) => {
      if (response.ok && response.type === "basic" && !navigation) await cache.put(request, response.clone());
      return response;
    });
    // On a slow connection, a page already kept here is better than waiting.
    if (!navigation || !cached) return await network;
    return await Promise.race([network, new Promise((resolve) => setTimeout(() => resolve(cached), NAVIGATION_TIMEOUT_MS))]);
  } catch {
    if (cached) return cached;
    return navigation ? new Response("Sin conexión", { status: 503, headers: { "Content-Type": "text/plain; charset=utf-8" } }) : Response.error();
  }
}
