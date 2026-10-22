# HRMS Location Tracking — Audit, Gap Report & Roadmap (2026-10-08)

Scope: everything between the phone's GPS chip and the HR screen — Android shell,
browser tracker, background task, offline queue, `record_location_ping`, storage
guard, triggers, sessions, office geofence, site-visit mirror, Live Tracking,
Site Visit Observer, My Team, history and reports.

Method: read the code and the *latest* migration definition of every function;
verified the most serious findings by hand; reproduced the time bugs on a local
PostgreSQL 17 copy. Nothing was run against production.

Already fixed today (for context):

| Fix | File | Status |
|---|---|---|
| Ping time stored 5½ h wrong (UTC saved, IST read) | `20261008160000_location_time_fix.sql` | Run in production, verified (ping_ist = received_at) |
| Stationary heartbeat 60 → 10 min in storage guard | same | Run |
| Live Tracking: LIVE / STALE / NO LOCATION TODAY / NOT TRACKING, ticking ages, change-only popups | `screens/admin/LiveTrackingScreen.tsx` | Needs web build |
| Request Ping → notification → auto location | `20261008150000_location_ping_request_notify.sql`, `components/PingRequestResponder.tsx` | Run 150000 + web build |
| **Regression from the time fix:** site-visit jump check stopped working | `20261008170000_site_visit_speed_check_fix.sql` | **New — run next** (tested: -19740 s → 60 s) |

---

## Phase 1 — implemented (2026-10-08)

| Gap # | Fix | Where |
|---|---|---|
| 1 | Phone sends a fix every 60 s (office) / 15 s (visit) **whether moving or not** (`distanceInterval: 0`); server stores movement only, the rest is a heartbeat | `services/location/backgroundLocationTask.ts`, `20261008180000` |
| 2 | Heartbeat on `tracking_sessions` (`last_seen_at`, `last_fix_*`) for every accepted fix; RPC answers `stored` / `stored_reason` | `20261008180000` §1, §4 |
| 3 | Geofence sweep decides from the newest real fix; silence → `CLOSED / UNVERIFIED_NO_DATA`, no notification | `20261008180000` §6 |
| 4, 12 | Accuracy-aware jump check (> 42 m/s after removing GPS error) for every ping incl. offline; self-correction; Live Tracking shows newest RELIABLE / heartbeat position | `20261008180000` §2, §3, §5 |
| 5 | Site-visit jump check after the time fix | `20261008170000` |
| 6 | Office ↔ visit options applied to the running Android service (options key, restart when changed; visit start/finish triggers it immediately) | `backgroundLocationTask.ts`, `LocationTrackingCoordinator.ts`, `attendanceTrackingLifecycle.ts`, `field-visit.service.ts` |
| 7 | High accuracy (GPS) in every mode | `backgroundLocationTask.ts` |
| 8 | Server silence detection (Android app only): employee at 20 min (max 3/day), team head + alert at 45 min (once/day), auto-resolve | `20261008180000` §7 — **schedule the cron only after the new APK is rolled out** (old APK sends nothing while still) |
| 9 | Office-mode points classified on the phone too | `backgroundLocationTask.ts` |
| 10 | Offline queue: permanent rejects dropped, outages retried, drained after every successful ping and on app start; old attendance no longer stops today's tracking | `services/location/offlineSync.ts` |
| 11 | Late/offline points kept (compared with their own predecessor) | `20261008180000` §2 |
| 13 | No more `TRACKING_SESSION_MISMATCH` on visits | `20261008180000` §4 |
| 15 | Midnight rollover clears only the visit, tracking continues | `backgroundLocationTask.ts` |
| 16 | Sign-out stops the native service | `components/AndroidHrmsShell.tsx` |
| 17 | GPS-off / permission events per hour (was once per day) | `20261008180000` §8 |
| 18 | App start resumes tracking + sends queue without waiting for the page | `AndroidHrmsShell.tsx` |
| 20–23 (part) | Live Tracking: LIVE ≤5 / RECENT 5–15 / STALE >15 min, accuracy ±m, "phone active — weak GPS" vs no data, distance from the shown ping, real office radius, real live count, detail modal never says "Live" for old data | `screens/admin/LiveTrackingScreen.tsx` |
| 26 | `ST_MakePoint($1,$2)` (column type checked) | `20261008180000` §2 |

