const CACHE_PREFIX = "bop-hrms-";
// export_web.ps1 replaces this token with the immutable release build ID.
// Changing the worker script on every release makes installed PWAs discover
// the update while the UI still controls when it is safe to reload.
const CACHE = `${CACHE_PREFIX}shell-__BOP_BUILD_ID__`;
// The export script replaces this with every hashed Metro JavaScript bundle.
// Lazy chunks are optional during installation: a temporary failure must not
// prevent the critical app shell from installing.
const RELEASE_SCRIPTS = __BOP_PRECACHE_ASSETS__;
const MAX_CACHE_ENTRIES = 120;
const CRITICAL_SHELL = [
  "./",
  "./manifest.webmanifest",
  "./icon.png",
];

async function trimCache(cache) {
  const keys = await cache.keys();
  const excess = keys.length - MAX_CACHE_ENTRIES;
  if (excess > 0) {
    await Promise.all(keys.slice(0, excess).map((key) => cache.delete(key)));
  }
}

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE);
      await cache.addAll(CRITICAL_SHELL);
      await Promise.allSettled(
        RELEASE_SCRIPTS.map(async (asset) => {
          const response = await fetch(asset, { cache: "no-store" });
          const contentType = response.headers.get("content-type") || "";
          if (!response.ok || contentType.includes("text/html")) return;
          await cache.put(asset, response);
        }),
      );
      await trimCache(cache);
    })(),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => {
        const priorReleaseCaches = keys
          .filter((key) => key.startsWith(CACHE_PREFIX) && key !== CACHE)
          .slice(-1);
        const retainedCaches = new Set([CACHE, ...priorReleaseCaches]);
        return Promise.all(
          keys
            .filter(
              (key) =>
                key.startsWith(CACHE_PREFIX) && !retainedCaches.has(key),
            )
            .map((key) => caches.delete(key)),
        );
      })
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("message", (event) => {
  if (event.data?.type === "SKIP_WAITING") self.skipWaiting();
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return;
  event.respondWith(
    (async () => {
      const isNavigation =
        event.request.mode === "navigate" ||
        event.request.headers.get("accept")?.includes("text/html");
      const isStaticAsset =
        event.request.destination === "script" ||
        event.request.destination === "style" ||
        event.request.destination === "image" ||
        event.request.destination === "font" ||
        /\.(?:js|mjs|css|map|json|webmanifest|png|jpe?g|gif|webp|avif|svg|ico|woff2?|ttf|otf|wasm)(?:$|\?)/i.test(
          url.pathname,
        );
      const isShellAsset =
        url.pathname.endsWith("/manifest.webmanifest") ||
        url.pathname.endsWith("/icon.png");
      try {
        const response = await fetch(event.request);
        const contentType = response.headers.get("content-type") || "";
        // A hosting fallback must never turn a missing static asset into HTML.
        if (isStaticAsset && contentType.includes("text/html")) {
          const cachedAsset = await caches.match(event.request);
          if (cachedAsset) return cachedAsset;
          return new Response("Application asset unavailable", {
            status: 502,
            headers: { "Content-Type": "text/plain; charset=utf-8" },
          });
        }
        // Static hosts commonly return their own 404 page for an application
        // route. Once this scoped worker controls /HRMS/, serve the cached app
        // shell so browser reloads such as /HRMS/reports remain inside HRMS.
        if (isNavigation && !response.ok) {
          const shell = await caches.match("./");
          if (shell) return shell;
        }
        if (response.ok && (isStaticAsset || isShellAsset)) {
          const copy = response.clone();
          event.waitUntil(
            caches.open(CACHE).then(async (cache) => {
              await cache.put(event.request, copy);
              await trimCache(cache);
            }),
          );
        }
        return response;
      } catch {
        const cached = await caches.match(event.request);
        if (cached) return cached;
        if (isNavigation) {
          const shell = await caches.match("./");
          if (shell) return shell;
        }
        return new Response("Offline asset unavailable", {
          status: 503,
          headers: { "Content-Type": "text/plain; charset=utf-8" },
        });
      }
    })(),
  );
});
