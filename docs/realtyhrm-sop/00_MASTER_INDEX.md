# RealtyHRM Standard Operating Procedure

This SOP describes the behavior evidenced in the repository. Server RPC results and deployed database policies are authoritative. Any item marked PARTIALLY IMPLEMENTED, DEFECTIVE or UNVERIFIED requires the listed verification before being treated as a production control.

Download the consolidated Word version: [RealtyHRM Complete SOP](../RealtyHRM_Complete_SOP.docx).

Current expanded deliverables: [Complete SOP (Word)](../RealtyHRM_COMPLETE_SOP_FINAL_v5.docx) and [Complete SOP (Markdown)](../RealtyHRM_COMPLETE_SOP.md).

For the completeness-review expansion with detailed role manuals, coverage matrix and failure register, use [Expanded SOP Master Index](../realtyhrm-sop-expanded/01_MASTER_INDEX.md). The latest sign-off review and prioritized remediation plan is [SOP Sign-off Audit and Action Plan](../realtyhrm-sop-expanded/20_SIGN_OFF_AUDIT_AND_ACTION_PLAN.md).

## Operating documents

1. [Employee SOP](01_EMPLOYEE_SOP.md)
2. [HR and Team Lead SOP](02_HR_TEAMLEAD_SOP.md)
3. [Admin and Permission SOP](03_ADMIN_SOP.md)
4. [Attendance and Biometric SOP](04_ATTENDANCE_BIOMETRIC_SOP.md)
5. [Location and Field Visit SOP](05_LOCATION_FIELD_VISIT_SOP.md)
6. [Leave, Tasks, Notifications and Events SOP](06_LEAVE_TASKS_NOTIFICATIONS_EVENTS_SOP.md)
7. [Reports, Audit and Privacy SOP](07_REPORTS_AUDIT_PRIVACY_SOP.md)
8. [Deployment and Troubleshooting SOP](08_DEPLOYMENT_TROUBLESHOOTING_SOP.md)
9. [Verification and Traceability](09_VERIFICATION_TRACEABILITY.md)

## Audit evidence

- [Discovery and analysis plan](../realtyhrm-audit/00_DISCOVERY_AND_PLAN.md)
- [Findings register](../realtyhrm-audit/01_FINDINGS_REGISTER.md)
- [Architecture and module inventory](../realtyhrm-audit/02_ARCHITECTURE_AND_MODULE_INVENTORY.md)
- [Authentication and authorization audit](../realtyhrm-audit/03_AUTH_AUTHORIZATION_AUDIT.md)
- [Attendance and biometric audit](../realtyhrm-audit/04_ATTENDANCE_BIOMETRIC_AUDIT.md)
- [Location and field-visit audit](../realtyhrm-audit/05_LOCATION_FIELD_VISIT_AUDIT.md)
- [Workflow audit](../realtyhrm-audit/06_WORKFLOW_AUDIT.md)
- [Database and integrations audit](../realtyhrm-audit/07_DATABASE_INTEGRATIONS_AUDIT.md)
- [Deployment and test audit](../realtyhrm-audit/08_DEPLOYMENT_TEST_AUDIT.md)

## Role coverage

| Role family evidenced in code | SOP coverage | Notes |
|---|---|---|
| Employee / sales and specialist roles | Employee SOP | Uses employee shell; exact module scope is permission-driven. |
| HR / HRD | HR and Team Lead SOP | HR panel access is role-normalized. |
| Team Lead / sales leadership | HR and Team Lead SOP | Team visibility/forwarding is server-scoped; role labels include team and sales variants. |
| ADMIN | Admin SOP | Data administration and permission administration are distinct controls. |
| SYSTEM_ADMIN / SUPER_ADMIN alias | Admin SOP | Highest permission-administration role; alias normalization is documented in the audit. |
| TELECALLER and other specialist aliases | Employee SOP plus permission catalog | Do not infer admin access from job title; use server permissions. |

