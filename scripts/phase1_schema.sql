-- ============================================================
-- RealtyHRM Phase 1 Schema
-- Run this in your Supabase SQL editor
-- ============================================================

-- 1. Departments
CREATE TABLE IF NOT EXISTS departments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL UNIQUE,
  description TEXT,
  head_id UUID REFERENCES profiles(id) ON DELETE SET NULL,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- 2. Designations
CREATE TABLE IF NOT EXISTS designations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL UNIQUE,
  department_id UUID REFERENCES departments(id) ON DELETE SET NULL,
  level INTEGER DEFAULT 1, -- 1=junior, 5=senior/head
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- 3. Add lifecycle + department + designation to profiles
ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS lifecycle_status TEXT DEFAULT 'active'
    CHECK (lifecycle_status IN ('candidate','onboarding','active','on_leave','suspended','exit')),
  ADD COLUMN IF NOT EXISTS department_id UUID REFERENCES departments(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS designation_id UUID REFERENCES designations(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS date_of_joining DATE,
  ADD COLUMN IF NOT EXISTS date_of_exit DATE,
  ADD COLUMN IF NOT EXISTS address TEXT,
  ADD COLUMN IF NOT EXISTS emergency_contact_name TEXT,
  ADD COLUMN IF NOT EXISTS emergency_contact_phone TEXT,
  ADD COLUMN IF NOT EXISTS bank_account_number TEXT,
  ADD COLUMN IF NOT EXISTS bank_ifsc TEXT,
  ADD COLUMN IF NOT EXISTS bank_name TEXT,
  ADD COLUMN IF NOT EXISTS pan_number TEXT,
  ADD COLUMN IF NOT EXISTS aadhaar_number TEXT;

-- 4. Leave balances (auto-managed)
CREATE TABLE IF NOT EXISTS leave_balances (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  year INTEGER NOT NULL DEFAULT EXTRACT(YEAR FROM now()),
  sick_total INTEGER DEFAULT 12,
  sick_used NUMERIC(5,1) DEFAULT 0,
  casual_total INTEGER DEFAULT 12,
  casual_used NUMERIC(5,1) DEFAULT 0,
  earned_total INTEGER DEFAULT 15,
  earned_used NUMERIC(5,1) DEFAULT 0,
  wfh_total INTEGER DEFAULT 24,
  wfh_used NUMERIC(5,1) DEFAULT 0,
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(user_id, year)
);

-- 5. Salary structures
CREATE TABLE IF NOT EXISTS salary_structures (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  effective_from DATE NOT NULL,
  ctc NUMERIC(12,2) NOT NULL,
  basic NUMERIC(12,2) NOT NULL,
  hra NUMERIC(12,2) DEFAULT 0,
  special_allowance NUMERIC(12,2) DEFAULT 0,
  transport_allowance NUMERIC(12,2) DEFAULT 0,
  medical_allowance NUMERIC(12,2) DEFAULT 0,
  pf_employee NUMERIC(12,2) DEFAULT 0,
  pf_employer NUMERIC(12,2) DEFAULT 0,
  esi_employee NUMERIC(12,2) DEFAULT 0,
  esi_employer NUMERIC(12,2) DEFAULT 0,
  professional_tax NUMERIC(12,2) DEFAULT 0,
  tds NUMERIC(12,2) DEFAULT 0,
  gross_salary NUMERIC(12,2) DEFAULT 0,
  net_salary NUMERIC(12,2) DEFAULT 0,
  is_active BOOLEAN DEFAULT true,
  created_by UUID REFERENCES profiles(id),
  created_at TIMESTAMPTZ DEFAULT now()
);

-- 6. Payroll runs
CREATE TABLE IF NOT EXISTS payroll_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  month INTEGER NOT NULL CHECK (month BETWEEN 1 AND 12),
  year INTEGER NOT NULL,
  status TEXT DEFAULT 'draft' CHECK (status IN ('draft','processing','completed','paid')),
  total_employees INTEGER DEFAULT 0,
  total_gross NUMERIC(14,2) DEFAULT 0,
  total_net NUMERIC(14,2) DEFAULT 0,
  run_by UUID REFERENCES profiles(id),
  run_at TIMESTAMPTZ,
  paid_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(month, year)
);

-- 7. Payslips
CREATE TABLE IF NOT EXISTS payslips (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  payroll_run_id UUID NOT NULL REFERENCES payroll_runs(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  month INTEGER NOT NULL,
  year INTEGER NOT NULL,
  basic NUMERIC(12,2) DEFAULT 0,
  hra NUMERIC(12,2) DEFAULT 0,
  special_allowance NUMERIC(12,2) DEFAULT 0,
  transport_allowance NUMERIC(12,2) DEFAULT 0,
  medical_allowance NUMERIC(12,2) DEFAULT 0,
  gross_salary NUMERIC(12,2) DEFAULT 0,
  pf_deduction NUMERIC(12,2) DEFAULT 0,
  esi_deduction NUMERIC(12,2) DEFAULT 0,
  pt_deduction NUMERIC(12,2) DEFAULT 0,
  tds_deduction NUMERIC(12,2) DEFAULT 0,
  other_deductions NUMERIC(12,2) DEFAULT 0,
  total_deductions NUMERIC(12,2) DEFAULT 0,
  net_salary NUMERIC(12,2) DEFAULT 0,
  working_days INTEGER DEFAULT 26,
  present_days INTEGER DEFAULT 26,
  lop_days NUMERIC(5,1) DEFAULT 0,
  status TEXT DEFAULT 'generated' CHECK (status IN ('generated','paid')),
  paid_on DATE,
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(payroll_run_id, user_id)
);

-- 8. Shifts
CREATE TABLE IF NOT EXISTS shifts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  start_time TIME NOT NULL,
  end_time TIME NOT NULL,
  grace_minutes INTEGER DEFAULT 15,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- 9. Employee shift assignments
CREATE TABLE IF NOT EXISTS employee_shifts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  shift_id UUID NOT NULL REFERENCES shifts(id) ON DELETE CASCADE,
  effective_from DATE NOT NULL,
  effective_to DATE,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- 10. Upcoming birthdays view
CREATE OR REPLACE VIEW upcoming_birthdays_30_days AS
SELECT
  id AS user_id,
  name,
  date_of_birth,
  (
    date_of_birth + (
      EXTRACT(YEAR FROM age(date_of_birth))::int +
      CASE WHEN date_of_birth + (EXTRACT(YEAR FROM age(date_of_birth))::int || ' years')::interval < now()
        THEN 1 ELSE 0 END
    ) * interval '1 year'
  )::date AS next_birthday
FROM profiles
WHERE date_of_birth IS NOT NULL
  AND is_active = true
  AND (
    date_of_birth + (
      EXTRACT(YEAR FROM age(date_of_birth))::int +
      CASE WHEN date_of_birth + (EXTRACT(YEAR FROM age(date_of_birth))::int || ' years')::interval < now()
        THEN 1 ELSE 0 END
    ) * interval '1 year'
  )::date BETWEEN CURRENT_DATE AND CURRENT_DATE + INTERVAL '30 days';

-- 11. RLS policies (disable for custom auth like this app)
ALTER TABLE departments DISABLE ROW LEVEL SECURITY;
ALTER TABLE designations DISABLE ROW LEVEL SECURITY;
ALTER TABLE leave_balances DISABLE ROW LEVEL SECURITY;
ALTER TABLE salary_structures DISABLE ROW LEVEL SECURITY;
ALTER TABLE payroll_runs DISABLE ROW LEVEL SECURITY;
ALTER TABLE payslips DISABLE ROW LEVEL SECURITY;
ALTER TABLE shifts DISABLE ROW LEVEL SECURITY;
ALTER TABLE employee_shifts DISABLE ROW LEVEL SECURITY;

-- 12. Indexes for performance
CREATE INDEX IF NOT EXISTS idx_leave_balances_user_year ON leave_balances(user_id, year);
CREATE INDEX IF NOT EXISTS idx_payslips_user ON payslips(user_id);
CREATE INDEX IF NOT EXISTS idx_payslips_run ON payslips(payroll_run_id);
CREATE INDEX IF NOT EXISTS idx_salary_structures_user ON salary_structures(user_id);
CREATE INDEX IF NOT EXISTS idx_profiles_lifecycle ON profiles(lifecycle_status);
CREATE INDEX IF NOT EXISTS idx_profiles_department ON profiles(department_id);
