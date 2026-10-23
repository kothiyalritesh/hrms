const CACHE_PREFIX = "bop-hrms-";
// export_web.ps1 replaces this token with the immutable release build ID.
// Changing the worker script on every release makes installed PWAs discover
// the update while the UI still controls when it is safe to reload.
const CACHE = `${CACHE_PREFIX}shell-20261023.114516`;
// The export script replaces this with every hashed Metro JavaScript bundle.
// Lazy chunks are optional during installation: a temporary failure must not
// prevent the critical app shell from installing.
const RELEASE_SCRIPTS = ["./_expo/static/js/web/__common-d33f47c35db486e164889b4ede4955e1.js","./_expo/static/js/web/__expo-metro-runtime-f32bf4eb0c1047573018696744221cd1.js","./_expo/static/js/web/ActivityAnalysisScreen-ce3765521bef1e674d00dcc222d9827d.js","./_expo/static/js/web/ActivityLoggingScreen-5d23b592f4455a03df17f1a135029e4e.js","./_expo/static/js/web/AdminDeviceSessionsScreen-18858b7e80adfb8a345852a128c6a867.js","./_expo/static/js/web/AdvancedAttendanceReportScreen-8a3e5c8efdba9fe264d82d5f4f1cfd6f.js","./_expo/static/js/web/AnonymousFeedbackScreen-1e2938fe85bfa72b9f06caa4c33b8c7f.js","./_expo/static/js/web/AttendanceCalendarScreen-f74c470a0ae5d7f626fc7243eae4e760.js","./_expo/static/js/web/AttendanceControlScreenNew-42020c8d58896747819038ed38a5c792.js","./_expo/static/js/web/attendance-import-4170e1d07122e9f1f3cc536624db565f.js","./_expo/static/js/web/AttendanceIntelligenceScreen-1c270ec6b393a3e7570025a1297d3d9b.js","./_expo/static/js/web/AttendanceRegularizationScreen-2a3627c51126ad8c0c674a1ebce94444.js","./_expo/static/js/web/AttendanceScreen-3610acd0df2e5732b005a63daec3bc96.js","./_expo/static/js/web/AuditLogsScreen-37a088efdf823d95697c75adef5b58d8.js","./_expo/static/js/web/BackdatedAttendanceScreen-812ac8f9128e245bfcbcdb9938d07b72.js","./_expo/static/js/web/BiometricDeviceManagementScreen-fb696a9dab7093293507cc25e60de046.js","./_expo/static/js/web/BiometricDevicesScreen-b001bbdaf7ba12163d7b0f4069379e81.js","./_expo/static/js/web/BiometricUserMatchScreen-f6cbb6ba67f50711cb7d9d7135cb44ec.js","./_expo/static/js/web/CheckInLogsScreen-3998c5522037517239aa2ec089ceca0a.js","./_expo/static/js/web/ComplianceScoresScreen-592206ea066c0b526198dd59899d8076.js","./_expo/static/js/web/EmployeeBirthdayManagementScreen-0aac292800929006d55c2e85befac4b0.js","./_expo/static/js/web/EventManagementScreen-4f827101c58f02c87f400417a4bfb5c8.js","./_expo/static/js/web/FieldVisitAdminScreen-5bb145061258473bf40b4b462b2e46c8.js","./_expo/static/js/web/FieldVisitScreen-fc6b0c3f469a1f225fd0d227569b01d2.js","./_expo/static/js/web/HelpSupportScreen-46615e830e6c497a29698db092a6eb67.js","./_expo/static/js/web/index-3f2c374968abf36c84079ea58fe3edbe.js","./_expo/static/js/web/InTransitScreen-474b29a2199e1f99c2c636c0faf685a4.js","./_expo/static/js/web/LeaveBalanceScreen-bc5a9f73d383efab709930e3c2f5b15a.js","./_expo/static/js/web/LeaveBalanceSummaryReportScreen-7e3eed31e9d8787e120cc4d78426613b.js","./_expo/static/js/web/LeaveManagementScreen-20cd5eb325e1abfa1292496b298d7594.js","./_expo/static/js/web/LeaveScreen-ecf395cdc949a23be072d6d07d6a7beb.js","./_expo/static/js/web/LiveTrackingScreen-7f46a58f06833a7e0f8a6008653d78f0.js","./_expo/static/js/web/LocationMonitorScreen-0ca6dddf188f334f9b0cc3d66ab9d6d3.js","./_expo/static/js/web/LocationTrackingSetupScreen-6633dec8817e7b4b3e3e8d883da3aef7.js","./_expo/static/js/web/medianBridge-a5f5cfa23bf8e37f654d5fc95e570f0b.js","./_expo/static/js/web/MyActivityLogsScreen-1dfce782ec33b2b73719658224a6e180.js","./_expo/static/js/web/MyTeamScreen-66388349909e6aca6e9d6d5a2f37764e.js","./_expo/static/js/web/NotificationManagementScreen-14e61543553b11731b20dfa689e55475.js","./_expo/static/js/web/NotificationsScreen-35cd80277bc2e90d035f0c836935c746.js","./_expo/static/js/web/OfficeExitReviewsScreen-678298764b1e3cc3434bcd9d31268f66.js","./_expo/static/js/web/OfficeSettingsScreen-f78fa6287d2ccc2e98309fa8619fe8e6.js","./_expo/static/js/web/PermissionsManagerScreen-98969d2c9725b0c7ff3ea1d0c5b98802.js","./_expo/static/js/web/RaiseTicketScreen-82d1f85fc828e6285f951a40ffebe48b.js","./_expo/static/js/web/SiteSettingsScreen-7cb5016334df481580434cfa2ab9bbdf.js","./_expo/static/js/web/SiteVisitObserverScreen-4919c5399f190b9cc14e2d41a7ea0ac3.js","./_expo/static/js/web/SmartOfficeEmployeeImport-532bb33d28a79a037b7568405801ce24.js","./_expo/static/js/web/SmartOfficeImportedData-9cdf4cf2daa4935c8f4dbeaf4256cf0d.js","./_expo/static/js/web/SmartOfficeSecureSyncScreen-602c940ac16ff83010f1080795219cd3.js","./_expo/static/js/web/SuspiciousAttendanceScreen-7bc9737e941fe88b6277eba8affb91ff.js","./_expo/static/js/web/TaskProjectControlScreen-7f41081a704e7f43c277e1736033c7d7.js","./_expo/static/js/web/TasksScreen-1761574072ca8d471cd49d501a22d114.js","./_expo/static/js/web/TeamHierarchyScreen-fecfe1e9137138856b60f867153f6f72.js","./_expo/static/js/web/TicketManagementScreen-18010ddd4417b67702d8dc62181325ca.js","./_expo/static/js/web/TVDisplayScreen-81efca9cc0b127f9d5903a893a10a1c6.js","./_expo/static/js/web/UpcomingBirthdaysScreen-0ff54144b4cdbd1ed6e350cc2a4302d0.js","./_expo/static/js/web/UserManagementScreen-9ee1f18d8573bd56fe40d6407d93d781.js"];
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
