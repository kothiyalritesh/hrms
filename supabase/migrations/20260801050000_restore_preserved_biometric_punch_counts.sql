-- Daily device-log compaction intentionally retains only first/last raw rows.
-- Preserve the larger already-confirmed punch count captured in immutable audit
-- history rather than incorrectly displaying every compacted day as 2 punches.

set local statement_timeout = '10min';
select set_config('app.suppress_attendance_outbox', 'true', true);

with audited_counts as (
  select
    audit.record_id as attendance_id,
    max(greatest(
      case
        when audit.old_values->>'biometric_punch_count' ~ '^[0-9]+$'
          then (audit.old_values->>'biometric_punch_count')::integer
        else 0
      end,
      case
        when audit.new_values->>'biometric_punch_count' ~ '^[0-9]+$'
          then (audit.new_values->>'biometric_punch_count')::integer
        else 0
      end
    )) as confirmed_punch_count
  from public.audit_logs audit
  where audit.table_name = 'attendance_logs'
    and (
      audit.old_values ? 'biometric_punch_count'
      or audit.new_values ? 'biometric_punch_count'
    )
  group by audit.record_id
)
update public.attendance_logs attendance
set biometric_punch_count = greatest(
      attendance.biometric_punch_count,
      audited.confirmed_punch_count
    ),
    updated_at = now()
from audited_counts audited
where attendance.id = audited.attendance_id
  and audited.confirmed_punch_count > attendance.biometric_punch_count;

notify pgrst, 'reload schema';
