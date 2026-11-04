/* Offline support for the dashboard.
 * - App shell + small data files: stale-while-revalidate (instant load, refreshed in background).
 * - Cohort / career / matchup bundles: cached the first time you open them, so any
 *   competition you've looked at works offline; refreshed in the background on later visits.
 * - /api/* (live scores, photos): always network, never cached.
 * Bump VERSION to drop old caches after a breaking change. */
const VERSION = "cil-v1";
const SHELL = ["./", "./index.html", "./index.js", "./playerimg.js", "./playermeta.js",
               "./rankings.js", "./icon.svg", "./manifest.webmanifest"];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET" || url.origin !== location.origin) return;
  if (url.pathname.startsWith("/api/")) return; // live data: network only
  e.respondWith(
    caches.open(VERSION).then(async (cache) => {
      const hit = await cache.match(e.request, { ignoreSearch: true });
      const net = fetch(e.request)
        .then((res) => {
          if (res.ok) cache.put(e.request, res.clone());
          return res;
        })
        .catch(() => hit);
      if (hit) {
        e.waitUntil(net.catch(() => {}));
        return hit;
      }
      return net;
    })
  );
});
