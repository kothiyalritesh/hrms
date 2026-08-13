# Production Release Checklist

The source and web artifact are ready for release, but production is not
complete until the following external actions have been performed.

## 1. Rotate and restrict credentials

- Rotate any SmartOffice and SMS credentials that appeared in an older browser
  build or document.
- Configure `SMARTOFFICE_URL`, `SMARTOFFICE_API_KEY`, and
  `SMARTOFFICE_API_ACCOUNT_NAME` only in the `smartoffice-proxy` Edge Function.
- Configure `SMS_OTP_API_KEY` only in the `otp-auth` Edge Function.
- Restrict the browser-visible Google Maps key to exact production origins and
  only the required Maps APIs. Add quota and billing alerts.
- Confirm the Expo public Supabase value is the valid anon/publishable key, not
  a service-role key.

## 2. Configure the biometric scheduler secret

Generate one high-entropy value and configure the same value as:

- the `BIOMETRIC_CRON_SECRET` Edge Function secret; and
- the Supabase Vault secret named `BIOMETRIC_CRON_SECRET`.

Never place this value in an Expo public environment variable.

## 3. Deploy database migrations

Review the dry run, back up production, and then apply:

```bash
npx supabase db push --linked
```

The pending production-hardening sequence is `20260729000000` through
`20260730260000`. It includes protected profile/attendance/field-visit/
configuration/tracking mutations, transactional checkout reconciliation,
atomic biometric mapping, idempotent employee CSV import, the authoritative
employee monthly-attendance calendar RPC, fail-closed attendance radii, and
active-office geofence validation. The final migrations also add:

- transactional and idempotent hierarchy imports keyed only by employee number
  or verified email;
- authoritative, idempotent biometric-import counts and file checksums;
- included effective-dated attendance reconciliation definitions;
- private employee profile pictures;
- transactional automatic site visits and manager warnings during check-in.
- bounded historical biometric imports that accept an inactive employee only
  inside verified employment dates and echo the exact batch/file identity;
- a frontend/backend release contract and authoritative protected biometric-sync
  confirmation. Production clients remain blocked until
  `rpc_get_release_contract` confirms schema version `20260730260000` and all
  four runtime-critical Edge Functions confirm the exact versions in
  `release.config.json`;
- confirmed Field Visit state transitions, retry-stable biometric requests,
  server-policy attendance warnings, and server-authoritative late status;
- identity-bound current-location evidence confirmation with orphan cleanup and
  exact fraud-review confirmation;
- one protected, indexed administrator dashboard summary RPC.

After deployment, run:

```bash
npx supabase db lint --linked --level error
```

Verify RLS and grants with employee, manager, HR, administrator, anonymous, and
service-role test identities.

## 4. Deploy Edge Functions

Deploy the changed/new functions:

```bash
npx supabase functions deploy smartoffice-proxy
npx supabase functions deploy biometric-attendance-sync
npx supabase functions deploy biometric-manual-import
npx supabase functions deploy otp-auth
npx supabase functions deploy send-event-notifications
npx supabase functions deploy send-journey-notifications
npx supabase functions deploy field-visit-evidence-upload
```

Run one administrator-triggered biometric sync and one manual spreadsheet
import. Confirm batch history, idempotency, failure history, and rollback in a
staging project before production.

## 5. Web release

- Root hosting: `npm run export:web`.
- Subfolder hosting: set `EXPO_PUBLIC_WEB_BASE_PATH=/HRMS/` (or the exact
  case-sensitive required path) before export. The same value configures Expo
  assets, lazy chunks, router prefixes, manifest, service worker and packaging.
- Do not package a root build inside a subfolder, or a subfolder build at root.
  `prepare_bop_hosting.ps1` now rejects that mismatch.
- Serve over HTTPS and configure SPA fallback to `index.html`.
- Confirm `manifest.webmanifest`, `sw.js`, and `icon.png` are served under the
  selected base path.
- Confirm the supplied Apache `.htaccess` security headers are present in live
  responses. Reproduce equivalent headers if the production host is not Apache.
- Confirm missing JavaScript, CSS, image and font URLs return 404/502 and never
  `index.html`.

## 6. Android release validation

Build the signed preview APK first, then test on physical Android 11, 13, and
14+ devices:

- foreground, background, screen-locked, and app-terminated tracking;
- foreground-service notification visibility;
- background-location permission denial/recovery;
- GPS off, permission revoked, mock location, poor accuracy, and stale fixes;
- 1 km, 500 m, arrival, check-in, checkout, and policy reminder notifications;
- offline evidence persistence, reconnect retry, and authentication expiry;
- battery optimization and OEM task-killer behavior;
- check-in/checkout idempotency and server-authoritative success messages.

Only promote the signed production app bundle after these tests pass.

## 7. Historical attendance backfill

- The Reports-screen Combined Sheet is disabled because the legacy generator
  was removed; it did not use the authoritative holiday, weekly-off,
  leave-type, and missing-punch rules.
- Attendance Control permits an application-attendance workbook for the
  server-authoritative current business day only.
- The Advanced Attendance screen now reads the included protected
  `rpc_admin_attendance_reconciliation` report. The RPC fails closed when any
  requested date lacks verified joining/exit, assignment, policy, or calendar
  history.
- Before payroll use, backfill and mark verified the effective-dated
  `employee_assignment_history`, `attendance_policy_history`, and
  `office_calendar_history` records for every requested historical date.
- Validate former employees, pre-joining dates, transfers, manager changes,
  leave types, holidays, weekly offs, and missing punches against signed HR
  source records in staging.
- Raw biometric-log export remains diagnostic evidence; it is not a payroll
  attendance report.

## 8. Build identity and private media

- Release UI version: `1.1.0`; default build ID: `20260731.4`. CI may override
  `EXPO_PUBLIC_BUILD_ID` with a unique immutable release identifier.
- Confirm the `profile-pics` bucket is private after migration.
- Confirm an employee can create a signed URL only for
  `avatars/<their-auth-uid>.<extension>` and cannot read another employee's
  object.
