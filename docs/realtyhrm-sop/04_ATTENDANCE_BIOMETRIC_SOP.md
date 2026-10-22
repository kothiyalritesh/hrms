# Attendance and Biometric SOP

## Canonical attendance procedure

1. Identify employee and business date in IST.
2. Read canonical attendance through `rpc_attendance_canonical_range`/the deployed canonical view.
3. Compare app attendance, biometric punches, approved regularization/correction and audit events.
4. Treat the server canonical result (`effective_checkin`, `effective_checkout`, `effective_status`) as official. Do not publish a hard-coded source precedence.

## Online/offline employee actions

Online check-in/out uses protected RPCs and committed timestamp validation. Offline actions are durable, idempotent and replayed via offline RPCs; an offline banner means “saved on device,” not server confirmation.

## Biometric operations

Biometric sync/import/webhook paths are Edge Functions: `biometric-attendance-sync`, `biometric-manual-import`, `biometric-punch-webhook`, with SmartOffice proxy support. Confirm batch/request status, employee-code mapping, punch count and reconciliation before accepting a result. Provider connectivity, schedules and deployed versions remain UNVERIFIED (AT-08).

## Corrections

Use regularization only for early/missed checkout. Use Backdated Attendance for missing check-in, backdated or HR-entry corrections. High-risk correction paths require the server’s second-person approval controls where deployed.

