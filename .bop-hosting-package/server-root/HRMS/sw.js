const CACHE_PREFIX = "bop-hrms-";
// export_web.ps1 replaces this token with the immutable release build ID.
// Changing the worker script on every release makes installed PWAs discover
// the update while the UI still controls when it is safe to reload.
const CACHE = `${CACHE_PREFIX}shell-20260810.1`;
// The export script replaces this with every hashed Metro JavaScript bundle.
// Lazy chunks are optional during installation: a temporary failure must not
// prevent the critical app shell from installing.
const RELEASE_SCRIPTS = ["./_expo/static/js/web/__common-a82f86f28f5c562dc24816e5e9fbb381.js","./_expo/static/js/web/__expo-metro-runtime-f32bf4eb0c1047573018696744221cd1.js","./_expo/static/js/web/ActivityAnalysisScreen-10c1faca67741283b5a67d2c374e4b4c.js","./_expo/static/js/web/ActivityLoggingScreen-6c2d070cd0fd929afff8b3044a6cee07.js","./_expo/static/js/web/AdvancedAttendanceReportScreen-636c10a5906687662c253b494fedc882.js","./_expo/static/js/web/AttendanceCalendarScreen-4f92dc6c8e0517bc84f7566fd86b9d39.js","./_expo/static/js/web/AttendanceControlScreenNew-9c3116af722c4c83e2f9fcbe01a4b50d.js","./_expo/static/js/web/attendance-import-5b9ccbe6f9731e240d7f28ca3eb05fa0.js","./_expo/static/js/web/AttendanceRegularizationScreen-4e424041f5ffe29d8d0fdb06c8e81ac8.js","./_expo/static/js/web/AttendanceScreen-959780b7b6d582fd98b084d1682e8571.js","./_expo/static/js/web/AuditLogsScreen-7dfd5b52ec342d46316ec53e47d1739b.js","./_expo/static/js/web/BiometricUserMatchScreen-54b0bc8edeb2cfca90e8e6f376d1a268.js","./_expo/static/js/web/CheckInLogsScreen-9c1cbfcf83122f46afe9c4352c2d13ef.js","./_expo/static/js/web/EventManagementScreen-fac6384cbb7c1b314cba336f57ccc977.js","./_expo/static/js/web/FieldVisitAdminScreen-6136c29f8b975f20327847164cbe2c7d.js","./_expo/static/js/web/FieldVisitScreen-b7dd4c6a4ed2f60c27527eb62ef7a252.js","./_expo/static/js/web/index-29b31dbc58973ea05de94a9f9936c5d7.js","./_expo/static/js/web/LeaveBalanceScreen-f18dfa846c8fcc17f2b07a02b019d057.js","./_expo/static/js/web/LeaveManagementScreen-d01260e872a44683ea015c12d98c5046.js","./_expo/static/js/web/LeaveScreen-5e957685e4be2ad659f4d19a8644f0c9.js","./_expo/static/js/web/LiveTrackingScreen-48a6201c32384a28ffe0e8177a787f7d.js","./_expo/static/js/web/LocationTrackingSetupScreen-8150e14e3ede4ecb3f15cdb062389c9b.js","./_expo/static/js/web/medianBridge-71e331ee6d67281ed663b6804630c02e.js","./_expo/static/js/web/MyActivityLogsScreen-beb504f19bb697c8838d0bb71249f174.js","./_expo/static/js/web/MyTeamScreen-78c475ec1af771f4eefe5bd42ba1ddf8.js","./_expo/static/js/web/NotificationManagementScreen-1ce68779820f5d60c5248be1526f8ae0.js","./_expo/static/js/web/NotificationsScreen-cbc2ae6e1f8e873de2b2d3c1c8bfc21c.js","./_expo/static/js/web/OfficeSettingsScreen-3c2820398de93be2396b4615b4a20afa.js","./_expo/static/js/web/RaiseTicketScreen-a70b92f03aa8af7e70f1829b5fe6e7a2.js","./_expo/static/js/web/SiteSettingsScreen-27d3f3eab03ef336bb0f625065c6a6d9.js","./_expo/static/js/web/SmartOfficeEmployeeImport-afa6004e2162cacf7bce488a16ea8412.js","./_expo/static/js/web/SmartOfficeImportedData-6a599fc834d02c94b35c5c384a6484eb.js","./_expo/static/js/web/SmartOfficeSecureSyncScreen-33c709b18c1385b4a8719e40b325e929.js","./_expo/static/js/web/SuspiciousAttendanceScreen-fc0b7bf7f0e05d202bddb82201b26c39.js","./_expo/static/js/web/TaskProjectControlScreen-218e0af66b08a39148737849b04ccf7f.js","./_expo/static/js/web/TasksScreen-f3653fb7826d27217ddc33a90643427d.js","./_expo/static/js/web/TeamHierarchyScreen-6010cbfdcbeaa48de7d5ee7bad7bce5d.js","./_expo/static/js/web/TicketManagementScreen-559616e96974e2e70296b243ab3025e8.js","./_expo/static/js/web/TVDisplayScreen-5b7db2932657dd80b687b2583df0223a.js","./_expo/static/js/web/UpcomingBirthdaysScreen-115db966d491d5a930e09fe5c16261e3.js","./_expo/static/js/web/UserManagementScreen-0ffb09535f69cb23830e647e59e20ed2.js"];
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
