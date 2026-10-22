# RealtyHRM: functional reliability audit and fixes (2026-10-12)

## 1. Summary

This round traced five areas end to end through the code, the SQL and live behaviour:
- event attendance and comp-off;
- check-out and location tracking;
- offline attendance;
- device sessions and notifications;
- the employee screens.

Every database fix was run against a local PostgreSQL 17 copy of the real function and view definitions, taken from the migrations. Each one was checked with a before/after scenario and applied twice to prove it can safely be re-run. Production was not touched.

What changed for users:
- **Event attendees now count as present** in Today's Present, Attendance Control, reports and the 8 PM absence job.
- **Tracking stops after every kind of check-out.** That includes the 8 PM automatic check-out, biometric and event check-outs, an open field visit, and stale sessions from a previous day.
- **Attendance works offline.** The action is saved on the phone with its GPS reading and sent later. The server records the original time, never double-counts, and never reopens a closed day.
- **Comp-off is credited once per worked weekly off.** Before, an event on a weekly off paid it twice. Earning a comp-off no longer hides a late arrival.
- **Notifications:**
  - "Clear all" no longer brings reminders back.
  - A notification error can no longer undo a check-out, leave or task action.
  - Geofence alerts now go through the push queue, which retries them.
- **The Duplicate Devices screen shows real data.** A revoked phone session no longer locks the employee out for good after they sign in again.
- **The Android app always opens the HRMS built into the app.** There is no hosted page, so no "could not be loaded / Retry" screen.

## 2. Baseline

| Item | State |
|---|---|
| Branch / commit | `master` @ `2147f49`, ~357 uncommitted files from earlier sessions (preserved) |
| Source snapshot | `scratchpad/baseline/source-2026-10-12.tgz` (taken before any edit) |
| Latest migration before this round | `20261009140000_security_advisor_fixes.sql` |
| Previous artefacts | APK build 37, `bop-hrms-deploy.zip`, `bop-hrms-backend.zip` (renamed with `-20261009` before rebuilding) |
| Typecheck baseline | clean |
| Jest baseline | 290 passed / 30 failed (7 suites, pre-existing contract tests) |

The previous session's migrations `20261009100000` to `140000` and the two Edge Function changes are **still not deployed**. They must be run before the new ones (see section 7).

## 3. Issue register (confirmed and fixed)