Tested locally (PostgreSQL 17, UTC session like Supabase): stationary → heartbeat only;
better accuracy kept; 3 km/1 min jump flagged; 400 m/1 min walk kept; low accuracy
1 per 10 min; offline late point kept; offline jump flagged; Live Tracking returns the
heartbeat position; self-correction after a wrong anchor; geofence: outside fix 15 min
later → confirmed + notifications, silence → UNVERIFIED (no notifications); silence
sweep notify → escalate → recover; GPS_OFF twice in one hour → 1 event. Jest location
suites 28/28 (2 new tests).

## Phase 2 — implemented (2026-10-08)

Migration `20261008190000_location_precision_phase2.sql` (run after 180000) + app changes.

| Item | Behaviour |
|---|---|
| Office relationship (D) | Every good fix → `INSIDE` (distance − min(accuracy, 50 m) ≤ radius) / `NEAR` (uncertain, no decision) / `OUTSIDE` (distance − accuracy > radius + 150 m) + distance, stored on the tracking session. Office-exit cycle closes as "returned" only on an INSIDE reading |
| Site relationship (E) | Every good visit fix → `AT_SITE` / `NEAR_SITE` / `APPROACHING` / `LEFT_SITE` + distance to the **selected** site (predefined site coordinates first) |
| #14 Direct field visits | Trip to the site is tracked before any check-in (visit-only tracking session, observer map fed). Site check-in creates the attendance → tracking moves to it automatically; trip session closed (`ATTENDANCE_STARTED` / `FIELD_VISIT_ENDED`) |
| Arrival precision | Automatic arrival needs 2 good fixes inside the site **and** 2 minutes there; inside/departure tests allow for GPS error |
| #19 Site check-in | Server and app: distance − min(accuracy, 50 m) ≤ radius (accuracy still ≤ 100 m, fresh, not mocked) |
| Visit location evidence | `STRONG` (≥ 2 points at site, ≥ 5 min) / `PARTIAL` / `NOT_AT_SITE` / `NONE` + time at site, closest distance, best accuracy, longest gap, fake-GPS / jump flags. Saved on the visit when completed or closed; shown to reviewers in the Visit Review panel (`rpc_field_visit_location_evidence`, viewers of that employee only) |
| Live Tracking | Card shows "In office · 35 m", "At the office boundary (GPS uncertain)", "Outside office · 1.2 km", "On the way to site · 2.3 km", "At site", "Left the site" — "(last known)" when stale |

Tested locally: trip before check-in stored on a visit-only session (APPROACHING
2.2 km → 1.1 km, observer rows written); dwell false at 1.5 min, true at 2.5 min;
site check-in → trip session STOPPED / ATTENDANCE_STARTED; evidence snapshot on
completion, readable by admin, blocked for another employee; office 30 m ±40 →
INSIDE, 140 m ±60 → INSIDE, 200 m ±20 → NEAR, 600 m → OUTSIDE. Patched functions
(arrival, departure, site check-in, office return) were re-created from the real
function bodies and compiled. TypeScript clean; Jest: no new failures.

## Phase 3 — implemented (2026-10-08)

Migration `20261008200000_location_monitoring_phase3.sql` (run after 190000) + app changes.

