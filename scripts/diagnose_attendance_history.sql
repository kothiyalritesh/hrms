-- Step 1: See who the 5 employees without office are
SELECT
  id,
  name,
  phone,
  role,
  created_at::date AS joined_on
FROM public.profiles
WHERE is_active = true
  AND office_id IS NULL
ORDER BY name;

-- Step 2: See all available offices (to know which office_id to assign)
SELECT id, name FROM public.offices ORDER BY name;

