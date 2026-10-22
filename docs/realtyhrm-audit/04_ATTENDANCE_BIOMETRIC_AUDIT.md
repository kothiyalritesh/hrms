# RealtyHRM Audit — Attendance, Events, Regularization, and Biometric Trace

Status: Static workflow trace completed; live schema, scheduled job, device, and deployment verification pending.  
Primary evidence: `screens/DashboardScreen.tsx`, `screens/AttendanceScreen.tsx`, `services/attendance.service.ts`, `services/offline-attendance.service.ts`, `services/canonical-attendance.service.ts`, `services/attendance-regularization.service.ts`, `services/attendance-correction.service.ts`, `services/event.service.ts`, Attendance Control/Admin screens, biometric services, and attendance migrations/tests.

## 1. Main attendance workflow

```text
Dashboard / AttendanceScreen
  -> GPS capability + current location
  -> AttendanceService.officeCheckIn
      -> active offices cache/table + nearest-office distance/radius
      -> rpc_attendance_checkin_v3(office, location)
      -> attendance_logs + side effects/audit/tracking (server)
      -> response verification + dashboard state

Dashboard / AttendanceScreen
  -> AttendanceService.rpcCheckOut
      -> rpc_attendance_checkout_reconciled(user, attendance, location, reason, idempotency)
      -> policy validation + authoritative checkout + undo token
      -> response must contain committed checkout_time
      -> UI stores short undo state and stops/restores tracking as appropriate

Reports/Admin
  -> CanonicalAttendanceService.list
      -> rpc_attendance_canonical_range (one-day windows, paginated)
      -> server authorization + canonical evidence calculation
      -> mapRow(effective_checkin/effective_checkout/status)
      -> reports/admin/dashboard state
```

### Check-in behavior supported by code

- `AttendanceService.getAllowedOffices` resolves the employee’s policy/office through `get_attendance_policy`; it does not assume a client-selected office is authoritative.
- `officeCheckIn` rejects missing/mocked/low-accuracy GPS, computes nearest active office and radius, reports an outside-office attempt, then calls `rpc_attendance_checkin_v3`.
- The server RPC response is checked for success and a committed timestamp; the client re-reads today’s record if the RPC response omits the timestamp.
- The server-side check-in path may commit an automatic site visit side effect when configured; this is displayed to the user and must be traced against the active migration/function definition.
- Duplicate check-in attempts and stale previous-day open sessions are handled by the service/UI and server RPC; exact behavior requires the final DB definition and tests.

### Checkout behavior supported by code

- `rpcCheckOut` calls `rpc_attendance_checkout_reconciled` with an idempotency key and `GOING_HOME` default reason.
- The service rejects a nominal success without a committed `checkout_time` and keeps the user’s UI active rather than showing an unconfirmed checkout.
- Policy values include minimum work duration, earliest checkout time, auto-close time, night-shift allowance, early-checkout reason requirement, undo window, late threshold, and reminder times (`AttendancePolicy` in `services/attendance.service.ts`).
- `rpc_attendance_undo_checkout` accepts a server-issued undo token. The UI displays a countdown and calls undo only while the token remains valid.
- Offline checkout stops native tracking immediately but remains unconfirmed until the server applies the queued operation.

## 2. Offline attendance

```text
No network
  -> runOfflineAttendanceAction confirmation
  -> cached active office + local GPS validation
  -> DurableWriteOutbox QUEUED item with idempotency key and capturedAt
  -> app/start/reconnect/foreground/60-second drain
  -> assert same employee is signed in
  -> rpc_attendance_offline_checkin or rpc_attendance_offline_checkout
  -> SYNCED or DEAD_LETTER; retryable failures use backoff
```

Evidence: `utils/offlineAttendanceFlow.ts`, `services/offline-attendance.service.ts`, `services/outbox/DurableWriteOutbox.ts`, `services/outbox/initOutbox.ts`, `App.tsx`, and migration `20261012140000_offline_attendance.sql`.

Operational rule: a phone-saved action is not server-confirmed attendance. Employees must wait for sync or report a failed/dead-letter item. The server uses the original captured time and an operation ID so retries are intended to be idempotent.

## 3. Canonical attendance and precedence caution

`CanonicalAttendanceService.mapRow` maps server fields `effective_checkin`, `effective_checkout`, and `effective_status` into official fields. The service requests `rpc_attendance_canonical_range` in one-day windows and pages at 500 rows, with a view fallback only if the RPC is missing. The server applies authorization and combines app, biometric, field-visit, event, regularization, admin, and automatic evidence according to the deployed canonical function/view.

The SOP must state that the server RPC/view is the sole authority for final attendance values. It must not state a fixed precedence order as universal fact because the repository contains multiple historical/replacement canonical definitions and the user-supplied review specifically flags this risk.

## 4. Employee regularization workflow

`AttendanceRegularizationService` exposes only two request types:

- `EARLY_CHECKOUT`
- `MISSED_CHECKOUT`

The active employee UI calls `rpc_request_attendance_regularization`; the review UI calls `rpc_review_attendance_regularization`. This is not a general missing-check-in workflow. Historical or absent-day entries use the Backdated Attendance/correction workflow.

The review screen loads paginated requests through `rpc_admin_list_attendance_regularization`, shows pending/approved/rejected states, and calls the service with approval/rejection notes. The source includes self-review and scope checks in later migrations/tests; final deployed behavior remains pending verification.

## 5. Backdated attendance correction workflow

