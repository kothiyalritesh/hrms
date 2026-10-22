# HRMS production-readiness audit — 7 Oct 2026

Read-only audit of the repository (233 migrations, app, edge functions). Nothing in the
app or database was changed by the audit. The biometric checkout rules were executed on a
local throwaway Postgres; everything else is by code inspection and is marked so.

**Important:** the repository may differ from production (some objects were created outside
migrations). Section 2 has read-only queries that confirm the most serious findings in
production. Run them before acting on the P0 list.

---

## 1. Verdict

**Can this HRMS be trusted in production today? Not for location-based enforcement, and not
yet for attendance/leave integrity against a determined employee.**

| Area | Verdict |
|---|---|
| Core: login, profiles, permissions engine, leave ledger, regularization approval, events, tasks | Strong |
| Attendance read path (late, checkout rule, weekly off) | Mostly correct, but stored rows, exports and reports disagree with it |
| Location tracking | Native Android pipeline is well built; **server discards most pings** (see P0-1/P0-2) |
| Site visit | Works up to arrival; no evidence, review or decision loop |
| Site Visit Observer | Reads tables nothing writes; map/KPIs are wrong by construction |
| Geofence exit → reason → escalation | Detection, reason UI and escalation are not connected |
| Fraud / duplicate device / credit score | Database pieces exist; almost nothing produces events |
| Notifications | In-app works; push blocked until the Android app registers FCM tokens |
| Security | **Employees can approve their own leave/regularization and edit their own attendance via the API** |

**Can HRMS reliably know where an employee is, detect movement, prevent fake visits, show it to
observers, escalate and keep evidence?**

| Link in the chain | State |
|---|---|
| Know where the employee is | Only for employees with a field visit that day (P0-1), and possibly not at all if the storage trigger is broken (P0-2) |
| Detect meaningful movement | Yes on the phone (adaptive 12–60 s / 15–100 m). No 15-minute heartbeat: a stationary phone goes silent and looks "stale" |
| Prevent fake attendance / visits | Mock GPS, low accuracy and impossible speed are **tagged** on each ping but nothing happens; check-out of a visit has no location check |
| Show it to observers | Live Tracking screen: yes (from `location_tracking`). Site Visit Observer: no (empty tables) |
| Escalate anomalies | No: office-exit detection has no caller, reason modal unreachable, worker never invoked |
| Preserve evidence | Raw pings 90 days + daily summary; any employee can call the purge function (S-7) |

---

## 2. Confirm in production first (read-only — Supabase SQL editor)

```sql
SELECT
  -- Location
  (SELECT count(*) FROM pg_extension WHERE extname = 'postgis')                                  AS postgis_installed,
  (SELECT max(received_at) FROM location_tracking)                                               AS last_ping_stored,
  (SELECT count(DISTINCT user_id) FROM location_tracking WHERE received_at > now() - interval '7 days') AS people_tracked_7d,
  position('ST_MakePoint(,)' IN pg_get_functiondef('public.adaptive_location_storage_guard'::regproc)) > 0 AS storage_guard_broken,
  (SELECT data_type FROM information_schema.columns
    WHERE table_schema='public' AND table_name='location_tracking' AND column_name='recorded_at') AS recorded_at_type,
  -- Leave status case
  (SELECT string_agg(DISTINCT status, ',') FROM leave_requests)                                  AS leave_status_values,
  -- Direct-API write access for employees
  has_table_privilege('authenticated', 'public.attendance_logs', 'UPDATE')                        AS emp_can_update_attendance,
  has_table_privilege('authenticated', 'public.leave_requests', 'UPDATE')                         AS emp_can_update_leave,
  has_table_privilege('authenticated', 'public.attendance_regularization_requests', 'UPDATE')     AS emp_can_update_regularization,
  (SELECT bool_or(has_function_privilege('anon', p.oid, 'EXECUTE')) FROM pg_proc p
    WHERE p.proname = 'grant_weekly_off_comp_off')                                                AS anon_can_mint_comp_off,
  -- Biometric ingest
  (SELECT count(*) FROM pg_trigger WHERE tgname = 'tr_monday_biometric_credit')                  AS monday_credit_trigger,
  (SELECT count(*) FROM information_schema.columns
    WHERE table_name='smartoffice_device_logs' AND column_name='punch_timestamp')                AS has_punch_timestamp;
```

