# Reports, Activity, Compliance and Support Manual

## R-01 Report access and common controls

**Navigation:** Main tab → Reports → Reports Hub → selected report.  
**Permission:** route-specific `SCREEN_PERMISSIONS` key; server scope/RLS controls rows.

1. Select a report and confirm the permitted date range/scope.
2. Apply employee, office, team or department filters only when offered by the server.
3. Wait for the loading state to complete; do not export while a stale previous range is displayed.
4. Verify row count, date/timezone, source labels and any warning/configuration status.
5. Use the report’s export/download action and confirm the file opens without sensitive over-sharing.

## R-02 Report catalogue

| Route/screen | Operational use | Key verification |
|---|---|---|
| Attendance Summary / Advanced | canonical daily/range attendance | official first-in/last-out, status and source |
| Attendance Register | monthly register | business month, employee scope and missing rows |
| Late Arrivals | late policy output | policy/configuration warning and date range |
| Field Visit | visit duration/status/location | verification state and GPS freshness |
| Geofence Events | blocked/outside/arrival events | event timestamp, distance and employee scope |
| Biometric Reconciliation | app/device differences | batch, mapping and canonical result |
| Activity Analysis | activity plus attendance day | activity count/billable/quality and canonical attendance |
| Tracking / Intelligence | live or historical tracking/insights | LIVE vs historical, signal age and scope |
| Suspicious/GPS | fraud/suspicion evidence | score, source evidence and reviewer action |
| Check-In Logs | accepted/blocked attempts | attempt reason and audit/request ID |
| Leave/Leave Balance/Leave Usage | requests, balance, usage | ledger/request status and approval scope |
| Regularization | correction requests | type restriction, reason, review status |
| Team Hierarchy | reporting relationships | server team scope and current hierarchy |
| Audit Logs | security/change trail | actor, object, action, timestamp |
| Overtime/Comp-Off | hours/event credit | policy/event source and date |
| Download Centre/Downloads | file generation/history | export actor, scope, file availability |

## R-03 Activity operations

**Navigation:** Home → Log Activity/My Activity Logs; HR Panel → Activity Analysis.  
**Permissions:** employee own activity; admin `activity_analysis.view`/scope.

1. Employee enters location type/name, notes, destination and meeting details.
2. `ActivityAnalysisService` classifies activity type, confidence, billable flag and low-quality flag before `activity_logs` insert.
3. Employee reviews own history; HR analyzes daily employee logs through `rpc_activity_analysis_day`/`rpc_activity_logs_day` with canonical attendance.
4. If the RPC is missing, the service has a fallback query path; record which path was used.

## R-04 Compliance, fraud and devices

**Navigation:** HR Panel/Reports → Suspicious Attendance, Compliance Scores, Duplicate Devices & Sessions, Attendance Intelligence.  
**Permission:** `suspicious.view`, `devices.manage`, `employees.view`, `attendance.view` as mapped.

1. Review score/evidence and source rows; do not treat a score as a disciplinary decision.
2. Inspect duplicate device/session evidence and revoke only the affected session through server controls.
3. Record reviewer, decision and escalation; preserve audit trail.

## R-05 Support and anonymous feedback

- Ticket: create/open/in-progress/resolved/closed; add resolution notes; verify ticket row before external notification.
- Anonymous feedback: read only within `feedback.view`; do not attempt identity inference or export raw narratives.

## R-06 Report troubleshooting

| Symptom | Evidence | Action | Verify |
|---|---|---|---|
| empty report | date/scope, RPC error, canonical row count | narrow range/check permission/schema | expected rows or documented no data |
| stale report | build ID, cached screen state, request ID | refresh/invalidate/correct range | returned date/scope matches selection |
| export missing | download/outbox/file state | retry once; inspect download centre and storage | file opens and scope is correct |
| report source conflict | app/device/correction/audit rows | use canonical result and escalate object version | canonical row + audit evidence |

