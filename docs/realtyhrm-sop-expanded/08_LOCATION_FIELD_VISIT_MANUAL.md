# Location Tracking and Field Visit Manual

## LT-01 Tracking setup and health

**Navigation:** Home → Location Tracking Setup; employee Dashboard/Field Visits; admin → Live Tracking/In Transit/Site Visit Observer.  
**Permissions:** employee owns own tracking; admin `live_tracking.view`, `field_visits.view`, `activity_analysis.view` as applicable.

1. Check device capability and location permission.
2. On Android, allow background location and battery-unrestricted operation if company policy permits.
3. Confirm active attendance/field-visit destination before expecting tracking.
4. Review tracking health, last ping age, accuracy, battery and signal state.
5. Stop/restore through the app lifecycle controls; do not kill the process while diagnosing.

**Platform result:** native task `hrms-attendance-location-v2` supports background behavior; web/PWA is foreground-only. Actual Android permission/battery behavior remains UNVERIFIED until device acceptance testing.

## LT-02 Location ping lifecycle

Native/web collector → quality/mock checks → offline secure queue if needed → `record_location_ping` → `location_tracking`/`journey_events` → journey/geofence event → notification outbox/dispatch.

The database migration intentionally has no direct insert policy for location tables. A missing row must be diagnosed through RPC response, queue state, tracking session and server stop conditions (no open attendance/visit, closed session or stale >16 hours).

## LT-03 Create and manage field visit

**Navigation:** Home → Field Visits → Log Where I’m Going.  
**Prerequisite:** valid destination coordinates; selected site if using predefined site.

1. Enter visit type, location, address, meeting/contact/project details and notes.
2. Confirm map pin/radius and submit. The service derives origin from latest ping or attendance check-in and calls `rpc_mutate_own_field_visit(CREATE)`.
3. At site, select Check in; server returns `CHECKED_IN` and time.
4. Use navigation/Active Journey and allow tracking while en route/at site.
5. Add checkout notes/evidence if required and select Check out; server must return `COMPLETED` and time.
6. Mark missed only when the visit was not completed and server permits it.

## LT-04 Selected-site and mismatch workflow

Selected-site check-in calls `check_in_field_visit_at_selected_site` and computes distance server-side. If the saved pin is wrong/outside radius:

1. Open current-location submission from the visit.
2. Select actual location/site, enter mismatch reason, purpose, expected duration and declaration.
3. Capture GPS and evidence photo when required; use idempotency key.
4. Submit through `submit_field_visit_current_location_v2` and wait for `PENDING` verification.
5. Reviewer uses `review_field_visit_current_location` and records APPROVED/REJECTED/NEEDS_INFORMATION/FLAGGED with notes.

Do not delete/rewrite the original visit. The child/source relationship is protected and employee UI collapse is only a display behavior.

## LT-05 Evidence upload/retry

`field-visit-evidence-upload` handles the upload boundary; storage bucket/path ownership and image constraints are enforced by SQL/policies. If upload is queued, use the retry queue, confirm object path and server submission response, and avoid duplicate photos. A `PENDING` row is not approval.

## LT-06 Admin monitoring

- **Live Tracking:** inspect current scope, freshness/signal status, last ping and visit state; distinguish LIVE, DELAYED, SIGNAL_LOST and historical.
- **In Transit:** inspect journey origin/destination, route/progress and warning status; do not interpret navigation distance as attendance proof.
- **Site Visit Observer:** review employee/visit cards, current location, signal and verification; preserve privacy and scope.
- **Field Visit Admin:** review daily visits and evidence; use server review actions.
- **Reports → Geofence Events/Field Visits/Tracking:** record date/scope/export and verify output.

## LT-07 Troubleshooting

| Symptom | Diagnostic evidence | Likely cause | Corrective action | Verification |
|---|---|---|---|---|
| No ping | permission state, tracking session, queue, last ping | permission revoked, stopped session, offline | restore permissions/tracking; drain queue | new `location_tracking` row |
| Stale signal | `recorded_at`, accuracy, battery, app state | foreground/web limitation or battery restriction | keep page active/use Android; allow background | fresh ping age |
| Visit cannot check in | GPS accuracy/mock/distance/RPC error | outside radius or invalid coordinates | move/repair site pin/current-location request | `CHECKED_IN` server response |
| Evidence pending | storage object, upload response, review status | queue or reviewer backlog | retry/upload or contact reviewer | status + audit event |

