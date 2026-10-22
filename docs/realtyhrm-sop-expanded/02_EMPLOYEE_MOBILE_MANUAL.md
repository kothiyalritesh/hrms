# Employee Mobile Application Manual

**Scope:** Android/iOS employee workflow through `MainTabNavigator` and `HomeStackNavigator`. The server determines authorization; this manual does not treat a visible button as permission.

## Common prerequisites

- Active profile and valid OTP session.
- Network for server confirmation; device date/time and location services enabled for attendance/visits.
- Android background location permission is required for reliable locked-screen tracking. iOS/web behavior requires separate verification.

## M-01 Sign in and sign out

**Navigation:** App launch → Login → phone → OTP.  
**Permission:** authenticated profile for all employee operations.

1. Enter the ten-digit Indian mobile number accepted by `LoginScreen` (`^[6-9]\\d{9}$`).
2. Select **Send OTP** and enter the six-digit code.
3. Wait for the authenticated home shell. Do not treat a locally cached profile as an active server session.
4. To sign out, Profile → Sign out. The app closes the device session, deactivates push registration, stops native tracking, clears location/current-visit queues and signs out locally. Pending durable attendance outbox items are not documented as deleted; they remain tied to the employee and require that employee to sign in again for replay/diagnosis.

**Expected:** Home/dashboard loads and the session is persisted through the configured shell-aware storage. Storage protection differs by platform and remains subject to environment/device verification.  
**Failure/recovery:** On expired/invalid OTP, wait for the resend timer and retry once. If the account is inactive or rate-limited, record the message and escalate to HR/System Administrator. The client/server phone-validation mismatch is DB-04; do not bypass it.

## M-02 Dashboard and attendance

**Navigation:** Home → Dashboard.  
**Prerequisite:** location permission, allowed office/site and no unresolved previous operation.

1. Review the displayed attendance state, office/policy prompts, pending sync banner and event cards.
2. Select **Check in**. The app captures GPS, rejects mock location/poor accuracy, resolves the nearest allowed office and calls the server check-in RPC.
3. Continue only when a committed server timestamp/status is shown. Start tracking only after the server confirms attendance.
4. Select **Check out** at the end of work. Confirm the server returns `checkout_time`; do not rely on a toast alone.
5. If offline, confirm the explicit offline prompt. The action is stored in the durable outbox with the captured time and idempotency key. Reconnect and wait for **confirmed/synced** status.

**Failure/recovery:**

- Outside radius or mock GPS: move to the allowed location, disable mock location and retry; repeated blocks go to HR with the check-in attempt ID.
- Network loss: keep the device online, open the app and wait for outbox drain; do not submit duplicate actions.
- Unknown/failed sync: capture the outbox/dead-letter message and escalate to Technical Operations.

**Evidence:** `DashboardScreen.tsx`, `services/attendance.service.ts`, `services/offline-attendance.service.ts`, `services/outbox/DurableWriteOutbox.ts`.

## M-03 Attendance history and correction request

**Navigation:** Home → Attendance & Regularization.  
**Permission:** own attendance operations; review permission is server-scoped.

1. Filter the required business month/date.
2. Review app/biometric/canonical status and any checkout reason.
3. Use regularization only for `EARLY_CHECKOUT` or `MISSED_CHECKOUT`.
4. For a missing check-in, past date or HR-entered correction, open the Backdated workflow through HR; do not submit a regularization request for the wrong type.
5. Track the returned request status and review notes.

**Expected:** request ID/status is returned and the history refreshes from the server.  
**Failure/recovery:** If a duplicate/open request exists, use the existing request; if the date is outside policy, escalate with the business date and server error.

## M-04 Leave

**Navigation:** Home → Leave History → Apply Leave.  
**Permission:** authenticated employee; approval is a reviewer permission.

1. Review balance and calendar/weekly-off information.
2. Choose sick, casual, earned, WFH or comp-off; enter start/end dates, reason and half-day period where applicable.
3. Submit and confirm `rpc_submit_leave_request` returns success and request ID.
4. Use the request detail to cancel only when the server permits cancellation.

**Failure/recovery:** Invalid dates, overlap, insufficient balance or closed status must be recorded exactly. Do not edit `leave_requests` directly; escalate to HR for policy/balance correction.

## M-05 Field visits and location

**Navigation:** Home → Field Visits.  
**Prerequisite:** destination coordinates, location permission and (for evidence) camera/gallery permission.

1. Select **Log Where I’m Going/Add Next Stop**.
2. Choose a saved site, map pin or valid destination; confirm purpose/contact/project details.
3. Select **Check in** only at the destination and wait for `CHECKED_IN` with server time.
4. Record notes/evidence if requested, then select **Check out** and wait for `COMPLETED`.
5. If the saved pin is wrong/outside radius, use current-location submission with a reason and declaration; do not create a duplicate visit.

**Expected:** one visible visit card; verification child rows are collapsed in the employee view.  
**Failure/recovery:** pending upload → retry queue; rejected/needs-information → follow reviewer notes; web/locked-screen limitation → use Android app or report tracking gap.

## M-06 Activity logging

**Navigation:** Home → Log Activity; history → My Activity Logs.  
**Prerequisite:** valid location/details appropriate to the activity.

1. Choose office/site/meeting/other, enter location, destination, notes and meeting details.
2. Submit; the client classifies activity and stores confidence/billable/quality fields in `activity_logs`.
3. Review or correct own history; do not fabricate GPS or client details.

**Failure/recovery:** low-quality classification is a flag, not an approval. Retry network failures and escalate persistent RLS/insert errors with timestamp and error code.

## M-07 Tasks, team, notifications and support

- **Tasks:** Tasks tab → review assigned/created/shared tasks; update only when the server returns `can_update`; forwarding is only to direct reports via the server.
- **My Team:** Home → My Team when the tab is available; review reports/team data within scope.
- **Notifications:** Home → Notifications; mark/read from the notification list. Missing push delivery is diagnosed through the notification/outbox procedure, not by repeatedly refreshing.
- **Support:** Home → Raise Ticket or Profile → Help & Support; submit category, priority, title and description. Ticket persistence is authoritative; WhatsApp is best-effort.
- **Birthdays/Profile:** Profile → profile details/help; Birthdays is opened from Home → Birthdays. `DocumentsScreen` is present in the repository but is not registered in the active navigators, so it is not an approved employee workflow until product/runtime activation is confirmed.

## M-08 Employee escalation template

Provide user ID (not OTP), business date/time with timezone, screen path, request/idempotency ID, exact error, network state, device/OS and whether the server-confirmed record exists. Remove employee GPS trails, tokens and personal data from screenshots.

