-- ============================================================
-- PHASE 1: DATABASE SCHEMA NORMALIZATION
-- Run this in Supabase SQL Editor
-- ============================================================

-- 1. CREATE departments TABLE
CREATE TABLE IF NOT EXISTS departments (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name VARCHAR(255) NOT NULL,
  code VARCHAR(50) UNIQUE,
  description TEXT,
  parent_id UUID REFERENCES departments(id) ON DELETE SET NULL,
  head_employee_id UUID REFERENCES profiles(id) ON DELETE SET NULL,
  budget_allocated DECIMAL(15,2) DEFAULT 0,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  deleted_at TIMESTAMP DEFAULT NULL
);

-- 2. CREATE designations TABLE
CREATE TABLE IF NOT EXISTS designations (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name VARCHAR(255) NOT NULL,
  code VARCHAR(50) UNIQUE,
  department_id UUID REFERENCES departments(id) ON DELETE SET NULL,
  level INTEGER DEFAULT 1, -- 1=entry, 2=mid, 3=senior, 4=lead, 5=manager, 6=director, 7=CXO
  description TEXT,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  deleted_at TIMESTAMP DEFAULT NULL
);

-- 3. ENHANCE profiles TABLE (add missing FKs and lifecycle fields)
-- Add columns if they don't exist
DO $$
BEGIN
  -- department_id
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'profiles' AND column_name = 'department_id') THEN
    ALTER TABLE profiles ADD COLUMN department_id UUID REFERENCES departments(id) ON DELETE SET NULL;
  END IF;

  -- designation_id
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'profiles' AND column_name = 'designation_id') THEN
    ALTER TABLE profiles ADD COLUMN designation_id UUID REFERENCES designations(id) ON DELETE SET NULL;
  END IF;

  -- employment_status
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'profiles' AND column_name = 'employment_status') THEN
    ALTER TABLE profiles ADD COLUMN employment_status VARCHAR(50) DEFAULT 'ACTIVE' CHECK (employment_status IN ('CANDIDATE', 'ONBOARDING', 'ACTIVE', 'SUSPENDED', 'NOTICE_PERIOD', 'EXITED'));
  END IF;

  -- joining_date
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'profiles' AND column_name = 'joining_date') THEN
    ALTER TABLE profiles ADD COLUMN joining_date DATE;
  END IF;

  -- exit_date
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'profiles' AND column_name = 'exit_date') THEN
    ALTER TABLE profiles ADD COLUMN exit_date DATE;
  END IF;

  -- deleted_at (soft delete)
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'profiles' AND column_name = 'deleted_at') THEN
    ALTER TABLE profiles ADD COLUMN deleted_at TIMESTAMP DEFAULT NULL;
  END IF;

  -- company_id (for future multi-tenancy)
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'profiles' AND column_name = 'company_id') THEN
    ALTER TABLE profiles ADD COLUMN company_id UUID DEFAULT NULL;
  END IF;
END $$;

-- 4. CREATE employee_meta TABLE
CREATE TABLE IF NOT EXISTS employee_meta (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  employee_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  
  -- KYC Documents
  pan_number VARCHAR(20),
  aadhaar_number VARCHAR(20),
  passport_number VARCHAR(50),
  voter_id VARCHAR(50),
  driving_license VARCHAR(50),
  
  -- Bank Details
  bank_name VARCHAR(255),
  bank_account_number VARCHAR(100),
  bank_ifsc_code VARCHAR(20),
  bank_branch VARCHAR(255),
  
  -- Emergency Contacts
  emergency_contact_name VARCHAR(255),
  emergency_contact_phone VARCHAR(20),
  emergency_contact_relationship VARCHAR(50),
  emergency_contact_address TEXT,
  
  -- Custom Fields (flexible JSONB)
  custom_fields JSONB DEFAULT '{}',
  
  -- Metadata
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- Create unique index on employee_id (one meta record per employee)
CREATE UNIQUE INDEX IF NOT EXISTS idx_employee_meta_employee_id ON employee_meta(employee_id);

-- 5. CREATE audit_logs TABLE
CREATE TABLE IF NOT EXISTS audit_logs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  table_name VARCHAR(100) NOT NULL,
  record_id UUID NOT NULL,
  action VARCHAR(20) NOT NULL CHECK (action IN ('INSERT', 'UPDATE', 'DELETE')),
  old_values JSONB DEFAULT NULL,
  new_values JSONB DEFAULT NULL,
  changed_columns TEXT[] DEFAULT NULL,
  performed_by UUID REFERENCES profiles(id) ON DELETE SET NULL,
  performed_at TIMESTAMP DEFAULT NOW(),
  ip_address INET,
  user_agent TEXT
);

