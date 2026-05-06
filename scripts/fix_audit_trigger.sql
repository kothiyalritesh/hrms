-- ============================================================
-- CHECK AUDIT_LOGS TABLE STRUCTURE
-- ============================================================

-- Check columns
SELECT column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_name = 'audit_logs'
ORDER BY ordinal_position;

-- ============================================================
-- CREATE FIXED AUDIT LOGGING TRIGGER
-- ============================================================

CREATE OR REPLACE FUNCTION log_audit_trigger()
RETURNS TRIGGER AS $$
DECLARE
  old_data JSONB;
  new_data JSONB;
BEGIN
  IF TG_OP = 'DELETE' THEN
    old_data = to_jsonb(OLD);
    new_data = NULL;
    
    INSERT INTO audit_logs (table_name, record_id, action, old_values, new_values, performed_by, performed_at)
    VALUES (TG_TABLE_NAME, OLD.id, 'DELETE', old_data, new_data, auth.uid(), NOW());
    
    RETURN OLD;
  ELSIF TG_OP = 'UPDATE' THEN
    old_data = to_jsonb(OLD);
    new_data = to_jsonb(NEW);
    
    INSERT INTO audit_logs (table_name, record_id, action, old_values, new_values, performed_by, performed_at)
    VALUES (TG_TABLE_NAME, NEW.id, 'UPDATE', old_data, new_data, auth.uid(), NOW());
    
    RETURN NEW;
  ELSIF TG_OP = 'INSERT' THEN
    old_data = NULL;
    new_data = to_jsonb(NEW);
    
    INSERT INTO audit_logs (table_name, record_id, action, old_values, new_values, performed_by, performed_at)
    VALUES (TG_TABLE_NAME, NEW.id, 'INSERT', old_data, new_data, auth.uid(), NOW());
    
    RETURN NEW;
  END IF;
  
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

-- Recreate all triggers with the fixed function
DROP TRIGGER IF EXISTS audit_profiles ON profiles;
CREATE TRIGGER audit_profiles
AFTER INSERT OR UPDATE OR DELETE ON profiles
FOR EACH ROW EXECUTE FUNCTION log_audit_trigger();

DROP TRIGGER IF EXISTS audit_attendance_logs ON attendance_logs;
CREATE TRIGGER audit_attendance_logs
AFTER INSERT OR UPDATE OR DELETE ON attendance_logs
FOR EACH ROW EXECUTE FUNCTION log_audit_trigger();

DROP TRIGGER IF EXISTS audit_leaves ON leaves;
CREATE TRIGGER audit_leaves
AFTER INSERT OR UPDATE OR DELETE ON leaves
FOR EACH ROW EXECUTE FUNCTION log_audit_trigger();

DROP TRIGGER IF EXISTS audit_tasks ON tasks;
CREATE TRIGGER audit_tasks
AFTER INSERT OR UPDATE OR DELETE ON tasks
FOR EACH ROW EXECUTE FUNCTION log_audit_trigger();

DROP TRIGGER IF EXISTS audit_activity_logs ON activity_logs;
CREATE TRIGGER audit_activity_logs
AFTER INSERT OR UPDATE OR DELETE ON activity_logs
FOR EACH ROW EXECUTE FUNCTION log_audit_trigger();

-- Verify triggers
SELECT trigger_name, event_object_table
FROM information_schema.triggers
WHERE trigger_schema = 'public'
AND trigger_name LIKE 'audit_%'
ORDER BY event_object_table;
