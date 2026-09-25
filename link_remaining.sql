-- Link remaining employee codes and backfill
UPDATE public.profiles
SET smartoffice_employee_code = employee_number
WHERE employee_number IN ('136011', '136012', '248208', '248239', '800045', '8235', '260194', 'AA227', '260168', '260721')
  AND smartoffice_employee_code IS NULL;

UPDATE public.smartoffice_device_logs dl
SET user_id = p.id
FROM public.profiles p
WHERE (p.smartoffice_employee_code = dl.employee_code OR p.employee_number = dl.employee_code)
  AND p.is_active = true
  AND dl.user_id IS NULL;
