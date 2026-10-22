# Attendance and Biometric Administration Manual

## Authority model

The official day is obtained through the business-clock/IST path. `CanonicalAttendanceService` calls `rpc_attendance_canonical_range` with a view fallback. The repository contains historical replacement definitions; never publish a fixed app-versus-biometric precedence until the deployed RPC is verified.

## AB-01 Configure attendance policy

**Navigation:** HR Panel → Offices & Settings → Attendance policy.  
**Permission:** `offices.manage`; server configuration mutation.

1. Review allowed office/radius, minimum work duration, earliest checkout, auto-close/night-shift settings and reminder flags.
2. Enter the change through the policy RPC with reason.
3. Confirm returned policy and audit event.
4. Test on staging with a controlled employee/date.

**Failure:** policy save succeeds in UI but check-in behavior is unchanged → verify deployed migration/function and policy cache, then escalate to database owner.

## AB-02 Canonical reconciliation

**Navigation:** HR Panel → Attendance Control or Reports → Attendance/Advanced/Attendance Register.  
**Permission:** scoped `attendance.view`/`attendance.export`.

1. Select IST business date/range and scope.
2. Read canonical rows: official first-in, official last-out, attendance status, source labels, warnings, app/biometric evidence and correction state.
3. Open raw app attendance, device punches, regularization/correction and audit events for discrepancies.
4. Record the canonical RPC/view response and do not infer precedence from historical SQL files.

## AB-03 Online and offline attendance

Employee action → `AttendanceService` → protected check-in/out RPC → attendance/audit tables → canonical response → UI state.

- Check-in validates mock GPS, accuracy, office radius, idempotency and committed timestamp.
- Check-out validates policy/early reason and committed timestamp; undo uses the dedicated undo RPC within server limits.
- Offline check-in/out uses cached offices, captured GPS/time, a durable outbox and replay RPCs; the phone state is not confirmation.

**Recovery:** inspect outbox state, retry/backoff/dead-letter, server response and duplicate operation ID. Do not replay manually with a new ID unless Technical Operations directs it.

## AB-04 Regularization and backdated correction

**Regularization:** only `EARLY_CHECKOUT` and `MISSED_CHECKOUT`; list through admin RPC, review with approve/reject notes.  
**Backdated:** employee/HR correction with reason/evidence/origin, date-window checks, no full-day approved leave conflict where deployed, one open request per employee/day and permanent correction/audit events.

1. Search employee/date.
2. Preview canonical/current state.
3. Submit or review with reason code, time/evidence and idempotency key.
4. For high-risk correction, require second-person approval if the deployed function requires it.
5. Refresh canonical result and audit log.

## AB-05 Biometric secure sync

**Navigation:** HR Panel → SmartOffice Integration/Secure Sync.  
**Permission:** `biometric.manage`.

1. Choose date range and start protected sync with a unique request ID.
2. Poll request/batch status; do not start a second request while the previous state is UNKNOWN/IN_PROGRESS.
3. Confirm transaction status, submitted/inserted/duplicate/rejected counts and batch/source hash.
4. Reconcile device punches to employee identity and canonical attendance.

**Edge Functions:** `biometric-attendance-sync`, `smartoffice-proxy`; database objects include `biometric_sync_requests`, import batches/state and ingest/apply RPCs. Provider credentials/schedules are unverified.

## AB-06 Manual biometric import and matching

**Navigation:** HR Panel → Employee Import → Imported Data → Biometric User Match.  
**Permission:** `biometric.manage`, with `employees.manage` for identity mapping.

1. Upload the source file in the supported format.
2. Parse dates/times; reject invalid date/time rows and future/today rows where the service protects live sessions.
3. Match only by unique SmartOffice employee code; unresolved/duplicate/blank codes remain unmatched.
4. Review matched rows and source file hash; explicitly click Import.
5. Confirm committed response counts: submitted = inserted + duplicates + rejected; record batch ID and errors.

**Recovery:** fix code mapping in Biometric User Match, create a new validated batch, and never overwrite live attendance through a manual import.

## AB-07 Webhook and device operations

`biometric-punch-webhook` requires its configured webhook secret and ingests punch payloads; `BiometricDeviceManagementScreen`/SmartOffice screens expose device/configuration controls where routed. A webhook HTTP success is not a canonical attendance result; verify raw punch, mapping, batch and canonical records.

