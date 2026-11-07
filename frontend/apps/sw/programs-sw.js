// Service worker of the programs site. The build writes dist/apps/sw.js from this file
// (scripts/sw-build.ts and the Vite config). Programs run on another site than the panel, so the panel's
// service worker cannot keep them; this one does, for /apps/ only.
// - A program is kept the first time it opens with internet: the page lists what it loaded
//   ("estrella:keep") and later requests go through here. Nothing is downloaded in advance, so
//   students do not spend mobile data on programs they never use.
// - Program pages and their own files are asked to the network first (always current online);
//   hashed build files never change, so they come from the copy.
// - After a new version, hashed files that this build no longer has are deleted.
const VERSION = "__VERSION__";
/** Every hashed file of this build (/apps/assets/…), written by the build. */
const CURRENT_ASSETS = new Set(__ASSETS__);
const CACHE = "estrella-programs";
const SCOPE = new URL("./", self.location.href).pathname;
const MAX_KEEP = 300;

self.addEventListener("install", () => {
  // Nothing to download first: a new version can take over right away.
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    await self.clients.claim();
    await prune();
  })());
});

self.addEventListener("message", (event) => {
  const data = event.data;
  if (!data || data.type !== "estrella:keep" || !Array.isArray(data.urls)) return;
  event.waitUntil(keep(data.urls.slice(0, MAX_KEEP)));
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method !== "GET" || !inScope(url) || isControlFile(url)) return;
  event.respondWith(url.pathname.startsWith(`${SCOPE}assets/`) ? cacheFirst(request) : networkFirst(request));
});

function inScope(url) {
  return url.origin === self.location.origin && url.pathname.startsWith(SCOPE);
}

/** The worker itself must always come from the network, or it could never be updated. */
function isControlFile(url) {
  return url.pathname === `${SCOPE}sw.js`;
}

function storable(response) {
  return response.ok && response.type === "basic" && response.status === 200;
}

async function keep(urls) {
  const cache = await caches.open(CACHE);
  for (const raw of urls) {
    let url;
    try {
      url = new URL(raw, self.location.href);
    } catch {
      continue;
    }
    url.hash = "";
    if (!inScope(url) || isControlFile(url) || await cache.match(url.href)) continue;
    try {
      const response = await fetch(url.href);
      if (storable(response)) await cache.put(url.href, response);
    } catch {
      // Offline or gone: it will be kept the next time it loads.
    }
  }
}

async function cacheFirst(request) {
  const cache = await caches.open(CACHE);
  const cached = await cache.match(request);
  if (cached) return cached;
  const response = await fetch(request);
  if (storable(response)) await cache.put(request, response.clone());
  return response;
}

async function networkFirst(request) {
  const cache = await caches.open(CACHE);
  try {
    const response = await fetch(request);
    if (storable(response)) await cache.put(request, response.clone());
    return response;
  } catch {
    const cached = await cache.match(request, { ignoreSearch: true });
    return cached ?? Response.error();
  }
}

/** Hashed files that this build does not have belong to old versions. */
async function prune() {
  const cache = await caches.open(CACHE);
  for (const request of await cache.keys()) {
    const path = new URL(request.url).pathname;
    if (path.startsWith(`${SCOPE}assets/`) && !CURRENT_ASSETS.has(path)) await cache.delete(request);
  }
}

// The version makes each build's worker distinct, so the browser installs the new one.
void VERSION;