| Result | Means |
|---|---|
| `storage_guard_broken = true` and `postgis_installed = 1` | No location ping has been saved since 25 Sep |
| `people_tracked_7d` ≈ number of field staff only | P0-1 confirmed |
| `recorded_at_type = timestamp without time zone` | Pings may be skewed by 5.5 h (L-6) |
| `leave_status_values` contains `approved` (lowercase) | Approved leave shows as Absent (A-1) |
| any `emp_can_update_* = true` | S-1/S-2/S-3 confirmed — **fix first** |
| `anon_can_mint_comp_off = true` | S-4 confirmed |
| `monday_credit_trigger = 1` and `has_punch_timestamp = 0` | Every biometric punch insert fails (B-1) |

---

## 3. Critical findings

### P0 — fix before relying on the system

| ID | Area | Problem | Evidence | Fix |
|---|---|---|---|---|
| S-1 | Security | Employees can INSERT/UPDATE their own `attendance_logs` directly (back-date check-in, add past days) | `20260901000000:169-182` re-grants after the revoke in `20260729050000:46` | Revoke INSERT/UPDATE from `authenticated`; drop employee insert/update policies; writes only via check-in/out RPCs |
| S-2 | Security | Employees can insert a regularization already `APPROVED`, or update their own to APPROVED; `attendance_id` not tied to user | `20260901000001:105-118`; view join `20261005040000:163` | Insert forced to PENDING with ownership check; status changes only via review RPC; view must also match `user_id` |
| S-3 | Security | Employees can set their own `leave_requests.status` to approved (no balance deducted) | `20260901000001:194-197` | BEFORE trigger blocking status change outside `rpc_review_leave_request`; insert forced to pending |
| S-4 | Security | `grant_weekly_off_comp_off` is SECURITY DEFINER with no auth check and never revoked: anyone (even anon) can mint comp-off for anyone | `20260928000000_fix_weekly_off_display.sql:351` | `REVOKE ALL … FROM public, anon, authenticated` |
| L-1 | Location | `record_location_ping` stores nothing and tells the phone to **stop tracking** when the employee has no field visit that day — office staff are never tracked | `20260725000000_scope_live_journeys_to_visit_date.sql:62-93` | Fall through to the unscoped function with a null visit; stop only when there is no open attendance |
| L-2 | Location | Storage trigger lost its placeholders: `ST_MakePoint(,)` — every ping insert errors if PostGIS is installed | `20260925000000_adaptive_location_storage_guard_update.sql:33` (correct in `20260803040000:1073`) | Restore `ST_MakePoint($1,$2)` |
| A-1 | Attendance | Canonical view matches `status = 'APPROVED'`; approvals write `'approved'` → approved leave appears as **Absent** in canonical attendance, reports, TV | `20261005040000:205`; `20260806020000:277` | Compare `lower(status) = 'approved'` (view, range core, partial index) |
| B-1 | Biometric | `tr_monday_biometric_credit` reads `NEW.punch_timestamp`, which the table does not have → every device-log insert may fail | `20260926131337:36` | Use `log_datetime`; wrap in exception block; or drop the trigger |
| SV-1 | Site visit | Observer reads `site_visit_live_locations` / `_location_history`; their only writer `record_site_visit_location_batch` has **no caller** | `20260910010000:59`; no reference in app | Write those tables from `record_location_ping`, or point the Observer at `location_tracking` |

### P1 — high impact