| ID | Pri | Finding (root cause) | Fix | Verified |
|---|---|---|---|---|
| EV-1 | P1 | Event check-in writes the day's `attendance_logs` row (`checkin_source='EVENT'`). But the canonical view and core RPC only accepted `APP%` as presence, so event-only attendees were ABSENT in lists and reports and were charged for absence. The count card disagreed with the list. | `20261012100000`: the view, `rpc_attendance_canonical_range_core` and `hrms_canonical_row_patch` accept `EVENT` and label it `EVENT`. There is still one row per employee per day, so nobody is double-counted. | Local, real view and RPC: event-only went ABSENT → CHECKED_OUT/CHECKED_IN; office rows unchanged |
| EV-2 | P2 | The dashboard event check-out button relied on `attendance_type='EVENT'`, which is only set when the event came first. | It now uses the employee's own open event check-in. | Typecheck |
| EV-3 | P2 | Two events on one day: the first event's check-out closed the whole working day. | The working day stays open while another event check-in is open. | Local: day open after the 1st check-out, closed after the 2nd |
| CO-1 | P1 | An event on a weekly off credited 1 (weekly-off trigger) plus 1.5 (event engine), 2.5 in total. | The event engine subtracts the weekly-off credit already granted. Only the extended-duty extra is added. | Local: ledger 2.5 → 1.5; repeat calls do not add more |
| CO-2 | P1 | Creating an event with comp-off ON failed on the Marketing-only constraint from the retired Sunday engine. | Constraint dropped. Legacy v1 event RPCs are no longer callable. | Local: create failed → OK |
| CO-3 | P2 | Monthly view: comp-off earned counted only event credits, an event overrode an office LATE, and comp-off replaced the present/late status. | `rpc_get_my_monthly_attendance_v3` counts all approved credits and keeps LATE. The screen counts comp-off separately from present days. | Local: late kept; earned 0.5 → 1.5, which matches the ledger |
| TR-1 | P0 | After a SYSTEM, biometric or event check-out with a field visit from today still open, the server accepted pings as "visit travel" and answered ACTIVE. The app restarted tracking on every restore until midnight. | Server: pings after today's check-out are answered STOPPED. App: never starts visit-travel tracking after today's check-out, re-checked inside the tracking queue. | Local: ACTIVE → STOPPED |
| TR-2 | P0 | "Open attendance" had no date limit, so a never-closed session from an earlier day kept tracking indefinitely. | Server and app only treat a session started in the last 16 h as open. | Local: 30 h-old session → STOPPED |
| TR-3 | P0 | If the native stop failed, the config was cleared anyway and the orphaned background service tracked forever. | The service stops itself when it has no session. Stop is not gated on a check that can fail. There is a 16 h maximum session age, and restore stops any orphan. | Typecheck. **Needs a device test** |
| TR-4 | P1 | Only APP and ADMIN check-outs closed the server tracking session. | Every check-out source closes it, and stale ACTIVE sessions were closed. | Local: SYSTEM check-out → STOPPED |
| TR-5 | P2 | A lost response after the check-out commit left tracking running. | A stop that is not confirmed is retried through a server re-check after 5 s and 30 s. | Typecheck |
| TR-6 | P2 | The offline ping queue dropped pings on `AUTHENTICATION_REQUIRED`, so data was lost after a long offline spell. | Those pings are kept and retried. | Typecheck |
| OF-1 | P1 | Offline attendance was impossible: the outbox was never started, check-in had no idempotency, and the server rejected any GPS reading older than 60 s. | See section 4. | Local SQL scenarios + 7 Jest lifecycle tests |
| DV-1 | P1 | `v_duplicate_device_usage` read `employee_device_bindings`, which nothing writes, so the screen was always empty. | Rebuilt on `user_device_sessions` (sign-in + 5-minute heartbeat). | Local: 2 accounts / 1 phone → 2 rows |
| DV-2 | P1 | A revoked device session blocked that phone for that employee permanently. | A sign-in made after the revocation reopens it; the revoked sign-in stays blocked. | Local |
| DV-3 | P2 | A check-in rejected for fake GPS did not create a Suspicious Attendance signal (only tracking pings did). | The check-in now records `MOCK_LOCATION`, once per employee per day. The public IP is stored on the device session for review; a shared IP is not treated as fraud. | Local: 0 → 1 signal |
| NT-1 | P1 | "Clear all" deleted the duplicate key, so the every-minute scheduler recreated and re-pushed reminders. | Cleared keys are remembered for 60 days and not recreated. | Local: re-enqueue after clear 1 row → 0; new keys still arrive |
| NT-2 | P1 | A notification error inside a trigger rolled back the action that fired it, for example Going Home check-out. | Notification triggers log a warning and let the action commit. | Local: rolled back → committed |
| NT-3 | P2 | Geofence alerts skipped the durable outbox: no retry, duplicates, no in-app row, generic text. | They go through `enqueue_hrms_notification` with one key per event. | Local: function rewired |
| NT-4 | P2 | The push dispatcher stalled once 300 expired receipts were queued. | Receipts older than 24 h are marked `RECEIPT_EXPIRED`. | Code review |
| NT-5 | P2 | Notifications screen: refresh stayed on the current page, no live updates, mark-read errors ignored. | Refresh resets to page 0, new notifications arrive in real time (table added to the realtime publication), and errors are checked. | Typecheck |
| UI-* | P2/P3 | Dashboard: "Updated just now" was hardcoded, stale responses could overwrite newer ones, refresh after a check-in showed cached data, and the stale-session warning was buried. Attendance month race, polling while hidden, clock not ticking, GPS spinner without a timeout, dead office modals. Profile WEEK_OFF vs WEEKLY_OFF and blank fields. Native leave start date blocked back-dated leave. Unbounded task list. Partial task rollback. Visit list blanked by an attendance error. Silent "mark missed". No action for IN_TRANSIT visits. Double-tap duplicate visits. Device and suspicious screens showed "empty" on error. Garbled bullet in Audit Logs. | All fixed (32 items). | Typecheck; no device test |
| AND-1 | P0 (user request) | The APK loaded the hosted site and showed "could not be loaded / Retry" on weak networks. | Android always runs the built-in HRMS. Maps fall back to a text panel if the APK has no Maps key, instead of crashing. The notification-permission banner now works natively. | Typecheck + Android bundle export |

