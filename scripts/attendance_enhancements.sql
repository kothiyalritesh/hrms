-- ============================================================
-- ATTENDANCE ENHANCEMENTS - Overtime, Comp-Off, On-Duty, Performance
-- ============================================================

-- ============================================================
-- 1. OVERTIME TRACKING
-- ============================================================

CREATE TABLE IF NOT EXISTS overtime_logs (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  date              DATE NOT NULL,
  checkout_time     TIMESTAMPTZ NOT NULL,
  overtime_minutes  INTEGER NOT NULL,
  overtime_hours    NUMERIC(5,2) NOT NULL,
  status            TEXT DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected')),
  approved_by       UUID REFERENCES profiles(id) ON DELETE SET NULL,
  approved_at       TIMESTAMPTZ,
  created_at        TIMESTAMPTZ DEFAULT now(),
  UNIQUE(user_id, date)
);

CREATE INDEX IF NOT EXISTS idx_overtime_user_date ON overtime_logs(user_id, date);
CREATE INDEX IF NOT EXISTS idx_overtime_status ON overtime_logs(status);

-- ============================================================
-- 2. COMP-OFF MANAGEMENT
-- ============================================================

CREATE TABLE IF NOT EXISTS compoff_credits (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  credit_date       DATE NOT NULL,
  reason            TEXT NOT NULL CHECK (reason IN ('sunday_work','holiday_work','overtime')),
  compoff_days      NUMERIC(5,2) NOT NULL,
  reference_id      UUID,
  status            TEXT DEFAULT 'active' CHECK (status IN ('active','used','expired')),
  created_at        TIMESTAMPTZ DEFAULT now(),
  UNIQUE(user_id, credit_date, reason)
);

CREATE INDEX IF NOT EXISTS idx_compoff_user ON compoff_credits(user_id);
CREATE INDEX IF NOT EXISTS idx_compoff_status ON compoff_credits(status);