Migration `20261014120000_backdated_attendance_corrections.sql` defines the newer correction workflow:

1. Search employee and date through `rpc_attendance_correction_employees` and `rpc_attendance_correction_preview`.
2. Submit with reason code, remarks, business date, check-in/check-out, evidence type/source/details, evidence verification, acknowledgement version, office/site, and idempotency key through `rpc_attendance_correction_submit`.
3. The database classifies routine/high-risk cases and holds high-risk ones for a second-person approval where required.
4. Decide, reject, or return for information through `rpc_attendance_correction_decide` / `return`; employees may provide information and cancel within the supported state machine.
5. Applied changes are written atomically to attendance, `attendance_audit_logs`, `hrms_audit_events`, and correction event history; the employee notification path must be verified in the deployed function.

The migration comments document windows, joining-date/future-time restrictions, no full-day approved leave, one open request per employee-day, and permanent correction event history. These are database-contract claims that require migration deployment verification before being presented as live policy.

## 6. Attendance Control and admin correction

`navigation/AdminStackNavigator.tsx` loads `AttendanceControlScreenNew.tsx`. That screen has:

- date presets and date range loading;
- canonical app/biometric views and raw device logs;
- biometric inline matching/reconciliation;
- location timeline access;
- attendance correction modal with IST input, reason, check-in/check-out validation, and `AttendanceService.adminCorrectAttendance`;
- export and warning/update behavior; and
- permission-gated access to Backdated Attendance.

`rpc_admin_correct_attendance` is the direct audited correction RPC. The source explicitly refuses a correction where no app attendance record exists for that day and tells the operator to use regularization/backdated flow for biometric/field-only evidence. This screen must not be described as policy-only; the legacy `AttendanceControlScreen.tsx` must not be treated as the active route without evidence.

## 7. Event attendance workflow

`EventService` is a separate workflow:

1. Admin creates/deletes events through `rpc_admin_create_event` / `rpc_admin_delete_event` with audience selection (employees, teams, departments, or all).
2. Employees see eligible events and assigned announcements from `events`, `event_participants`, and `event_announcements`.
3. Dashboard event attendance calls `rpc_event_check_in_v2` and `rpc_event_check_out_v2` with event location, GPS accuracy, captured time, provider, and mocked-location flag.
4. Server returns geofenced distance, arrival status/late minutes, checkout timestamp, and comp-off eligibility/credit state.
5. Event acknowledgement uses `rpc_acknowledge_event`; event notifications use their Edge Function path.

Event attendance is separate from ordinary office attendance. The final SOP must explain this explicitly and must not advise staff to substitute event attendance for ordinary check-in/out unless the deployed business rule explicitly links the two.

## 8. Biometric and SmartOffice processing

Static source surfaces identified:

- `services/biometric-sync-secure.service.ts` and biometric admin screens for secure sync/status.
- `services/smartoffice.service.ts`, SmartOffice integration/import/match/imported-data screens.
- `services/attendance-import.service.ts` for imported attendance reconciliation and export fields.
- `supabase/functions/biometric-attendance-sync`, `biometric-manual-import`, `biometric-punch-webhook`, and `smartoffice-proxy`.
- `smartoffice_device_logs`, employee-code mapping/audit, attendance audit, and canonical attendance objects in SQL migrations.

The expected operational flow is device/provider → secured Edge Function or import → raw device logs → employee mapping → reconciliation/canonical evidence → attendance/report output. Mapping, duplicate punches, unmatched codes, replay/idempotency, service-role restrictions, and deployed provider behavior require a separate integration test batch.

## 9. Attendance findings

| ID | Status | Finding |
|---|---|---|
| AT-01 | VERIFIED | Employee online check-in/check-out are routed through protected RPCs, not direct client writes in the active service path. |
| AT-02 | VERIFIED | Offline attendance is queued locally with captured GPS/time and idempotency, then synced through dedicated RPCs. |
| AT-03 | VERIFIED | Employee regularization service supports `EARLY_CHECKOUT` and `MISSED_CHECKOUT`; it is not the full absent-day/backdated workflow. |
| AT-04 | VERIFIED | Active Attendance Control route is `AttendanceControlScreenNew`; it includes direct admin correction and biometric reconciliation. |
| AT-05 | VERIFIED | Event attendance has dedicated event tables/service/RPCs and separate check-in/out flow. |
| AT-06 | UNVERIFIED | Final canonical attendance precedence and deployed function/view definition require migration-chain and live-schema reconciliation. |
| AT-07 | PARTIALLY IMPLEMENTED / RISK | The repository contains many historical/replacement attendance definitions and combined SQL snapshots; a single authoritative production definition is not yet proven. |
| AT-08 | UNVERIFIED | Biometric provider, scheduled sync, webhook, mapping, and Edge Function behavior are not verified against deployed infrastructure. |

## 10. Required verification tests

- Run the focused Jest tests for attendance control classification, canonical late calculation, offline queue/lifecycle, event/session notification fixes, and production hardening.
- Run `supabase/tests/correction_scenarios.sql`, permission scenarios, and migration test scripts only against a disposable/staging database with known schema.
- Verify no direct authenticated INSERT/UPDATE path bypasses attendance RPCs in the final deployed RLS state.
- Verify duplicate and idempotent online/offline check-in/out, undo expiry, stale previous-day sessions, no-app-record admin correction, biometric unmatched/mapping, event geofence, and canonical report output.