## 4. Offline attendance: how it works now

```
Tap Check In / Check Out with no internet
  -> confirm -> GPS fix -> saved on the phone (QUEUED, shown in an amber banner "not confirmed yet")
  -> internet back / app opened / every 60 s -> SYNCING
  -> server: same office, radius, accuracy and mock rules; GPS fix may be up to 24 h old;
     time recorded = time of the GPS fix; idempotent per operation id
  -> SYNCED (green: "confirmed")  |  SUPERSEDED (day already recorded, nothing changed)
  |  REJECTED (red, with the reason: outside radius / >24 h / fake GPS ...)
```

- A check-out waits for its own check-in, and is cancelled if that check-in was rejected.
- An app killed mid-sync re-sends on the next start. The server de-duplicates.
- An expired session keeps the action until the employee signs in again. A different employee's session never sends it.
- An offline check-out stops tracking on the phone immediately.
- An offline check-in starts tracking once it is synced the same day.
- Offline check-ins are stored with `checkin_source = 'APP_OFFLINE'`, so HR can tell them apart. The sync time is kept in `attendance_offline_operations`.
- Not covered: event check-in/out and field-visit check-in still need internet. On the Attendance screen, an offline check-out after an offline check-in is offered from the Dashboard button.

## 5. Tests actually run

| Test | Result |
|---|---|
| Local PG17 replicas (real definitions from the migrations, dependencies stubbed): events, comp-off, monthly view, two events, tracking guards, notifications, device sessions, offline (11 scenarios) | All pass after the fix. The bug was reproduced first where applicable. Every migration was applied twice. |
| Jest: new `services/outbox/__tests__/DurableWriteOutbox.lifecycle.test.ts` (offline check-in → check-out ordering, duplicate, killed app, rejection cascade, expired session, no-handler spin, subscribers) | 7/7 pass |
| Jest full suite | 299 passed / 28 failed, down from 30. The remaining failures are the same 7 pre-existing contract suites, none caused by this round. The Android-shell contract test was rewritten for the new design. |
| TypeScript (`tsconfig.qa-check.json`) | clean |
| Android JS bundle export | see section 8 |

**Not tested (needs a phone):** background tracking stop/restart on a real device, airplane-mode offline check-in/out and recovery, push delivery, and the built-in Android app UI end to end. Please run the device checklist in section 9 before rolling out to everyone.

## 6. Files changed this round

**Database:** `supabase/migrations/20261012100000_event_attendance_and_comp_off.sql`, `20261012110000_tracking_lifecycle_guards.sql`, `20261012120000_notification_reliability.sql`, `20261012130000_device_sessions_and_fraud_signals.sql`, `20261012140000_offline_attendance.sql`.

**Edge function:** `supabase/functions/notification-dispatch/index.ts` (receipt stall).

**App, outbox and offline:**
- `App.tsx`
- `services/outbox/DurableWriteOutbox.ts`
- `services/outbox/initOutbox.ts`
- `services/offline-attendance.service.ts` (new)
- `utils/offlineAttendanceFlow.ts` (new)
- `components/OfflineAttendanceStatus.tsx` (new)
- `services/attendance.service.ts` (office cache)

**App, tracking:**
- `services/location/backgroundLocationTask.ts`
- `services/location/LocationTrackingCoordinator.ts`
- `services/location/attendanceTrackingLifecycle.ts`
- `services/location/offlineSync.ts`
- `components/AttendanceCheckoutFlow.tsx`

**App, Android:**
- `components/SafeMapView.tsx` (new), plus the 5 native map components
- `app.config.js`
- `components/NotificationAlerts.tsx`

