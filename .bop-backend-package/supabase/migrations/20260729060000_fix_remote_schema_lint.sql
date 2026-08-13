-- Remove an unused broken diagnostic RPC and repair the day-end field-visit
-- function reported by `supabase db lint --linked`.

drop function if exists public.get_deleted_attendance();

create or replace function public.auto_checkout_field_visits()
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_business_date date := (now() at time zone 'Asia/Kolkata')::date;
begin
  update public.field_visits
  set status = 'COMPLETED',
      checkout_time = now(),
      checkout_notes = 'Auto checked out at end of business day'
  where status = 'CHECKED_IN'
    and date = v_business_date;
end;
$$;

revoke all on function public.auto_checkout_field_visits()
  from public, anon, authenticated;
grant execute on function public.auto_checkout_field_visits()
  to service_role;
