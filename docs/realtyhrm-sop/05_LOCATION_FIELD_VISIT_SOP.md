# Location and Field-Visit SOP

## Start tracking

On Android, grant foreground/background location permissions and keep the native bridge enabled. On web/PWA, keep the page active; reliable locked-screen tracking is not implemented. Tracking starts/restores with open attendance or an active field visit and stops after closure/server stop.

## Field visit lifecycle

1. Create a visit with a valid map/predefined-site destination.
2. Check in through the server mutation; confirm `CHECKED_IN` and server time.
3. Allow tracking to update the visit/journey state. Record meeting notes and optional evidence.
4. Check out; confirm `COMPLETED` and `checkout_time`. Mark `MISSED` only when appropriate.

## Location mismatch/current-location evidence

If outside the saved site radius or the pin is wrong, use current-location submission with reason, declaration, GPS and evidence photo if requested. The submission is a reviewable child record; wait for `APPROVED`/other review status. Do not delete or overwrite the source visit.

## Monitoring

For missing pings inspect tracking session, outbox, `location_tracking`, `journey_events`, geofence outbox and notification delivery rows. Server RPC and database records outrank UI badges.

