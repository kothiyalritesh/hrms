# SOP Sign-off Audit and Production-Readiness Action Plan

**Review date:** 19 October 2026  
**Reviewed baseline:** Expanded RealtyHRM SOP and supporting audit documents in `docs/realtyhrm-sop-expanded/` and `docs/realtyhrm-audit/`.  
**Scope:** Documentation consistency, completeness against the stated requirements/coverage matrix, source-supported claims and release-readiness evidence. No application, database or deployment files were changed.

## Sign-off verdict

The documentation is suitable as the **current technical baseline**, after the corrections recorded below. It is not a production-readiness approval. The repository still has a failed full TypeScript check, seven failing Jest suites/25 failing tests, unverified production schema/RLS/function deployment, unverified biometric/provider configuration, no restore-drill evidence and no Android background-location acceptance evidence.

## Corrections made during this review

| ID | Finding | Evidence | Correction |
|---|---|---|---|
| DOC-01 | Mobile manual described session persistence as secure. | `lib/supabase.ts` uses shell-aware persistent storage; browser path is not certified secure storage by source inspection. | Mobile/web manuals now describe configured persistent storage and retain platform/security verification as an open item. |
| DOC-02 | Sign-out said it clears all offline queues. | `contexts/AuthContext.tsx` clears location/current-visit queues but does not clear `DurableWriteOutbox` attendance items. | Mobile manual now states that pending durable attendance items remain tied to the employee and require replay/diagnosis after sign-in. |
| DOC-03 | Documents were presented as an employee/HR navigation workflow. | `DocumentsScreen.tsx` and `screens/admin/DocumentManagementScreen.tsx` have no active route registration in the inspected navigators. | Both are explicitly source-only/unrouted in the manuals and coverage matrix. |
| DOC-04 | Master index said every procedure had an inline status. | Role manuals contain procedure steps but not a status label on every section. | Status rule now points to coverage, traceability, test and defect registers; individual procedures inherit their linked classification. |
| DOC-05 | Coverage matrix claimed the entire repository was represented one-by-one. | Low-level service/helper files are grouped rather than individually listed. | Completion language now limits the claim to significant operational artifacts and links to the full architecture inventory. |
| DOC-06 | Payroll/project scope and unmounted navigation needed explicit treatment. | `PayrollScreen.tsx`, `ProjectsScreen.tsx`, `AttendanceStackNavigator.tsx` are not active routes in inspected navigators. | Scope/approval register and audit reconciliation explicitly classify them as legacy/unmounted or excluded. |

## Remaining documentation findings before final approval

| ID | Priority | Finding | Required correction before sign-off | Owner |
|---|---|---|---|---|
| DOC-07 | P1 | Traceability is now function-level for the main high-risk workflows, but some grouped intelligence, report and integration rows still use family-level references. | Add function/component names and exact test paths for the remaining high-risk grouped rows before final sign-off. | Technical writer + engineering |
| DOC-08 | P1 | Test evidence records commands and results but not commit SHA, package lock hash, full JSON artifact location or environment fingerprint. | Add immutable run metadata and attach redacted command output/Jest JSON to the release record. | QA/release owner |
| DOC-09 | P1 | The manual set has no formal document owner, approver, review cadence or change log. | Add document-control metadata to the master index and a signed version/change table. | Product/operations owner |
| DOC-10 | P2 | Some navigation labels are user-facing titles while others are route names; this can confuse support staff. | Add a route-name column to the navigation register and use the exact header title plus route identifier consistently. | Technical writer |
| DOC-11 | P2 | Legacy/source-only screens are identified, but there is no repository cleanup or archive decision. | Product owner decides whether to remove, archive or retain each excluded artifact; record the decision without activating it implicitly. | Product + engineering |
| DOC-12 | P2 | Multiple generated Word bundles remain in `docs/` with versioned names, which can make the delivery artifact ambiguous. | Keep one clearly named current file in the delivery path and move/label prior bundles as historical baselines before sign-off. | Release/document owner |

## Completeness validation against required deliverables

| Requirement | Coverage result | Sign-off interpretation |
|---|---|---|
| Architecture and module inventory | Covered for significant operational areas; full file inventory remains in prior audit inventory | Documentation complete; source/deployment verification still partial |
| Actual roles and permission mechanisms | Covered by `11_PERMISSIONS_MATRIX.md`, `constants/permissionCatalog.ts`, `usePermissions` and role normalization | Server/RLS equivalence remains unverified |
| Employee mobile and web manuals | Covered with navigation, prerequisites, actions, outcomes and recovery | Device/browser acceptance remains open |
| HR, Team Lead and System Administrator manuals | Covered with role-specific procedures and escalation | Scope/permission behavior requires staging verification |
| Attendance, biometric and reconciliation | Covered with canonical, correction, offline, import and webhook procedures | Production authority/provider/migration version remains unverified |
| Location, geofence and field visits | Covered with setup, ping, visit, evidence and monitoring procedures | Android background behavior and deployed policies remain unverified |
| Leave, tasks, notifications, events, support and activity | Covered at operational level | Provider/RLS and some query contracts remain partial |
| Reports and exports | Catalogue and common controls covered | Individual report query contracts and integration fixtures remain partial |
| Database, RLS, Edge Functions and integrations | Object map, RPC handling, function table and security queries covered | Live schema, grants, schedules, secrets and provider responses unavailable |
| Deployment, backup, recovery and troubleshooting | Procedures and symptom matrix covered | Backup/PITR/restore/rollback evidence absent; cannot sign off |
| Workflow diagrams | Covered in Mermaid | Diagrams describe intended/source flows, not deployed proof |
| Permissions matrix | Covered with canonical keys, aliases and scope semantics | Live server permission tests required |
| Test evidence and verification checklist | Covered; failed results recorded honestly | Release blockers remain open |
| Defects, limitations and operational risks | Covered by KD-01 through KD-18 plus this review | Owner acceptance/remediation is still required |
| Source-to-procedure traceability | Covered at workflow level | Function-level expansion is DOC-07 |
| Unresolved questions/manual verification | Covered in audit, defect and approval registers | Must be closed or risk-accepted |

