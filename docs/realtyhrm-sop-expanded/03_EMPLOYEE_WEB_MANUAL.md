# Employee Web/PWA Manual

**Navigation:** Browser → configured HRMS web path → Login → Home/Tasks/Profile. `RootNavigator`, `MainTabNavigator`, web route/deep-link handling and service-worker code determine the shell.

## W-01 Browser prerequisites

- Use a supported browser with JavaScript, notifications and location enabled.
- Keep the HRMS tab active during web tracking; browser background/locked-screen tracking is not equivalent to Android native tracking.
- Permit storage/service-worker registration unless corporate policy blocks it. If registration fails, the app can continue online-only but update/offline behavior is reduced.

## W-02 Login and web session

Follow the mobile OTP steps. The browser stores the Supabase session through the configured shell-aware persistent storage; browser storage protection is environment-dependent and is not certified as secure storage by source inspection alone. If the Android shell bridge is available, `NativeShellConnector` synchronizes session/tracking/notifications; never copy tokens manually.

**Failure/recovery:** clear only the HRMS site data after documenting the error; sign in again. If the web path redirects incorrectly, record the configured base path and deep link; do not alter hosting files during incident handling.

## W-03 Web attendance

1. Home → Dashboard.
2. Allow browser location and select Check in/out.
3. Keep the page active until the server-confirmed result appears.
4. If offline, treat local saved state as pending only; reconnect and wait for durable outbox confirmation.

**Expected:** attendance row/server timestamp appears.  
**Limitation:** no reliable locked-screen/background location tracking on web (LT-01). For field work that requires continuous arrival/departure tracking, use the Android app.

## W-04 Web field visits and maps

Use Home → Field Visits. Map pins, navigation links and geofence checks use browser-capable services. Google Maps/Directions configuration is an external dependency; a broken map key or blocked API must be escalated as configuration, not worked around by changing coordinates.

## W-05 Web updates and stale shell recovery

1. If a release banner says an update is ready, save any pending work and reload through the banner.
2. If the shell is stale, open browser developer/application storage, inspect the HRMS service worker/cache status, then perform a controlled reload. Do not delete unrelated site data.
3. Recheck build ID/schema banner and sign-in after reload.

**Escalate:** hosting/deploy owner for service-worker mismatch, release metadata mismatch or repeated cache rollback. Evidence: browser console message, build ID, configured web path and whether a fresh private window reproduces it.

