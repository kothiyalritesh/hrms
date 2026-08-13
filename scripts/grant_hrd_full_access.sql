-- ============================================================
-- Grant HRD (and HR) Full Admin Rights
-- Run this in Supabase SQL Editor
-- ============================================================

-- 1. Ensure HRD role exists in roles table
INSERT INTO roles (name) VALUES ('HRD')
ON CONFLICT (name) DO NOTHING;

-- 2. Normalise any case variations in profiles
UPDATE profiles SET role = 'HRD' WHERE LOWER(TRIM(role)) = 'hrd';
UPDATE profiles SET role = 'HR'  WHERE LOWER(TRIM(role)) = 'hr';

-- 3. Rename "Greater Noida 136" → "Noida 136" everywhere
DO $$
DECLARE
  old_id UUID;
  new_id UUID;
BEGIN
  SELECT id INTO old_id FROM offices WHERE name = 'Greater Noida 136' LIMIT 1;
  SELECT id INTO new_id FROM offices WHERE name = 'Noida 136' LIMIT 1;

  IF old_id IS NULL THEN
    -- Nothing to do, already clean
    RETURN;
  END IF;

  IF new_id IS NULL THEN
    -- Safe to rename directly, no duplicate
    UPDATE offices SET name = 'Noida 136' WHERE id = old_id;
  ELSE
    -- Merge: point all FK references from old_id → new_id, then delete old
    UPDATE profiles        SET office_id = new_id WHERE office_id = old_id;
    UPDATE attendance_logs SET office_id = new_id WHERE office_id = old_id;
    DELETE FROM offices WHERE id = old_id;
  END IF;
END;
$$;
UPDATE profiles SET team = 'Noida 136' WHERE team = 'Greater Noida 136';

-- ─── Disable RLS on all tables (custom auth — auth.uid() is always NULL) ──────
ALTER TABLE profiles                DISABLE ROW LEVEL SECURITY;
ALTER TABLE leaves                  DISABLE ROW LEVEL SECURITY;
ALTER TABLE leave_balance           DISABLE ROW LEVEL SECURITY;
ALTER TABLE attendance_logs         DISABLE ROW LEVEL SECURITY;
ALTER TABLE activity_logs           DISABLE ROW LEVEL SECURITY;
ALTER TABLE notifications           DISABLE ROW LEVEL SECURITY;
ALTER TABLE field_visits            DISABLE ROW LEVEL SECURITY;
ALTER TABLE tasks                   DISABLE ROW LEVEL SECURITY;
ALTER TABLE offices                 DISABLE ROW LEVEL SECURITY;
ALTER TABLE roles                   DISABLE ROW LEVEL SECURITY;
ALTER TABLE support_tickets         DISABLE ROW LEVEL SECURITY;
ALTER TABLE events                  DISABLE ROW LEVEL SECURITY;
ALTER TABLE predefined_sites        DISABLE ROW LEVEL SECURITY;
ALTER TABLE location_tracking       DISABLE ROW LEVEL SECURITY;
ALTER TABLE location_alerts         DISABLE ROW LEVEL SECURITY;
ALTER TABLE location_ping_requests  DISABLE ROW LEVEL SECURITY;
ALTER TABLE escalation_matrix       DISABLE ROW LEVEL SECURITY;
ALTER TABLE escalation_log          DISABLE ROW LEVEL SECURITY;
ALTER TABLE audit_logs              DISABLE ROW LEVEL SECURITY;

-- ─── Add all HRD (and HR) users to escalation_matrix ─────────────────────────
-- This gives them Live Tracking alerts and Reports tab access
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

-- Mark as escalation members (used by MainTabNavigator to show HR Panel tab)
UPDATE profiles
SET is_escalation_member = TRUE
WHERE role IN ('HR', 'HRD') AND is_active = TRUE;

-- ─── Recreate admin_attendance_export view ───────────────────────────────────
DROP VIEW IF EXISTS admin_attendance_export;
CREATE VIEW admin_attendance_export AS
SELECT
  al.id,
  al.user_id,
  al.date,
  al.checkin_time,
  al.checkout_time,
  al.status,
  al.distance_from_office,
  al.warning,
  al.attendance_type,
  al.office_id,
  p.name            AS employee_name,
  p.employee_number,
  p.email,
  p.phone,
  p.team,
  p.role            AS designation,
  o.name            AS office_name
FROM attendance_logs al
LEFT JOIN profiles p ON al.user_id = p.id
LEFT JOIN offices  o ON al.office_id = o.id
ORDER BY al.date DESC, al.checkin_time DESC;

-- ─── Verify ───────────────────────────────────────────────────────────────────
SELECT
  p.name,
  p.role,
  p.is_escalation_member,
  em.notify_gps_off,
  em.notify_out_range
FROM profiles p
LEFT JOIN escalation_matrix em ON em.user_id = p.id
WHERE p.role IN ('HR', 'HRD')
ORDER BY p.role, p.name;

SELECT 'HRD full access granted successfully' AS status;
