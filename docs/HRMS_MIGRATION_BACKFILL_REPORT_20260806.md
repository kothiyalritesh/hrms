# HRMS migration and backfill report — 6 August 2026

## Deployment

- Linked Supabase project: `jidbrwpzfpbursihtvpg`
- Applied migrations: `20260806010000`, `20260806020000`, `20260806030000`
- Release schema contract: `20260806030000`
- Remote migration list: local and remote versions synchronized.
- New HRMS RPCs passed remote `plpgsql_check` lint after the `030000` contract-cast correction.

## Backfills performed

- Created a normalized `teams` table and linked profiles to canonical teams without deleting the legacy display value.
- Added profile reporting controls (`show_on_tv`, `attendance_reporting_enabled`, `is_service_account`) and excluded service accounts from attendance and leave accrual.
- Added scoped holiday/weekly-off resolution with employee → team → office → company precedence.
- Created one active `ALL` attendance policy for any active office that did not already have one; the canonical status remains `CONFIG_REQUIRED` wherever office/policy evidence is still incomplete.
- Preserved original attendance, field-visit, and tracking timestamp values in `hrms_timestamp_backup_20260806` before attempting any physical type conversion.
- Added explicit app check-in evidence for future writes. Existing app evidence continues to be resolved safely from `checkin_source` when protected history cannot be rewritten.
- Migrated current leave balances into immutable `OPENING_BALANCE` ledger entries and ran the idempotent current-month casual-leave accrual.

## Review-required records

The production attendance protection trigger refused the bulk historical `app_checkin_time` rewrite. This is intentionally recorded as:

- Entity: `ATTENDANCE_EVIDENCE`
- Identifier: `APP_CHECKIN_BACKFILL`
- Status: `REVIEW_REQUIRED`
- Runtime behavior: canonical attendance derives app evidence from the existing protected `checkin_source`; no official time is lost or shifted.

Each legacy timestamp column that Postgres could not convert because of dependent functions/views is also retained as a `TIMESTAMP_COLUMN / REVIEW_REQUIRED` row, with the table/column identifier and SQLSTATE. The canonical `hrms_timestamp(...)` overload interprets those offset-less historical values as Asia/Kolkata and preserves already-zoned instants.

Exact protected identifiers and database errors are retained in the admin-only migration ledger:

```sql
select entity_type, entity_id, status, detail
from public.hrms_migration_report
where migration_key = '20260806010000'
order by entity_type, entity_id;
```

The ledger and raw timestamp backup have RLS enabled, are readable only by authenticated HRMS administrators, and reject browser-role mutations.

## Data safety

- No attendance, biometric, field-visit, location, leave-request, or leave-balance history was deleted.
- Physical timestamp conversion runs per column in a subtransaction; blocked conversions roll back only that column and are recorded.
- Leave mutations lock the balance row and insert an immutable transaction with an idempotency key in the same transaction.
- Approved regularization updates official checkout only through the protected transactional review RPC and creates an audit event.

## Follow-up operation

An HRMS administrator should review `REVIEW_REQUIRED` ledger rows after dependent legacy views are retired. Do not manually rewrite protected attendance rows; update the relevant database dependencies first, then perform a separately audited conversion from the timestamp backup.
