-- BIOMETRIC_CRON_SECRET must be created in both Supabase Vault and the
-- biometric-attendance-sync Edge Function environment before deployment.

do $$
begin
  if exists(select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.unschedule(jobid)
    from cron.job
    where jobname in (
      'biometric-attendance-sync-every-2-minutes',
      'biometric-attendance-sync-every-minute'
    );

    perform cron.schedule(
      'biometric-attendance-sync-every-minute',
      '* * * * *',
      $job$
        select net.http_post(
          url := 'https://jidbrwpzfpbursihtvpg.supabase.co/functions/v1/biometric-attendance-sync',
          headers := jsonb_build_object(
            'Content-Type', 'application/json',
            'x-biometric-sync-source', 'pg_cron',
            'x-biometric-sync-secret', coalesce(
              (
                select decrypted_secret
                from vault.decrypted_secrets
                where name = 'BIOMETRIC_CRON_SECRET'
                limit 1
              ),
              'NOT_CONFIGURED'
            )
          ),
          body := '{}'::jsonb,
          timeout_milliseconds := 55000
        );
      $job$
    );
  end if;
end
$$;

-- Attendance and biometric writes are available only through protected RPCs.
do $$
begin
  if to_regclass('public.attendance_logs') is not null then
    revoke insert, update, delete on public.attendance_logs from authenticated;
  end if;
  if to_regclass('public.attendance_audit_logs') is not null then
    revoke insert, update, delete on public.attendance_audit_logs from authenticated;
  end if;
  if to_regclass('public.attendance_fraud_events') is not null then
    revoke insert, update, delete on public.attendance_fraud_events from authenticated;
  end if;
end
$$;

create or replace function public.rpc_batch_update_attendance_warnings(
  p_updates jsonb
)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare v_updated integer;
begin
  perform public.require_profile_admin();
  if jsonb_typeof(p_updates) <> 'array'
     or jsonb_array_length(p_updates) > 5000 then
    raise exception 'INVALID_WARNING_BATCH';
  end if;
  update public.attendance_logs attendance
  set warning = rows.warning,
      updated_at = now()
  from jsonb_to_recordset(p_updates) rows(id uuid, warning boolean)
  where attendance.id = rows.id
    and attendance.date = (now() at time zone 'Asia/Kolkata')::date;
  get diagnostics v_updated = row_count;
  return v_updated;
end;
$$;

revoke all on function public.rpc_batch_update_attendance_warnings(jsonb)
  from public, anon;
grant execute on function public.rpc_batch_update_attendance_warnings(jsonb)
  to authenticated;
