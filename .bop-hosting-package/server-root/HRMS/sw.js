const CACHE_PREFIX = "bop-hrms-";
// export_web.ps1 replaces this token with the immutable release build ID.
// Changing the worker script on every release makes installed PWAs discover
// the update while the UI still controls when it is safe to reload.
const CACHE = `${CACHE_PREFIX}shell-20260810.1`;
// The export script replaces this with every hashed Metro JavaScript bundle.
// Lazy chunks are optional during installation: a temporary failure must not
// prevent the critical app shell from installing.
const RELEASE_SCRIPTS = ["./_expo/static/js/web/__common-cf62cff6722691ae1f8da149a844ac45.js","./_expo/static/js/web/__expo-metro-runtime-f32bf4eb0c1047573018696744221cd1.js","./_expo/static/js/web/ActivityAnalysisScreen-ac5f4d72ee82f6da3c5c7483470d3132.js","./_expo/static/js/web/ActivityLoggingScreen-b5be544979b2c74db4c395b849e8c761.js","./_expo/static/js/web/AdminDeviceSessionsScreen-a29f00593cb9ee283d2207dc9c813904.js","./_expo/static/js/web/AdvancedAttendanceReportScreen-ac3d704767e8e96f63924c95f0ccda53.js","./_expo/static/js/web/AnonymousFeedbackScreen-bbafe57f0af69da12f88cecfe05918f7.js","./_expo/static/js/web/AttendanceCalendarScreen-25fc7f9cc7ba10088aa535e1e6e9e82a.js","./_expo/static/js/web/AttendanceControlScreenNew-1dca6c9ea48399da3fc9dfcbca5e2d85.js","./_expo/static/js/web/attendance-import-d35de9938791d2634c233164d9d5df36.js","./_expo/static/js/web/AttendanceIntelligenceScreen-17d7adf86ad78233f0807f4b4bae44ba.js","./_expo/static/js/web/AttendanceRegularizationScreen-3b641c4cdc6ff709ba690055af51f4c7.js","./_expo/static/js/web/AttendanceScreen-913aa102ad170ba4d37a7615feb62984.js","./_expo/static/js/web/AuditLogsScreen-785571277378259da70912f12ea51af3.js","./_expo/static/js/web/BiometricDeviceManagementScreen-8381e1641825ac932419e652642d081d.js","./_expo/static/js/web/BiometricUserMatchScreen-24e15f1e3785d192f63d3a89c2675b10.js","./_expo/static/js/web/CheckInLogsScreen-f025841389bce2728bf11ad91554cf92.js","./_expo/static/js/web/EmployeeBirthdayManagementScreen-f7b3123cc50cd84501ead7cbfc0d2b21.js","./_expo/static/js/web/EventManagementScreen-703d6419603892f51a9d6d7caa2d5527.js","./_expo/static/js/web/FieldVisitAdminScreen-e14b9bda559cd037c171650ea83c131c.js","./_expo/static/js/web/FieldVisitScreen-fe0f2552ef80f32be7d338ebf469241f.js","./_expo/static/js/web/HelpSupportScreen-d55f20f9ed7a76b684e2d72b1abc0c1e.js","./_expo/static/js/web/index-0dc63468cfed2de259935f279a99a9c9.js","./_expo/static/js/web/InTransitScreen-c4ca6ad23cbd7f2f2c0ababa435b9277.js","./_expo/static/js/web/LeaveBalanceScreen-65c17c52571e6fac69cb648ff59af97d.js","./_expo/static/js/web/LeaveManagementScreen-132db79012d409181fe8dd84e644e630.js","./_expo/static/js/web/LeaveScreen-8cfade8382eb7dd23b39f0b1cb9e2895.js","./_expo/static/js/web/LiveTrackingScreen-f403c48d29531be81d544f5e3f0020d3.js","./_expo/static/js/web/LocationTrackingSetupScreen-eb689fb09b5bd1cfc1b85481e2b882c6.js","./_expo/static/js/web/medianBridge-f887c78095de3d8899c7cc51697cb870.js","./_expo/static/js/web/MyActivityLogsScreen-93c761a7ae03a1b22e600d3951f417cf.js","./_expo/static/js/web/MyTeamScreen-791d4f49f3ac960f6ca29e55b897b7f5.js","./_expo/static/js/web/NotificationManagementScreen-e4b0bfa43518621748cb3e0a7e6d4aad.js","./_expo/static/js/web/NotificationsScreen-41ad06c3fb341714cc5e06f30922635b.js","./_expo/static/js/web/OfficeSettingsScreen-7e4d466b05e489ec146c8b110ad4afb4.js","./_expo/static/js/web/PermissionsManagerScreen-480385cb0598453373283ef461959ece.js","./_expo/static/js/web/RaiseTicketScreen-1ec4b7f56cdd3ffd1a409334a9fcdc4b.js","./_expo/static/js/web/SiteSettingsScreen-7031982287c3de5d8fa6f17f70f5004a.js","./_expo/static/js/web/SiteVisitObserverScreen-6f467fb3adcc1f01a20e7e8ee8ed949c.js","./_expo/static/js/web/SmartOfficeEmployeeImport-c9d46ca331ee115d77607559c7f7b390.js","./_expo/static/js/web/SmartOfficeImportedData-132f29f8a1abbad24705de30e6e8a3cd.js","./_expo/static/js/web/SmartOfficeSecureSyncScreen-030c2fe5e22f6d81db65569a601abc9a.js","./_expo/static/js/web/SuspiciousAttendanceScreen-91ac50d3a6be2d1d52fe4718e566e3f9.js","./_expo/static/js/web/TaskProjectControlScreen-bb37b5b70985b2a30d804e8693f36213.js","./_expo/static/js/web/TasksScreen-9b78e48808f4cce90feda0ac06d100aa.js","./_expo/static/js/web/TeamHierarchyScreen-046bde38154a608cc5148df26a156103.js","./_expo/static/js/web/TicketManagementScreen-7293435a9b031e8b4000304ec465ae0c.js","./_expo/static/js/web/TVDisplayScreen-551b8c214f277b644a7cb0e2d1817989.js","./_expo/static/js/web/UpcomingBirthdaysScreen-4141dae2c2ba386df53b86bfcf1b3c37.js","./_expo/static/js/web/UserManagementScreen-5abf8ff959e53be60888686549d6d39c.js"];
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
