-- ============================================================
-- RealtyHRM — MASTER DATABASE SETUP (FIXED)
-- Single file to run on a fresh Supabase project
-- Run this entire file in Supabase SQL Editor
-- ============================================================

-- ============================================================
-- SECTION 1: CORE TABLES
-- ============================================================

-- Roles
CREATE TABLE IF NOT EXISTS roles (
  id   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL UNIQUE,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Offices
CREATE TABLE IF NOT EXISTS offices (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name              TEXT NOT NULL UNIQUE,
  address           TEXT,
  latitude          DOUBLE PRECISION,
  longitude         DOUBLE PRECISION,
  attendance_radius INTEGER DEFAULT 300,
  is_active         BOOLEAN DEFAULT true,
  created_at        TIMESTAMPTZ DEFAULT now()
);

-- Departments
CREATE TABLE IF NOT EXISTS departments (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name               TEXT NOT NULL UNIQUE,
  code               TEXT,
  description        TEXT,
  parent_id          UUID REFERENCES departments(id) ON DELETE SET NULL,
  budget_allocated   DECIMAL(15, 2),
  is_active          BOOLEAN DEFAULT true,
  created_at         TIMESTAMPTZ DEFAULT now(),
  updated_at         TIMESTAMPTZ DEFAULT now(),
  deleted_at         TIMESTAMPTZ
);

-- Designations
CREATE TABLE IF NOT EXISTS designations (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name          TEXT NOT NULL UNIQUE,
  code          TEXT,
  department_id UUID REFERENCES departments(id) ON DELETE SET NULL,
  level         INTEGER DEFAULT 1,
  description   TEXT,
  is_active     BOOLEAN DEFAULT true,
  created_at    TIMESTAMPTZ DEFAULT now(),
  updated_at    TIMESTAMPTZ DEFAULT now(),
  deleted_at    TIMESTAMPTZ
);

-- Indexes for departments and designations
CREATE INDEX IF NOT EXISTS idx_departments_code ON departments(code);
CREATE INDEX IF NOT EXISTS idx_departments_parent_id ON departments(parent_id);
CREATE INDEX IF NOT EXISTS idx_departments_deleted_at ON departments(deleted_at);
CREATE INDEX IF NOT EXISTS idx_designations_code ON designations(code);
CREATE INDEX IF NOT EXISTS idx_designations_department_id ON designations(department_id);
CREATE INDEX IF NOT EXISTS idx_designations_deleted_at ON designations(deleted_at);

-- Profiles (main employee table)
CREATE TABLE IF NOT EXISTS profiles (
  id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name                     TEXT NOT NULL,
  email                    TEXT,
  phone                    TEXT UNIQUE,
  employee_number          TEXT UNIQUE,
  role                     TEXT,
  role_id                  UUID REFERENCES roles(id) ON DELETE SET NULL,
  office_id                UUID REFERENCES offices(id) ON DELETE SET NULL,
  department_id            UUID REFERENCES departments(id) ON DELETE SET NULL,
  designation_id           UUID REFERENCES designations(id) ON DELETE SET NULL,
  reporting_manager_id     UUID REFERENCES profiles(id) ON DELETE SET NULL,
  lifecycle_status         TEXT DEFAULT 'active'
                             CHECK (lifecycle_status IN ('candidate','onboarding','active','on_leave','suspended','exit')),
  is_active                BOOLEAN DEFAULT true,
  custom_password          TEXT,
  username                 TEXT UNIQUE,
  date_of_birth            DATE,
  date_of_joining          DATE,
  date_of_exit             DATE,
  address                  TEXT,
  emergency_contact_name   TEXT,
  emergency_contact_phone  TEXT,
  bank_account_number      TEXT,
  bank_ifsc                TEXT,
  bank_name                TEXT,
  pan_number               TEXT,
  aadhaar_number           TEXT,
  created_at               TIMESTAMPTZ DEFAULT now(),
  updated_at               TIMESTAMPTZ DEFAULT now()
);



-- ============================================================
-- SECTION 2: ATTENDANCE
-- ============================================================

CREATE TABLE IF NOT EXISTS attendance_logs (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
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
  status               TEXT DEFAULT 'CHECKED_IN'
                         CHECK (status IN ('CHECKED_IN','CHECKED_OUT','ABSENT')),
  created_at           TIMESTAMPTZ DEFAULT now(),
  UNIQUE(user_id, date)
);

CREATE INDEX IF NOT EXISTS idx_attendance_user_date ON attendance_logs(user_id, date);
CREATE INDEX IF NOT EXISTS idx_attendance_date      ON attendance_logs(date);

-- Shifts
CREATE TABLE IF NOT EXISTS shifts (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name           TEXT NOT NULL,
  start_time     TIME NOT NULL,
  end_time       TIME NOT NULL,
  grace_minutes  INTEGER DEFAULT 15,
  is_active      BOOLEAN DEFAULT true,
  created_at     TIMESTAMPTZ DEFAULT now()
);

-- Employee shift assignments
CREATE TABLE IF NOT EXISTS employee_shifts (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id        UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  shift_id       UUID NOT NULL REFERENCES shifts(id) ON DELETE CASCADE,
  effective_from DATE NOT NULL,
  effective_to   DATE,
  created_at     TIMESTAMPTZ DEFAULT now()
);

-- ============================================================
-- SECTION 3: LEAVE MANAGEMENT
-- ============================================================

CREATE TABLE IF NOT EXISTS leaves (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  type             TEXT NOT NULL CHECK (type IN ('sick','casual','earned','wfh')),
  start_date       DATE NOT NULL,
  end_date         DATE NOT NULL,
  reason           TEXT,
  status           TEXT DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected','cancelled')),
  rejection_reason TEXT,
  approved_by      UUID REFERENCES profiles(id) ON DELETE SET NULL,
  created_at       TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_leaves_user   ON leaves(user_id);
CREATE INDEX IF NOT EXISTS idx_leaves_status ON leaves(status);

-- Leave balances (auto-managed per user per year)
CREATE TABLE IF NOT EXISTS leave_balances (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  year          INTEGER NOT NULL DEFAULT EXTRACT(YEAR FROM now()),
  sick_total    INTEGER DEFAULT 12,
  sick_used     NUMERIC(5,1) DEFAULT 0,
  casual_total  INTEGER DEFAULT 12,
  casual_used   NUMERIC(5,1) DEFAULT 0,
  earned_total  INTEGER DEFAULT 15,
  earned_used   NUMERIC(5,1) DEFAULT 0,
  wfh_total     INTEGER DEFAULT 24,
  wfh_used      NUMERIC(5,1) DEFAULT 0,
  updated_at    TIMESTAMPTZ DEFAULT now(),
  UNIQUE(user_id, year)
);

CREATE INDEX IF NOT EXISTS idx_leave_balances_user_year ON leave_balances(user_id, year);

-- ============================================================
-- SECTION 4: TASKS & PROJECTS
-- ============================================================

CREATE TABLE IF NOT EXISTS tasks (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title       TEXT NOT NULL,
  description TEXT,
  type        TEXT DEFAULT 'other',
  priority    TEXT DEFAULT 'medium' CHECK (priority IN ('high','medium','low')),
  status      TEXT DEFAULT 'pending' CHECK (status IN ('pending','in_progress','completed','cancelled')),
  assigned_to UUID REFERENCES profiles(id) ON DELETE SET NULL,
  assigned_by UUID REFERENCES profiles(id) ON DELETE SET NULL,
  due_date    DATE,
  created_at  TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_tasks_assigned ON tasks(assigned_to);
CREATE INDEX IF NOT EXISTS idx_tasks_status   ON tasks(status);

CREATE TABLE IF NOT EXISTS projects (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name          TEXT NOT NULL,
  location      TEXT,
  address       TEXT,
  price         TEXT,
  price_per_sqft TEXT,
  type          TEXT DEFAULT 'residential' CHECK (type IN ('residential','commercial','plots')),
  status        TEXT DEFAULT 'available' CHECK (status IN ('available','sold_out','upcoming')),
  amenities     TEXT[] DEFAULT '{}',
  description   TEXT,
  is_active     BOOLEAN DEFAULT true,
  created_at    TIMESTAMPTZ DEFAULT now()
);

-- ============================================================
-- SECTION 5: NOTIFICATIONS
-- ============================================================

CREATE TABLE IF NOT EXISTS notifications (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  title      TEXT NOT NULL,
  message    TEXT NOT NULL,
  type       TEXT DEFAULT 'announcement',
  read       BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_notifications_user   ON notifications(user_id);
CREATE INDEX IF NOT EXISTS idx_notifications_unread ON notifications(user_id, read);

-- ============================================================
-- SECTION 6: ACTIVITY LOGS & FIELD VISITS
-- ============================================================

CREATE TABLE IF NOT EXISTS activity_logs (
  id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id                UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  location_type          VARCHAR(20) NOT NULL CHECK (location_type IN ('office','site','meeting','others')),
  location_name          VARCHAR(255) NOT NULL,
  notes                  TEXT,
  destination            VARCHAR(255),
  gps_coordinates        JSONB,
  timestamp              TIMESTAMPTZ NOT NULL,
  activity_type          VARCHAR(30) CHECK (activity_type IN ('SITE_VISIT','CLIENT_MEETING','CHANNEL_PARTNER_MEETING','INTERNAL_MEETING','TRAVEL','OFFICE_WORK','OTHER')),
  confidence_score       INTEGER CHECK (confidence_score >= 0 AND confidence_score <= 100),
  client_name            VARCHAR(255),
  company_name           VARCHAR(255),
  meeting_purpose        VARCHAR(255),
  meeting_details        JSONB,
  location_type_confirmed VARCHAR(20),
  is_billable_activity   BOOLEAN DEFAULT false,
  summary                TEXT,
  flag                   VARCHAR(20),
  created_at             TIMESTAMPTZ DEFAULT now(),
  updated_at             TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_activity_logs_user      ON activity_logs(user_id);
CREATE INDEX IF NOT EXISTS idx_activity_logs_timestamp ON activity_logs(timestamp);
CREATE INDEX IF NOT EXISTS idx_activity_logs_type      ON activity_logs(activity_type);
CREATE INDEX IF NOT EXISTS idx_activity_logs_date      ON activity_logs(DATE(timestamp));

CREATE TABLE IF NOT EXISTS field_visits (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  activity_log_id   UUID REFERENCES activity_logs(id) ON DELETE SET NULL,
  visit_type        VARCHAR(20) NOT NULL CHECK (visit_type IN ('site','meeting','office','others')),
  location_name     VARCHAR(255) NOT NULL,
  location_address  TEXT,
  destination_coords JSONB,
  meeting_type      VARCHAR(30) CHECK (meeting_type IN ('client','channel_partner')),
  contact_name      VARCHAR(255),
  contact_phone     VARCHAR(50),
  company_name      VARCHAR(255),
  project_name      VARCHAR(255),
  notes             TEXT,
  checkin_time      TIMESTAMPTZ,
  checkin_location  JSONB,
  checkout_time     TIMESTAMPTZ,
  checkout_location JSONB,
  checkout_notes    TEXT,
  status            VARCHAR(20) NOT NULL DEFAULT 'PENDING'
                      CHECK (status IN ('PENDING','CHECKED_IN','COMPLETED','MISSED')),
  date              DATE NOT NULL DEFAULT CURRENT_DATE,
  created_at        TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_field_visits_user   ON field_visits(user_id);
CREATE INDEX IF NOT EXISTS idx_field_visits_date   ON field_visits(date);
CREATE INDEX IF NOT EXISTS idx_field_visits_status ON field_visits(status);

-- ============================================================
-- SECTION 7: DOCUMENTS
-- ============================================================

CREATE TABLE IF NOT EXISTS employee_documents (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID REFERENCES profiles(id) ON DELETE CASCADE,
  name        VARCHAR(255) NOT NULL,
  category    VARCHAR(50) DEFAULT 'personal' CHECK (category IN ('personal','hr','property','certificate')),
  file_path   TEXT NOT NULL,
  file_url    TEXT NOT NULL,
  size        BIGINT DEFAULT 0,
  mime_type   VARCHAR(100),
  uploaded_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_employee_docs_user ON employee_documents(user_id);

-- ============================================================
-- SECTION 8: PAYROLL ENGINE
-- ============================================================

CREATE TABLE IF NOT EXISTS salary_structures (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id             UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  effective_from      DATE NOT NULL,
  ctc                 NUMERIC(12,2) NOT NULL,
  basic               NUMERIC(12,2) NOT NULL,
  hra                 NUMERIC(12,2) DEFAULT 0,
  special_allowance   NUMERIC(12,2) DEFAULT 0,
  transport_allowance NUMERIC(12,2) DEFAULT 0,
  medical_allowance   NUMERIC(12,2) DEFAULT 0,
  pf_employee         NUMERIC(12,2) DEFAULT 0,
  pf_employer         NUMERIC(12,2) DEFAULT 0,
  esi_employee        NUMERIC(12,2) DEFAULT 0,
  esi_employer        NUMERIC(12,2) DEFAULT 0,
  professional_tax    NUMERIC(12,2) DEFAULT 0,
  tds                 NUMERIC(12,2) DEFAULT 0,
  gross_salary        NUMERIC(12,2) DEFAULT 0,
  net_salary          NUMERIC(12,2) DEFAULT 0,
  is_active           BOOLEAN DEFAULT true,
  created_by          UUID REFERENCES profiles(id),
  created_at          TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_salary_structures_user ON salary_structures(user_id);

CREATE TABLE IF NOT EXISTS payroll_runs (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  month           INTEGER NOT NULL CHECK (month BETWEEN 1 AND 12),
  year            INTEGER NOT NULL,
  status          TEXT DEFAULT 'draft' CHECK (status IN ('draft','processing','completed','paid')),
  total_employees INTEGER DEFAULT 0,
  total_gross     NUMERIC(14,2) DEFAULT 0,
  total_net       NUMERIC(14,2) DEFAULT 0,
  run_by          UUID REFERENCES profiles(id),
  run_at          TIMESTAMPTZ,
  paid_at         TIMESTAMPTZ,
  created_at      TIMESTAMPTZ DEFAULT now(),
  UNIQUE(month, year)
);

CREATE TABLE IF NOT EXISTS payslips (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  payroll_run_id   UUID NOT NULL REFERENCES payroll_runs(id) ON DELETE CASCADE,
  user_id          UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  month            INTEGER NOT NULL,
  year             INTEGER NOT NULL,
  basic            NUMERIC(12,2) DEFAULT 0,
  hra              NUMERIC(12,2) DEFAULT 0,
  special_allowance NUMERIC(12,2) DEFAULT 0,
  transport_allowance NUMERIC(12,2) DEFAULT 0,
  medical_allowance NUMERIC(12,2) DEFAULT 0,
  gross_salary     NUMERIC(12,2) DEFAULT 0,
  pf_deduction     NUMERIC(12,2) DEFAULT 0,
  esi_deduction    NUMERIC(12,2) DEFAULT 0,
  pt_deduction     NUMERIC(12,2) DEFAULT 0,
  tds_deduction    NUMERIC(12,2) DEFAULT 0,
  other_deductions NUMERIC(12,2) DEFAULT 0,
  total_deductions NUMERIC(12,2) DEFAULT 0,
  net_salary       NUMERIC(12,2) DEFAULT 0,
  working_days     INTEGER DEFAULT 26,
  present_days     INTEGER DEFAULT 26,
  lop_days         NUMERIC(5,1) DEFAULT 0,
  status           TEXT DEFAULT 'generated' CHECK (status IN ('generated','paid')),
  paid_on          DATE,
  created_at       TIMESTAMPTZ DEFAULT now(),
  UNIQUE(payroll_run_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_payslips_user ON payslips(user_id);
CREATE INDEX IF NOT EXISTS idx_payslips_run  ON payslips(payroll_run_id);

-- ============================================================
-- SECTION 9: AUDIT LOGS
-- ============================================================

CREATE TABLE IF NOT EXISTS audit_logs (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  action       TEXT NOT NULL,
  table_name   TEXT NOT NULL,
  record_id    TEXT,
  old_values   JSONB,
  new_values   JSONB,
  performed_by UUID REFERENCES profiles(id) ON DELETE SET NULL,
  performed_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_audit_logs_table ON audit_logs(table_name);
CREATE INDEX IF NOT EXISTS idx_audit_logs_time  ON audit_logs(performed_at DESC);

-- ============================================================
-- SECTION 10: VIEWS
-- ============================================================

-- Drop existing views if they exist
DROP VIEW IF EXISTS admin_daily_employee_log CASCADE;
DROP VIEW IF EXISTS admin_attendance_export CASCADE;
DROP VIEW IF EXISTS upcoming_birthdays_30_days CASCADE;

-- Admin attendance export view
CREATE OR REPLACE VIEW admin_attendance_export AS
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
  o.name            AS office_name
FROM attendance_logs al
LEFT JOIN profiles p ON al.user_id = p.id
LEFT JOIN offices  o ON al.office_id = o.id
ORDER BY al.date DESC, al.checkin_time DESC;

-- Admin daily employee log view
CREATE OR REPLACE VIEW admin_daily_employee_log AS
SELECT
  p.id                                          AS user_id,
  p.name                                        AS employee_name,
  p.employee_number,
  p.role,
  o.name                                        AS office_name,
  al.date                                       AS work_date,
  al.checkin_time,
  al.checkin_location,
  al.checkout_time,
  al.checkout_location,
  al.status                                     AS attendance_status,
  al.attendance_type,
  al.distance_from_office,
  al.warning                                    AS attendance_warning,
  (
    SELECT json_agg(
      json_build_object(
        'id',              act.id,
        'time',            to_char(act.timestamp AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Kolkata', 'HH24:MI'),
        'location_type',   act.location_type,
        'location_name',   act.location_name,
        'activity_type',   act.activity_type,
        'summary',         act.summary,
        'client_name',     act.client_name,
        'company_name',    act.company_name,
        'notes',           act.notes,
        'is_billable',     act.is_billable_activity,
        'confidence',      act.confidence_score,
        'flag',            act.flag,
        'meeting_details', act.meeting_details
      ) ORDER BY act.timestamp ASC
    )
    FROM activity_logs act
    WHERE act.user_id = p.id
      AND DATE(act.timestamp) = COALESCE(al.date, CURRENT_DATE)
  )                                             AS activities,
  (
    SELECT COUNT(*)
    FROM activity_logs act
    WHERE act.user_id = p.id
      AND DATE(act.timestamp) = COALESCE(al.date, CURRENT_DATE)
  )                                             AS total_activities,
  (
    SELECT COUNT(*)
    FROM activity_logs act
    WHERE act.user_id = p.id
      AND DATE(act.timestamp) = COALESCE(al.date, CURRENT_DATE)
      AND act.is_billable_activity = true
  )                                             AS billable_activities
FROM profiles p
LEFT JOIN offices o ON p.office_id = o.id
LEFT JOIN attendance_logs al
  ON al.user_id = p.id AND al.date = CURRENT_DATE
WHERE p.is_active = true
ORDER BY p.name ASC;

-- Upcoming birthdays view (next 30 days)
CREATE OR REPLACE VIEW upcoming_birthdays_30_days AS
SELECT
  id AS user_id,
  name,
  date_of_birth,
  CASE
    WHEN (DATE_TRUNC('year', CURRENT_DATE) + (date_of_birth - DATE_TRUNC('year', date_of_birth)::date)) >= CURRENT_DATE
    THEN (DATE_TRUNC('year', CURRENT_DATE) + (date_of_birth - DATE_TRUNC('year', date_of_birth)::date))::date
    ELSE (DATE_TRUNC('year', CURRENT_DATE) + INTERVAL '1 year' + (date_of_birth - DATE_TRUNC('year', date_of_birth)::date))::date
  END AS next_birthday
FROM profiles
WHERE date_of_birth IS NOT NULL
  AND is_active = true
  AND CASE
    WHEN (DATE_TRUNC('year', CURRENT_DATE) + (date_of_birth - DATE_TRUNC('year', date_of_birth)::date)) >= CURRENT_DATE
    THEN (DATE_TRUNC('year', CURRENT_DATE) + (date_of_birth - DATE_TRUNC('year', date_of_birth)::date))::date
    ELSE (DATE_TRUNC('year', CURRENT_DATE) + INTERVAL '1 year' + (date_of_birth - DATE_TRUNC('year', date_of_birth)::date))::date
  END BETWEEN CURRENT_DATE AND CURRENT_DATE + INTERVAL '30 days';

-- ============================================================
-- SECTION 11: DISABLE RLS (app uses custom auth, not Supabase Auth)
-- ============================================================

ALTER TABLE profiles           DISABLE ROW LEVEL SECURITY;
ALTER TABLE roles              DISABLE ROW LEVEL SECURITY;
ALTER TABLE offices            DISABLE ROW LEVEL SECURITY;
ALTER TABLE departments        DISABLE ROW LEVEL SECURITY;
ALTER TABLE designations       DISABLE ROW LEVEL SECURITY;
ALTER TABLE attendance_logs    DISABLE ROW LEVEL SECURITY;
ALTER TABLE shifts             DISABLE ROW LEVEL SECURITY;
ALTER TABLE employee_shifts    DISABLE ROW LEVEL SECURITY;
ALTER TABLE leaves             DISABLE ROW LEVEL SECURITY;
ALTER TABLE leave_balances     DISABLE ROW LEVEL SECURITY;
ALTER TABLE tasks              DISABLE ROW LEVEL SECURITY;
ALTER TABLE projects           DISABLE ROW LEVEL SECURITY;
ALTER TABLE notifications      DISABLE ROW LEVEL SECURITY;
ALTER TABLE activity_logs      DISABLE ROW LEVEL SECURITY;
ALTER TABLE field_visits       DISABLE ROW LEVEL SECURITY;
ALTER TABLE employee_documents DISABLE ROW LEVEL SECURITY;
ALTER TABLE salary_structures  DISABLE ROW LEVEL SECURITY;
ALTER TABLE payroll_runs       DISABLE ROW LEVEL SECURITY;
ALTER TABLE payslips           DISABLE ROW LEVEL SECURITY;
ALTER TABLE audit_logs         DISABLE ROW LEVEL SECURITY;

-- ============================================================
-- SECTION 12: SEED DATA
-- ============================================================

-- Roles
INSERT INTO roles (name) VALUES
  ('Business Head'),
  ('Team Head'),
  ('Team Leader'),
  ('Sales Manager'),
  ('GM Sales'),
  ('AGM Sales'),
  ('BDM'),
  ('BDE'),
  ('Sales Executive'),
  ('Telecaller'),
  ('Co-ordinator'),
  ('Accounts'),
  ('Marketing'),
  ('HR'),
  ('Admin')
ON CONFLICT (name) DO NOTHING;

-- Offices (BOP locations with GPS)
INSERT INTO offices (name, address, latitude, longitude, attendance_radius) VALUES
  ('Sector 63',             'Sector 63, Noida, UP',                  28.6231, 77.3800, 300),
  ('Greater Noida 136',     'Sector 136, Greater Noida, UP',         28.5027, 77.4059, 300),
  ('Greater Noida Alpha 2', 'Alpha 2, Greater Noida, UP',            28.4709, 77.5114, 300),
  ('Gurugram',              'Cyber City, Gurugram, Haryana',         28.4200, 77.0382, 300)
ON CONFLICT (name) DO NOTHING;

-- Default departments
INSERT INTO departments (name, description) VALUES
  ('Sales',          'Sales and business development team'),
  ('Marketing',      'Marketing and digital team'),
  ('Operations',     'Operations and admin team'),
  ('Finance',        'Accounts and finance team'),
  ('HR',             'Human resources team'),
  ('Technology',     'IT and tech team')
ON CONFLICT (name) DO NOTHING;

-- Default designations
INSERT INTO designations (name, level) VALUES
  ('Business Head',          10),
  ('General Manager',         9),
  ('Deputy General Manager',  8),
  ('Senior Manager',          7),
  ('Manager',                 6),
  ('Assistant Manager',       5),
  ('Team Leader',             4),
  ('Senior Executive',        3),
  ('Executive',               2),
  ('Trainee',                 1)
ON CONFLICT (name) DO NOTHING;

-- Default shifts
INSERT INTO shifts (name, start_time, end_time, grace_minutes) VALUES
  ('Morning Shift',   '09:00', '18:00', 15),
  ('General Shift',   '10:00', '19:00', 15),
  ('Evening Shift',   '12:00', '21:00', 15)
ON CONFLICT DO NOTHING;

-- ============================================================
-- SECTION 13: ADMIN USER (change password after first login)
-- ============================================================

INSERT INTO profiles (
  id, name, email, phone, role, is_active, custom_password, lifecycle_status
) VALUES (
  gen_random_uuid(),
  'System Admin',
  'admin@rehrms.com',
  '9999999999',
  'SYSTEM_ADMIN',
  true,
  'admin123',
  'active'
) ON CONFLICT (phone) DO NOTHING;

-- ============================================================
-- SECTION 14: FINAL VERIFICATION
-- ============================================================

SELECT
  'profiles'           AS table_name, COUNT(*) AS rows FROM profiles           UNION ALL
SELECT 'roles',                        COUNT(*) FROM roles                      UNION ALL
SELECT 'offices',                      COUNT(*) FROM offices                    UNION ALL
SELECT 'departments',                  COUNT(*) FROM departments                UNION ALL
SELECT 'designations',                 COUNT(*) FROM designations               UNION ALL
SELECT 'shifts',                       COUNT(*) FROM shifts                     UNION ALL
SELECT 'attendance_logs',              COUNT(*) FROM attendance_logs            UNION ALL
SELECT 'leaves',                       COUNT(*) FROM leaves                     UNION ALL
SELECT 'leave_balances',               COUNT(*) FROM leave_balances             UNION ALL
SELECT 'tasks',                        COUNT(*) FROM tasks                      UNION ALL
SELECT 'projects',                     COUNT(*) FROM projects                   UNION ALL
SELECT 'notifications',                COUNT(*) FROM notifications              UNION ALL
SELECT 'activity_logs',                COUNT(*) FROM activity_logs              UNION ALL
SELECT 'field_visits',                 COUNT(*) FROM field_visits               UNION ALL
SELECT 'employee_documents',           COUNT(*) FROM employee_documents         UNION ALL
SELECT 'salary_structures',            COUNT(*) FROM salary_structures          UNION ALL
SELECT 'payroll_runs',                 COUNT(*) FROM payroll_runs               UNION ALL
SELECT 'payslips',                     COUNT(*) FROM payslips                   UNION ALL
SELECT 'audit_logs',                   COUNT(*) FROM audit_logs
ORDER BY table_name;

SELECT '✅ RealtyHRM database setup complete!' AS status;
