# Verification, Traceability and Open Questions

## Verification checklist

- [ ] Confirm applied migration snapshot and canonical attendance RPC/view.
- [ ] Confirm Edge Function deployed versions, schedules, secrets and webhook allowlists.
- [ ] Reconcile OTP phone validation on client and server.
- [ ] Execute Android background tracking, geofence, offline outbox and battery tests.
- [ ] Execute biometric provider/import/webhook mapping test.
- [ ] Execute field evidence upload/review/storage-policy test.
- [ ] Execute leave balance/overlap/approval and task scope tests against staging.
- [ ] Fix `scratch.tsx` and triage 25 failing Jest tests.
- [ ] Produce dated backup/restore evidence.

## Traceability matrix

| Procedure | Primary source | Database/Edge object | Status |
|---|---|---|---|
| Employee OTP | `LoginScreen.tsx`, `AuthContext.tsx` | `otp-auth` | PARTIALLY IMPLEMENTED (validation drift) |
| Online attendance | `attendance.service.ts` | attendance check-in/out RPCs | VERIFIED in source |
| Offline attendance | `offline-attendance.service.ts` | offline attendance RPCs/outbox | VERIFIED in source |
| Canonical attendance | `canonical-attendance.service.ts` | canonical range RPC/view | UNVERIFIED deployment |
| Biometric sync | biometric services | biometric Edge Functions/import RPCs | UNVERIFIED runtime |
| Field visit | `field-visit.service.ts` | field visit mutation RPCs | VERIFIED in source |
| Current-location evidence | `current-location-visit.service.ts` | submit/review RPCs, storage bucket | PARTIALLY IMPLEMENTED |
| Location tracking | `backgroundLocationTask.ts` | `record_location_ping`, tracking tables | VERIFIED source; device UNVERIFIED |
| Leave | `leave.service.ts` | leave submit/review/cancel RPCs | PARTIALLY IMPLEMENTED |
| Tasks | `task-sharing.service.ts` | task hierarchy RPCs | VERIFIED source |
| Events | `event.service.ts` | event check-in/out RPCs | VERIFIED source |

## Unresolved questions

1. Which migration/function versions are actually deployed in each environment?
2. What is the approved canonical attendance source rule as implemented by the live RPC?
3. Are OTP server prefix rules intentionally broader than the UI?
4. What are the production backup/PITR and storage retention owners and restore dates?
5. Which notification channels are mandatory versus best-effort?

