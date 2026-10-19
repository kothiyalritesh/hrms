const CACHE_PREFIX = "bop-hrms-";
// export_web.ps1 replaces this token with the immutable release build ID.
// Changing the worker script on every release makes installed PWAs discover
// the update while the UI still controls when it is safe to reload.
const CACHE = `${CACHE_PREFIX}shell-20261015.130108`;
// The export script replaces this with every hashed Metro JavaScript bundle.
// Lazy chunks are optional during installation: a temporary failure must not
// prevent the critical app shell from installing.
const RELEASE_SCRIPTS = ["./_expo/static/js/web/__common-3ac1ecdd603f6dcd484e899734ff8a25.js","./_expo/static/js/web/__expo-metro-runtime-f32bf4eb0c1047573018696744221cd1.js","./_expo/static/js/web/ActivityAnalysisScreen-55033bc62ad429f17565488114605a33.js","./_expo/static/js/web/ActivityLoggingScreen-4869b47d19fa0642f91159bca8cd407c.js","./_expo/static/js/web/AdminDeviceSessionsScreen-e6308bdb29738161b5be2550d67d5d3d.js","./_expo/static/js/web/AdvancedAttendanceReportScreen-41c7340f5173eb9d9668b161c7e123e3.js","./_expo/static/js/web/AnonymousFeedbackScreen-0b9953a7aea2f3c91f2500e1a2325fa5.js","./_expo/static/js/web/AttendanceCalendarScreen-22ef78924f6bcae6cd01c5620bca095f.js","./_expo/static/js/web/AttendanceControlScreenNew-273cc86bbbcd4225edcb4b59a4e1ef74.js","./_expo/static/js/web/attendance-import-7bc2ec438463cf2479f93d7f639952b9.js","./_expo/static/js/web/AttendanceIntelligenceScreen-d689b55da0a0249dd8851d9fcf3cb7b2.js","./_expo/static/js/web/AttendanceRegularizationScreen-f66697c724089e656bf5af59499949fa.js","./_expo/static/js/web/AttendanceScreen-5d6efe4e49b797fd8781fa7a29aa7e8c.js","./_expo/static/js/web/AuditLogsScreen-813c373f7a4c3a4798c829138c6ac360.js","./_expo/static/js/web/BackdatedAttendanceScreen-077ec5f28e4f954478d38cfee54ce565.js","./_expo/static/js/web/BiometricDeviceManagementScreen-3ea74141244a775d60edb089f64d81c3.js","./_expo/static/js/web/BiometricUserMatchScreen-f3aa312195e97393b8ec0003ebf79ede.js","./_expo/static/js/web/CheckInLogsScreen-7723ac9236e70689f03bb261efa7dfc0.js","./_expo/static/js/web/ComplianceScoresScreen-8e9c84f4164ce7615647df577ae9593d.js","./_expo/static/js/web/EmployeeBirthdayManagementScreen-83bf4aeb548b63ccf215c35ecff6c0aa.js","./_expo/static/js/web/EventManagementScreen-4afbdaeebc54406851b4a81af7aa366b.js","./_expo/static/js/web/FieldVisitAdminScreen-034b7107bbdcb193a207bc41128d9ca3.js","./_expo/static/js/web/FieldVisitScreen-a4978d86e803e95ccff937bf5cd209cf.js","./_expo/static/js/web/HelpSupportScreen-113547c69b422040989f9f4d23849f67.js","./_expo/static/js/web/index-60aaeb509a3cb14beb5e5f8704216eb4.js","./_expo/static/js/web/InTransitScreen-d5872d4bd7f4736041047979cb80a026.js","./_expo/static/js/web/LeaveBalanceScreen-dfafccb5444841401e99d9463030b2b2.js","./_expo/static/js/web/LeaveBalanceSummaryReportScreen-4d16adc6fad2b550eae3a21f6e3cdbee.js","./_expo/static/js/web/LeaveManagementScreen-c7ffc8c2f2652f5055c4393d145c7bb5.js","./_expo/static/js/web/LeaveScreen-6c29594b040dfc7f96bcf66c9937a636.js","./_expo/static/js/web/LiveTrackingScreen-2523884c9761ec93cfbb4451d4f16559.js","./_expo/static/js/web/LocationTrackingSetupScreen-51ca1082e114d7c57e71d17e418052f5.js","./_expo/static/js/web/medianBridge-bbe415d7ce818c53feb4a9b7e8a2e459.js","./_expo/static/js/web/MyActivityLogsScreen-25f1b5f48dbc94f821f17cd79967a8ad.js","./_expo/static/js/web/MyTeamScreen-b48ad21f5b2c6745e0b11db00708fc22.js","./_expo/static/js/web/NotificationManagementScreen-c47140114a0fbcc55dd09ecfa1536209.js","./_expo/static/js/web/NotificationsScreen-7e82542af437bc15358cfaa9decaa749.js","./_expo/static/js/web/OfficeSettingsScreen-b7ca4f18a88e8f2809aa4537de636a88.js","./_expo/static/js/web/PermissionsManagerScreen-892b931769121be948076d540a8f1f33.js","./_expo/static/js/web/RaiseTicketScreen-cf2c0db682979a929ee8c6bebc47736a.js","./_expo/static/js/web/SiteSettingsScreen-42e178ce770fb843a0d43c286b05da6c.js","./_expo/static/js/web/SiteVisitObserverScreen-152687f0315eaffab4c092e70ef25822.js","./_expo/static/js/web/SmartOfficeEmployeeImport-bcde92ee531977c03f8766aa5b245940.js","./_expo/static/js/web/SmartOfficeImportedData-4128f1de1e704cdac03afcda3919aee8.js","./_expo/static/js/web/SmartOfficeSecureSyncScreen-0d452ad90b850e22837fa63af9895439.js","./_expo/static/js/web/SuspiciousAttendanceScreen-5d2c26ba1a00c5adedb90734bf9561c4.js","./_expo/static/js/web/TaskProjectControlScreen-4a4863c1bde21006b8bf2cbe0b5cf494.js","./_expo/static/js/web/TasksScreen-ef2011e6638eae35f2375444b2291c9c.js","./_expo/static/js/web/TeamHierarchyScreen-3a89e7f9206ff42f625167e0f8c88506.js","./_expo/static/js/web/TicketManagementScreen-0d2649ad8622a66173a919105a0fecab.js","./_expo/static/js/web/TVDisplayScreen-d9460f6b92c810229d1389603bd5a96e.js","./_expo/static/js/web/UpcomingBirthdaysScreen-475653d99afb0e2c7d34ae03dbb7ddbc.js","./_expo/static/js/web/UserManagementScreen-cfc182a697055475098ea5a80cdf9faf.js"];
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
