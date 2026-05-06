-- ============================================================
-- ATTENDANCE RECOVERY & BACKUP SYSTEM - CLEAN VERSION
-- Run this ONLY in Supabase SQL Editor
-- Do NOT copy TypeScript code into this file
-- ============================================================

-- ============================================================
-- STEP 1: ADD SOFT DELETE COLUMNS TO ATTENDANCE_LOGS
-- ============================================================

ALTER TABLE attendance_logs ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;
ALTER TABLE attendance_logs ADD COLUMN IF NOT EXISTS deleted_by UUID REFERENCES profiles(id) ON DELETE SET NULL;
ALTER TABLE attendance_logs ADD COLUMN IF NOT EXISTS deletion_reason TEXT;

CREATE INDEX IF NOT EXISTS idx_attendance_deleted_at ON attendance_logs(deleted_at);

-- ============================================================
-- STEP 2: CREATE ATTENDANCE BACKUP TABLE
-- ============================================================

CREATE TABLE IF NOT EXISTS attendance_logs_backup (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  original_id          UUID NOT NULL,
  user_id              UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  date                 DATE NOT NULL,
  checkin_time         TIMESTAMPTZ,
  checkout_time        TIMESTAMPTZ,
  checkin_location     JSONB,
  checkout_location    JSONB,
  attendance_type      TEXT DEFAULT 'OFFICE',
  office_id            UUID REFERENCES offices(id) ON DELETE SET NULL,
  distance_from_office INTEGER DEFAULT 0,
  warning              BOOLEAN DEFAULT false,
  status               TEXT DEFAULT 'CHECKED_IN',
  deleted_at           TIMESTAMPTZ,
  deleted_by           UUID REFERENCES profiles(id) ON DELETE SET NULL,
  deletion_reason      TEXT,
  backup_created_at    TIMESTAMPTZ DEFAULT now(),
  backup_restored_at   TIMESTAMPTZ,
  created_at           TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_attendance_backup_user_date ON attendance_logs_backup(user_id, date);
CREATE INDEX IF NOT EXISTS idx_attendance_backup_deleted_at ON attendance_logs_backup(deleted_at);
CREATE INDEX IF NOT EXISTS idx_attendance_backup_original_id ON attendance_logs_backup(original_id);

-- ============================================================
-- STEP 3: CREATE ATTENDANCE AUDIT LOG TABLE
-- ============================================================

CREATE TABLE IF NOT EXISTS attendance_audit_log (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  attendance_id        UUID,
  user_id              UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  action               TEXT NOT NULL CHECK (action IN ('INSERT', 'UPDATE', 'DELETE', 'RESTORE')),
  old_values           JSONB,
  new_values           JSONB,
  reason               TEXT,
  performed_by         UUID REFERENCES profiles(id) ON DELETE SET NULL,
  performed_at         TIMESTAMPTZ DEFAULT now(),
  ip_address           TEXT,
  user_agent           TEXT
);

CREATE INDEX IF NOT EXISTS idx_attendance_audit_user ON attendance_audit_log(user_id);
CREATE INDEX IF NOT EXISTS idx_attendance_audit_action ON attendance_audit_log(action);
CREATE INDEX IF NOT EXISTS idx_attendance_audit_date ON attendance_audit_log(performed_at DESC);

-- ============================================================
-- STEP 4: CREATE SOFT DELETE FUNCTION
-- ============================================================

CREATE OR REPLACE FUNCTION soft_delete_attendance(
  p_attendance_id UUID,
  p_deleted_by UUID,
  p_reason TEXT DEFAULT 'Manual deletion'
)
RETURNS TABLE (
  success BOOLEAN,
  message TEXT,
  backup_id UUID
) AS $$
DECLARE
  v_backup_id UUID;
  v_attendance RECORD;
BEGIN
  SELECT * INTO v_attendance FROM attendance_logs WHERE id = p_attendance_id;
  
  IF v_attendance IS NULL THEN
    RETURN QUERY SELECT false, 'Attendance record not found'::TEXT, NULL::UUID;
    RETURN;
  END IF;
  
  INSERT INTO attendance_logs_backup (
    original_id, user_id, date, checkin_time, checkout_time,
    checkin_location, checkout_location, attendance_type, office_id,
    distance_from_office, warning, status, deleted_at, deleted_by, deletion_reason
  ) VALUES (
    p_attendance_id, v_attendance.user_id, v_attendance.date,
    v_attendance.checkin_time, v_attendance.checkout_time,
    v_attendance.checkin_location, v_attendance.checkout_location,
    v_attendance.attendance_type, v_attendance.office_id,
    v_attendance.distance_from_office, v_attendance.warning,
    v_attendance.status, now(), p_deleted_by, p_reason
  ) RETURNING attendance_logs_backup.id INTO v_backup_id;
  
  UPDATE attendance_logs
  SET deleted_at = now(),
      deleted_by = p_deleted_by,
      deletion_reason = p_reason
  WHERE id = p_attendance_id;
  
  INSERT INTO attendance_audit_log (
    attendance_id, user_id, action, old_values, reason, performed_by
  ) VALUES (
    p_attendance_id, v_attendance.user_id, 'DELETE',
    row_to_json(v_attendance), p_reason, p_deleted_by
  );
  
  RETURN QUERY SELECT true, 'Attendance soft deleted successfully'::TEXT, v_backup_id;
END;
$$ LANGUAGE plpgsql;

-- ============================================================
-- STEP 5: CREATE RESTORE FUNCTION
-- ============================================================

CREATE OR REPLACE FUNCTION restore_attendance(
  p_backup_id UUID,
  p_restored_by UUID,
  p_reason TEXT DEFAULT 'Manual restoration'
)
RETURNS TABLE (
  success BOOLEAN,
  message TEXT,
  restored_id UUID
) AS $$
DECLARE
  v_backup RECORD;
  v_restored_id UUID;
BEGIN
  SELECT * INTO v_backup FROM attendance_logs_backup WHERE id = p_backup_id;
  
  IF v_backup IS NULL THEN
    RETURN QUERY SELECT false, 'Backup record not found'::TEXT, NULL::UUID;
    RETURN;
  END IF;
  
  IF EXISTS (SELECT 1 FROM attendance_logs WHERE id = v_backup.original_id AND deleted_at IS NOT NULL) THEN
    UPDATE attendance_logs
    SET deleted_at = NULL,
        deleted_by = NULL,
        deletion_reason = NULL
    WHERE id = v_backup.original_id
    RETURNING id INTO v_restored_id;
  ELSE
    INSERT INTO attendance_logs (
      id, user_id, date, checkin_time, checkout_time,
      checkin_location, checkout_location, attendance_type, office_id,
      distance_from_office, warning, status, created_at
    ) VALUES (
      v_backup.original_id, v_backup.user_id, v_backup.date,
      v_backup.checkin_time, v_backup.checkout_time,
      v_backup.checkin_location, v_backup.checkout_location,
      v_backup.attendance_type, v_backup.office_id,
      v_backup.distance_from_office, v_backup.warning,
      v_backup.status, now()
    ) RETURNING id INTO v_restored_id;
  END IF;
  
  UPDATE attendance_logs_backup
  SET backup_restored_at = now()
  WHERE id = p_backup_id;
  
  INSERT INTO attendance_audit_log (
    attendance_id, user_id, action, new_values, reason, performed_by
  ) VALUES (
    v_restored_id, v_backup.user_id, 'RESTORE',
    row_to_json(v_backup), p_reason, p_restored_by
  );
  
  RETURN QUERY SELECT true, 'Attendance restored successfully'::TEXT, v_restored_id;
END;
$$ LANGUAGE plpgsql;

-- ============================================================
-- STEP 6: CREATE GET DELETED ATTENDANCE FUNCTION
-- ============================================================

CREATE OR REPLACE FUNCTION get_deleted_attendance(
  p_user_id UUID DEFAULT NULL,
  p_start_date DATE DEFAULT NULL,
  p_end_date DATE DEFAULT NULL
)
RETURNS TABLE (
  backup_id UUID,
  original_id UUID,
  user_id UUID,
  employee_name TEXT,
  date DATE,
  checkin_time TIMESTAMPTZ,
  checkout_time TIMESTAMPTZ,
  status TEXT,
  deleted_at TIMESTAMPTZ,
  deleted_by_name TEXT,
  deletion_reason TEXT,
  backup_created_at TIMESTAMPTZ
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    alb.id,
    alb.original_id,
    alb.user_id,
    p.name,
    alb.date,
    alb.checkin_time,
    alb.checkout_time,
    alb.status,
    alb.deleted_at,
    p2.name,
    alb.deletion_reason,
    alb.backup_created_at
  FROM attendance_logs_backup alb
  LEFT JOIN profiles p ON alb.user_id = p.id
  LEFT JOIN profiles p2 ON alb.deleted_by = p2.id
  WHERE (p_user_id IS NULL OR alb.user_id = p_user_id)
    AND (p_start_date IS NULL OR alb.date >= p_start_date)
    AND (p_end_date IS NULL OR alb.date <= p_end_date)
    AND alb.backup_restored_at IS NULL
  ORDER BY alb.deleted_at DESC;
END;
$$ LANGUAGE plpgsql;

-- ============================================================
-- STEP 7: CREATE DELETED ATTENDANCE VIEW
-- ============================================================

CREATE OR REPLACE VIEW deleted_attendance_view AS
SELECT
  alb.id as backup_id,
  alb.original_id,
  alb.user_id,
  p.name as employee_name,
  p.employee_number,
  p.phone,
  o.name as office_name,
  alb.date,
  alb.checkin_time,
  alb.checkout_time,
  alb.status,
  alb.deleted_at,
  p2.name as deleted_by_name,
  alb.deletion_reason,
  alb.backup_created_at,
  alb.backup_restored_at
FROM attendance_logs_backup alb
LEFT JOIN profiles p ON alb.user_id = p.id
LEFT JOIN profiles p2 ON alb.deleted_by = p2.id
LEFT JOIN offices o ON alb.office_id = o.id
WHERE alb.backup_restored_at IS NULL
ORDER BY alb.deleted_at DESC;

-- ============================================================
-- STEP 8: CREATE ACTIVE ATTENDANCE VIEW
-- ============================================================

CREATE OR REPLACE VIEW active_attendance_logs AS
SELECT *
FROM attendance_logs
WHERE deleted_at IS NULL;

-- ============================================================
-- STEP 9: DISABLE RLS
-- ============================================================

ALTER TABLE attendance_logs_backup DISABLE ROW LEVEL SECURITY;
ALTER TABLE attendance_audit_log DISABLE ROW LEVEL SECURITY;

-- ============================================================
-- VERIFICATION - Run these to verify setup
-- ============================================================

SELECT '✅ Soft delete columns added' AS step_1;

SELECT COUNT(*) as backup_table_exists FROM information_schema.tables WHERE table_name = 'attendance_logs_backup';

SELECT COUNT(*) as audit_table_exists FROM information_schema.tables WHERE table_name = 'attendance_audit_log';

SELECT COUNT(*) as functions_created FROM information_schema.routines 
WHERE routine_name IN ('soft_delete_attendance', 'restore_attendance', 'get_deleted_attendance');

SELECT '✅ Attendance recovery system setup complete!' AS final_status;
