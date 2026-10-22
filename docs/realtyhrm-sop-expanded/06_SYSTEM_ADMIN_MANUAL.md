# System Administrator Manual

**Role model:** `SYSTEM_ADMIN` and `SUPER_ADMIN` aliases are normalized to `SYSTEM_ADMIN`. `ADMIN` is also a permission administrator by the catalog. `HR`/`HRD` are data-admin roles but are not automatically permission administrators.

## SA-01 Permission administration

**Navigation:** HR Panel → Permissions Manager → People / Role Templates / Simulator / History.  
**Permission:** `permissions.view`, `permissions.assign`, `permissions.revoke`; server `hrms_is_permission_admin`/grant/revoke RPCs.

1. Search and verify the target profile and current grants.
2. Choose canonical permission, scope (`GLOBAL`, `OFFICE`, `OFFICE_TREE`, `TEAM`, `TEAM_TREE`, `REPORTS_TO`, `ASSIGNED`, `SELF`, `DEPARTMENT`) and expiry where applicable.
3. Enter a meaningful reason for high-risk grants.
4. Confirm the RPC response, audit event and refreshed permission cache.
5. Simulate access before asking the user to retry.

**Safety:** no self-grant by delegated administrators; never copy tokens or use a direct table edit. A grant can make a screen visible while a separate RPC/RLS check still denies data.

## SA-02 User lifecycle and auth revocation

**Navigation:** HR Panel → User Management; Device Sessions.  
**Permission:** `employees.view/manage`, `devices.manage`; auth revocation is server-controlled.

1. Validate identity, employee number, phone, role, office, team, reports-to and active/lifecycle state.
2. For deactivation/exit, use the lifecycle action and retain reason/date.
3. For duplicate/compromised sessions, inspect Device Sessions and revoke the selected auth/device session; confirm audit and user sign-out.
4. Verify the user no longer receives active scoped permissions or push registration as intended.

## SA-03 Office, site and attendance policy configuration

**Navigation:** HR Panel → Offices & Settings; Sites & Geofences; Attendance Calendar.  
**Permission:** `offices.manage`, `sites.manage`, `attendance.calendar.manage`.

1. Review office coordinates, radius, timezone/policy and active state.
2. Maintain predefined sites/geofences with valid coordinates and radius.
3. Configure holidays/weekly offs with correct office/user scope.
4. Change attendance policy through the admin mutation/RPC path, with reason and audit confirmation.
5. Test one check-in/checkout in staging after changes; do not assume UI save means active production policy.

## SA-04 Events, notifications, tickets and feedback

Use Event Management, Notification Management, Ticket Management and Anonymous Feedback only within their catalog permissions. Verify audience, content and outbox/delivery status. Preserve anonymous feedback anonymity and avoid joining it with user-identifying data.

## SA-05 Data integrity and audit

Use Audit Logs, canonical attendance views/RPCs, biometric batch/request status and location/field audit tables for investigation. Never repair attendance, GPS evidence or permission rows with an ad-hoc SQL update; create an approved migration/RPC change under separate authorization.

## SA-06 Release control

Before release, reconcile `release.config.json` required schema/Edge versions with the applied migration/function set, run all required checks, confirm backups/restore test and stage rollback. Current repository blockers are recorded in `13_TEST_EVIDENCE_REGISTER.md` and `14_KNOWN_DEFECTS_REGISTER.md`.

