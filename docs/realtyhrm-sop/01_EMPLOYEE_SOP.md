# Employee SOP

## Sign in

1. Enter the 10-digit Indian mobile number. The current UI accepts only numbers beginning 6–9 (`screens/LoginScreen.tsx`).
2. Request OTP and enter the six-digit code before expiry. Respect resend/rate-limit messages.
3. If the profile is inactive or the server rejects the challenge, contact HR; do not retry indefinitely.

**Control:** OTP authentication is server-mediated by `otp-auth`; server validation currently does not enforce the same 6–9 prefix (DB-04), so deployment owners must reconcile this.

## Attendance

1. Allow location permission and ensure mock location is disabled.
2. Check in from an allowed office/site. The server validates GPS accuracy, radius and committed timestamp.
3. Check out only when the server confirms `checkout_time`. If offline, the app labels the action as saved locally and queues it; wait for synchronization confirmation.
4. For an early/missed checkout, submit regularization. For a missing check-in or backdated correction, use the Backdated Attendance workflow—not regularization.
5. Never use event check-in as ordinary office attendance.

Evidence: `DashboardScreen.tsx`, `services/attendance.service.ts`, `services/offline-attendance.service.ts`, `services/attendance-regularization.service.ts`.

## Leave, tasks and support

- Submit/cancel leave from Leave; confirm the returned status. Check balance and calendar before submitting.
- Use Tasks for assigned/created/shared work. Forward only to direct reports when offered by the server.
- Raise support tickets with category, priority and actionable details. Ticket persistence is authoritative; WhatsApp delivery is best-effort.

## Field visits

Create a destination with valid coordinates, check in at the destination, record notes/evidence where requested, and check out at completion. If the saved pin is wrong or outside the radius, use the current-location evidence path and wait for review; do not create duplicate visits.

