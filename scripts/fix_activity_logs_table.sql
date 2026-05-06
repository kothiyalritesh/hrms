-- ============================================================
-- Fix Activity Logs Table - Run this in Supabase SQL Editor
-- ============================================================

-- 1. Check if table exists
SELECT EXISTS (
  SELECT FROM information_schema.tables 
  WHERE table_schema = 'public' 
  AND table_name = 'activity_logs'
) as table_exists;

-- 2. If table doesn't exist, create it
CREATE TABLE IF NOT EXISTS activity_logs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,

  -- Activity Details
  location_type VARCHAR(20) NOT NULL CHECK (location_type IN ('office', 'site', 'meeting', 'others')),
  location_name VARCHAR(255) NOT NULL,
  notes TEXT,
  destination VARCHAR(255),

  -- Location Data
  gps_coordinates JSONB,
  timestamp TIMESTAMP NOT NULL,

  -- Analysis Results (computed)
  activity_type VARCHAR(30) CHECK (activity_type IN ('SITE_VISIT', 'CLIENT_MEETING', 'CHANNEL_PARTNER_MEETING', 'INTERNAL_MEETING', 'TRAVEL', 'OFFICE_WORK', 'OTHER')),
  confidence_score INTEGER CHECK (confidence_score >= 0 AND confidence_score <= 100),
  client_name VARCHAR(255),
  company_name VARCHAR(255),
  meeting_purpose VARCHAR(255),
  location_type_confirmed VARCHAR(20),
  is_billable_activity BOOLEAN DEFAULT false,
  summary TEXT,
  flag VARCHAR(20),

  -- Metadata
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- 3. Create indexes if they don't exist
CREATE INDEX IF NOT EXISTS idx_activity_logs_user_id ON activity_logs(user_id);
CREATE INDEX IF NOT EXISTS idx_activity_logs_timestamp ON activity_logs(timestamp);
CREATE INDEX IF NOT EXISTS idx_activity_logs_activity_type ON activity_logs(activity_type);
CREATE INDEX IF NOT EXISTS idx_activity_logs_location_type ON activity_logs(location_type);
CREATE INDEX IF NOT EXISTS idx_activity_logs_date ON activity_logs(DATE(timestamp));

-- 4. Enable RLS
ALTER TABLE activity_logs ENABLE ROW LEVEL SECURITY;

-- 5. Drop existing policies to recreate them
DROP POLICY IF EXISTS "Users can view own activities" ON activity_logs;
DROP POLICY IF EXISTS "Users can insert own activities" ON activity_logs;
DROP POLICY IF EXISTS "Admins can view all activities" ON activity_logs;
DROP POLICY IF EXISTS "Users can update own activities" ON activity_logs;

-- 6. Create RLS policies
-- Users can view their own activities
CREATE POLICY "Users can view own activities" ON activity_logs
  FOR SELECT USING (auth.uid() = user_id);

-- Users can insert their own activities
CREATE POLICY "Users can insert own activities" ON activity_logs
  FOR INSERT WITH CHECK (auth.uid() = user_id);

-- Users can update their own activities
CREATE POLICY "Users can update own activities" ON activity_logs
  FOR UPDATE USING (auth.uid() = user_id);

-- Admins can view all activities
CREATE POLICY "Admins can view all activities" ON activity_logs
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE profiles.id = auth.uid()
      AND profiles.role IN ('Business Head', 'Team Head', 'admin')
    )
  );

-- 7. Verify table structure
SELECT column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_name = 'activity_logs'
ORDER BY ordinal_position;

-- 8. Check row count
SELECT COUNT(*) as total_activities FROM activity_logs;

-- 9. Check sample data (if any)
SELECT id, user_id, activity_type, timestamp, created_at
FROM activity_logs
ORDER BY created_at DESC
LIMIT 5;
