GRANT SELECT ON public.v_attendance_daily_canonical TO authenticated;

GRANT SELECT ON public.v_attendance_daily_canonical TO anon;

GRANT SELECT ON public.v_attendance_daily_canonical TO service_role;

CREATE FUNCTION public.rpc_my_attendance_daily_v3(p_start date, p_end date) RETURNS SETOF public.v_attendance_daily_canonical
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
  select normalized.*
  from public.v_attendance_daily_canonical row_data
  cross join lateral jsonb_populate_record(
    null::public.v_attendance_daily_canonical,
    to_jsonb(row_data) || jsonb_build_object(
      'attendance_status',
      public.effective_canonical_attendance_status(
        row_data.attendance_status,
        row_data.official_first_in,
        row_data.official_last_out,
        row_data.has_field_visit,
        row_data.is_late
      )
    )
  ) normalized
  where row_data.user_id = auth.uid()
    and row_data.work_date between p_start and p_end
  order by row_data.work_date desc
  limit 367
$$;

NOTIFY pgrst, 'reload schema';