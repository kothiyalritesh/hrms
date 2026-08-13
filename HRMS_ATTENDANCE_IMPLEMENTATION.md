# Attendance, biometric, field-visit and storage implementation

## Deployment checklist

1. Back up the Supabase database and record the current `rpc_get_release_contract()` response.
2. Review existing duplicate attendance rows. The migration requires the already-established unique `(user_id, date)` contract and does not delete history.
3. Apply `20260803040000_attendance_field_biometric_location_optimization.sql` in staging, then run the checkout, biometric, field-visit, RLS and retention acceptance suites against staging data.
4. Add the Edge Function secret `SMARTOFFICE_WEBHOOK_SECRET` in Supabase. Never expose it as an `EXPO_PUBLIC_*` variable.
5. Deploy `biometric-punch-webhook`, followed by the version-aligned `biometric-attendance-sync`, `smartoffice-proxy`, `otp-auth`, and `field-visit-evidence-upload` functions.
6. Configure SmartOffice to POST device ID, employee code, punch timestamp, direction and source event ID to `biometric-punch-webhook`. Keep the existing scheduled polling function as fallback.
7. Confirm `rpc_get_release_contract()` reports schema `20260803040000` and all five Edge Function versions from `release.config.json`.
8. In Google Cloud Console, restrict the web key to production HTTPS referrers, the Android key to the package and signing SHA-256 certificate, and enable only Maps JavaScript, Places, Geocoding and the APIs actually used. Configure quotas and billing alerts.
9. Confirm `public/.htaccess` permits only required Supabase and Google endpoints. `api.ipify.org` is intentionally absent and `expo-network` was removed.
10. Verify the evidence bucket is private and signed-URL access works. Existing upload code compresses before upload, hashes offline evidence and stores only paths.
11. Test Android foreground/background permission, mock-location rejection and local tracking shutdown after server checkout. Test the PWA notice and foreground-only behavior separately.
12. Publish the frontend only after the database and Edge Functions are live; the release gate rejects a known-incompatible contract.
13. Monitor `maintenance_job_runs`, biometric reconciliation counts, checkout failures, Edge Function errors and database query plans for the first release window.

## Rollback notes

This migration is intentionally additive. Do not drop the new audit, punch, session or route-summary tables during an incident; they may already contain operational evidence.

- Frontend rollback: redeploy the previous frontend and its matching `release.config.json` only after restoring the previous `rpc_get_release_contract()` definition.
- Checkout rollback: restore `rpc_attendance_checkout_reconciled(uuid,jsonb,text,boolean)` from migration `20260729070000_transactional_checkout_reconciliation.sql` and restore the corresponding previous service call. Keep `attendance_action_requests` and audit data read-only.
- Field-visit rollback: restore `rpc_mutate_own_field_visit(text,uuid,jsonb)` from `20260729080000_protected_field_visit_mutations.sql`. Preserve the additive destination/state columns.
- Biometric rollback: disable the SmartOffice webhook, leave scheduled polling paused, and process the reconciliation queue manually. Do not delete raw punches or mappings. The legacy rollover auto-checkout job must not be re-enabled unless the company explicitly approves that policy.
- Maintenance rollback: unschedule `hrms-bounded-maintenance`. It is safe to rerun; each delete is retention-based and batch-limited, but a paused job preserves all remaining raw data.
- PostGIS rollback: leave the geography column and GIST index in place. They do not change coordinate JSON contracts and dropping them creates unnecessary table work.
- Device-session rollback: stop calling the device-session RPCs; preserve rows for audit. Explicit Supabase logout remains functional.

## Modified files

- `App.tsx` adds the online/offline banner and defers only network-failed compatibility checks.
- `components/AttendanceCheckoutFlow.tsx` implements the four-option checkout modal, fresh GPS confirmation, double-tap protection and server-confirmed success.
- `components/CurrentLocationFallbackModal.tsx` replaces the web module that bundled an unused public-IP lookup.
- `components/DeviceSessionsModal.tsx` displays this device, other sessions, activity and revocation controls.
- `components/LocationSearchInput.tsx` adds three-character/400 ms search gating, six-result limits, timeouts, bounded cache, session tokens, stale-response rejection and retry UI.
- `components/MeetingDetailModal.tsx` opens the selected site, meeting or office flow directly and carries destination provenance.
- `components/SitePickerModal.tsx` requires a destination confirmation card for searched/map/current/saved destinations.
- `contexts/AuthContext.tsx` validates/registers device sessions and clears tracking, channels and employee queues on logout.
- `lib/supabase.ts` keeps persistent refresh sessions and enables URL session detection on web.
- `navigation/HomeStackNavigator.tsx` removes `checkoutIntent` and adds destination-creation intent.
- `screens/AttendanceScreen.tsx`, `screens/AttendanceScreenWeb.tsx`, and `screens/DashboardScreen.tsx` invoke the same server-authoritative checkout flow and remove legacy direct-checkout bypasses.
- `screens/FieldVisitScreen.tsx` consumes typed visit intents and explicitly warns that PWA background tracking is unavailable.
- `screens/ProfileScreen.tsx` exposes device-session management.
- `screens/admin/BiometricUserMatchScreen.tsx` reprocesses historical unmatched punches after an admin saves a mapping.
- `services/attendance.service.ts` sends attendance ID, complete GPS evidence, reason and idempotency key, and requires a committed server timestamp.
- `services/current-location-visit.service.ts` securely deletes user evidence queues at logout.
- `services/device-session.service.ts` creates a persistent opaque device ID and provides session list/revoke/close operations without storing refresh tokens.
- `services/field-visit.service.ts` requires valid destination coordinates, accepts zero coordinates, records provenance and adds creation idempotency.
- `services/location/secureQueue.ts` securely clears encrypted pending pings at logout.
- `utils/gps.ts` implements finite/range/freshness/mock/accuracy validation and best-of-three current GPS sampling.
- `supabase/migrations/20260803040000_attendance_field_biometric_location_optimization.sql` contains the authoritative schema, RPCs, RLS, indexes, PostGIS path, adaptive storage trigger and maintenance jobs.
- `supabase/functions/biometric-punch-webhook/index.ts` provides authenticated near-real-time, batch-bounded, idempotent punch ingestion.
- `supabase/functions/biometric-attendance-sync/index.ts` ingests every raw punch before retaining the protected legacy batch for admin rollback visibility.
- `supabase/functions/smartoffice-proxy/index.ts`, `supabase/functions/otp-auth/index.ts`, and `supabase/functions/field-visit-evidence-upload/index.ts` now advertise backend schema `20260803040000`.
- `release.config.json` advances the build/schema contract and includes the webhook function.
- `package.json` and `package-lock.json` remove unused `expo-network`/browser IP lookup code.
- `.gitignore` excludes local `.expo-check-*` production-export verification output.
- `__tests__/attendanceWorkflow.test.ts`, `utils/__tests__/gpsValidation.test.ts`, and `__tests__/productionHardening.test.ts` cover the new contracts and release inventory.
