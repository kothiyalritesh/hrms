-- ============================================================
-- Smart Geofence Violation Engine - Database Schema
-- ============================================================

-- 1. Geofence Violations Table
CREATE TABLE IF NOT EXISTS geofence_violations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  office_id UUID NOT NULL REFERENCES offices(id) ON DELETE CASCADE,
  office_name TEXT NOT NULL,
  distance_meters INTEGER NOT NULL,
  violation_type TEXT NOT NULL CHECK (violation_type IN ('safe', 'warning', 'violation')),
  checkin_time TIMESTAMP WITH TIME ZONE NOT NULL,
  date DATE NOT NULL,
  flagged BOOLEAN DEFAULT FALSE,
  manager_notified BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Indexes for performance
CREATE INDEX idx_geofence_violations_user_id ON geofence_violations(user_id);
CREATE INDEX idx_geofence_violations_date ON geofence_violations(date);
CREATE INDEX idx_geofence_violations_violation_type ON geofence_violations(violation_type);
CREATE INDEX idx_geofence_violations_flagged ON geofence_violations(flagged);
CREATE INDEX idx_geofence_violations_user_date ON geofence_violations(user_id, date);

-- 2. Compliance Status Table
CREATE TABLE IF NOT EXISTS compliance_status (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL UNIQUE REFERENCES profiles(id) ON DELETE CASCADE,
  is_compliant BOOLEAN DEFAULT TRUE,
  violations_this_week INTEGER DEFAULT 0,
  violations_this_month INTEGER DEFAULT 0,
  total_violations INTEGER DEFAULT 0,
  compliance_score INTEGER DEFAULT 100 CHECK (compliance_score >= 0 AND compliance_score <= 100),
  last_violation_date DATE,
  non_compliant_since TIMESTAMP WITH TIME ZONE,
  status TEXT DEFAULT 'compliant' CHECK (status IN ('compliant', 'warning', 'non_compliant')),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Indexes
CREATE INDEX idx_compliance_status_user_id ON compliance_status(user_id);
CREATE INDEX idx_compliance_status_status ON compliance_status(status);
CREATE INDEX idx_compliance_status_compliance_score ON compliance_status(compliance_score);

-- 3. Update attendance_logs table to include geofence violation type
ALTER TABLE attendance_logs 
ADD COLUMN IF NOT EXISTS geofence_violation_type TEXT DEFAULT 'safe' CHECK (geofence_violation_type IN ('safe', 'warning', 'violation'));

-- 4. Update performance_metrics table to include compliance data
ALTER TABLE performance_metrics
ADD COLUMN IF NOT EXISTS compliance_score INTEGER DEFAULT 100,
ADD COLUMN IF NOT EXISTS compliance_penalty NUMERIC DEFAULT 0,
ADD COLUMN IF NOT EXISTS adjusted_overall_score NUMERIC;

-- 5. Create audit trigger for geofence violations
CREATE OR REPLACE FUNCTION audit_geofence_violations()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO audit_logs (
    table_name,
    record_id,
    action,
    old_values,
    new_values,
    changed_columns,
    performed_by,
    performed_at
  ) VALUES (
    'geofence_violations',
    NEW.id,
    'INSERT',
    NULL,
    jsonb_build_object(
      'user_id', NEW.user_id,
      'office_name', NEW.office_name,
      'distance_meters', NEW.distance_meters,
      'violation_type', NEW.violation_type,
      'flagged', NEW.flagged
    ),
    ARRAY['user_id', 'office_name', 'distance_meters', 'violation_type', 'flagged'],
    auth.uid(),
    NOW()
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_audit_geofence_violations ON geofence_violations;
CREATE TRIGGER trigger_audit_geofence_violations
AFTER INSERT ON geofence_violations
FOR EACH ROW
EXECUTE FUNCTION audit_geofence_violations();

-- 6. Create view for compliance dashboard
CREATE OR REPLACE VIEW compliance_dashboard AS
SELECT
  cs.user_id,
  p.name AS employee_name,
  p.employee_number,
  p.email,
  o.name AS office_name,
  cs.is_compliant,
  cs.violations_this_week,
  cs.violations_this_month,
  cs.total_violations,
  cs.compliance_score,
  cs.status,
  cs.last_violation_date,
  cs.non_compliant_since,
  COUNT(CASE WHEN gv.violation_type = 'violation' THEN 1 END) AS flagged_violations_count,
  MAX(gv.date) AS most_recent_violation_date
FROM compliance_status cs
LEFT JOIN profiles p ON cs.user_id = p.id
LEFT JOIN offices o ON p.office_id = o.id
LEFT JOIN geofence_violations gv ON cs.user_id = gv.user_id AND gv.flagged = TRUE
GROUP BY cs.id, p.id, o.id;

-- 7. Create view for violation analytics
CREATE OR REPLACE VIEW violation_analytics AS
SELECT
  DATE_TRUNC('week', gv.date)::DATE AS week_start,
  o.name AS office_name,
  gv.violation_type,
  COUNT(*) AS violation_count,
  COUNT(DISTINCT gv.user_id) AS affected_employees,
  ROUND(AVG(gv.distance_meters)::NUMERIC, 2) AS avg_distance_meters,
  MAX(gv.distance_meters) AS max_distance_meters
FROM geofence_violations gv
LEFT JOIN offices o ON gv.office_id = o.id
GROUP BY DATE_TRUNC('week', gv.date), o.name, gv.violation_type
ORDER BY week_start DESC, office_name;

-- 8. Enable RLS on new tables
ALTER TABLE geofence_violations ENABLE ROW LEVEL SECURITY;
ALTER TABLE compliance_status ENABLE ROW LEVEL SECURITY;

-- 9. RLS Policies for geofence_violations
CREATE POLICY "Users can view their own violations" ON geofence_violations
  FOR SELECT USING (auth.uid() = user_id OR auth.uid() IN (
    SELECT id FROM profiles WHERE role IN ('SYSTEM_ADMIN', 'ADMIN', 'HR', 'HRD')
  ));

CREATE POLICY "Admins can view all violations" ON geofence_violations
  FOR SELECT USING (auth.uid() IN (
    SELECT id FROM profiles WHERE role IN ('SYSTEM_ADMIN', 'ADMIN', 'HR', 'HRD')
  ));

-- 10. RLS Policies for compliance_status
CREATE POLICY "Users can view their own compliance" ON compliance_status
  FOR SELECT USING (auth.uid() = user_id OR auth.uid() IN (
    SELECT id FROM profiles WHERE role IN ('SYSTEM_ADMIN', 'ADMIN', 'HR', 'HRD')
  ));

CREATE POLICY "Admins can view all compliance" ON compliance_status
  FOR SELECT USING (auth.uid() IN (
    SELECT id FROM profiles WHERE role IN ('SYSTEM_ADMIN', 'ADMIN', 'HR', 'HRD')
  ));

-- 11. Grant permissions
GRANT SELECT ON geofence_violations TO authenticated;
GRANT SELECT ON compliance_status TO authenticated;
GRANT SELECT ON compliance_dashboard TO authenticated;
GRANT SELECT ON violation_analytics TO authenticated;
