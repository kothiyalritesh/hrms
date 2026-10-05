-- Add date_of_birth to profiles
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS date_of_birth DATE;

-- Create view for upcoming birthdays in the next 30 days
CREATE OR REPLACE VIEW public.upcoming_birthdays_30_days AS
WITH curr_year AS (
  SELECT extract(year FROM current_date)::int as y
),
dob_this_year AS (
  SELECT 
    id AS user_id,
    name,
    date_of_birth,
    (date_of_birth + ((curr_year.y - extract(year FROM date_of_birth)::int) || ' years')::interval)::date AS birthday_this_year
  FROM public.profiles
  CROSS JOIN curr_year
  WHERE date_of_birth IS NOT NULL AND is_active = true
),
next_bday AS (
  SELECT
    user_id,
    name,
    date_of_birth,
    CASE 
      WHEN birthday_this_year >= current_date THEN birthday_this_year
      ELSE birthday_this_year + interval '1 year'
    END::date AS next_birthday
  FROM dob_this_year
)
SELECT *
FROM next_bday
WHERE next_birthday BETWEEN current_date AND current_date + interval '30 days'
ORDER BY next_birthday ASC;

-- Grant access to the view
GRANT SELECT ON public.upcoming_birthdays_30_days TO authenticated;
