# Team Lead Operations Manual

Team Lead operations are not granted solely by a label such as `TEAM_LEADER`, `SALES_MANAGER` or `BUSINESS_HEAD`. Team visibility and actions depend on reporting hierarchy plus active scoped permissions returned by `get_my_permissions` and enforced by server RPC/RLS.

## TL-01 Open team workspace

**Navigation:** Main tab → My Team (when rendered) or Tasks → team-related action.  
**Prerequisites:** active direct reports or escalation visibility; current session.

1. Confirm team members and reporting lines shown by the server.
2. Select an employee only within the returned scope.
3. Use the specific action (task, leave, attendance, field visit) rather than assuming all team data is editable.

**Failure/recovery:** My Team tab absent means no current team/escalation visibility; request hierarchy correction from HR. `PERMISSION_DENIED` requires permission review, not a client-side workaround.

## TL-02 Task assignment and forwarding

**Navigation:** Tasks tab → task detail → Forward/Update; HR Panel → Tasks & Projects if granted.  
**Permission:** `tasks.view`/`tasks.manage` or server relation flags.

1. Load `rpc_my_tasks` and inspect `relation`, `can_update`, `can_forward` and `forwarded_count`.
2. Update only when `can_update` is true.
3. Use **Forward** to direct reports; select individuals or all direct reports as allowed.
4. Confirm `rpc_task_forward` returns success/added count, then refresh the task list.

**Recovery:** `NOT_YOUR_TEAM`, `NO_DIRECT_REPORTS` or `FORBIDDEN` → check hierarchy and scope with HR/Admin; do not insert task shares directly.

## TL-03 Team attendance and regularization

**Navigation:** permitted HR Panel Attendance Control/Regularization or Reports tab.  
**Permission:** scoped `attendance.view`, `regularization.view/approve`, `attendance.regularize`.

1. Filter to the team/date returned by server scope.
2. Compare canonical official first-in/last-out with app, biometric and approved corrections.
3. Review early/missed checkout regularization only; route missing check-in/backdated cases to Backdated Attendance.
4. Approve/reject with an evidence-based note; verify audit/canonical refresh.

## TL-04 Team leave and field activity

Use Leave Management or Reports only if `leave.view/approve` is granted. Review leave balance, overlap and reason before decision. For field visits, use Field Visit Admin/Observer and verify GPS freshness, mismatch status, evidence and reviewer status. Never publish a PENDING or FLAGGED visit as verified.

## TL-05 Team communication and escalation

Use task/notification/event channels for operational messages. For a system issue, provide scope, employee ID, date/time, request ID and exact RPC/error. Escalate:

- hierarchy/role issue → HR/System Administrator;
- attendance source conflict → Attendance Administrator/database owner;
- location/device issue → Technical Operations;
- missing notification → notification/outbox owner.

