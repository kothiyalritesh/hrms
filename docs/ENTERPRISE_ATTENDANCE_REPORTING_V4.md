# Enterprise attendance reporting v5

## Purpose

The v5 reporting contract separates historical reporting from operational
attendance monitoring. It prevents a current office, team, manager, or policy
from silently relabelling an older employee-day.

## Accuracy contract

- Attendance evidence continues to come from the canonical app, biometric,
  field-visit, regularization, and admin-correction sources.
- Organization and late-policy labels are resolved from effective-dated,
  verified history for the employee-day.
- Holidays and weekly offs are resolved using that historical assignment
  scope. Weekly-off rules must have valid effective dates.
- A missing or unverified assignment/policy is returned as
  `CONFIG_REQUIRED`; it is never guessed and shown as valid payroll data.
- `ABSENT` is emitted only for a configured working day after biometric source
  coverage and employee mapping are confirmed. Missing coverage is
  `DATA_NOT_SYNCED`; missing identity configuration is `MAPPING_REQUIRED`.
- Attendance on a holiday or weekly off is retained as `WORKED_HOLIDAY` or
  `WORKED_WEEKLY_OFF` instead of being hidden by the calendar label.
- Fraud severity and reasons come from persisted attendance fraud events.
- Every generated workbook includes the applied criteria and the number of
  historically verified rows.

## Smart report examples

- `Marketing team from 3 Aug to 16 Aug who were late`
- `Biometric attendance for Lucknow office this month`
- `Employees with no checkout last month`
- `Suspicious GPS attendance today`
- `Sales managers under Ankit Mavi with multiple sources this month`
- `Employee named Priya Sharma who was absent from 1 Aug to 15 Aug`

Recognised criteria can be combined: explicit or relative dates, office, team,
team head, supported role, employee name/number, attendance source, and status
or exception.

## Deployment order

1. Apply migrations through `20260817040000` in timestamp order.
2. Deploy every Edge Function declared in `release.config.json`; their version
   probes now require schema `20260817040000`.
3. Publish the matching web/mobile build only after the release contract probe
   returns the same backend schema version.
4. Verify historical configuration issues before using an export for payroll.

## Required production acceptance checks

- Transfer an employee between two teams and confirm older days remain under
  the former team.
- Change a late policy and confirm the new boundary applies only from its
  effective date.
- Run each smart-report example and reconcile its total against SQL for a
  controlled fixture dataset.
- Confirm unverified historical rows appear as `CONFIG_REQUIRED`.
- Confirm an uncovered source day appears as `DATA_NOT_SYNCED`, never absent.
- Confirm an unmapped employee appears as `MAPPING_REQUIRED`, never absent.
- Confirm a non-HR/non-admin account cannot call the full-company report RPC.
- Load-test a representative maximum period and employee population before
  selecting the production export limit.