## Prioritized production-readiness action plan

### P0 — must close before relying on controls or releasing

| Order | Action | Evidence of completion | Related records |
|---:|---|---|---|
| 1 | Verify target database privileges, RLS policies, approval/self-approval boundaries and protected RPC signatures using read-only checks. | Redacted schema/policy/grant report; negative tests proving employees cannot self-edit/approve attendance, leave or regularization. | KD-16, T-10, TR-02/TR-03/TR-06/TR-07 |
| 2 | Reconcile applied migration sequence, canonical attendance RPC/view definitions, Edge Function versions and `release.config.json`. | Environment manifest with migration IDs, function versions, signatures and deployment timestamps. | KD-05, KD-06, TR-05 |
| 3 | Produce and execute a backup/PITR/restore drill, including storage and Edge Function rollback. | Dated restore record with RPO/RTO, integrity checks and rollback target. | KD-12 |
| 4 | Resolve or formally risk-accept the malformed `scratch.tsx` typecheck blocker. | Clean `npm run typecheck` exit 0, or signed exception with removal/quarantine plan. | KD-01, TE-03 |
| 5 | Approve the attendance source-precedence policy and replay a biometric/app/correction reconciliation in staging. | Signed policy plus fixture results showing canonical rows, audit trail and duplicate handling. | KD-05, KD-11, TR-03/TR-05/TR-08 |

### P1 — must close before broad operational rollout

| Order | Action | Evidence of completion | Related records |
|---:|---|---|---|
| 6 | Triage all seven failing Jest suites and decide stale contract vs missing behavior vs missing fixture. | Per-test disposition, targeted reruns and updated integration/fixture tests. | KD-02, KD-08–KD-10, TE-04 |
| 7 | Complete OTP security contract review: challenge/request ID, retry-after, rate limits, UI/server phone format and session issuance. | Approved contract, Edge Function test, UI test and abuse/rate-limit evidence. | KD-03, KD-04, TR-01 |
| 8 | Run Android device acceptance for background location, battery restrictions, permission revocation, locked screen, queue replay and geofence events. | Device matrix with OS/build, pings, health states and recovery results. | KD-07, KD-17, TR-12 |
| 9 | Verify biometric provider credentials/configuration, schedules, webhook secret, code mapping, duplicate handling and batch replay. | Staging provider run with redacted batch/source hash and canonical reconciliation. | KD-11, TR-08/TR-09 |
| 10 | Verify saved sites, network resilience, advanced report query limits and map route origin behavior with data-backed tests. | Staging fixtures and passing targeted integration tests for each workflow. | KD-08–KD-10, KD-18 |
| 11 | Restrict and rotate Maps/provider configuration as required; verify push/WhatsApp/SMS delivery and retry monitoring. | Key restriction report, provider health checks and delivery/outbox evidence. | KD-13, KD-14 |

### P2 — required for documentation and operational maturity

| Order | Action | Evidence of completion | Related records |
|---:|---|---|---|
| 12 | Expand high-risk traceability to exact functions/components/tests and add immutable evidence metadata. | Updated TR rows, commit SHA, environment fingerprint and stored test artifacts. | DOC-07, DOC-08 |
| 13 | Add document owner, approver, review cadence, version history and sign-off page to the master index. | Approved document-control record. | DOC-09 |
| 14 | Decide archive/remove/retain disposition for unrouted legacy screens and historical SQL snapshots. | Product/engineering decision log and updated coverage matrix. | DOC-11, KD-15 |
| 15 | Run scoped report/export integration tests against canonical fixtures, including privacy review. | Reconciled files, row counts, scope checks and export-retention evidence. | KD-18, TR-19 |

## Sign-off checklist

Do not mark the SOP or release “verified” until all applicable rows below have evidence or a named risk acceptance:

- [ ] Scope owner confirms payroll/financial exclusion and legacy-screen disposition.
- [ ] Database owner supplies applied schema/RPC/RLS/grant evidence.
- [ ] Attendance/HR owner approves source precedence and correction policy.
- [ ] Platform owner completes backup/restore/rollback drill.
- [ ] Engineering resolves or accepts typecheck and Jest blockers.
- [ ] Mobile QA completes Android location/geofence acceptance.
- [ ] Integration owner verifies biometric, SMS, push, WhatsApp and Maps boundaries.
- [ ] QA attaches reproducible test metadata and targeted reruns.
- [ ] Product/security owners accept or remediate KD-01–KD-18.
- [ ] Document owner approves this SOP version and next review date.

## Final documentation structure recommendation

Keep the current separate-manual structure and master index. Before final sign-off, add only the document-control metadata and function-level traceability described in DOC-07–DOC-09; do not merge the manuals into one operational chapter that hides role boundaries or unresolved evidence. The consolidated Word/Markdown bundle should remain a convenience artifact generated from the maintainable Markdown sources.
