# Database, Authentication Boundary and Integration Audit

## Database architecture

The application uses Supabase/Postgres through `lib/supabase.ts`. Reads are a mix of typed table/view queries and server RPCs. Writes for attendance, permissions, field visits, events, corrections, regularization, and location tracking are predominantly RPC-mediated. The migration directory contains 262 SQL files, including replacement migrations; a filename alone is not proof that a migration is applied.

Key data domains observed:

| Domain | Tables/views/functions observed |
|---|---|
| Identity | `profiles`, `auth.users` through OTP Edge Function, device sessions, push tokens |
| Attendance | `attendance_logs`, biometric punch/device logs, canonical views/RPCs, audit logs, corrections/regularizations |
| Location | `location_tracking`, `tracking_sessions`, `journey_events`, `field_visits`, predefined sites |
| Leave/tasks | `leave_requests`, `leave_balance`, `holiday_calendar`, `weekly_off_rules`, `tasks`, hierarchy RPCs |
| Notifications | `notifications`, `notification_outbox`, push outbox/delivery tables |
| Events/support | `events`, participants/announcements/checkins, `support_tickets` |
| Authorization | permission catalog/grants, `authorized_user_ids`, scope/RLS helper functions |

## Authentication and service boundaries

The active login path is `otp-auth` Edge Function plus Supabase `verifyOtp` magic-link token exchange. The application stores sessions through Supabase/secure storage and closes device/push/tracking state on logout. `otp.service.ts` contains a separate TOTP/backup-code implementation that is not the LoginScreen path and should be treated as a parallel/legacy capability until explicitly activated.

Edge Functions use either the caller Authorization header or a protected service-role client. Webhook functions require dedicated headers/secrets (biometric sync and SmartOffice/journey webhooks). Documentation and support procedures must never copy those secret values.

## Deployment and configuration evidence

`package.json` exposes Expo, typecheck, Jest, web export/deploy, EAS preview/update and production update commands. `release.config.json` declares build `20261006.2`, required schema `20260810000000` and Edge Function versions from August 2026, while migration filenames inspected extend through October 2026. This is a release metadata drift risk; it requires release-owner confirmation before deployment. No `supabase/config.toml` was present at the inspected path, so local CLI project linkage cannot be claimed.

`app.config.js` contains a Google Maps configuration fallback. Its value is intentionally omitted from this documentation; production deployments must use restricted, environment-managed keys and verify referrer/package restrictions.

## Integration inventory

- SMS/OTP: `otp-auth` and `services/sms.service.ts`.
- WhatsApp: `services/whatsapp.service.ts`, used for support and selected notifications.
- SmartOffice/biometric: `biometric-attendance-sync`, `biometric-manual-import`, `biometric-punch-webhook`, `smartoffice-proxy`, plus `services/biometric-sync-secure.service.ts` and `smartoffice.service.ts`.
- Push/geofence/journey: `notification-dispatch`, `geofence-notification-worker`, `send-journey-notifications`, Expo notification registration.
- Maps/location: Expo location/native bridge, Google Maps links/configuration, server-side distance functions.

## Findings

| ID | Finding | Classification | Evidence |
|---|---|---|---|
| DB-01 | Supabase/Postgres is the application system of record; critical writes are RPC-mediated. | VERIFIED | `lib/supabase.ts`, services and migrations |
| DB-02 | Migration history contains multiple replacements; applied production schema is not verified in this audit. | UNVERIFIED | `supabase/migrations` |
| DB-03 | Release required schema/Edge versions are older than the newest migration filenames. | DEFECTIVE (release-control risk) | `release.config.json` vs migration directory |
| DB-04 | OTP client validates Indian mobile format, but server normalization accepts any ten digits; contract drift exists. | DEFECTIVE | `LoginScreen.tsx`, `supabase/functions/otp-auth/index.ts` |
| DB-05 | Webhook/service-role boundaries are present; secret values were not disclosed. | VERIFIED | Edge Function headers/client construction |
| DB-06 | Maps fallback key is present in app configuration and needs restriction/secret-management review. | PARTIALLY IMPLEMENTED | `app.config.js` |

