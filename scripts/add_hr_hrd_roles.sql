-- ============================================================
-- Add HR and HRD roles + escalation access
-- Run in Supabase SQL Editor
-- ============================================================

-- 1. Add HR and HRD to roles table (if roles table exists)
INSERT INTO roles (name) VALUES ('HR'), ('HRD')
ON CONFLICT (name) DO NOTHING;

-- 2. Update any profiles that have role = 'HR' or 'HRD' as text
--    (in case they were added manually)
UPDATE profiles SET role = 'HR'  WHERE LOWER(TRIM(role)) = 'hr';
UPDATE profiles SET role = 'HRD' WHERE LOWER(TRIM(role)) = 'hrd';

-- 3. Auto-add HR and HRD profiles to escalation_matrix
--    so they get location alerts and can see Live Tracking
INSERT INTO escalation_matrix (user_id, label, notify_gps_off, notify_out_range, notify_no_data)
SELECT p.id, p.role || ' - ' || p.name, TRUE, TRUE, TRUE
FROM profiles p
WHERE p.role IN ('HR', 'HRD')
  AND p.is_active = TRUE
ON CONFLICT (user_id) DO UPDATE
  SET notify_gps_off   = TRUE,
      notify_out_range = TRUE,
      notify_no_data   = TRUE;

-- 4. Flag them as escalation members for fast lookup
UPDATE profiles
SET is_escalation_member = TRUE
WHERE role IN ('HR', 'HRD') AND is_active = TRUE;

SELECT 'HR/HRD roles configured' AS status;
