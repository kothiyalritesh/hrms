# Attendance-linked background location

## Outcome

The Expo source now contains one native, attendance-bound location coordinator,
top-level location/geofence task definitions, local device notifications,
protected offline sync, server-authoritative journey transitions, RLS,
push-token registration, and a server-side manager push function.

Tracking starts only for an authenticated open attendance record and stops only
after a confirmed app, early-app, or admin checkout. The existing database
machine-punch protection remains authoritative. Web retains foreground polling
and explicitly reports that reliable background tracking is unavailable.

This implementation follows the platform behavior that Android 11 and later
send background-location requests to application Settings. The setup screen
therefore explains the checked-in-only use and the Settings choice
before opening Settings. Approximate foreground access is treated as
approximate background access and is not reported as precise tracking.

Official references:

- Android background location:
  https://developer.android.com/develop/sensors-and-location/location/permissions/background
- Expo Location:
  https://docs.expo.dev/versions/latest/sdk/location/
- Expo Notifications:
  https://docs.expo.dev/versions/v56.0.0/sdk/notifications/
- Expo TaskManager:
  https://docs.expo.dev/versions/latest/sdk/task-manager/

## Initial audit findings

- Native and JavaScript tracking were mounted in more than one screen/root,
  allowing duplicate listeners and stop/start races.
- The original root check filtered attendance to the current date, which could
  stop a valid open attendance after midnight.
- The old native task wrote location rows directly and had no authoritative
  attendance/session RPC, journey thresholds, protected offline queue, or
  device notification channels.
- Existing notification history was primarily Supabase/in-app notification
  data, not Android/iOS notification-panel delivery.
- Existing biometric/machine checkout-protection migrations already prevent
  machine punches from closing app attendance. The new tracking migration does
  not weaken or replace those protections.
- Several historical SQL scripts disable RLS. The new tracking tables enable
  RLS and accept location writes only through a validated security-definer RPC.
- The repo had Expo dependency drift. Dependencies were aligned to Expo SDK 56
  before implementation.

## Architecture

1. `LocationTrackingProvider` is mounted once at the application root.
2. `LocationTrackingCoordinator` serializes lifecycle mutations and reconciles
   native state against the latest genuinely open attendance across dates.
3. `backgroundLocationTask.ts` defines the location and geofence tasks at module
   top level and is imported before the React application starts.
4. A foreground service supplies the persistent Android tracking notification.
5. The device calculates immediate local threshold transitions, while
   `record_location_ping` independently validates coordinates, quality,
   attendance ownership, distance, ordering, and authoritative journey state.
6. Reliable pings can create unique 1 km, 500 m, arrival, and departure events.
   A database trigger creates in-app manager history; the Edge Function sends
   deduplicated device pushes from server-read data.
7. Offline pings use UUID idempotency keys, are stored in capture-time order,
   and keep their sensitive body in SecureStore on native devices. Confirmed
   uploads are removed.

Sampling modes:

| State                         |   Accuracy |   Time | Movement |
| ----------------------------- | ---------: | -----: | -------: |
| Attendance, no destination    |   Balanced | ~120 s |    100 m |
| Destination over 5 km/unknown |   Balanced |  ~60 s |    100 m |
| Destination 1–5 km            |       High |  ~30 s |     50 m |
| Destination within 1 km       | Navigation |  ~12 s |     15 m |
| Arrived                       |       High |  ~60 s |     50 m |

Expo can update a registered task's native options while the app is active.
Android may reject foreground-service changes initiated from the background,
so nested geofences remain the background wake-up/fallback mechanism.

## File-by-file changes

- `App.tsx`: installs the single root tracking provider and deep-link config.
- `index.js`: imports the task-definition module before React startup.
- `app.json`, `app.config.js`: location/foreground-service/background modes,
  notifications, custom sound, SecureStore, scheme, Maps key, and EAS project ID.
- `eas.json`: development APK, preview APK, and production AAB profiles.
- `contexts/LocationTrackingContext.tsx`: one native coordinator owner, realtime
  attendance/visit reconciliation, app-state reconciliation, and web fallback.
- `services/location/backgroundLocationTask.ts`: top-level native tasks,
  foreground-service options, adaptive modes, geofences, local state, quality
  checks, RPC upload, and offline fallback.
- `services/location/LocationTrackingCoordinator.ts`: permissions, start/stop,
  midnight-safe restore, destination changes, stale health, offline sync, and
  notification response lifecycle.
- `services/location/geo.ts`: Haversine, quality classification, hysteresis,
  two-reading arrival/departure confirmation, and once-per-journey transitions.
- `services/location/notification.service.ts`: four Android channels, local
  notifications, actions, authenticated visit revalidation, deep links, and
  push-token registration.
- `services/location/secureQueue.ts`, `offline.ts`: bounded protected queue and
  timestamp ordering.
- `services/location/attendanceLifecycle.ts`, `types.ts`: pure lifecycle rules
  and typed tracking state.