| ID | Area | Problem | Fix |
|---|---|---|---|
| L-3 | Location | Health alerts roll back: `location_alerts` CHECK allows only lowercase, `record_tracking_health_event` inserts uppercase (`20260925020000:49`) | One CHECK allowing both, `NOT VALID` |
| L-4 | Geofence | Office-exit detection (`rpc_ingest_location_observation`) has no caller, wrong column names and a cycle-key collision; reason modal never opened; worker never triggered | Evaluate office geofence inside `record_location_ping`; write alert + outbox; open reason modal from open `geofence_events` |
| L-5 | Location | Admin "request ping" is never fulfilled (`useLocationMonitor` is never imported) | Shell listens for `location_ping_requests` / push data and sends a fresh ping |
| L-6 | Location | Mock GPS / impossible speed tagged but produce no fraud event, alert or score change | Insert `attendance_fraud_events` + alert from `record_location_ping` |
| SV-2 | Site visit | `IN_TRANSIT` is never set; Observer status falls through to COMPLETED; "Total visits" counts employees | Status from the visit itself; count visits |
| SV-3 | Site visit | Check-out needs no location, accuracy, dwell time or evidence | Validate like check-in; flag when outside radius |
| SV-4 | Site visit | `auto_checkout_field_visits` not scheduled — open visits never close and block attendance auto-close | Schedule at 20:00 IST; PENDING → MISSED |
| SV-5 | Site visit | No evidence / review / decision for normal visits (only for outside-geofence submissions) | See section 6, item 4 |
| A-2 | Attendance | Unpatched view turns a single punch (or a 12:00 tap) into a checkout; reports/exports/MyTeam/payroll view read this or the raw row | Apply `hrms_canonical_row_patch` inside the view/core |
| A-3 | Attendance | Day-end job only closes today and yesterday — if cron misses a day, stored rows stay open forever while UI shows 20:00 | Close all open rows in a 7–30-day window |
| A-4 | Attendance | Biometric punches **after 20:00** become the checkout (runtime: 20:01, 23:58 kept) | Decision needed (section 7) |
| A-5 | Leave/Reg | Submit/cancel leave and create-regularization RPCs exist only in `scripts/`, not migrations; absent days cannot be regularized; UI hard-codes 23:59 | Move into migrations; allow date-only regularization; user picks time |
| S-5 | Security | `rpc_event_check_out` granted to anon, no `auth.uid()` check — anyone can check anyone out | Add uid check / revoke |
| S-6 | Permissions | Expired temporary GLOBAL grants still give company-wide attendance and live GPS (`rpc_attendance_canonical_range`, `rpc_latest_location_pings` ignore `expires_at`) | Use `hrms_has_global_permission()` |
| S-7 | Permissions | Delegated `teams.manage` (any scope) can rewrite `reports_to` for anyone — the hierarchy wrappers pass no targets | Pass target ids and scope-check |
| N-1 | Notifications | Push blocked: no device has an FCM token (APK without Firebase) | Rebuild Android app with FCM |
| F-1 | Fraud | Two employees on one phone: nothing detects, blocks, notifies or scores it; fraud-event table only in `scripts/` | Trigger on `user_device_sessions` when the same device has another user |
| C-1 | Credit score | Only one deduction rule (geofence rejected), its UI calls a non-existent RPC, no employee/HR screen | Wire triggers; build screens (section 6) |

### P2 / P3 (selected)

- Purge of site-visit history callable by any employee (evidence destruction) — `20260908000000:282`.
- `upcoming_birthdays_30_days` exposes full date of birth to everyone.
- Managers get duplicate leave and regularization notifications; regularization notifies every HR company-wide.
- Missed check-in reminder fires on holidays and weekly offs.
- Weekly-off rules only add days off (global Sunday + personal Tuesday = two days); monthly v1 ignores global/team rules → Sundays absent there.
- `rpc_admin_attendance_daily_v3` late count compares in UTC (late ≈ 0).
- Saturday-WFH config (`work_schedule_configs`) is not read by any calculation.
- InTransit screen uses a UTC day window and a 1000-row cap.
- Observer map: no geofence/accuracy circle; markers may not draw if data arrives before the map.
- `TEAM`/`DEPARTMENT` scopes go stale: `team_id` and `department` have no writer.
- 11 SECURITY DEFINER functions without `search_path`.

