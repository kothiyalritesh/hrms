-- ============================================================
-- ATTENDANCE RECOVERY & BACKUP SYSTEM
-- ============================================================

-- ============================================================
-- 1. ADD SOFT DELETE COLUMNS TO ATTENDANCE_LOGS
-- ============================================================

ALTER TABLE attendance_logs ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;
ALTER TABLE attendance_logs ADD COLUMN IF NOT EXISTS deleted_by UUID REFERENCES profiles(id) ON DELETE SET NULL;
ALTER TABLE attendance_logs ADD COLUMN IF NOT EXISTS deletion_reason TEXT;

CREATE INDEX IF NOT EXISTS idx_attendance_deleted_at ON attendance_logs(deleted_at);

-- ============================================================
-- 2. CREATE ATTENDANCE BACKUP TABLE
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
-- 3. CREATE ATTENDANCE AUDIT LOG
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
-- 4. CREATE FUNCTION TO SOFT DELETE ATTENDANCE
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
  -- Get the attendance record
  SELECT * INTO v_attendance FROM attendance_logs WHERE id = p_attendance_id;
  
  IF v_attendance IS NULL THEN
    RETURN QUERY SELECT false, 'Attendance record not found'::TEXT, NULL::UUID;
    RETURN;
  END IF;
  
  -- Create backup
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
  
  -- Soft delete from main table
  UPDATE attendance_logs
  SET deleted_at = now(),
      deleted_by = p_deleted_by,
      deletion_reason = p_reason
  WHERE id = p_attendance_id;
  
  -- Log to audit
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
-- 5. CREATE FUNCTION TO RESTORE ATTENDANCE
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
  -- Get the backup record
  SELECT * INTO v_backup FROM attendance_logs_backup WHERE id = p_backup_id;
  
  IF v_backup IS NULL THEN
    RETURN QUERY SELECT false, 'Backup record not found'::TEXT, NULL::UUID;
    RETURN;
  END IF;
  
  -- Check if original record still exists (soft deleted)
  IF EXISTS (SELECT 1 FROM attendance_logs WHERE id = v_backup.original_id AND deleted_at IS NOT NULL) THEN
    -- Restore the soft deleted record
    UPDATE attendance_logs
    SET deleted_at = NULL,
        deleted_by = NULL,
        deletion_reason = NULL
    WHERE id = v_backup.original_id
    RETURNING id INTO v_restored_id;
  ELSE
    -- Create new record from backup
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
  
  -- Update backup record
  UPDATE attendance_logs_backup
  SET backup_restored_at = now()
  WHERE id = p_backup_id;
  
  -- Log to audit
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
-- 6. CREATE FUNCTION TO GET DELETED ATTENDANCE
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
-- 7. CREATE VIEW FOR DELETED ATTENDANCE
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
-- 8. CREATE VIEW FOR ACTIVE ATTENDANCE (EXCLUDING SOFT DELETED)
-- ============================================================

CREATE OR REPLACE VIEW active_attendance_logs AS
SELECT *
FROM attendance_logs
WHERE deleted_at IS NULL;

-- ============================================================
-- 9. DISABLE RLS ON NEW TABLES
-- ============================================================

ALTER TABLE attendance_logs_backup DISABLE ROW LEVEL SECURITY;
ALTER TABLE attendance_audit_log DISABLE ROW LEVEL SECURITY;

-- ============================================================
-- 10. VERIFICATION QUERIES
-- ============================================================

-- Check if soft delete columns added
SELECT column_name, data_type
FROM information_schema.columns
WHERE table_name = 'attendance_logs'
AND column_name IN ('deleted_at', 'deleted_by', 'deletion_reason');

-- Check if backup table created
SELECT table_name
FROM information_schema.tables
WHERE table_name IN ('attendance_logs_backup', 'attendance_audit_log');

-- Check if functions created
SELECT routine_name
FROM information_schema.routines
WHERE routine_name IN ('soft_delete_attendance', 'restore_attendance', 'get_deleted_attendance');

SELECT '✅ Attendance recovery system setup complete!' AS status;