- `screens/LocationTrackingSetupScreen.tsx`: permission education, health
  status, Settings/retry controls, last update, destination, and journey state.
- `screens/AttendanceScreen.tsx`, `DashboardScreen.tsx`: start/setup on app
  check-in and stop only after successful authoritative checkout.
- `screens/FieldVisitScreen.tsx`, `services/field-visit.service.ts`: destination
  activation, cancellation/completion cleanup, and HRMS checkout coordination.
- `navigation/HomeStackNavigator.tsx`: setup and field-visit deep-link routes.
- `hooks/useLocationMonitor.ts`, `tasks/backgroundLocation.ts`: web-only and
  compatibility facades; duplicate native ownership was removed.
- `assets/sounds/arrival_ping.wav`: configured custom destination alert sound.
- `types/location-database.ts`: focused database types for new entities.
- `supabase/migrations/20260723000000_attendance_background_location.sql`:
  additive schema, indexes, RLS, RPCs, checkout trigger, and manager history.
- `supabase/functions/send-journey-notifications/index.ts`: secret-protected,
  server-validated, atomically claimed/deduplicated Expo push delivery.
- `services/location/__tests__`: geometry, threshold, quality, lifecycle,
  midnight, biometric, offline ordering, and duplicate native registration
  tests.
- `tsconfig.location.json`: focused strict typecheck for this subsystem.

No compiled `dist` file was changed.

## Supabase deployment

Do this first in a staging project or a production branch:

```powershell
npx supabase db push --dry-run
npx supabase db push
npx supabase functions deploy send-journey-notifications --no-verify-jwt
npx supabase secrets set JOURNEY_PUSH_WEBHOOK_SECRET="<strong-random-secret>"
```

After the migration succeeds, set
`EXPO_PUBLIC_LOCATION_RPC_ENABLED=true` in the Expo/EAS deployment environment
and rebuild/redeploy the client. Leave it `false` before migration; the app will
use the existing `location_tracking` table without issuing repeated missing-RPC
requests during a staged rollout.

The function deliberately uses its own `x-journey-webhook-secret`; it does not
trust a mobile payload. Configure a Supabase Database Webhook:

- table: `public.journey_events`
- event: `INSERT`
- URL: the deployed `send-journey-notifications` function URL
- HTTP header: `x-journey-webhook-secret` with the same secret

The function accepts both a normal database-webhook `record.id` payload and a
manual `{ "journeyEventId": "..." }` payload.

Before production, verify these with two employee accounts and one manager:

```sql
select tablename, rowsecurity
from pg_tables
where schemaname = 'public'
  and tablename in (
    'tracking_sessions', 'journey_events',
    'device_push_tokens', 'push_delivery_log', 'location_tracking'
  );

select attendance_log_id, count(*)
from tracking_sessions
where status = 'ACTIVE'
group by attendance_log_id
having count(*) > 1;

select field_visit_id, event_type, count(*)
from journey_events
where field_visit_id is not null
group by field_visit_id, event_type
having count(*) > 1;
```

The migration has not been applied automatically to the linked project from
this workspace. Local Supabase validation was unavailable because Docker was
not running.

## Native build

Set the EAS project ID in the build environment:

```powershell
$env:EXPO_PUBLIC_EAS_PROJECT_ID="<eas-project-uuid>"
npx eas-cli login
npx eas-cli build --platform android --profile development
```

Install the resulting APK on a physical device. Expo Go is not a valid test for
Android background location. After staging passes, create the store artifact:

```powershell
npx eas-cli build --platform android --profile production
```

## Physical Android verification

Use a real open attendance and real movement; mocked locations are intentionally
classified as untrusted and cannot prove arrival.

1. Android 11+: check in, open **Location Tracking Setup**, allow notifications
   and precise foreground location, accept the education screen, then choose
   **Allow all the time** in application Settings.
2. Android 13+: repeat once with notifications denied; attendance must remain
   valid, the service must not be falsely reported active, and the warning must
   remain visible.
3. Android 14+: confirm the persistent foreground-service notification, then
   minimize and lock the screen for at least 15 minutes.
4. Confirm `tracking_sessions` has one active row and `location_tracking`
   continues receiving rows for the same attendance ID.
5. Start a field visit from outside 1.1 km. Confirm one 1 km alert, one 500 m
   alert, and arrival only after two reliable in-radius readings.
6. Tap Open Visit, Navigate, and Check In. Each action must reload and validate
   the current visit before acting.
7. Disable GPS, background permission, and precise location separately. Verify
   the in-app warning, deduplicated journey health event, manager history, and
   location-problem notification where notification permission still exists.
8. Disable networking, capture multiple points, restore networking, and confirm
   capture-time ordering with no duplicate `client_event_id`.
9. Cross midnight while checked in. Confirm the same attendance and native task
   remain active.
10. Import a biometric/SmartOffice punch. Confirm no checkout and no tracking
    stop. Then complete app checkout and confirm the native service and its
    persistent notification disappear.