---

## 4. Capability matrix

Status: **A** working (runtime evidence) · **A\*** correct by inspection, runtime pending · **B** different approach ·
**C** partial · **D** built, not connected · **E** broken · **F** UI only · **G** backend only · **H** wrong business logic · **I** missing · **J** cannot verify.

| Capability | Status | Note |
|---|---|---|
| App checkout wins over biometric | A | Runtime-tested |
| Biometric ≥ 18:30 becomes checkout (read path) | A (18:30–20:00) / H (after 20:00) | Runtime-tested |
| Auto checkout 20:00 | A (read path) / C (stored row) | Cron covers only 2 days |
| Late after 10:32 | A\* | `>=`: exactly 10:32:00 counts late |
| Weekly off (rules + scopes + overrides) | B | `weekly_off_rules` + `resolve_hrms_calendar_day`; additive-only flaw |
| Saturday WFH (Marketing) | G | Config exists, unused |
| Holidays | A\* | |
| Leave apply / approve / balance | C | Approve correct; submit RPC not in migrations; self-approve hole (S-3) |
| Leave shown on attendance | E | A-1 |
| Regularization approve → attendance → audit | A | Runtime replica |
| Regularization request | D/H | A-5, S-2 |
| Present/absent/late counts agree across screens | E | ≥ 9 different calculations |
| Native background tracking (Android) | A\* | Foreground service + headless task; device test pending |
| Ping storage | E | L-1, L-2 |
| 15-minute heartbeat | H | Adaptive 60 s / 50 m + 60-min dedupe instead; no heartbeat |
| Offline queue / replay | C | 200 pings, encrypted; replay can be dropped by the dedupe |
| Live Tracking screen | C | Correct source; depends on L-1/L-2 |
| Dashboard live count | C | Correct source, but 15-min window vs 60-min dedupe hides stationary staff |
| Office geofence at check-in | A\* | Radius + accuracy enforced server-side |
| Office exit → reason → escalation | D | L-4 |
| Site visit create / arrive (server geofence check-in) | A\* | |
| Manager assigns a visit | I | Employees create their own |
| Site visit evidence (photo) | C | Only on outside-geofence fallback |
| Site visit completion integrity | H | SV-3 |
| Site Visit Observer: KPIs / map / live | E/D | SV-1, SV-2 |
| Site Visit Observer: review queue / actions | I | |
| Visit timeline | D | Modal exists, never opened |
| Fraud events / suspicious attendance screen | D | Nothing writes events |
| Duplicate device detection | D/J | Source table empty |
| Credit / compliance score | D | One rule, no UI |
| Notifications in-app (leave, regularization, tasks, events, visits, holidays) | A\* | Duplicates for managers |
| Push notifications | D | N-1 |
| Birthday notification | F | Screen only |
| Permission engine (scopes, temporary, templates, simulator, audit) | A\* | 56 local tests pass; S-6, S-7 gaps |
| Backend enforcement of permissions | C | New RPCs enforced; legacy table policies leave S-1..S-3 open |
| Employee profile self-edit | A\* | Name + photo only via RPC |
| Department / birthday editing | I / E | No writer; birthday screen does a blocked direct update |
| Anonymous feedback anonymity | A\* | After `20261007143002` (not yet run) |

---

## 5. Source of truth

