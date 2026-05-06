-- ============================================================
-- CREATE AUDIT LOGGING TRIGGERS
-- Only for tables that exist
-- ============================================================

-- 1. Create audit function
CREATE OR REPLACE FUNCTION log_audit_trigger()
RETURNS TRIGGER AS $$
DECLARE
  old_data JSONB;
  new_data JSONB;
  changed_cols TEXT[];
  col_name TEXT;
BEGIN
  IF TG_OP = 'DELETE' THEN
    old_data = to_jsonb(OLD);
    new_data = NULL;
    changed_cols = NULL;
    
    INSERT INTO audit_logs (table_name, record_id, action, old_values, new_values, changed_columns, performed_by)
    VALUES (TG_TABLE_NAME, OLD.id, 'DELETE', old_data, new_data, changed_cols, auth.uid());
    
    RETURN OLD;
  ELSIF TG_OP = 'UPDATE' THEN
    old_data = to_jsonb(OLD);
    new_data = to_jsonb(NEW);
    changed_cols = ARRAY[]::TEXT[];
    
    -- Find changed columns
    FOR col_name IN SELECT jsonb_object_keys(new_data) LOOP
      IF old_data->col_name IS DISTINCT FROM new_data->col_name THEN
        changed_cols = array_append(changed_cols, col_name);
      END IF;
    END LOOP;
    
    INSERT INTO audit_logs (table_name, record_id, action, old_values, new_values, changed_columns, performed_by)
    VALUES (TG_TABLE_NAME, NEW.id, 'UPDATE', old_data, new_data, changed_cols, auth.uid());
    
    RETURN NEW;
  ELSIF TG_OP = 'INSERT' THEN
    old_data = NULL;
    new_data = to_jsonb(NEW);
    changed_cols = NULL;
    
    INSERT INTO audit_logs (table_name, record_id, action, old_values, new_values, changed_columns, performed_by)
    VALUES (TG_TABLE_NAME, NEW.id, 'INSERT', old_data, new_data, changed_cols, auth.uid());
    
    RETURN NEW;
  END IF;
  
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

-- 2. Create triggers for existing tables only

-- Profiles trigger
DROP TRIGGER IF EXISTS audit_profiles ON profiles;
CREATE TRIGGER audit_profiles
AFTER INSERT OR UPDATE OR DELETE ON profiles
FOR EACH ROW EXECUTE FUNCTION log_audit_trigger();

-- Attendance logs trigger (if exists)
DROP TRIGGER IF EXISTS audit_attendance_logs ON attendance_logs;
CREATE TRIGGER audit_attendance_logs
AFTER INSERT OR UPDATE OR DELETE ON attendance_logs
FOR EACH ROW EXECUTE FUNCTION log_audit_trigger();

-- Leaves trigger (if exists)
DROP TRIGGER IF EXISTS audit_leaves ON leaves;
CREATE TRIGGER audit_leaves
AFTER INSERT OR UPDATE OR DELETE ON leaves
FOR EACH ROW EXECUTE FUNCTION log_audit_trigger();

-- Tasks trigger (if exists)
DROP TRIGGER IF EXISTS audit_tasks ON tasks;
CREATE TRIGGER audit_tasks
AFTER INSERT OR UPDATE OR DELETE ON tasks
FOR EACH ROW EXECUTE FUNCTION log_audit_trigger();

-- Activity logs trigger (if exists)
DROP TRIGGER IF EXISTS audit_activity_logs ON activity_logs;
CREATE TRIGGER audit_activity_logs
AFTER INSERT OR UPDATE OR DELETE ON activity_logs
FOR EACH ROW EXECUTE FUNCTION log_audit_trigger();

-- 3. Verify triggers are created
SELECT trigger_name, event_object_table, event_manipulation
FROM information_schema.triggers
WHERE trigger_schema = 'public'
AND trigger_name LIKE 'audit_%'
ORDER BY event_object_table;

-- 4. Check audit logs
SELECT COUNT(*) as audit_logs_count FROM audit_logs;
