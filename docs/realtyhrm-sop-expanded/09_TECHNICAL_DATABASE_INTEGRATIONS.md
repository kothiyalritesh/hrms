# Technical Operations, Database and Integrations Manual

## T-01 Runtime architecture

`App.tsx` composes ErrorBoundary → AuthProvider → LocationTrackingProvider → durable outbox/push/offline evidence/web tracker → navigation. Supabase is accessed through `lib/supabase.ts` using Auth, PostgREST, RPC, Realtime and Storage. Edge Functions provide OTP, biometrics, SmartOffice, evidence, notifications, auto-end and auth revocation.

## T-02 Database change control

1. Identify the migration file and all later `CREATE OR REPLACE`/`DROP` definitions for the object.
2. Compare function signature, `SECURITY DEFINER`, `search_path`, grants/revokes, RLS/policies, triggers and dependent views.
3. Confirm the migration is applied in the target environment; filenames alone are insufficient.
4. Run read-only schema/object checks in staging, then an approved migration with rollback plan.
5. Record migration ID, object signature, deployment timestamp and verification query.

Historical/combined SQL under `_superseded`, `manual`, `_temp`, root scripts and generated reports is evidence only until deployment provenance is established.

## T-03 Object/domain map

| Domain | Primary objects | Write boundary |
|---|---|---|
| Identity | `profiles`, auth users, device sessions, push tokens | OTP/auth/session RPCs and Edge Functions |
| Attendance | `attendance_logs`, device/biometric logs, canonical views/RPCs, audit/correction tables | attendance, correction, import and canonical RPCs |
| Location | `tracking_sessions`, `location_tracking`, `journey_events`, `field_visits`, audit tables | `record_location_ping`, field-visit RPCs, evidence functions |
| Leave/work | leave requests/balances/calendar, tasks/hierarchy, events | leave/task/event RPCs and scoped table policies |
| Communication | notifications/outboxes/delivery logs, support tickets, feedback | notification enqueue/dispatch, ticket writes, review RPCs |
| Authorization | permission catalog/grants, scope helpers, RLS | grant/revoke/role-template RPCs and server checks |

## T-04 Authorization and RLS

Canonical client keys are in `constants/permissionCatalog.ts`; aliases are normalized by `canonicalPermission`. `usePermissions` retrieves `get_my_permissions`, while server checks use `hrms_has_permission`, `hrms_require_permission`, scope helpers and RLS. Data-admin roles implicitly hold non-permission-management capabilities in the client catalog; deployment must confirm the same server rule. Never treat a hidden tab as security.

## T-05 RPC and response handling

Critical client services validate the response, status, ID, timestamp and transaction state. When debugging:

1. Record RPC name/signature, actor, business date and idempotency/request ID.
2. Capture safe error code/message and whether a row/audit event was committed.
3. Check migration signature/grants and RLS scope.
4. Verify the UI refreshes from server data rather than cached optimistic state.

## T-06 Edge Function contracts

| Function | Purpose | Boundary/verification |
|---|---|---|
| `otp-auth` | request/verify OTP and magic-link token | phone/profile/rate/attempt checks; client/server validation drift |
| `biometric-attendance-sync` | protected sync and batch status | request ID, claim lock, service role, committed counts |
| `biometric-manual-import` | validated punch import | batch/source hash and transaction status |
| `biometric-punch-webhook` | device webhook ingest | configured webhook secret and ingest RPC |
| `smartoffice-proxy` | provider proxy | Authorization/secret and vault/config dependency |
| `field-visit-evidence-upload` | evidence upload | authenticated session, path ownership, bucket policy |
| `notification-dispatch` | push outbox delivery | delivery log, retries, idempotency |
| `geofence-notification-worker` | geofence outbox | notification row and delivery status |
| `send-event-notifications` | event announcements | event/audience and notification row |
| `send-journey-notifications` | journey events/deep links | webhook secret and journey event |
| `daily-checkin-alert` | scheduled check-in alert | scheduler and notification enqueue |
| `auto-end-time` | automatic attendance close | policy/closed-session audit |
| `revoke-user-auth` | auth/session revocation | authorized caller and auth state |

Deployed versions, schedules, environment values and provider credentials require environment inspection.

## T-07 Queue and idempotency operations

Durable outbox, offline location queues, current-location queues, notification outboxes and biometric request tables have retry/permanent-failure states. Use the original request/idempotency ID to inspect/retry. Do not duplicate a write by changing the ID unless the server has rejected the original permanently.

## T-08 Integrations

- SMS/OTP: provider response is separate from authenticated session confirmation.
- WhatsApp: support notifications are best-effort after ticket persistence.
- SmartOffice/biometric: code mapping and batch reconciliation are mandatory.
- Maps: API key restrictions, web path and platform package restrictions must be checked; values are intentionally excluded from documentation.
- Push/FCM/Expo: token registration, outbox, delivery and retry must all be checked.
- Mailchimp and other marketing integrations are not part of attendance authority and require provider/config verification.

## T-09 Technical escalation packet

Include environment/build ID, migration/function version, RPC name/signature, request/idempotency ID, safe error, UTC/IST timestamp, table/audit row IDs and a redacted reproduction. Never include access/refresh tokens, service keys, webhook secrets or raw employee location history.

## T-10 Security verification before relying on controls

Run read-only checks in the target database for `has_table_privilege('authenticated', ...)`, RLS policies on `attendance_logs`, `leave_requests`, `attendance_regularization_requests`, `profiles`, `tasks`, `notifications`, `field_visits` and `location_tracking`, and non-internal triggers on `tasks`/attendance tables. Prior production audit documents reported direct-write/self-approval risks; current source alone cannot prove those are absent in the target environment. If any employee can update status/checkout or mint approval directly, stop relying on the affected workflow and escalate as P0.

```sql
select tablename, policyname, cmd, roles
from pg_policies
where schemaname = 'public'
  and tablename in ('profiles','attendance_logs','leave_requests',
                    'attendance_regularization_requests','tasks',
                    'notifications','field_visits','location_tracking')
order by tablename, policyname;

select has_table_privilege('authenticated','public.attendance_logs','UPDATE') as can_update_attendance,
       has_table_privilege('authenticated','public.leave_requests','UPDATE') as can_update_leave,
       has_table_privilege('authenticated','public.attendance_regularization_requests','UPDATE') as can_update_regularization;
```

Run only in the intended environment, record results without employee rows, and never paste credentials or tokens into the incident record.

