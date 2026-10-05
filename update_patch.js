const fs = require('fs');

const sql = `
CREATE OR REPLACE FUNCTION public.resolve_hrms_calendar_day(p_user_id uuid, p_date date)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
WITH person AS (
  SELECT id, office_id, team_id, weekly_off_day FROM public.profiles WHERE id = p_user_id
), candidates AS (
  SELECT 'HOLIDAY'::text AS kind, h.name AS label,
    CASE WHEN h.user_id IS NOT NULL THEN 4 WHEN h.team_id IS NOT NULL THEN 3 WHEN h.office_id IS NOT NULL THEN 2 ELSE 1 END AS specificity,
    h.id AS rule_id
  FROM public.holiday_calendar h CROSS JOIN person p
  WHERE h.is_active AND NOT h.is_optional AND h.holiday_date = p_date
    AND (h.user_id = p.id OR h.team_id = p.team_id OR h.office_id = p.office_id
      OR (h.user_id IS NULL AND h.team_id IS NULL AND h.office_id IS NULL))
  UNION ALL
  SELECT 'WEEKLY_OFF', to_char(p_date, 'FMDay'),
    CASE WHEN w.user_id IS NOT NULL THEN 4 WHEN w.team_id IS NOT NULL THEN 3 WHEN w.office_id IS NOT NULL THEN 2 ELSE 1 END,
    w.id
  FROM public.weekly_off_rules w CROSS JOIN person p
  WHERE w.is_active AND p_date BETWEEN w.valid_from AND coalesce(w.valid_to, 'infinity'::date)
    AND w.weekday = extract(dow from p_date)::integer
    AND (w.week_of_month IS NULL OR w.week_of_month = ((extract(day from p_date)::integer - 1) / 7) + 1)
    AND (w.user_id = p.id OR w.team_id = p.team_id OR w.office_id = p.office_id
      OR (w.user_id IS NULL AND w.team_id IS NULL AND w.office_id IS NULL))
  UNION ALL
  SELECT 'WEEKLY_OFF', to_char(p_date, 'FMDay'), 4 AS specificity, NULL::uuid AS rule_id
  FROM person p
  WHERE p.weekly_off_day IS NOT NULL AND p.weekly_off_day = extract(dow from p_date)::integer
)
SELECT coalesce((
  SELECT jsonb_build_object('kind', kind, 'label', label, 'specificity', specificity, 'rule_id', rule_id)
  FROM candidates ORDER BY specificity DESC, CASE kind WHEN 'HOLIDAY' THEN 0 ELSE 1 END LIMIT 1
), jsonb_build_object('kind', 'WORKING_DAY', 'specificity', 0));
$$;
`;

fs.appendFileSync('weekly_off_patch.sql', '\n\n-- Phase 4: Integration with Attendance\n' + sql);
console.log("Updated patch with resolve_hrms_calendar_day");