**Screens:**
- `screens/DashboardScreen.tsx`
- `screens/AttendanceScreen.tsx`
- `screens/ProfileScreen.tsx`
- `screens/LeaveScreen.tsx`
- `screens/TasksScreen.tsx`
- `screens/FieldVisitScreen.tsx`
- `components/MeetingDetailModal.tsx`
- `screens/NotificationsScreen.tsx`
- `screens/admin/AdminDeviceSessionsScreen.tsx`
- `screens/admin/SuspiciousAttendanceScreen.tsx`
- `screens/admin/AuditLogsScreen.tsx`

**Tests:**
- `__tests__/productionHardening.test.ts` (Android contract)
- the new outbox test

## 7. Deployment (in this order)

1. **Previous round, not yet run:** migrations `20261009100000` → `110000` → `120000` → `130000` → `140000`.
2. **This round:** `20261012100000` → `110000` → `120000` → `130000` → `140000`. Paste each into the SQL editor and run it on its own.
   - Each one stops with an error and changes nothing if production looks different from what was expected.
   - Each ends with a read-only CHECK query.
3. **Edge functions:**
   - `supabase functions deploy notification-dispatch send-journey-notifications --project-ref fuchvtzbgwzdpzfaizbj`
   - Optional: disable the database webhook that calls `geofence-notification-worker`; it has nothing left to send.
4. Upload `bop-hrms-deploy.zip` to `public_html` (browser users).
5. Install the new APK on phones.
   - Everyone must sign in once more, because the built-in app keeps its own session.
   - From now on, screen changes reach the APK only through a new APK or an EAS Update. Deploying the web zip alone updates browsers only.

**Rollback:**
- Every function change is a `CREATE OR REPLACE`; the previous definition is in the earlier migration file.
- The new tables (`notification_dismissed_keys`, `attendance_offline_operations`) can stay.
- The APK can be downgraded to build 37 (WebView shell).

## 8. Build artefacts

| Artefact | Notes |
|---|---|
| `BOP-HRMS-1.3.0-build38.apk` (108 MB) | EAS build e7ec6364. https://expo.dev/artifacts/eas/QMlbSQ7n62NyNK1lK-sGpSn4GqnjUOtvQwnaDsep_ak.apk. Bundle verified to contain the offline, tracking and map-guard code. |
| `bop-hrms-deploy.zip` (3.6 MB) | Web, 91 files. Bundle verified to contain the new code. |
| `bop-hrms-backend.zip` (632 KB) | All migrations, including the 5 new ones, plus Edge Functions. |
| Previous release, kept | `bop-hrms-deploy-20261009.zip`, `bop-hrms-backend-20261009.zip`, `BOP-HRMS-1.3.0-build37.apk` |
| Android JS bundle export (local) | Compiled: 7.7 MB Hermes bundle. |

## 9. Device checklist before full roll-out

1. Check in, then check out (Going Home). The "Location tracking active" notification disappears within a few seconds.
2. Check in, then swipe the app away and reopen it. Tracking resumes. Check out and reopen: tracking does not come back.
3. Airplane mode, then Check In. You see the amber "saved on this phone" banner. Turn airplane mode off: a green "confirmed" banner appears, and the time shown equals the offline time.
4. Airplane mode for a check-in and a check-out, then kill the app, then go online and open it. Both sync in order.
5. Check in at an event. The employee appears in Today's Present.
6. Open Live Tracking, Field Visits and the In-Transit map. On an APK without a Maps key you see a text panel, not a crash.

## 10. Remaining / not done

- The monthly calendar's v1 RPC still resolves weekly-off by user or office only. It ignores team rules and validity dates, which `resolve_hrms_calendar_day` handles.
- `rpc_submit_leave_request` exists only in `scripts/`, not in a migration. Back-dated leave is allowed on the server, and the app now allows it on every platform.
- The device identifier is an app-storage UUID: it survives sign-out but changes on reinstall. A hardware ID would need a new native module.
- `send-journey-notifications` may duplicate manager pushes if its database webhook is enabled; the webhook settings are not in the repo.
- Duplicate migration version `20261008150000` (two files) blocks `supabase db push`. Running the files manually works.
- The `v_attendance_daily_canonical` view lost `security_invoker` in an earlier migration (`20261008210000`). Employee access was revoked in `20261009140000`, so it is not exposed.
