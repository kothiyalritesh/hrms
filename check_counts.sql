CREATE OR REPLACE FUNCTION public.check_counts()
RETURNS jsonb LANGUAGE sql SECURITY DEFINER AS $$
  SELECT jsonb_build_object(
    'punches', (SELECT count(*) FROM public.biometric_device_punches),
    'mappings', (SELECT count(*) FROM public.employee_biometric_mappings)
  );
$$;