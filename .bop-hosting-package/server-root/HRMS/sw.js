const CACHE_PREFIX = "bop-hrms-";
// export_web.ps1 replaces this token with the immutable release build ID.
// Changing the worker script on every release makes installed PWAs discover
// the update while the UI still controls when it is safe to reload.
const CACHE = `${CACHE_PREFIX}shell-20261021.181121`;
// The export script replaces this with every hashed Metro JavaScript bundle.
// Lazy chunks are optional during installation: a temporary failure must not
// prevent the critical app shell from installing.
const RELEASE_SCRIPTS = ["./_expo/static/js/web/__common-97c38868b748acf36126b651146ae0ac.js","./_expo/static/js/web/__expo-metro-runtime-f32bf4eb0c1047573018696744221cd1.js","./_expo/static/js/web/ActivityAnalysisScreen-f1267ec416fdbe61f434d51f0995bd3c.js","./_expo/static/js/web/ActivityLoggingScreen-306205e3167541dc916f172a7e2236c2.js","./_expo/static/js/web/AdminDeviceSessionsScreen-18858b7e80adfb8a345852a128c6a867.js","./_expo/static/js/web/AdvancedAttendanceReportScreen-8ed1a222d11ab6c88c6bd040f4cf0ec4.js","./_expo/static/js/web/AnonymousFeedbackScreen-dffcbd5d59faeda18730338f059e678e.js","./_expo/static/js/web/AttendanceCalendarScreen-debf71142fea5f776771bd43b611551b.js","./_expo/static/js/web/AttendanceControlScreenNew-bf6b40aefa40338491da65575cd492cf.js","./_expo/static/js/web/attendance-import-94699d0de4efb401be5212c739d5d31d.js","./_expo/static/js/web/AttendanceIntelligenceScreen-391dc9b0d8629b3b4352942a2cc77c6a.js","./_expo/static/js/web/AttendanceRegularizationScreen-5baa253b087fffcf26b212141da4cfae.js","./_expo/static/js/web/AttendanceScreen-6d545d25d7e5c7fc65327880e68f690b.js","./_expo/static/js/web/AuditLogsScreen-e246b5df64d9b4231c0ee6c9b220cb2d.js","./_expo/static/js/web/BackdatedAttendanceScreen-e2b7aef08fbc172406d6dbdb0afdd32e.js","./_expo/static/js/web/BiometricDeviceManagementScreen-fb696a9dab7093293507cc25e60de046.js","./_expo/static/js/web/BiometricUserMatchScreen-a39723fbe5e22982d310bec91e4e3217.js","./_expo/static/js/web/CheckInLogsScreen-3ebd6c1555d3342a7388189db26725f6.js","./_expo/static/js/web/ComplianceScoresScreen-111f39f13215a79ad496a3d8b09b0c15.js","./_expo/static/js/web/EmployeeBirthdayManagementScreen-ddc66349525e0fc00cd207fe341f1be1.js","./_expo/static/js/web/EventManagementScreen-7473e687010bd22557d6235447b84cc8.js","./_expo/static/js/web/FieldVisitAdminScreen-6e0a1d5575d2b2bf685e3da2bcbc703d.js","./_expo/static/js/web/FieldVisitScreen-d56451e7ef12c6ac78e178180dec1411.js","./_expo/static/js/web/HelpSupportScreen-46615e830e6c497a29698db092a6eb67.js","./_expo/static/js/web/index-c2ebf508cdc742c1f0a53f2649094f2f.js","./_expo/static/js/web/InTransitScreen-f8652e17990f9d4fc3362e3bb8f24f37.js","./_expo/static/js/web/LeaveBalanceScreen-adfc9867d2c8c3566524bad90d239035.js","./_expo/static/js/web/LeaveBalanceSummaryReportScreen-74916c7561765f968b26dd195ab3444c.js","./_expo/static/js/web/LeaveManagementScreen-5bb5828499ee4bd8f9d9f5380b31194b.js","./_expo/static/js/web/LeaveScreen-4ce3596a2901f0ce934ce2bb33d99b1e.js","./_expo/static/js/web/LiveTrackingScreen-2f41783fc7187118903415b08560e034.js","./_expo/static/js/web/LocationMonitorScreen-2b9d1eccfa86a453abe1ba50b2cb646a.js","./_expo/static/js/web/LocationTrackingSetupScreen-6633dec8817e7b4b3e3e8d883da3aef7.js","./_expo/static/js/web/medianBridge-a5f5cfa23bf8e37f654d5fc95e570f0b.js","./_expo/static/js/web/MyActivityLogsScreen-1dfce782ec33b2b73719658224a6e180.js","./_expo/static/js/web/MyTeamScreen-4e428ab5cae1cb51e0711304aa83c851.js","./_expo/static/js/web/NotificationManagementScreen-6dbea91aedcb0cfa7cffb001ac605be0.js","./_expo/static/js/web/NotificationsScreen-cf0ae30369e3b17e39cdb3b79f9e309f.js","./_expo/static/js/web/OfficeExitReviewsScreen-66553a70f5c7caa231cc14f6152a4e17.js","./_expo/static/js/web/OfficeSettingsScreen-f78fa6287d2ccc2e98309fa8619fe8e6.js","./_expo/static/js/web/PermissionsManagerScreen-f35d2be0e6fe7214671b4ff9f45cf802.js","./_expo/static/js/web/RaiseTicketScreen-c5d6b5ff1d5b15e0ffacf1920893e884.js","./_expo/static/js/web/SiteSettingsScreen-7cb5016334df481580434cfa2ab9bbdf.js","./_expo/static/js/web/SiteVisitObserverScreen-4b1ae116b9739e479ec3e56694a51f1f.js","./_expo/static/js/web/SmartOfficeEmployeeImport-410c7cc081840b8fce2412f5f98f8725.js","./_expo/static/js/web/SmartOfficeImportedData-e28d8ec86050860ffa78c23b8fdc906a.js","./_expo/static/js/web/SmartOfficeSecureSyncScreen-0d4bc855a30890c804e6a34c313743b6.js","./_expo/static/js/web/SuspiciousAttendanceScreen-deafc3be27b6da4529769ba186a74b79.js","./_expo/static/js/web/TaskProjectControlScreen-7f41081a704e7f43c277e1736033c7d7.js","./_expo/static/js/web/TasksScreen-6799067f5ffbbf12ce0433fab118f14c.js","./_expo/static/js/web/TeamHierarchyScreen-2772284481655116486b60ed8579b9d5.js","./_expo/static/js/web/TicketManagementScreen-6e7160c5ff5b74ffd34c54cf7579d3c9.js","./_expo/static/js/web/TVDisplayScreen-7f0fa6e5313ccfecaf87fabbf712c6c5.js","./_expo/static/js/web/UpcomingBirthdaysScreen-34e262364d2f616a8815f1f9681b10f2.js","./_expo/static/js/web/UserManagementScreen-592144d2c28e1cd9b78920ee34338907.js"];
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