| Item | Behaviour |
|---|---|
| #22 One freshness rule | LIVE ≤ 5 min · RECENT ≤ 15 · STALE > 15 · NONE — `utils/locationFreshness.ts` and SQL `hrms_location_freshness`, used by Live Tracking, Site Visit Observer (was 5/30 min and 15/60 s) and My Team |
| Observer real time | Ages tick every minute (live → recent → no signal without reload); a person standing still at a site stays live (heartbeat refreshes the observer row); markers show age and fade when stale; clicking a marker opens current data; drawer labels show the real last-fix age; times in IST; "⚠️ Tampered" text fixed |
| #21 Check-in ≠ GPS | Attendance timeline no longer injects check-in/out as green GPS points (they are events); My Team mismatch only from a current position (check-in distance shown on the check-in row); Live Tracking meeting ETA never starts from the check-in point and says "straight line", not "by road" |
| #24 Day story | `rpc_location_timeline`: stays (≥ 5 min, named "Office: …" / "Site: …"), trips (distance, duration), gaps (> 20 min without data), check-in/out events, summary (distance, moving / still / no-data minutes, ignored jump / weak points). Shown above the point log in the location timeline |
| Team heads | `hrms_can_view_location`: whole reporting tree (was direct reports only); `rpc_latest_locations_for_users` feeds My Team with real timestamps |
| Timezone bugs found | My Team and the attendance timeline queried `recorded_at` (IST, no zone) with UTC bounds — evening pings missed — and My Team could not parse the zone-less values. Both now use the server RPCs (fallback uses IST bounds) |
| Movement | Live Tracking shows "Moving · 24 km/h" / "Not moving" for live positions |

Tested locally: scripted day → STAY Office 62 min → TRIP 1.04 km 28 min → STAY
Site: Tower A 60 min → GAP 60 min → STAY Office 30 min, jump excluded, 4 events;
manager two levels up allowed, unrelated employee blocked; freshness bands; My
Team RPC returns LIVE position; observer row refreshed from heartbeat. TypeScript
clean; Jest: no new failures (+3 freshness tests).

## Phases 4 + 5 — implemented (2026-10-08)

Migration `20261008210000_location_edge_cases_phase4_5.sql` (run after 200000) + app changes.

