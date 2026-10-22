# HR Panel Manual

**Entry:** Main tab → HR Panel → Admin Dashboard.  
**Authorization:** `usePermissions.canOpenScreen()` is only a client gate. The corresponding server permission/RLS/RPC check is authoritative. HR/HRD are data-admin roles in the client catalog but permission-management rights remain restricted.

## HR-01 Common review procedure

1. Record employee/date/scope before opening a queue.
2. Confirm the route is present and not a legacy screen.
3. Filter narrowly; review source/evidence/audit fields.
4. Use the screen action/RPC and wait for a confirmed response.
5. Refresh from the server and retain request ID/status/notes.

If a screen is visible but the RPC returns `PERMISSION_DENIED`, stop and escalate to the System Administrator; never bypass with a direct table edit.

## HR-02 Employee and records

**Navigation:** HR Panel → User Management; Employee Birthday Management. `DocumentManagementScreen` exists in source but is not registered in the active admin navigator; do not treat it as an available HR workflow without route/runtime activation evidence.  
**Permission:** `employees.view`/`employees.manage`, `birthdays.manage`; server scope.

- Search by employee number/name, review active status/role/office/team.
- Create/edit/deactivate only with validated profile data and reason.
- Assigning platform administrator roles is a higher-risk server-controlled action.
- Review birthday/document changes through audit; do not download or circulate unnecessary personal data.

**Failure/recovery:** duplicate phone/employee number or invalid lifecycle status → correct the source data and retry; unauthorized role assignment → System Administrator.

## HR-03 Attendance Control and review queues

**Navigation:** HR Panel → Attendance Control, Attendance Regularization, Backdated Attendance, Attendance Calendar, Check-In Logs, Suspicious Attendance, Compliance Scores.  
**Permissions:** `attendance.view`, `attendance.regularize`, `regularization.view/approve`, `attendance.backdate_correct/approve`, `attendance.calendar.manage`, `checkin_logs.view`, `suspicious.view`, `employees.view`.

1. In Attendance Control select business date/range and App or Biometric tab.
2. Review canonical/server fields, raw device logs, reconciliation state and audit evidence.
3. For direct correction, select an existing attendance record, enter a reason and valid IST times, then confirm the audited RPC result. If no record exists, route to Backdated Attendance.
4. In Attendance Regularization, filter PENDING/APPROVED/REJECTED, inspect the employee reason and canonical first/last times, then approve/reject with notes.
5. In Backdated Attendance, use the correct origin (employee request or HR entry), evidence/reason code and verification state. High-risk approvals require the server’s second-person controls where deployed.
6. Use Check-In Logs for blocked/outside-office attempts, Suspicious Attendance for fraud/GPS evidence and Compliance Scores for the summarized score—not as a replacement for source records.

**Expected:** server status changes, audit event and refreshed canonical/report output.  
**Recovery:** stale page → refresh canonical data; conflicting sources → escalate with record IDs; RPC missing/schema mismatch → database owner.

## HR-04 Leave and calendar

**Navigation:** HR Panel → Leave Management, Leave Balance, Attendance Calendar.  
**Permissions:** `leave.view`, `leave.approve`, `leave.balance.manage`, `attendance.calendar.manage`.

- Review pending leave, overlap/balance and approval scope.
- Approve/reject through the server review action with notes.
- Adjust balance only with reason and audit confirmation.
- Maintain holidays/weekly-off rules only after validating office/user scope.

## HR-05 Work, communication and feedback

**Navigation:** Tasks & Projects, Notification Management, Ticket Management, Event Management, Anonymous Feedback, Team Hierarchy, TV Display.  
**Permissions:** `tasks.view/manage`, `notifications.send`, `tickets.manage`, `events.manage`, `feedback.view`, `teams.manage`, `attendance.view` for TV display.

- Assign tasks only to permitted scope; use hierarchy-aware results.
- Send notifications after checking audience, message and delivery channel; inspect outbox after dispatch.
- Resolve tickets with resolution notes; ticket row is authoritative if WhatsApp fails.
- Create events with audience, venue/radius, date/time and comp-off settings; event attendance is separate from ordinary attendance.
- Read anonymous feedback without attempting re-identification.
- TV Display is a read-only operational display; verify date/office scope before placing on a shared screen.

## HR-06 Field and monitoring

**Navigation:** Field Visits, Site Visit Observer, Live Tracking, In Transit, Activity Analysis.  
**Permissions:** `field_visits.view`, `live_tracking.view`, `activity_analysis.view`.

Review only the authorized scope, check freshness/signal status, distinguish live from historical data and avoid exporting unnecessary GPS history. For current-location submissions, record decision/notes through review RPC and preserve audit history.

## HR-07 Reporting

Open Reports tab and select the guarded report. Filter by date, office/team/employee only when the server permits. Confirm export/download completion and store files in approved access-controlled locations. Report-specific procedures are in the technical/report manual and matrix.

