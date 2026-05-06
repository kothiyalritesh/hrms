-- ============================================================
-- Required Database Setup for HRMS
-- Run this in Supabase SQL Editor
-- ============================================================

-- 1. Create admin_attendance_export VIEW
-- This view is required by AttendanceControlScreenNew
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
  p.name AS employee_name,
  p.employee_number,
  p.email,
  o.name AS office_name
FROM attendance_logs al
LEFT JOIN profiles p ON al.user_id = p.id
LEFT JOIN offices o ON al.office_id = o.id
ORDER BY al.date DESC, al.checkin_time DESC;

-- 2. Ensure attendance_logs table exists (created by previous schema migration)
-- If you haven't created it yet, run: scripts/attendance_logs_schema.sql

-- 3. Create activity_logs table if not exists
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

-- Create indexes for activity_logs if not exists
CREATE INDEX IF NOT EXISTS idx_activity_logs_user_id ON activity_logs(user_id);
CREATE INDEX IF NOT EXISTS idx_activity_logs_timestamp ON activity_logs(timestamp);
CREATE INDEX IF NOT EXISTS idx_activity_logs_activity_type ON activity_logs(activity_type);
CREATE INDEX IF NOT EXISTS idx_activity_logs_location_type ON activity_logs(location_type);
CREATE INDEX IF NOT EXISTS idx_activity_logs_date ON activity_logs(DATE(timestamp));

-- 4. Enable RLS on activity_logs if not already enabled
ALTER TABLE activity_logs ENABLE ROW LEVEL SECURITY;

-- 5. Create RLS policies for activity_logs
-- Drop existing policies
DROP POLICY IF EXISTS "activity_logs_user_select" ON activity_logs;
DROP POLICY IF EXISTS "activity_logs_user_insert" ON activity_logs;
DROP POLICY IF EXISTS "activity_logs_admin_select" ON activity_logs;

-- Policy: Users can view their own activities
CREATE POLICY "activity_logs_user_select" ON activity_logs
  FOR SELECT
  USING (auth.uid() = user_id);

-- Policy: Users can insert their own activities
CREATE POLICY "activity_logs_user_insert" ON activity_logs
  FOR INSERT
  WITH CHECK (auth.uid() = user_id);

-- Policy: Admins can view all activities
CREATE POLICY "activity_logs_admin_select" ON activity_logs
  FOR SELECT
  USING (
    auth.uid() IN (
      SELECT id FROM profiles
      WHERE role IN ('Business Head', 'Team Head', 'admin', 'ADMIN')
    )
  );

-- 6. Verify setup
SELECT 'Setup Complete!' as status;