-- ============================================================
-- Activity Logs Table for Employee Activity Tracking
-- Add this to your Supabase database
-- ============================================================

CREATE TABLE activity_logs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,

  -- Activity Details
  location_type VARCHAR(20) NOT NULL CHECK (location_type IN ('office', 'site', 'meeting', 'others')),
  location_name VARCHAR(255) NOT NULL,
  notes TEXT,
  destination VARCHAR(255),

  -- Location Data
  gps_coordinates JSONB, -- {latitude: number, longitude: number}
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
  flag VARCHAR(20), -- 'LOW_QUALITY_ENTRY'

  -- Metadata
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- Indexes for performance
CREATE INDEX idx_activity_logs_user_id ON activity_logs(user_id);
CREATE INDEX idx_activity_logs_timestamp ON activity_logs(timestamp);
CREATE INDEX idx_activity_logs_activity_type ON activity_logs(activity_type);
CREATE INDEX idx_activity_logs_location_type ON activity_logs(location_type);

-- Index for date-based queries
CREATE INDEX idx_activity_logs_date ON activity_logs(DATE(timestamp));

-- RLS Policies
ALTER TABLE activity_logs ENABLE ROW LEVEL SECURITY;

-- Users can only see their own activities
CREATE POLICY "Users can view own activities" ON activity_logs
  FOR SELECT USING (auth.uid() = user_id);

-- Users can insert their own activities
CREATE POLICY "Users can insert own activities" ON activity_logs
  FOR INSERT WITH CHECK (auth.uid() = user_id);

-- Admins can view all activities
CREATE POLICY "Admins can view all activities" ON activity_logs
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE profiles.id = auth.uid()
      AND profiles.role IN ('Business Head', 'Team Head', 'admin')
    )
  );

-- Function to automatically analyze activity on insert
CREATE OR REPLACE FUNCTION analyze_activity_on_insert()
RETURNS TRIGGER AS $$
BEGIN
  -- This would call the analysis logic
  -- For now, we'll set basic defaults
  NEW.activity_type = 'OTHER';
  NEW.confidence_score = 50;
  NEW.is_billable_activity = false;
  NEW.summary = COALESCE(NEW.notes, 'Activity logged');

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger to analyze activity on insert
CREATE TRIGGER trigger_analyze_activity
  BEFORE INSERT ON activity_logs
  FOR EACH ROW EXECUTE FUNCTION analyze_activity_on_insert();