11. Force-stop the app. Android can stop all application work; reopen the app
    and verify reconciliation restores tracking for an open attendance.

Useful read-only checks:

```powershell
adb shell dumpsys package com.rehrms.app | findstr /I "location notification"
adb shell dumpsys activity services com.rehrms.app
adb logcat | findstr /I "expo-location hrms-attendance-location"
```

## Rollout

1. Back up the production database and capture current migration/version IDs.
2. Review the dependency audit separately; five high advisories remain,
   including the existing `xlsx` package with no npm-provided fix.
3. Apply the migration to staging and run the two-account RLS checks.
4. Deploy the Edge Function and webhook; verify one in-app and one device push.
5. Distribute the development build to QA on Android 11, 13, and 14+.
6. Pilot with a small employee/manager group for several workdays. Measure
   missing-update rate, duplicate events, battery use, and denied permissions.
7. Release the production AAB in staged percentages.
8. Only after the pilot, schedule the organization-approved detailed-location
   retention job. Do not invent a retention period without HR/legal approval.

## Rollback

The low-risk rollback is to disable the journey-event webhook and distribute the
previous mobile build. Leave the additive tables/columns in place so existing
audit data is preserved. Existing attendance and field-visit tables continue to
work without the new client.

For a full schema rollback, first export `tracking_sessions`,
`journey_events`, `device_push_tokens`, and `push_delivery_log`. Then remove the
new trigger/functions/policies and finally the new tables/columns in a reviewed
follow-up migration. Do not drop them ad hoc in production: that would destroy
tracking and delivery evidence.

## Verification evidence

Commands run in this workspace:

| Check                                 | Result                                           |
| ------------------------------------- | ------------------------------------------------ |
| `npm test -- --runInBand`             | PASS — 4 suites, 17 tests                        |
| `npm run typecheck:location`          | PASS                                             |
| Focused ESLint for new location files | PASS                                             |
| `npx expo-doctor`                     | PASS — 21/21                                     |
| `npx expo config --type prebuild`     | PASS                                             |
| Android `expo prebuild --no-install`  | PASS — permissions, icon, and sound generated    |
| `npx expo export --platform web`      | PASS — 1,439 modules, 36 output files            |
| Repository-wide TypeScript            | FAIL — 71 legacy errors; 0 feature-related       |
| Repository-wide ESLint                | FAIL — 1,331 legacy problems                     |
| `npm audit --omit=dev`                | FAIL — 18 advisories, including 5 high           |
| Local Supabase migration execution    | NOT RUN — Docker unavailable                     |
| Native Android/EAS build              | NOT RUN — EAS credentials/project ID unavailable |
| Physical Android tests                | NOT RUN — no attached physical device            |

Acceptance status:

|   # | Criterion                         | Status/evidence                                                                  |
| --: | --------------------------------- | -------------------------------------------------------------------------------- |
|   1 | Exactly one native session        | Implemented; unique DB index and idempotent coordinator. Device test pending.    |
|   2 | Persistent Android notification   | Configured foreground service. Device test pending.                              |
|   3 | Minimized/locked pings            | Native task configured. Device test pending.                                     |
|   4 | Bound to attendance ID            | PASS in config, session FK, and RPC validation.                                  |
|   5 | Midnight-safe                     | PASS unit test and open-attendance query without date filter.                    |
|   6 | Biometric does not stop           | PASS unit test plus existing machine-punch DB protection.                        |
|   7 | One 1 km alert                    | PASS unit test; notification-panel test pending.                                 |
|   8 | One 500 m alert                   | PASS unit test; notification-panel test pending.                                 |
|   9 | Confirmed arrival once            | PASS unit test and unique DB event; device test pending.                         |
|  10 | Sound/vibration channel           | Configured and asset generated; device test pending.                             |
|  11 | Correct deep link                 | Implemented with server revalidation; device tap test pending.                   |
|  12 | Server-validated manager alert    | PASS by RPC/event/Edge Function design; deployed integration pending.            |
|  13 | Offline deduplicated sync         | PASS ordering test, UUID index, and RPC duplicate guard.                         |
|  14 | Deduplicated health alerts        | PASS by local window and DB unique indexes; device test pending.                 |
|  15 | Checkout stops service            | Implemented after confirmed authoritative checkout; device test pending.         |
|  16 | No tracking outside attendance    | PASS by coordinator and RPC guards.                                              |
|  17 | Unauthorized access blocked       | RLS implemented; two-account deployed test pending.                              |
|  18 | Existing flow regression          | Web export PASS; full device/business regression pending.                        |
|  19 | Native Android build              | NOT RUN.                                                                         |
|  20 | TypeScript/lint/tests/diagnostics | Focused checks/tests/diagnostics PASS; repo-wide TS/lint FAIL on legacy backlog. |

Do not mark the feature production-complete until the migration, native build,
and physical-device rows above have passed in staging.
