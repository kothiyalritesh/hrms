# SmartOffice Integration

SmartOffice data is fetched only by authenticated Supabase Edge Functions.
Operational host names, API keys, and passwords must be configured in the Edge
Function environment and must never be placed in client code or documentation.

The production workflow provides:

- server-scheduled and administrator-triggered sync;
- atomic biometric import batches with validation and failed-batch history;
- idempotent raw-punch storage;
- protected employee-code matching;
- rollback metadata for attendance changes;
- read-only reporting screens for raw device logs and matched attendance.

Manual spreadsheet imports use the protected `biometric-manual-import` function
and are applied as one transaction.
