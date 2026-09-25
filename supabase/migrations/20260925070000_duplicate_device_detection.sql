-- Migration: Duplicate Device Detection View (Module 11)
-- Description: Creates a view to identify devices that are being used by multiple employees to check in.

CREATE OR REPLACE VIEW public.v_duplicate_device_usage AS
WITH device_counts AS (
  SELECT 
    device_fingerprint,
    count(DISTINCT user_id) as users_count
  FROM public.employee_device_bindings
  GROUP BY device_fingerprint
  HAVING count(DISTINCT user_id) > 1
)
SELECT 
  d.device_fingerprint,
  d.device_name,
  d.platform,
  d.app_version,
  d.user_id,
  p.name as employee_name,
  p.employee_number,
  d.last_verified_at as last_used,
  c.users_count
FROM public.employee_device_bindings d
JOIN device_counts c ON c.device_fingerprint = d.device_fingerprint
JOIN public.profiles p ON p.id = d.user_id
ORDER BY c.users_count DESC, d.device_fingerprint, d.last_verified_at DESC;

-- Also let's grant access
GRANT SELECT ON public.v_duplicate_device_usage TO authenticated;
