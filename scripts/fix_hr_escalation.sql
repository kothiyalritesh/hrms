-- ============================================================
-- Fix: Add all HR/HRD users to escalation_matrix
-- Run in Supabase SQL Editor
-- ============================================================

-- Add HR/HRD to escalation matrix so they get location alerts
INSERT INTO escalation_matrix (user_id, label, notify_gps_off, notify_out_range, notify_no_data)
SELECT
  p.id,
  p.role || ' - ' || p.name,
  TRUE, TRUE, TRUE
FROM profiles p
WHERE p.role IN ('HR', 'HRD')
  AND p.is_active = TRUE
ON CONFLICT (user_id) DO UPDATE
  SET notify_gps_off   = TRUE,
      notify_out_range = TRUE,
      notify_no_data   = TRUE;

-- Mark them as escalation members
UPDATE profiles
SET is_escalation_member = TRUE
WHERE role IN ('HR', 'HRD') AND is_active = TRUE;

-- Verify
SELECT p.name, p.role, em.label
FROM escalation_matrix em
JOIN profiles p ON p.id = em.user_id
ORDER BY p.role, p.name;
