# HR and Team Lead SOP

## Review queue

Use the relevant HR/admin screens and server results to review leave, regularization, backdated attendance, field-visit evidence, tasks and tickets. Verify employee, business date, source, evidence and scope before deciding.

## Attendance exceptions

- Regularization is limited to `EARLY_CHECKOUT` and `MISSED_CHECKOUT`.
- Missing check-in, backdated or HR-entered corrections belong in Backdated Attendance.
- Review server-returned canonical attendance and audit records. Do not rely on a displayed app/biometric value alone.

## Field evidence

Review location distance, accuracy, mock-location flag, declaration, evidence photo and audit history. Record a decision and notes through the review action; do not edit protected location fields directly.

## Team tasks

Use hierarchy-aware task results. Confirm the server says a task can be updated or forwarded; visibility is not equivalent to edit authority.

## Escalation

Escalate schema/RPC errors, queue dead letters, repeated GPS gaps, or conflicting attendance sources to the system administrator/database owner with IDs and business dates, excluding employee-sensitive payloads from chat/email.