-- Indexes for audit_logs
CREATE INDEX IF NOT EXISTS idx_audit_logs_table_record ON audit_logs(table_name, record_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_performed_by ON audit_logs(performed_by);
CREATE INDEX IF NOT EXISTS idx_audit_logs_performed_at ON audit_logs(performed_at);

-- 6. CREATE FUNCTION for automatic audit logging
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
    VALUES (TG_TABLE_NAME, OLD.id, 'DELETE', old_data, new_data, changed_cols, NULL);
    
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
    VALUES (TG_TABLE_NAME, NEW.id, 'UPDATE', old_data, new_data, changed_cols, NULL);
    
    RETURN NEW;
  ELSIF TG_OP = 'INSERT' THEN
    old_data = NULL;
    new_data = to_jsonb(NEW);
    changed_cols = NULL;
    
    INSERT INTO audit_logs (table_name, record_id, action, old_values, new_values, changed_columns, performed_by)
    VALUES (TG_TABLE_NAME, NEW.id, 'INSERT', old_data, new_data, changed_cols, NULL);
    
    RETURN NEW;
  END IF;
  
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

-- 7. CREATE TRIGGERS for audit logging on key tables
-- Profiles audit trigger
DROP TRIGGER IF EXISTS audit_profiles ON profiles;
CREATE TRIGGER audit_profiles
AFTER INSERT OR UPDATE OR DELETE ON profiles
FOR EACH ROW EXECUTE FUNCTION log_audit_trigger();

-- Departments audit trigger
DROP TRIGGER IF EXISTS audit_departments ON departments;
CREATE TRIGGER audit_departments
AFTER INSERT OR UPDATE OR DELETE ON departments
FOR EACH ROW EXECUTE FUNCTION log_audit_trigger();

-- Designations audit trigger
DROP TRIGGER IF EXISTS audit_designations ON designations;
CREATE TRIGGER audit_designations
AFTER INSERT OR UPDATE OR DELETE ON designations
FOR EACH ROW EXECUTE FUNCTION log_audit_trigger();

-- Employee meta audit trigger
DROP TRIGGER IF EXISTS audit_employee_meta ON employee_meta;
CREATE TRIGGER audit_employee_meta
AFTER INSERT OR UPDATE OR DELETE ON employee_meta
FOR EACH ROW EXECUTE FUNCTION log_audit_trigger();

-- 8. CREATE VIEW for active employees (excludes soft-deleted)
CREATE OR REPLACE VIEW active_employees AS
SELECT p.*, d.name AS department_name, des.name AS designation_name
FROM profiles p
LEFT JOIN departments d ON p.department_id = d.id
LEFT JOIN designations des ON p.designation_id = des.id
WHERE p.deleted_at IS NULL AND p.is_active = true;

-- 9. CREATE VIEW for employee directory
CREATE OR REPLACE VIEW employee_directory AS
SELECT 
  p.id,
  p.name,
  p.email,
  p.phone,
  p.employee_number,
  p.employment_status,
  p.joining_date,
  p.exit_date,
  p.is_active,
  d.name AS department_name,
  des.name AS designation_name,
  des.level AS designation_level,
  r.name AS role_name,
  o.name AS office_name,
  mgr.name AS reporting_manager_name,
  em.pan_number,
  em.aadhaar_number,
  em.bank_name,
  em.bank_account_number
FROM profiles p
LEFT JOIN departments d ON p.department_id = d.id
LEFT JOIN designations des ON p.designation_id = des.id
LEFT JOIN roles r ON p.role_id = r.id
LEFT JOIN offices o ON p.office_id = o.id
LEFT JOIN profiles mgr ON p.reporting_manager_id = mgr.id
LEFT JOIN employee_meta em ON p.id = em.employee_id
WHERE p.deleted_at IS NULL;

-- 10. SEED DEFAULT DEPARTMENTS
INSERT INTO departments (name, code, description, is_active) VALUES
  ('Human Resources', 'HR', 'HR and Administration Department', true),
  ('Finance & Accounts', 'FIN', 'Finance, Accounting and Payroll', true),
  ('Sales & Marketing', 'SM', 'Sales, Business Development and Marketing', true),
  ('Operations', 'OPS', 'Operations and Project Management', true),
  ('Information Technology', 'IT', 'IT, Software Development and Infrastructure', true),
  ('Legal & Compliance', 'LEGAL', 'Legal Affairs and Regulatory Compliance', true)
ON CONFLICT (code) DO NOTHING;

-- 11. SEED DEFAULT DESIGNATIONS
INSERT INTO designations (name, code, department_id, level, description, is_active) VALUES
  ('HR Executive', 'HR-EXEC', (SELECT id FROM departments WHERE code = 'HR'), 1, 'Entry level HR role', true),
  ('HR Manager', 'HR-MGR', (SELECT id FROM departments WHERE code = 'HR'), 5, 'HR Department Manager', true),
  ('Accountant', 'ACC-EXEC', (SELECT id FROM departments WHERE code = 'FIN'), 2, 'Finance Executive', true),
  ('Finance Manager', 'FIN-MGR', (SELECT id FROM departments WHERE code = 'FIN'), 5, 'Finance Department Manager', true),
  ('Sales Executive', 'SALES-EXEC', (SELECT id FROM departments WHERE code = 'SM'), 1, 'Entry level Sales role', true),
  ('Business Development Manager', 'BDM', (SELECT id FROM departments WHERE code = 'SM'), 4, 'BDM role', true),
  ('Sales Manager', 'SALES-MGR', (SELECT id FROM departments WHERE code = 'SM'), 5, 'Sales Department Manager', true),
  ('Operations Executive', 'OPS-EXEC', (SELECT id FROM departments WHERE code = 'OPS'), 1, 'Operations Executive', true),
  ('Operations Manager', 'OPS-MGR', (SELECT id FROM departments WHERE code = 'OPS'), 5, 'Operations Manager', true),
  ('Software Developer', 'DEV', (SELECT id FROM departments WHERE code = 'IT'), 2, 'Software Developer', true),
  ('Tech Lead', 'TECH-LEAD', (SELECT id FROM departments WHERE code = 'IT'), 4, 'Technical Lead', true),
  ('CTO', 'CTO', (SELECT id FROM departments WHERE code = 'IT'), 7, 'Chief Technology Officer', true)
ON CONFLICT (code) DO NOTHING;

-- 12. DISABLE RLS for custom auth compatibility
ALTER TABLE departments DISABLE ROW LEVEL SECURITY;
ALTER TABLE designations DISABLE ROW LEVEL SECURITY;
ALTER TABLE employee_meta DISABLE ROW LEVEL SECURITY;
ALTER TABLE audit_logs DISABLE ROW LEVEL SECURITY;

-- 13. CREATE INDEXES for performance
CREATE INDEX IF NOT EXISTS idx_profiles_department ON profiles(department_id);
CREATE INDEX IF NOT EXISTS idx_profiles_designation ON profiles(designation_id);
CREATE INDEX IF NOT EXISTS idx_profiles_employment_status ON profiles(employment_status);
CREATE INDEX IF NOT EXISTS idx_profiles_joining_date ON profiles(joining_date);
CREATE INDEX IF NOT EXISTS idx_profiles_deleted_at ON profiles(deleted_at) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_departments_parent ON departments(parent_id);
CREATE INDEX IF NOT EXISTS idx_designations_department ON designations(department_id);

-- 14. Verify setup
SELECT 'Phase 1 Schema Normalization Complete!' AS status;
SELECT COUNT(*) AS total_departments FROM departments;
SELECT COUNT(*) AS total_designations FROM designations;

