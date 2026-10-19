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
// Shown only when a page cannot be loaded at all and no cached copy exists.
// It retries by itself as soon as the connection is back.
const OFFLINE_PAGE = `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>BOP HRMS</title>
<style>body{margin:0;min-height:100vh;display:grid;place-items:center;font-family:system-ui,sans-serif;background:#160D1E;color:#fff;text-align:center;padding:24px}
button{margin-top:18px;background:#A12A9B;color:#fff;border:0;border-radius:10px;padding:12px 26px;font-weight:700;font-size:15px}
p{color:#D1C4D6;max-width:340px;line-height:1.5}</style></head><body><div>
<h2>HRMS could not be reached</h2><p>Check your internet connection. This page reloads automatically when you are back online.</p>
<button onclick="location.reload()">Try again</button></div>
<script>addEventListener("online",function(){location.reload()});setTimeout(function(){location.reload()},15000);</script>
</body></html>`;
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
      // cache: "reload" — never precache an index.html the browser kept from an
      // older release (the host sends no Cache-Control for it).
      await cache.addAll(CRITICAL_SHELL.map((url) => new Request(url, { cache: "reload" })));
      await Promise.allSettled(
        RELEASE_SCRIPTS.map(async (asset) => {
          const response = await fetch(asset, { cache: "no-store" });
          const contentType = response.headers.get("content-type") || "";
          if (!response.ok || contentType.includes("text/html")) return;
          await cache.put(asset, response);
        }),
      );
      await trimCache(cache);
      // Take over right away: an older worker must not keep serving an old
      // release (old releases pointed at a Supabase project that no longer exists).
      await self.skipWaiting();
    })(),
  );
});

// The app shell of THIS release only. Older release caches are kept briefly so
// pages that are still open can load their lazy chunks, but they must never
// provide the shell for a new page load.
async function currentShell() {
  const cache = await caches.open(CACHE);
  return cache.match("./");
}

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

// Browser notifications shown by the page (components/BrowserNotificationWatcher):
// a tap focuses an open HRMS tab on the notification's page, or opens one.
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const raw = event.notification.data && event.notification.data.url;
  let target;
  try {
    target = new URL(raw || "./notifications", self.registration.scope);
    if (target.origin !== self.location.origin) target = new URL("./", self.registration.scope);
  } catch (_) {
    target = new URL("./", self.registration.scope);
  }
  event.waitUntil(
    (async () => {
      const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      for (const client of windows) {
        if (client.url.startsWith(self.registration.scope) && "focus" in client) {
          await client.focus();
          if ("navigate" in client) await client.navigate(target.href).catch(() => undefined);
          return;
        }
      }
      await self.clients.openWindow(target.href);
    })(),
  );
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
        // Pages always come from the network, bypassing the browser cache, so a
        // new release is picked up on the next load.
        const response = isNavigation
          ? await fetch(event.request.url, { cache: "no-store", credentials: "same-origin" })
          : await fetch(event.request);
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
          const shell = await currentShell();
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
        if (isNavigation) {
          const shell = await currentShell();
          if (shell) return shell;
          // One quick retry: a single dropped request (mobile network switch,
          // busy host) should not leave the user on an error page.
          try {
            await new Promise((resolve) => setTimeout(resolve, 1200));
            const retried = await fetch(event.request);
            if (retried.ok) return retried;
          } catch {
            // fall through to the friendly offline page
          }
          return new Response(OFFLINE_PAGE, {
            status: 503,
            headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" },
          });
        }
        const cached = await caches.match(event.request);
        if (cached) return cached;
        return new Response("Offline asset unavailable", {
          status: 503,
          headers: { "Content-Type": "text/plain; charset=utf-8" },
        });
      }
    })(),
  );
});