| Item | Behaviour |
|---|---|
| Phone tracking health | The Android app reports permissions (foreground / background / precise), GPS on/off, service running, queued offline points, app + tracking version — on change, otherwise every 10 min (`rpc_report_tracking_health`). New problems are logged in `tracking_health_events` and resolved automatically when fixed |
| HR sees why | Live Tracking card: "GPS turned off", "permission is not Allow all the time", "only approximate location", "tracking service not running", "N locations waiting to upload", "Old HRMS app — ask them to update", "Browser only — sent only while HRMS is open" (#25) |
| Employee sees status | Dashboard (Android app, including inside the app's web view — the warning banner used to be hidden there): green "Location sharing on · last sent 2 min ago", or the problem with a link to the setup screen. Browser users get an honest note that tracking only runs while HRMS is open |
| Rollout-safe silence alerts | Only phones that report the new every-minute tracking are checked, so people on the old app are never alerted for sitting still. The 5-minute job is now scheduled by the migration |
| #27 Attendance view | `latest_ping_at`, accuracy, office status / distance, session status and health reason come from the tracking heartbeat (were NULL → TV display and reports showed everyone stale) |
| Browser pings | Failed pings (bad connection) are kept with their GPS time and resent with the next ping (max 30) instead of being lost |
| Offline queue | 600 points (was 200): ~10 h of office tracking or ~2.5 h of driving offline |
| Battery / data (Phase 5) | A phone that has not moved sends at most every 2 min in the office / 1 min on a visit (fixes are still taken every minute / 15 s; any movement is sent at once) — about half the uploads for desk staff while staying inside the 5-min LIVE window. Server stores movement only (Phase 1), heartbeat for the rest |
| Performance (Phase 5) | Indexes for per-attendance session lookups, the geofence sweep and silence recovery; latest-location queries are per-person lookups (Phase 1/3); raw points are kept 90 days and summarised by the existing hourly maintenance job |

Tested locally: health report stored (unknown keys dropped), GPS-off logged then
resolved; silence sweep alerts the new-app phone only; heartbeats carry device
health; attendance view returns ping time, ±9 m, GREEN, 35 m, ACTIVE,
LAST_PING_STALE. TypeScript clean; Jest: no new failures.

### Known platform limits (cannot be fixed in code)
- Android may still stop the tracking service on some brands (Xiaomi, Oppo,
  Vivo, Realme) or after a reboot until HRMS is opened again. The server now
  notices (silence alert after 20 min → push to the employee, 45 min → team
  head) — push needs the new APK with FCM.
- iPhone / any browser: tracking only while HRMS is open on screen; fake GPS
  cannot be detected in a browser.

## Deployment order (all phases)

1. Supabase SQL editor, in order (skip any already run):
   `130000` → `140000` → `150000` → `160000` ✅ → `170000` → `180000` → `190000` → `200000` → `210000`.
2. Web build + upload (`deploy_bop_web.ps1 -WebBasePath HRMS`).
3. New Android APK (with FCM) — Phases 1, 2 and 4 phone changes live there.
4. Check rollout: the "who runs the new app" query at the end of `210000`.

---

## A. Current situation in plain words

**Working**
- Android app (WebView shell) runs a real native background location service
  (foreground-service notification, survives swiping the app away).
- Every ping carries GPS time, accuracy, speed, heading, mocked flag and a unique
  event id; the server de-duplicates on that id.
- Offline queue on Android (up to 200 points, original GPS time kept).
- Server labels each point: RELIABLE, LOW_ACCURACY, STALE, MOCKED, OUTSIDE_REGION,
  IMPOSSIBLE_SPEED. Mocked points create a fraud event and alert.
- Office exit flow (potential exit → confirmed → reason asked → HR/line manager).
- Site-visit arrival/departure from pings, observer map with accuracy in the drawer.
- Ping time is now correct (after today's fix).

**Partially working**
- Live Tracking freshness (fixed today, but still no accuracy, no mode, no map).
- Site-visit tracking (works only if the employee is also checked in for attendance).
- Office geofence (works, but treats *missing data* as *left the office*).
- Tracking health (GPS off / permission revoked reported once per day; nothing for
  battery saver, killed service, reboot).

**Unreliable**
- **A person sitting still sends no location at all** (phone only reports after
  moving 50 m) → they turn STALE although nothing is wrong.
- Tracking speed/precision changes (office ↔ near site ↔ far) never reach the
  Android service after it first starts.
- Jumps of 1–4 km are accepted as RELIABLE and can become the "current location".
- Browser users (desktop, iPhone, Android without the app) are tracked only while
  HRMS is open on screen.

**Missing**
- Server-side "checked in but no location for N minutes" detection.
- A heartbeat separate from history (so "still here" doesn't need a new stored point).
- Accuracy circle, mode (office/visit) and moving/stationary on HR screens.
- Stays / trips / gaps history (today it is a raw list of dots).
- One shared freshness rule (three screens use three different rules).

---

## B. Gap report (most serious first)

| # | Priority | Problem | Why it matters | Current situation (evidence) | Required improvement |
|---|---|---|---|---|---|
| 1 | P0 | Stationary employee sends nothing | Office staff look "STALE / GPS off" all day; false alerts; HR stops trusting the screen | `backgroundLocationTask.ts:299` `distanceInterval: 50` (and deferred 50 m) → Android delivers no fix until 50 m moved. No heartbeat anywhere | Native: `distanceInterval: 0`, fixed time interval; server decides what to store. Every fix updates a "last seen" heartbeat even when not stored |
| 2 | P0 | Server says "fresh" for points it threw away | `tracking_sessions.last_location_at` is advanced, client deletes the ping from its queue, but no row is stored; geofence & site mirror silently do nothing | `phase_a:994-999` updates session after insert regardless; guard returns NULL (`20260925000000:26-29`) | Insert result checked; dropped-as-duplicate pings update only a heartbeat column; response says `stored:false, reason` |
| 3 | P0 | Missing data = confirmed office exit | One bad ping + phone silence → "left office" notifications to employee, manager, HR | `hrms_geofence_sweep` confirms every POTENTIAL_EXIT > 10 min without checking for later data (`phase_a:872-882`) | Sweep confirms only with ≥2 outside RELIABLE points, or marks the event UNVERIFIED (no notification) when no data followed |
| 4 | P0 | Jumped / low-quality point becomes the "current location" | Map shows employee 2 km away; wrong office/site decision | `rpc_latest_location_pings` excludes only MOCKED (`20261006180000:67`); 70 m/s limit with no accuracy factor | Latest = latest RELIABLE point; show newer unreliable points as "unconfirmed"; speed check accuracy-aware (distance − both accuracies) and 50 m/s cap for road travel |
| 5 | P0 | Site-visit jump check dead after time fix | Jumps on visits counted as arrival/departure | `20260723000000:478` naive-vs-tz subtraction | **Fixed in 170000** |
| 6 | P0 | Mode changes never applied in Android shell | Field visit tracked at office settings; NEAR (12 s, best GPS) never activated | `startNativeTracking` skips if running (`backgroundLocationTask.ts:348-353`); shell sends `tracking.restore` not `updateActiveDestination`; web coordinator no-ops | On every `tracking.restore`/mode change: compare options, `stopLocationUpdatesAsync` + restart when changed |
| 7 | P0 | DISTANT mode uses Balanced (cell/Wi-Fi) accuracy | Points > 100 m → LOW_ACCURACY → dropped by guard → journey never advances | `backgroundLocationTask.ts:286-290`, guard drops accuracy > 100 | Use High accuracy for every mode during working hours |
| 8 | P1 | No server detection of missing location | A dead/killed app cannot report itself; nobody notices | Only client-sent `LOCATION_STALE`; no cron reads `last_location_at` | Cron every 5 min: checked-in + no heartbeat > 20 min → tracking-health "SILENT", employee push, escalate after 45 min |
| 9 | P1 | Attendance mode labels every point RELIABLE on the phone | Client label meaningless | `backgroundLocationTask.ts:159` | Server already recomputes; drop reliance on client label, run phone checks in every mode |
| 10 | P1 | Offline queue gets stuck | One rejected ping (old attendance, expired token, 5xx) blocks all later points until 200-cap evicts it | `Coordinator.ts:575-586` `break`; drains only on network-change event (`:130-133`) | Skip & park permanently-rejected items; retry transient with backoff; drain after every successful live ping and on app foreground |
| 11 | P1 | Out-of-order/offline points silently discarded | Offline route lost when phone reconnects | Guard drops `recorded_at <= latest` (`20260925000000`) | Accept older points into history (flag `sync_source='offline'`), only exclude them from "latest" |
| 12 | P1 | Guard compares against unreliable previous points and ignores accuracy | A 5 m fix dropped because a 90 m fix was "nearby" | `20260925000000:20-29` | Compare to last RELIABLE point; keep the new point if accuracy improved by ≥ 2× |
| 13 | P1 | Site-visit pings rejected when cached session id is old | Every visit ping fails after a session restart | `TRACKING_SESSION_MISMATCH` (`20260723000000:446`) | Resume like the attendance path |
| 14 | P1 | Visit tracking requires attendance check-in | Field staff starting from home get no live tracking | `NO_OPEN_ATTENDANCE` discard (`20260723000000:429`) | Open a tracking session for an active visit even without attendance |
| 15 | P1 | Midnight rollover kills all tracking | Night-shift / late visits stop being tracked, no stop reason | `backgroundLocationTask.ts:150-157` | Clear only the destination, keep attendance tracking |
| 16 | P1 | Logout doesn't stop native tracking | Ex-user device keeps sending | `AndroidHrmsShell.tsx:387-391` | Stop task + clear queue on `auth.clearSession` |
| 17 | P1 | Health events once per type per day | Second GPS-off of the day lost | `journey_events_health_event_idx` (`20260723000000:52`) | Per-occurrence events with open/close (GPS_OFF → GPS_RESTORED) |
| 18 | P1 | No reboot / force-stop restart | Tracking dead until employee opens app | No boot receiver | Restore on app launch automatically (shell calls `restoreIfRequired`) + server SILENT detection (#8) + push "open HRMS" |
| 19 | P1 | Site check-in rejects genuine users | 25 m radius with a 60 m fix fails | distance ≤ radius, no accuracy tolerance (`20260810000000:660-699`) | `distance − accuracy ≤ radius` (accuracy still capped at 100 m) |
| 20 | P2 | HR screens hide accuracy, mode, movement | HR can't judge reliability | `LiveTrackingScreen.tsx:729-733` keeps only lat/lng/time | Show accuracy (±m), mode, moving/stationary, office/site distance from the *same* ping |
| 21 | P2 | Check-in coordinates shown as location | Fake "GREEN" points in history; detail map says "Check-in location" with office coords | `AttendanceControlScreenNew.tsx:347-360`, `LiveTrackingScreen.tsx:1377-1385`, `MyTeamScreen.tsx:152-155` | Show check-in as a separate event icon, never as a GPS point |
| 22 | P2 | Three freshness rules | Same person LIVE on one screen, DELAYED on another | Live 15 min; Observer 5/30 min + 15/60 s; MyTeam own rule | One SQL function `hrms_location_freshness()` + one TS helper |
| 23 | P2 | Detail modal / summary bar show "Live" for any ping | Old data looks live | `LiveTrackingScreen.tsx:1177,1379-1385` | Use freshness state everywhere |
| 24 | P2 | History is a raw dot list | HR can't read the day | `LocationTimelineModal.tsx:108-185` | Stays / trips / gaps timeline |
| 25 | P2 | Browser users foreground-only, no queue, mocked always false | iPhone/desktop users invisible when screen off | `WebForegroundTracker.tsx:48,61` | Honest label "Browser — tracked only while open"; require Android app for field roles |
| 26 | P3 | `ST_MakePoint(,)` in guard source | If PostGIS is ever enabled, every ping insert fails | `20260925000000:33` | Restore `$1,$2` |
| 27 | P3 | Canonical view ping columns hard-coded NULL | Anything using them always shows stale | `phase_a:258-263,414-418` | Fill from heartbeat |
| 28 | P3 | `rpc_latest_location_pings` scans 3 days for all users every poll | Slow as data grows | `20261006180000` | LATERAL latest-per-user on `(user_id, recorded_at desc)` or read from heartbeat table |
| 29 | P3 | Geofence report: errors hidden, CSV button does nothing | Wrong "no events" | `GeofenceEventsReportScreen.tsx:29-33,67` | Show error, implement export, filters |

**Verify in production (read-only)** — `field_visits.checkin_time/checkout_time`
and `attendance_logs.checkin_time/checkout_time` may also be naive timestamps
with the same UTC/IST risk:

```sql
SELECT table_name, column_name, data_type FROM information_schema.columns
WHERE table_schema='public'
  AND (table_name, column_name) IN (('field_visits','checkin_time'),('field_visits','checkout_time'),
       ('attendance_logs','checkin_time'),('attendance_logs','checkout_time'));
```

---

## C. Ideal model — the employee's day

1. **Start work / check in** — check-in needs a fresh fix (≤ 2 min old,
   ≤ 100 m accuracy). Tracking session opens. Android service starts in
   OFFICE mode. Employee sees a green "Location sharing on · last sent just now".
2. **In office** — a fix every 60 s from the phone. Server stores a history point
   only when moved ≥ 30 m (or accuracy much better), but **every** fix refreshes
   the heartbeat → HR sees LIVE all day without thousands of duplicate rows.
3. **Moving** — speed > 1 m/s → phone switches to 15–30 s fixes; every point stored.
4. **Field visit** — starting a visit switches the service to VISIT mode (High
   accuracy, 30 s; 12 s within 1 km of the site). Arrival = 2 reliable fixes within
   `radius + accuracy` and ≥ 2 min dwell.
5. **At site** — stationary heartbeat continues; observer shows AT SITE · LIVE.
6. **Leaving the site** — 2 reliable fixes beyond radius + 100 m → DEPARTED; next
   visit or office return re-classifies mode.
7. **Return to office** — office geofence RETURNED_INSIDE, mode back to OFFICE.
8. **Checkout** — final fix stored, session STOPPED, service stops, card shows NOT TRACKING.

---

## D. Office tracking plan

- Relationship computed **server-side on every fix** (not from attendance):
  office id, distance, `inside / near / outside / unknown`, accuracy, age.
- Inside test with accuracy: inside if `distance + accuracy ≤ radius`; outside if
  `distance − accuracy > radius + 150 m`; anything between = "near / uncertain"
  (no decision, no alert).
- Exit = 2 RELIABLE outside fixes ≥ 5 min apart **and** no field visit active.
  Silence never counts as exit (it becomes tracking-health SILENT instead).
- Return = 1 RELIABLE inside fix.
- Stored on the heartbeat row so HR screens read one place.

## E. Field visit tracking plan

- Visit start → VISIT mode on the phone immediately (fix for #6/#7).
- Tracking works with or without attendance check-in (#14).
- Site relationship per fix: distance to the **selected site coordinates**,
  `approaching / at site / left / unknown`.
- Arrival: 2 RELIABLE fixes inside `radius + min(accuracy, 50)` + 2 min dwell.
  Departure: 2 RELIABLE fixes beyond `radius + 100`.
- Visit evidence summary saved on the visit: arrival time, departure time, time on
  site, closest distance, best accuracy, gaps during the visit, flagged points.
  A visit with *no* location evidence is marked "No location evidence".
- Check-in/out accuracy tolerance as in #19; checkout far from site → risk flag
  (already exists), not a block.

## F. Real-time / last-seen definition

Defined on **last fix received** (heartbeat time, GPS time of the newest valid fix):

| State | Rule | HR shows |
|---|---|---|
| LIVE | ≤ 5 min | green · "Live · 2 min ago · ±9 m" |
| RECENT | 5–15 min | amber-light · "11 min ago · ±18 m" |
| STALE | > 15 min | amber · "Last known 48 min ago" + greyed marker |
| UNAVAILABLE | device told us why: GPS off, permission revoked, service killed, poor accuracy only | red · reason + since when |
| UNKNOWN / NO LOCATION TODAY | checked in, no valid fix today | red · "No location received today" |
| NOT TRACKING | checked out / not working | grey |

Rules:
- Marker never drawn without its age and accuracy; STALE marker greyed and
  labelled "last known".
- Ages tick every minute on the screen (done today).
- Thresholds stored in one config row; one SQL + one TS function used by Live
  Tracking, Observer, My Team, dashboards.

## G. Failure handling

| Failure | What the system does | HR sees |
|---|---|---|
| GPS weak | Point stored as LOW_ACCURACY (history only), not used as "current" | Last good location + "poor GPS since 10:42" |
| GPS off | Native task error → health event GPS_OFF (each occurrence), push to employee | UNAVAILABLE · GPS off |
| Permission revoked | Health event, push to employee "turn location back on" | UNAVAILABLE · permission removed |
| No internet | Queue on phone (keep GPS time), heartbeat stops | RECENT → STALE; when back, route fills in and state returns to LIVE |
| Phone locked / app background | Android service continues | Normal |
| Battery saver / OEM kill | Server SILENT detection after 20 min → push employee; after 45 min → line manager | STALE · "No updates — app may be restricted" |
| Phone/app restarted | App restores tracking on launch automatically | Short gap shown in history |
| Browser only | Tracked only while HRMS is open | "Browser — tracked while open" badge |

Always shown separately: **"Not moving"** (heartbeat fresh, same place) vs
**"No data"** (heartbeat old).

## H. Alert plan

| Situation | Employee | Team head | HR | Management |
|---|---|---|---|---|
| GPS off / permission removed (working hours) | Push immediately | after 30 min unresolved | — | — |
| Silent > 20 min while checked in | Push | after 45 min | daily digest | — |
| Left office (confirmed, no visit) | Reason prompt | yes | yes | — |
| Left site during visit (confirmed) | Prompt | yes | — | — |
| Mocked location | — | yes | yes | — |
| Impossible jump | — | — | weekly review list only | — |
| Low accuracy, stationary, short gaps < 15 min | none | none | none | none |

Anti-spam: one open alert per user per type; re-notify only on state change;
recovery closes the alert silently ("Location restored" only in the screen).

---

## Tracking state machine

```
IDLE ──check-in──▶ OFFICE_TRACKING ──visit start──▶ VISIT_TRACKING(APPROACHING)
                       ▲    │                          │ 2 fixes in radius + dwell
                       │    │ exit confirmed            ▼
                       │    ▼                      VISIT_TRACKING(AT_SITE)
                       │  OUTSIDE_OFFICE                │ 2 fixes beyond radius+100
                       │    │ inside fix                ▼
                       └────┘◀──── visit end ──── VISIT_TRACKING(LEFT_SITE)
any ──checkout──▶ STOPPED

Health overlay (independent of the above, can coexist):
OK | POOR_GPS | GPS_OFF | PERMISSION_DENIED | NETWORK_OFFLINE (queueing)
   | BACKGROUND_RESTRICTED | SILENT (server-detected) 
```

---

## Test matrix

| Scenario | Expected | How to prove |
|---|---|---|
| Office, sitting 2 h | LIVE all the time, ≤ 1 stored point / 10 min | heartbeat age < 2 min; row count |
| Office → walk out 300 m | POTENTIAL_EXIT → CONFIRMED after 2 fixes | geofence_events rows |
| One bad fix then phone off | **No** exit notification; SILENT health | geofence_events UNVERIFIED |
| Start visit | Service options switch to VISIT within 1 min | `tracking.getStatus` options |
| Drive 10 km to site | point every ≤ 30 s, no IMPOSSIBLE_SPEED | location_tracking |
| GPS jump 2 km | flagged, not "current" | Live Tracking unchanged |
| Arrive & stay 30 min at site | AT_SITE, LIVE | observer |
| Airplane mode 20 min while moving | queue; route filled after reconnect, GPS times kept | rows with `sync_source=offline` |
| Bad queued item | later items still upload | queue length → 0 |
| GPS off | UNAVAILABLE · GPS off within 2 min | health event |
| Permission revoked | UNAVAILABLE · permission | health event |
| Force-stop app | SILENT after 20 min, push sent | tracking_health |
| Reboot + open app | tracking resumes without user action | session resumed |
| Battery saver | either continues or SILENT detected | |
| Midnight during tracking | attendance tracking continues | |
| Logout | service stops, queue cleared | |
| Checkout | NOT TRACKING, service stopped | |

---

## I. Roadmap

### Phase 1 — Critical reliability (removes false/missing/misleading location)
1. Run `20261008170000_site_visit_speed_check_fix.sql` (done in code, tested).
2. **Heartbeat**: add `tracking_sessions.last_seen_at / last_fix_accuracy /
   last_fix_lat / last_fix_lng` updated on *every* accepted fix (stored or
   deduplicated); `record_location_ping` returns `stored`/`reason` (#2).
3. **Native capture**: `distanceInterval: 0`, High accuracy in every mode,
   60 s stationary / 15–30 s moving (#1, #7).
4. **Mode switch** in the shell: restart the service when options change (#6).
5. Latest location = latest RELIABLE; accuracy-aware jump check (#4, #12).
6. Geofence sweep never confirms on silence (#3).
→ needs: 1 migration + native change → **new APK**.

### Phase 2 — Office + field precision
Office relationship with accuracy bands (D), visit without attendance (#14),
session-mismatch resume (#13), site check-in accuracy tolerance (#19), visit
evidence summary (E), midnight rollover (#15).

### Phase 3 — Real-time monitoring
One freshness function (F, #22), accuracy/mode/movement on Live Tracking,
Observer and My Team (#20, #23), no check-in coords as location (#21),
real map with accuracy circles, stays/trips/gaps history (#24).

### Phase 4 — Edge cases
Server SILENT detection + escalation (#8), per-occurrence health events (#17),
offline queue fixes (#10, #11), restart on launch (#18), logout stops tracking
(#16), browser-only badge (#25), battery-optimisation guidance screen.

### Phase 5 — Optimisation
Faster latest-location query (#28), retention/summaries, adaptive intervals by
battery, `ST_MakePoint` cleanup (#26), report fixes (#29).

### Honest platform limits
- Android: reliable background tracking needs the HRMS app with "Allow all the
  time" location and battery optimisation disabled for HRMS. Some OEMs (Xiaomi,
  Oppo, Vivo, Realme) still kill services — only server-side SILENT detection
  can catch that.
- iPhone / any browser: tracking only while HRMS is open on screen. It cannot be
  "real-time" there and the UI must say so.
- Mock-location detection is reliable only in the Android app; browsers cannot
  detect it.
