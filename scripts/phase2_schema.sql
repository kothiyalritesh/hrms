-- ============================================================
-- RealtyHRM Phase 2 Schema
-- Performance, Recruitment, Engagement, Analytics
-- Run in Supabase SQL Editor AFTER MASTER_SETUP.sql
-- ============================================================

-- ============================================================
-- PERFORMANCE MANAGEMENT
-- ============================================================

CREATE TABLE IF NOT EXISTS goals (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  title         TEXT NOT NULL,
  description   TEXT,
  category      TEXT DEFAULT 'individual' CHECK (category IN ('individual','team','company')),
  period        TEXT DEFAULT 'quarterly' CHECK (period IN ('monthly','quarterly','yearly')),
  start_date    DATE NOT NULL,
  end_date      DATE NOT NULL,
  target_value  NUMERIC(10,2),
  current_value NUMERIC(10,2) DEFAULT 0,
  unit          TEXT DEFAULT '%',
  weight        INTEGER DEFAULT 100 CHECK (weight BETWEEN 1 AND 100),
  status        TEXT DEFAULT 'active' CHECK (status IN ('active','completed','cancelled')),
  created_by    UUID REFERENCES profiles(id),
  created_at    TIMESTAMPTZ DEFAULT now(),
  updated_at    TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_goals_user   ON goals(user_id);
CREATE INDEX IF NOT EXISTS idx_goals_period ON goals(period, status);

CREATE TABLE IF NOT EXISTS performance_reviews (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  reviewee_id   UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  reviewer_id   UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  review_type   TEXT DEFAULT 'manager' CHECK (review_type IN ('self','manager','peer','360')),
  period        TEXT NOT NULL,
  overall_score NUMERIC(3,1) CHECK (overall_score BETWEEN 1 AND 5),
  ratings       JSONB DEFAULT '{}',
  strengths     TEXT,
  improvements  TEXT,
  comments      TEXT,
  status        TEXT DEFAULT 'draft' CHECK (status IN ('draft','submitted','acknowledged')),
  submitted_at  TIMESTAMPTZ,
  created_at    TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_reviews_reviewee ON performance_reviews(reviewee_id);
CREATE INDEX IF NOT EXISTS idx_reviews_reviewer ON performance_reviews(reviewer_id);

CREATE TABLE IF NOT EXISTS feedback (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  from_id     UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  to_id       UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  message     TEXT NOT NULL,
  is_anonymous BOOLEAN DEFAULT false,
  created_at  TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_feedback_to ON feedback(to_id);

-- ============================================================
-- RECRUITMENT & ATS
-- ============================================================

CREATE TABLE IF NOT EXISTS job_postings (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title            TEXT NOT NULL,
  department_id    UUID REFERENCES departments(id) ON DELETE SET NULL,
  designation_id   UUID REFERENCES designations(id) ON DELETE SET NULL,
  description      TEXT,
  requirements     TEXT,
  location         TEXT,
  employment_type  TEXT DEFAULT 'full_time' CHECK (employment_type IN ('full_time','part_time','contract','internship')),
  min_experience   INTEGER DEFAULT 0,
  max_experience   INTEGER,
  min_salary       NUMERIC(12,2),
  max_salary       NUMERIC(12,2),
  openings         INTEGER DEFAULT 1,
  status           TEXT DEFAULT 'open' CHECK (status IN ('draft','open','closed','on_hold')),
  posted_by        UUID REFERENCES profiles(id),
  posted_at        TIMESTAMPTZ DEFAULT now(),
  closes_at        DATE,
  created_at       TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_jobs_status ON job_postings(status);

CREATE TABLE IF NOT EXISTS candidates (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id         UUID NOT NULL REFERENCES job_postings(id) ON DELETE CASCADE,
  name           TEXT NOT NULL,
  email          TEXT,
  phone          TEXT,
  resume_url     TEXT,
  experience_years INTEGER DEFAULT 0,
  current_company TEXT,
  current_ctc    NUMERIC(12,2),
  expected_ctc   NUMERIC(12,2),
  source         TEXT DEFAULT 'direct' CHECK (source IN ('direct','referral','portal','agency','linkedin')),
  referred_by    UUID REFERENCES profiles(id),
  stage          TEXT DEFAULT 'applied' CHECK (stage IN ('applied','screened','interview','offer','hired','rejected')),
  rejection_reason TEXT,
  notes          TEXT,
  created_at     TIMESTAMPTZ DEFAULT now(),
  updated_at     TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_candidates_job   ON candidates(job_id);
CREATE INDEX IF NOT EXISTS idx_candidates_stage ON candidates(stage);

CREATE TABLE IF NOT EXISTS interviews (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  candidate_id   UUID NOT NULL REFERENCES candidates(id) ON DELETE CASCADE,
  job_id         UUID NOT NULL REFERENCES job_postings(id) ON DELETE CASCADE,
  interviewer_id UUID REFERENCES profiles(id),
  round          INTEGER DEFAULT 1,
  interview_type TEXT DEFAULT 'in_person' CHECK (interview_type IN ('in_person','video','phone','technical','hr')),
  scheduled_at   TIMESTAMPTZ NOT NULL,
  duration_mins  INTEGER DEFAULT 60,
  status         TEXT DEFAULT 'scheduled' CHECK (status IN ('scheduled','completed','cancelled','no_show')),
  feedback       TEXT,
  rating         INTEGER CHECK (rating BETWEEN 1 AND 5),
  recommendation TEXT CHECK (recommendation IN ('strong_yes','yes','maybe','no','strong_no')),
  created_at     TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_interviews_candidate ON interviews(candidate_id);

-- ============================================================
-- EMPLOYEE ENGAGEMENT
-- ============================================================

CREATE TABLE IF NOT EXISTS surveys (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title       TEXT NOT NULL,
  description TEXT,
  questions   JSONB NOT NULL DEFAULT '[]',
  target_role TEXT,
  is_anonymous BOOLEAN DEFAULT true,
  status      TEXT DEFAULT 'draft' CHECK (status IN ('draft','active','closed')),
  created_by  UUID REFERENCES profiles(id),
  starts_at   TIMESTAMPTZ,
  ends_at     TIMESTAMPTZ,
  created_at  TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS survey_responses (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  survey_id   UUID NOT NULL REFERENCES surveys(id) ON DELETE CASCADE,
  user_id     UUID REFERENCES profiles(id) ON DELETE SET NULL,
  answers     JSONB NOT NULL DEFAULT '{}',
  submitted_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_survey_responses_survey ON survey_responses(survey_id);

CREATE TABLE IF NOT EXISTS recognitions (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  from_id     UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  to_id       UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  badge       TEXT NOT NULL CHECK (badge IN ('star','innovator','team_player','leader','customer_champion','above_beyond')),
  message     TEXT NOT NULL,
  is_public   BOOLEAN DEFAULT true,
  created_at  TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_recognitions_to ON recognitions(to_id);

-- ============================================================
-- DISABLE RLS FOR NEW TABLES
-- ============================================================

ALTER TABLE goals               DISABLE ROW LEVEL SECURITY;
ALTER TABLE performance_reviews DISABLE ROW LEVEL SECURITY;
ALTER TABLE feedback            DISABLE ROW LEVEL SECURITY;
ALTER TABLE job_postings        DISABLE ROW LEVEL SECURITY;
ALTER TABLE candidates          DISABLE ROW LEVEL SECURITY;
ALTER TABLE interviews          DISABLE ROW LEVEL SECURITY;
ALTER TABLE surveys             DISABLE ROW LEVEL SECURITY;
ALTER TABLE survey_responses    DISABLE ROW LEVEL SECURITY;
ALTER TABLE recognitions        DISABLE ROW LEVEL SECURITY;

-- ============================================================
-- ANALYTICS VIEWS
-- ============================================================

-- Monthly headcount & attrition
CREATE OR REPLACE VIEW hr_analytics_summary AS
SELECT
  (SELECT COUNT(*) FROM profiles WHERE is_active = true)                          AS active_employees,
  (SELECT COUNT(*) FROM profiles WHERE lifecycle_status = 'exit')                 AS total_exits,
  (SELECT COUNT(*) FROM profiles WHERE lifecycle_status = 'candidate')            AS candidates_pipeline,
  (SELECT COUNT(*) FROM profiles WHERE lifecycle_status = 'onboarding')           AS onboarding,
  (SELECT COUNT(*) FROM leaves WHERE status = 'pending')                          AS pending_leaves,
  (SELECT COUNT(*) FROM attendance_logs WHERE date = CURRENT_DATE)                AS today_attendance,
  (SELECT COUNT(*) FROM job_postings WHERE status = 'open')                       AS open_positions,
  (SELECT COUNT(*) FROM candidates WHERE stage NOT IN ('hired','rejected'))       AS active_candidates,
  (SELECT COUNT(*) FROM surveys WHERE status = 'active')                          AS active_surveys,
  (SELECT ROUND(AVG(overall_score),2) FROM performance_reviews WHERE status = 'submitted') AS avg_performance_score;

-- Department headcount
CREATE OR REPLACE VIEW dept_headcount AS
SELECT
  d.name AS department,
  COUNT(p.id) AS total,
  COUNT(p.id) FILTER (WHERE p.is_active = true) AS active
FROM departments d
LEFT JOIN profiles p ON p.department_id = d.id
GROUP BY d.id, d.name
ORDER BY active DESC;

-- Monthly attendance rate
CREATE OR REPLACE VIEW monthly_attendance_rate AS
SELECT
  DATE_TRUNC('month', date) AS month,
  COUNT(DISTINCT user_id)   AS employees_present,
  COUNT(*)                  AS total_checkins
FROM attendance_logs
WHERE date >= CURRENT_DATE - INTERVAL '6 months'
GROUP BY DATE_TRUNC('month', date)
ORDER BY month DESC;

SELECT '✅ Phase 2 schema installed successfully!' AS status;
