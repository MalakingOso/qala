/* Qala service worker: app-shell offline cache + mutation outbox flush.
 * Tile PNGs and API sync stay network-first; the shell and queued ops
 * survive airplane mode. Version the cache to force updates. */
const VERSION = "qala-v7";
const SHELL = ["/", "/index.html", "/manifest.webmanifest", "/icons/icon-192.png"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(VERSION).then((c) => c.addAll(SHELL)).then(() =>
      self.skipWaiting()
    ),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys.filter((k) => k !== VERSION).map((k) => caches.delete(k)),
        )
      )
      .then(() => self.clients.claim()),
  );
});

// App shell + static: cache-first. Sync API + tiles: network-first.
self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== "GET") return;
  // Video is fetched with Range requests; the answer is a 206, which
  // cache.put rejects. Let the browser talk to the network directly.
  if (
    event.request.destination === "video" || event.request.headers.has("range")
  ) return;
  if (url.pathname.startsWith("/api/") || url.pathname.startsWith("/tiles/")) {
    event.respondWith(
      fetch(event.request).catch(() => caches.match(event.request)),
    );
    return;
  }
  event.respondWith(
    caches.match(event.request).then(
      (hit) =>
        hit ??
          fetch(event.request).then((res) => {
            const copy = res.clone();
            caches.open(VERSION).then((c) => c.put(event.request, copy));
            return res;
          }),
    ),
  );
});
