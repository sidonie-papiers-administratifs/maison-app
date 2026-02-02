/* Service worker simple (cache) */
const CACHE_NAME = "maison-cache-v1";
const ASSETS = [
  "./",
  "./index.html",
  "./manifest.json",
  "./service-worker.js"
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE_NAME);
      await cache.addAll(ASSETS);
      self.skipWaiting();
    })()
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(keys.map(k => (k === CACHE_NAME ? null : caches.delete(k))));
      self.clients.claim();
    })()
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  const url = new URL(req.url);

  // On ne gère que le même origin
  if (url.origin !== self.location.origin) return;

  event.respondWith(
    (async () => {
      const cache = await caches.open(CACHE_NAME);

      // HTML : network-first (évite "rien ne change" trop souvent)
      if (req.mode === "navigate" || (req.headers.get("accept") || "").includes("text/html")) {
        try {
          const fresh = await fetch(req);
          cache.put("./index.html", fresh.clone());
          return fresh;
        } catch {
          const cached = await cache.match("./index.html");
          return cached || new Response("Hors ligne.", { status: 200, headers: { "Content-Type": "text/plain; charset=utf-8" } });
        }
      }

      // Autres fichiers : cache-first
      const cached = await cache.match(req);
      if (cached) return cached;

      const fresh = await fetch(req);
      cache.put(req, fresh.clone());
      return fresh;
    })()
  );
});
