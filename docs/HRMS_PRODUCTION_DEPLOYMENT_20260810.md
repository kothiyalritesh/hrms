# HRMS Production Deployment - 10 August 2026

## Deployment status

| Component | Status | Production version |
|---|---|---|
| Supabase database | Deployed | `20260810010000` |
| Supabase Edge Functions | Deployed and active | Schema contract `20260810000000` |
| Android/iOS JavaScript update | Published to production and preview | Runtime `1.2.0` |
| Internal Android APK | Built and ready to install | `1.2.0 (11)` |
| BOP web package | Cache-forcing replacement ready to upload | Build `20260810.1` |
| Backend recovery package | Built and ready | Migrations, functions, checklist |

The initial files were uploaded successfully, but production diagnostics found Hostinger serving `sw.js` with a long-lived cache header. Build `20260810.1` adds a versioned service-worker URL and bypasses the native Android WebView cache. Upload the replacement ZIP described below; public verification still showed the initial `20260806.4` worker at the time this report was updated.

## Mobile production release

- EAS branch/channel: `production`
- Production update group: `043e5581-9c98-4f1f-a60d-2b977f613e02`
- Production Android update: `019feaaf-0025-7f03-995e-98e56d9f1a88`
- Production iOS update: `019feaaf-0025-724a-96a2-3ca8749d4b47`
- Preview update group: `b4eea09f-d48d-44c2-b847-e6f4b2c16705`
- Preview Android update: `019feab2-3660-7ed1-b28e-427fe2a25777`
- Preview iOS update: `019feab2-3660-7e71-863a-b21c3be4909a`
- Runtime version: `1.2.0`
- Production dashboard: <https://expo.dev/accounts/kothiyalritesh/projects/re-hrms/updates/043e5581-9c98-4f1f-a60d-2b977f613e02>
- Preview dashboard: <https://expo.dev/accounts/kothiyalritesh/projects/re-hrms/updates/b4eea09f-d48d-44c2-b847-e6f4b2c16705>

Compatible installed production builds download this update through Expo Updates when the application starts with internet access.

The previously distributed internal APK used runtime `1.1.0` and cannot consume a `1.2.0` OTA. Install `BOP-HRMS-1.2.0-build11.apk` once to move those devices to the current runtime.

## Database migrations deployed

1. `20260810000000_field_event_audience_context_notifications.sql`
2. `20260810010000_backfill_event_field_attendance_context.sql`

The migrations preserve historical first-in/last-out values, office assignments, existing Comp-Off balances and biometric attendance records.

## Edge Functions deployed

- `notification-dispatch` version 5
- `biometric-attendance-sync` version 18
- `smartoffice-proxy` version 22
- `biometric-punch-webhook` version 7
- `otp-auth` version 24
- `field-visit-evidence-upload` version 23

## Deployment packages

### Web package

- File: `bop-hrms-deploy.zip`
- Size: `1,848,285` bytes
- SHA-256: `CC78DC3F70B234BC1E7F98BD5B6DF79F4C2D1EEDE04B8D5DC5EC53AF03073301`
- Target: extract inside `public_html` so `public_html/HRMS/index.html` and `public_html/HRMS/_expo/` are side by side.

### Backend recovery package

- File: `bop-hrms-backend.zip`
- Size: `260,925` bytes
- SHA-256: `80A5E6595E151F78C486306E4CE39CAFD941DB3E6C55D8ABEB2EFB0AC14FC02B`
- Contents: production migrations, Edge Functions and release checklist.

### Internal Android APK

- File: `BOP-HRMS-1.2.0-build11.apk`
- Size: `111,069,890` bytes
- SHA-256: `2C08D24C523559BDA6F8DAE4DDD7C6B682C95E14D111B0784BB7EBC996BE1CAC`
- EAS build: `c694d513-f6ba-4eec-9a84-36a0759d62d6`
- Download: <https://expo.dev/artifacts/eas/M0ub205SPwVv2fxx-ZZhhaH5JETC1LdeOynMzAUs3RY.apk>

## Verification

- TypeScript typecheck: passed
- ESLint: passed with two unrelated pre-existing warnings
- Jest: 33 suites and 185 tests passed
- Migration state: local and production versions aligned
- Edge Function state: deployed functions active
- Web production export: completed successfully
- Repository whitespace validation: passed

## Post-deployment checks

After uploading the web package, verify:

1. Open `https://bop.in/HRMS/` in a private browser window.
2. Confirm a logged-in mobile user sees the loader and then the dashboard without an OTP flash.
3. Perform a direct-to-site field visit using a designated test employee.
4. Create a targeted test event and verify one enrolled physical device receives and opens the push notification.
5. Check that attendance reminders are suppressed after check-in and checkout.

The physical-device push receipt check requires a real enrolled production handset. No production employee notification was generated solely for automated verification.

## Rollback notes

- Expo OTA: republish the previous compatible update to the `production` channel.
- Web: restore the previous `/HRMS/` hosting archive.
- Database migrations are additive and preserve historical records. Do not destructively roll them back; deploy a corrective forward migration if necessary.
- Edge Functions can be redeployed from the previous source revision independently of the database.
