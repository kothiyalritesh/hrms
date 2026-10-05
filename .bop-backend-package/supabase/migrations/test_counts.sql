CREATE OR REPLACE FUNCTION public.count_rows_debug()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  fv_count int;
  att_count int;
BEGIN
  SELECT count(*) INTO fv_count FROM public.field_visits;
  SELECT count(*) INTO att_count FROM public.attendance_logs;
  RETURN jsonb_build_object('field_visits', fv_count, 'attendance_logs', att_count);
END;
$$;
