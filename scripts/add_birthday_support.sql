-- ============================================================
-- Add date_of_birth to profiles and create birthday view
-- Run this in Supabase SQL Editor
-- ============================================================

-- 1. Add date_of_birth column to profiles
ALTER TABLE profiles
ADD COLUMN IF NOT EXISTS date_of_birth DATE;

-- 2. Create view for upcoming birthdays in next 30 days
CREATE OR REPLACE VIEW upcoming_birthdays_30_days AS
SELECT
  id AS user_id,
  name,
  date_of_birth,
  -- Calculate next birthday this year or next year
  CASE
    WHEN (DATE_TRUNC('year', CURRENT_DATE) + (date_of_birth - DATE_TRUNC('year', date_of_birth))) >= CURRENT_DATE
    THEN (DATE_TRUNC('year', CURRENT_DATE) + (date_of_birth - DATE_TRUNC('year', date_of_birth)))
    ELSE (DATE_TRUNC('year', CURRENT_DATE) + INTERVAL '1 year' + (date_of_birth - DATE_TRUNC('year', date_of_birth)))
  END AS next_birthday
FROM profiles
WHERE
  date_of_birth IS NOT NULL
  AND is_active = true
HAVING
  CASE
    WHEN (DATE_TRUNC('year', CURRENT_DATE) + (date_of_birth - DATE_TRUNC('year', date_of_birth))) >= CURRENT_DATE
    THEN (DATE_TRUNC('year', CURRENT_DATE) + (date_of_birth - DATE_TRUNC('year', date_of_birth)))
    ELSE (DATE_TRUNC('year', CURRENT_DATE) + INTERVAL '1 year' + (date_of_birth - DATE_TRUNC('year', date_of_birth)))
  END <= CURRENT_DATE + INTERVAL '30 days'
ORDER BY next_birthday ASC;

-- 3. Add date_of_birth to payroll table (create if not exists)
CREATE TABLE IF NOT EXISTS payroll (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES profiles(id) ON DELETE CASCADE,
  month VARCHAR(20) NOT NULL,
  year INTEGER NOT NULL,
  basic_salary NUMERIC(12,2) DEFAULT 0,
  allowances NUMERIC(12,2) DEFAULT 0,
  deductions NUMERIC(12,2) DEFAULT 0,
  net_salary NUMERIC(12,2) DEFAULT 0,
  status VARCHAR(20) DEFAULT 'pending' CHECK (status IN ('pending', 'processed', 'paid')),
  paid_on TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, month, year)
);

-- 4. Create projects table (if not exists)
CREATE TABLE IF NOT EXISTS projects (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  location VARCHAR(255),
  address TEXT,
  price VARCHAR(100),
  price_per_sqft VARCHAR(100),
  type VARCHAR(50) DEFAULT 'residential' CHECK (type IN ('residential', 'commercial', 'plots')),
  status VARCHAR(50) DEFAULT 'available' CHECK (status IN ('available', 'sold_out', 'upcoming')),
  amenities TEXT[] DEFAULT '{}',
  description TEXT,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 5. Create employee_documents table (if not exists)
CREATE TABLE IF NOT EXISTS employee_documents (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES profiles(id) ON DELETE CASCADE,
  name VARCHAR(255) NOT NULL,
  category VARCHAR(50) DEFAULT 'personal' CHECK (category IN ('personal', 'hr', 'property', 'certificate')),
  file_path TEXT NOT NULL,
  file_url TEXT NOT NULL,
  size BIGINT DEFAULT 0,
  mime_type VARCHAR(100),
  uploaded_at TIMESTAMPTZ DEFAULT NOW()
);

-- 6. Enable RLS on new tables
ALTER TABLE payroll ENABLE ROW LEVEL SECURITY;
ALTER TABLE projects ENABLE ROW LEVEL SECURITY;
ALTER TABLE employee_documents ENABLE ROW LEVEL SECURITY;

-- 7. RLS policies for payroll (employees see own, admins see all)
CREATE POLICY "Users can view own payroll" ON payroll
  FOR SELECT USING (user_id = auth.uid());

CREATE POLICY "Admins can manage payroll" ON payroll
  FOR ALL USING (
    EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN ('SYSTEM_ADMIN', 'ADMIN'))
  );

-- 8. RLS policies for projects (all active users can view)
CREATE POLICY "All users can view projects" ON projects
  FOR SELECT USING (is_active = true);

CREATE POLICY "Admins can manage projects" ON projects
  FOR ALL USING (
    EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN ('SYSTEM_ADMIN', 'ADMIN', 'BUSINESS_HEAD'))
  );

-- 9. RLS policies for employee_documents
CREATE POLICY "Users can manage own documents" ON employee_documents
  FOR ALL USING (user_id = auth.uid());

CREATE POLICY "Admins can view all documents" ON employee_documents
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN ('SYSTEM_ADMIN', 'ADMIN'))
  );

-- Verify
SELECT 'date_of_birth column' as item, column_name FROM information_schema.columns WHERE table_name = 'profiles' AND column_name = 'date_of_birth'
UNION ALL
SELECT 'payroll table', table_name FROM information_schema.tables WHERE table_name = 'payroll'
UNION ALL
SELECT 'projects table', table_name FROM information_schema.tables WHERE table_name = 'projects'
UNION ALL
SELECT 'employee_documents table', table_name FROM information_schema.tables WHERE table_name = 'employee_documents';