| Domain | Authoritative source | Competing sources |
|---|---|---|
| Attendance | `rpc_attendance_canonical_range` (core + checkout patch) | Raw `attendance_logs` (exports, MyTeam, payroll view), unpatched `v_attendance_daily_canonical`, `v_attendance_daily_enterprise`, monthly v1–v3, AttendanceIntelligence engine |
| Schedule | `resolve_hrms_calendar_day` | `_at_assignment` variant (ignores profile off day), monthly v1 logic, 3 JS re-implementations, `work_schedule_configs` |
| Location | `location_tracking` via `record_location_ping` | `tracking_sessions.last_location_at` (better heartbeat, unread), `site_visit_live_locations` (unwritten), geofence tables (unwritten) |
| Site visit | `field_visits` | Observer derives per-employee status from empty live tables |
| Leave | `leave_requests` + leave ledger | Case mismatch in views |
| Permissions | `hrms_active_grants` | Direct `user_permissions` checks in 2 RPCs, legacy `has_permission`, manager cache implicit access |
| Notifications | `notifications` → `notification_push_outbox` → dispatcher | Geofence `notification_outbox` (unwritten) |

---

## 6. Top 20 actions (in order)

1. Run the section 2 queries.
2. Close the self-approval / self-edit holes S-1, S-2, S-3, S-4, S-5.
3. Fix the storage trigger (L-2) and stop discarding office staff pings (L-1).
4. Fix leave status case (A-1) and the biometric Monday-credit trigger (B-1).
5. Rebuild the Android app with Firebase (N-1), then real-device test: screen locked, app swiped away, battery saver, no network, reboot, a full field day.
6. Feed the Site Visit Observer from `record_location_ping` and rebuild its status/KPI logic (SV-1, SV-2).
7. Site visit evidence + review: photo on check-in/out, server checks on check-out, risk flags, `review_field_visit` (approve / flag / reject / needs info + notes), review queue and timeline in the Observer.
8. Schedule visit auto-close (SV-4) and attendance day-end over a wider window (A-3).
9. Apply the checkout patch inside the canonical view so reports/exports agree (A-2); move exports, MyTeam and payroll view onto the canonical RPC.
10. Office-exit geofence inside `record_location_ping` → alert → employee reason prompt → manager/HR escalation (L-4).
11. Fraud signals: mock GPS / impossible speed / shared device → `attendance_fraud_events` + alert (L-6, F-1).
12. Credit score: deductions from flagged visits, rejected geofence reasons, shared device, late, absence; employee and HR screens (C-1).
13. Health alerts constraint (L-3) and admin ping requests (L-5).
14. One live-tracking snapshot RPC with one freshness threshold for Dashboard, Live Tracking, TV, InTransit, Observer.
15. Move leave submit/cancel and regularization create RPCs into migrations; allow regularizing an absent day (A-5).
16. Permission gaps S-6 (expiry) and S-7 (hierarchy targets); maintain `team_id`/`department`.
17. Remove duplicate notifications; scope regularization HR fan-out; skip holidays/weekly offs in reminders.
18. Weekly-off: allow a specific rule to replace the global Sunday; use one resolver everywhere; read Saturday-WFH config.
19. Revoke the evidence purge function and birthday view from employees; add `search_path` to the 11 functions.
20. Turn the local permission/attendance tests into a repeatable suite and add site-visit + location scenarios.

---

## 7. Decisions needed from the business

1. **Biometric punch after 20:00** — should a 21:10 punch become the checkout, or is 20:00 the cap?
2. **Late at exactly 10:32:00** — late, or late only from 10:32:01 / 10:33?
3. **Working on a weekly off** — show as WEEKLY_OFF (today) or as Present (with comp-off)?
4. **15-minute heartbeat** — required even when stationary (more battery, proves the phone is alive), or keep movement-only?
5. **Site visit evidence** — photo mandatory on every visit, or per site?

## 8. Not verified

Production schema/migration state (section 2 covers the critical parts), whether the hosted
build has a valid Google Maps key, Supabase webhooks configured outside the repo, and on-device
background survival on real Android phones (Doze, OEM task killers, killed app).