-- Comp-off usage tracking
CREATE TABLE IF NOT EXISTS compoff_usage (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  leave_id          UUID REFERENCES leaves(id) ON DELETE SET NULL,
  compoff_credit_id UUID NOT NULL REFERENCES compoff_credits(id) ON DELETE CASCADE,
  usage_date        DATE NOT NULL,
  compoff_days_used NUMERIC(5,2) NOT NULL,
  created_at        TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_compoff_usage_user ON compoff_usage(user_id);
CREATE INDEX IF NOT EXISTS idx_compoff_usage_leave ON compoff_usage(leave_id);

-- ============================================================
-- 3. ON-DUTY / EVENT TRACKING
-- ============================================================

CREATE TABLE IF NOT EXISTS on_duty_events (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  event_date        DATE NOT NULL,
  event_name        TEXT NOT NULL,
  event_type        TEXT NOT NULL CHECK (event_type IN ('training','conference','client_visit','company_event','other')),
  location          TEXT,
  start_time        TIMESTAMPTZ,
  end_time          TIMESTAMPTZ,
  description       TEXT,
  status            TEXT DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected','completed')),
  requested_by      UUID NOT NULL REFERENCES profiles(id) ON DELETE SET NULL,
  approved_by       UUID REFERENCES profiles(id) ON DELETE SET NULL,
  approved_at       TIMESTAMPTZ,
  created_at        TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_on_duty_user_date ON on_duty_events(user_id, event_date);
CREATE INDEX IF NOT EXISTS idx_on_duty_status ON on_duty_events(status);

-- ============================================================
-- 4. ATTENDANCE SUMMARY (Daily aggregation)
-- ============================================================

CREATE TABLE IF NOT EXISTS attendance_summary (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  date              DATE NOT NULL,
  punch_in_time     TIMESTAMPTZ,
  punch_out_time    TIMESTAMPTZ,
  working_hours     NUMERIC(5,2),
  is_late           BOOLEAN DEFAULT false,
  late_minutes      INTEGER DEFAULT 0,
  is_overtime       BOOLEAN DEFAULT false,
  overtime_minutes  INTEGER DEFAULT 0,
  is_on_duty        BOOLEAN DEFAULT false,
  is_sunday         BOOLEAN DEFAULT false,
  is_holiday        BOOLEAN DEFAULT false,
  is_leave          BOOLEAN DEFAULT false,
  leave_type        TEXT,
  is_absent         BOOLEAN DEFAULT false,
  status            TEXT DEFAULT 'present' CHECK (status IN ('present','late','absent','on_duty','leave','holiday','sunday')),
  office_id         UUID REFERENCES offices(id) ON DELETE SET NULL,
  office_name       TEXT,
  created_at        TIMESTAMPTZ DEFAULT now(),
  updated_at        TIMESTAMPTZ DEFAULT now(),
  UNIQUE(user_id, date)
);

CREATE INDEX IF NOT EXISTS idx_attendance_summary_user_date ON attendance_summary(user_id, date);
CREATE INDEX IF NOT EXISTS idx_attendance_summary_status ON attendance_summary(status);
CREATE INDEX IF NOT EXISTS idx_attendance_summary_date ON attendance_summary(date);

-- ============================================================
-- 5. PERFORMANCE TRACKING
-- ============================================================

CREATE TABLE IF NOT EXISTS performance_metrics (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  month             INTEGER NOT NULL CHECK (month BETWEEN 1 AND 12),
  year              INTEGER NOT NULL,
  total_working_days INTEGER DEFAULT 0,
  present_days      INTEGER DEFAULT 0,
  late_days         INTEGER DEFAULT 0,
  absent_days       INTEGER DEFAULT 0,
  on_duty_days      INTEGER DEFAULT 0,
  leave_days        NUMERIC(5,2) DEFAULT 0,
  total_working_hours NUMERIC(8,2) DEFAULT 0,
  total_overtime_hours NUMERIC(8,2) DEFAULT 0,
  punctuality_score NUMERIC(5,2) DEFAULT 100,
  consistency_score NUMERIC(5,2) DEFAULT 100,
  performance_rank  INTEGER,
  created_at        TIMESTAMPTZ DEFAULT now(),
  updated_at        TIMESTAMPTZ DEFAULT now(),
  UNIQUE(user_id, month, year)
);

CREATE INDEX IF NOT EXISTS idx_performance_user_month ON performance_metrics(user_id, month, year);
CREATE INDEX IF NOT EXISTS idx_performance_rank ON performance_metrics(performance_rank);

-- ============================================================
-- 6. UPDATED VIEWS
-- ============================================================

DROP VIEW IF EXISTS admin_attendance_export CASCADE;

CREATE OR REPLACE VIEW admin_attendance_export AS
SELECT
  s.id,
  s.user_id,
  s.date,
  s.punch_in_time,
  s.punch_out_time,
  s.working_hours,
  s.is_late,
  s.late_minutes,
  s.is_overtime,
  s.overtime_minutes,
  s.is_on_duty,
  s.is_sunday,
  s.is_holiday,
  s.is_leave,
  s.leave_type,
  s.is_absent,
  s.status,
  s.office_id,
  s.office_name,
  p.name AS employee_name,
  p.employee_number,
  p.email,
  p.phone,
  COALESCE(s.office_name, o.name) AS office_location
FROM attendance_summary s
LEFT JOIN profiles p ON s.user_id = p.id
LEFT JOIN offices o ON s.office_id = o.id
ORDER BY s.date DESC, s.punch_in_time DESC;

-- ============================================================
-- 7. PERFORMANCE LEADERBOARD VIEW
-- ============================================================

CREATE OR REPLACE VIEW performance_leaderboard AS
SELECT
  pm.user_id,
  p.name AS employee_name,
  p.employee_number,
  p.phone,
  o.name AS office_name,
  pm.month,
  pm.year,
  pm.present_days,
  pm.late_days,
  pm.absent_days,
  pm.total_working_hours,
  pm.total_overtime_hours,
  pm.punctuality_score,
  pm.consistency_score,
  ROUND(
    (pm.punctuality_score * 0.5 + pm.consistency_score * 0.3 + (pm.total_working_hours / 200 * 100) * 0.2)::numeric,
    2
  ) AS overall_score,
  ROW_NUMBER() OVER (PARTITION BY pm.month, pm.year ORDER BY 
    (pm.punctuality_score * 0.5 + pm.consistency_score * 0.3 + (pm.total_working_hours / 200 * 100) * 0.2) DESC
  ) AS rank
FROM performance_metrics pm
LEFT JOIN profiles p ON pm.user_id = p.id
LEFT JOIN offices o ON p.office_id = o.id
WHERE pm.punctuality_score > 0
ORDER BY pm.month DESC, pm.year DESC, rank ASC;

-- ============================================================
-- 8. MONTHLY ATTENDANCE REPORT VIEW
-- ============================================================

CREATE OR REPLACE VIEW monthly_attendance_report AS
SELECT
  p.id AS user_id,
  p.name AS employee_name,
  p.employee_number,
  p.phone,
  o.name AS office_name,
  EXTRACT(MONTH FROM s.date)::INTEGER AS month,
  EXTRACT(YEAR FROM s.date)::INTEGER AS year,
  COUNT(*) FILTER (WHERE s.status = 'present') AS present_days,
  COUNT(*) FILTER (WHERE s.status = 'late') AS late_days,
  COUNT(*) FILTER (WHERE s.status = 'absent') AS absent_days,
  COUNT(*) FILTER (WHERE s.status = 'on_duty') AS on_duty_days,
  COUNT(*) FILTER (WHERE s.status = 'leave') AS leave_days,
  COUNT(*) FILTER (WHERE s.status = 'sunday') AS sunday_count,
  COUNT(*) FILTER (WHERE s.status = 'holiday') AS holiday_count,
  ROUND(SUM(s.working_hours)::numeric, 2) AS total_working_hours,
  ROUND(SUM(s.overtime_minutes)::numeric / 60, 2) AS total_overtime_hours,
  ROUND(
    (COUNT(*) FILTER (WHERE s.status = 'present' OR s.status = 'late') * 100.0 / 
     NULLIF(COUNT(*) FILTER (WHERE s.status IN ('present', 'late', 'absent')), 0))::numeric,
    2
  ) AS attendance_percentage
FROM profiles p
LEFT JOIN offices o ON p.office_id = o.id
LEFT JOIN attendance_summary s ON p.id = s.user_id
WHERE p.is_active = true
GROUP BY p.id, p.name, p.employee_number, p.phone, o.name, EXTRACT(MONTH FROM s.date), EXTRACT(YEAR FROM s.date)
ORDER BY year DESC, month DESC, p.name ASC;

-- ============================================================
-- 9. DISABLE RLS ON NEW TABLES
-- ============================================================

ALTER TABLE overtime_logs DISABLE ROW LEVEL SECURITY;
ALTER TABLE compoff_credits DISABLE ROW LEVEL SECURITY;
ALTER TABLE compoff_usage DISABLE ROW LEVEL SECURITY;
ALTER TABLE on_duty_events DISABLE ROW LEVEL SECURITY;
ALTER TABLE attendance_summary DISABLE ROW LEVEL SECURITY;
ALTER TABLE performance_metrics DISABLE ROW LEVEL SECURITY;

SELECT '✅ Attendance enhancements setup complete!' AS status;
