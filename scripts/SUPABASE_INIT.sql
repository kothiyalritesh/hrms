-- ============================================================================
-- SUPABASE INITIALIZATION SCRIPT FOR REALTYHRM
-- ============================================================================
-- This script initializes all necessary tables, indexes, and policies
-- Run this FIRST before running other migration scripts
-- ============================================================================

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ============================================================================
-- 1. CORE TABLES
-- ============================================================================

-- Offices Table
CREATE TABLE IF NOT EXISTS offices (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name VARCHAR(255) NOT NULL UNIQUE,
  address TEXT,
  city VARCHAR(100),
  state VARCHAR(100),
  postal_code VARCHAR(20),
  country VARCHAR(100),
  latitude DECIMAL(10, 8),
  longitude DECIMAL(11, 8),
  radius_km DECIMAL(5, 2) DEFAULT 5.0,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_offices_city ON offices(city);
CREATE INDEX idx_offices_is_active ON offices(is_active);

-- Profiles Table (Extended)
CREATE TABLE IF NOT EXISTS profiles (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  auth_id UUID UNIQUE,
  first_name VARCHAR(100),
  last_name VARCHAR(100),
  name VARCHAR(255),
  email VARCHAR(255) UNIQUE,
  phone VARCHAR(20),
  username VARCHAR(100) UNIQUE,
  employee_number VARCHAR(50) UNIQUE,
  profile_pic_url TEXT,
  role VARCHAR(50) DEFAULT 'employee',
  office_id UUID REFERENCES offices(id) ON DELETE SET NULL,
  is_active BOOLEAN DEFAULT true,
  date_of_birth DATE,
  is_birthday_marked BOOLEAN DEFAULT false,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_profiles_auth_id ON profiles(auth_id);
CREATE INDEX idx_profiles_role ON profiles(role);
CREATE INDEX idx_profiles_office_id ON profiles(office_id);
CREATE INDEX idx_profiles_is_active ON profiles(is_active);
CREATE INDEX idx_profiles_email ON profiles(email);
CREATE INDEX idx_profiles_employee_number ON profiles(employee_number);

-- User Credentials Table
CREATE TABLE IF NOT EXISTS user_credentials (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID UNIQUE NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  username VARCHAR(100) UNIQUE NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  is_temporary BOOLEAN DEFAULT true,
  email VARCHAR(255) NOT NULL,
  phone VARCHAR(20),
  otp_secret VARCHAR(32),
  otp_enabled BOOLEAN DEFAULT false,
  otp_verified BOOLEAN DEFAULT false,
  backup_codes TEXT[],
  last_login_at TIMESTAMP,
  login_attempts INT DEFAULT 0,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_user_credentials_user_id ON user_credentials(user_id);
CREATE INDEX idx_user_credentials_username ON user_credentials(username);
CREATE INDEX idx_user_credentials_email ON user_credentials(email);

-- Sites Table
CREATE TABLE IF NOT EXISTS sites (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name VARCHAR(255) NOT NULL,
  address TEXT,
  city VARCHAR(100),
  state VARCHAR(100),
  postal_code VARCHAR(20),
  country VARCHAR(100),
  latitude DECIMAL(10, 8),
  longitude DECIMAL(11, 8),
  project_id UUID,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_sites_city ON sites(city);
CREATE INDEX idx_sites_project_id ON sites(project_id);
CREATE INDEX idx_sites_is_active ON sites(is_active);

-- Activity Logs Table
CREATE TABLE IF NOT EXISTS activity_logs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  activity_type VARCHAR(50) NOT NULL,
  activity_subtype VARCHAR(100),
  description TEXT,
  location_latitude DECIMAL(10, 8),
  location_longitude DECIMAL(11, 8),
  location_address TEXT,
  destination_latitude DECIMAL(10, 8),
  destination_longitude DECIMAL(11, 8),
  destination_address TEXT,
  site_id UUID REFERENCES sites(id) ON DELETE SET NULL,
  office_id UUID REFERENCES offices(id) ON DELETE SET NULL,
  check_in_time TIMESTAMP,
  check_out_time TIMESTAMP,
  duration_minutes INT,
  notes TEXT,
  is_compliant BOOLEAN DEFAULT true,
  compliance_notes TEXT,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_activity_logs_user_id ON activity_logs(user_id);
CREATE INDEX idx_activity_logs_activity_type ON activity_logs(activity_type);
CREATE INDEX idx_activity_logs_created_at ON activity_logs(created_at);
CREATE INDEX idx_activity_logs_site_id ON activity_logs(site_id);
CREATE INDEX idx_activity_logs_office_id ON activity_logs(office_id);

-- Checkout Notes Table
CREATE TABLE IF NOT EXISTS checkout_notes (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  activity_log_id UUID NOT NULL REFERENCES activity_logs(id) ON DELETE CASCADE,
  note TEXT NOT NULL,
  created_by UUID REFERENCES profiles(id) ON DELETE SET NULL,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_checkout_notes_activity_log_id ON checkout_notes(activity_log_id);

-- Field Visits Table
CREATE TABLE IF NOT EXISTS field_visits (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  site_id UUID REFERENCES sites(id) ON DELETE SET NULL,
  visit_date DATE NOT NULL,
  check_in_time TIMESTAMP NOT NULL,
  check_out_time TIMESTAMP,
  latitude DECIMAL(10, 8),
  longitude DECIMAL(11, 8),
  address TEXT,
  purpose TEXT,
  notes TEXT,
  photos TEXT[],
  is_approved BOOLEAN,
  approved_by UUID REFERENCES profiles(id) ON DELETE SET NULL,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_field_visits_user_id ON field_visits(user_id);
CREATE INDEX idx_field_visits_site_id ON field_visits(site_id);
CREATE INDEX idx_field_visits_visit_date ON field_visits(visit_date);
CREATE INDEX idx_field_visits_is_approved ON field_visits(is_approved);

-- Meetings Table
CREATE TABLE IF NOT EXISTS meetings (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  activity_log_id UUID NOT NULL REFERENCES activity_logs(id) ON DELETE CASCADE,
  attendees TEXT[],
  client_name VARCHAR(255),
  client_phone VARCHAR(20),
  client_email VARCHAR(255),
  property_details TEXT,
  outcome VARCHAR(100),
  follow_up_required BOOLEAN DEFAULT false,
  follow_up_date DATE,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_meetings_activity_log_id ON meetings(activity_log_id);

-- Leaves Table
CREATE TABLE IF NOT EXISTS leaves (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  leave_type VARCHAR(50) NOT NULL,
  from_date DATE NOT NULL,
  to_date DATE NOT NULL,
  duration_days DECIMAL(5, 2),
  reason TEXT,
  status VARCHAR(20) DEFAULT 'pending',
  rejected_reason TEXT,
  approved_by UUID REFERENCES profiles(id) ON DELETE SET NULL,
  approval_date TIMESTAMP,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_leaves_user_id ON leaves(user_id);
CREATE INDEX idx_leaves_status ON leaves(status);
CREATE INDEX idx_leaves_from_date ON leaves(from_date);
CREATE INDEX idx_leaves_to_date ON leaves(to_date);

-- Location Compliance Table
CREATE TABLE IF NOT EXISTS location_compliance (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  log_date DATE NOT NULL,
  total_minutes_worked INT,
  time_at_office INT,
  time_at_sites INT,
  time_at_other INT,
  is_compliant BOOLEAN DEFAULT true,
  compliance_notes TEXT,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_location_compliance_user_id ON location_compliance(user_id);
CREATE INDEX idx_location_compliance_log_date ON location_compliance(log_date);
CREATE INDEX idx_location_compliance_is_compliant ON location_compliance(is_compliant);

-- ============================================================================
-- 2. ROW LEVEL SECURITY (RLS) POLICIES
-- ============================================================================

-- Enable RLS on all tables
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_credentials ENABLE ROW LEVEL SECURITY;
ALTER TABLE offices ENABLE ROW LEVEL SECURITY;
ALTER TABLE sites ENABLE ROW LEVEL SECURITY;
ALTER TABLE activity_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE checkout_notes ENABLE ROW LEVEL SECURITY;
ALTER TABLE field_visits ENABLE ROW LEVEL SECURITY;
ALTER TABLE meetings ENABLE ROW LEVEL SECURITY;
ALTER TABLE leaves ENABLE ROW LEVEL SECURITY;
ALTER TABLE location_compliance ENABLE ROW LEVEL SECURITY;

-- Profiles Policies
CREATE POLICY "Users can view their own profile" ON profiles
  FOR SELECT USING (auth.uid() = auth_id OR 
    (SELECT role FROM profiles WHERE auth_id = auth.uid()) IN ('admin', 'manager'));

CREATE POLICY "Users can update their own profile" ON profiles
  FOR UPDATE USING (auth.uid() = auth_id);

CREATE POLICY "Admins can view all profiles" ON profiles
  FOR SELECT USING ((SELECT role FROM profiles WHERE auth_id = auth.uid()) = 'admin');

-- Activity Logs Policies
CREATE POLICY "Users can view their own activity logs" ON activity_logs
  FOR SELECT USING (user_id = (SELECT id FROM profiles WHERE auth_id = auth.uid())
    OR (SELECT role FROM profiles WHERE auth_id = auth.uid()) IN ('admin', 'manager'));

CREATE POLICY "Users can insert their own activity logs" ON activity_logs
  FOR INSERT WITH CHECK (user_id = (SELECT id FROM profiles WHERE auth_id = auth.uid()));

CREATE POLICY "Users can update their own activity logs" ON activity_logs
  FOR UPDATE USING (user_id = (SELECT id FROM profiles WHERE auth_id = auth.uid())
    OR (SELECT role FROM profiles WHERE auth_id = auth.uid()) = 'admin');

-- Field Visits Policies
CREATE POLICY "Users can view their own field visits" ON field_visits
  FOR SELECT USING (user_id = (SELECT id FROM profiles WHERE auth_id = auth.uid())
    OR (SELECT role FROM profiles WHERE auth_id = auth.uid()) IN ('admin', 'manager'));

CREATE POLICY "Users can insert their own field visits" ON field_visits
  FOR INSERT WITH CHECK (user_id = (SELECT id FROM profiles WHERE auth_id = auth.uid()));

-- Leaves Policies
CREATE POLICY "Users can view their own leaves" ON leaves
  FOR SELECT USING (user_id = (SELECT id FROM profiles WHERE auth_id = auth.uid())
    OR (SELECT role FROM profiles WHERE auth_id = auth.uid()) IN ('admin', 'manager'));

CREATE POLICY "Users can insert their own leaves" ON leaves
  FOR INSERT WITH CHECK (user_id = (SELECT id FROM profiles WHERE auth_id = auth.uid()));

-- Offices and Sites (Public read)
CREATE POLICY "Anyone can view offices" ON offices
  FOR SELECT USING (true);

CREATE POLICY "Anyone can view sites" ON sites
  FOR SELECT USING (true);

-- ============================================================================
-- 3. HELPER FUNCTIONS
-- ============================================================================

-- Function to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create triggers for all tables
CREATE TRIGGER update_profiles_updated_at BEFORE UPDATE ON profiles
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_activity_logs_updated_at BEFORE UPDATE ON activity_logs
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_field_visits_updated_at BEFORE UPDATE ON field_visits
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_leaves_updated_at BEFORE UPDATE ON leaves
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_offices_updated_at BEFORE UPDATE ON offices
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_sites_updated_at BEFORE UPDATE ON sites
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ============================================================================
-- 4. VIEWS
-- ============================================================================

-- Daily Activity Summary View
CREATE OR REPLACE VIEW daily_activity_summary AS
SELECT
  DATE(created_at) as activity_date,
  user_id,
  activity_type,
  COUNT(*) as activity_count,
  SUM(duration_minutes) as total_minutes,
  MAX(updated_at) as last_update
FROM activity_logs
GROUP BY DATE(created_at), user_id, activity_type;

-- User Leave Summary View
CREATE OR REPLACE VIEW user_leave_summary AS
SELECT
  user_id,
  leave_type,
  COUNT(*) as total_leaves,
  SUM(duration_days) as total_days_taken,
  MAX(to_date) as last_leave_date
FROM leaves
WHERE status = 'approved'
GROUP BY user_id, leave_type;

-- Compliance Summary View
CREATE OR REPLACE VIEW compliance_summary AS
SELECT
  user_id,
  COUNT(*) as days_tracked,
  SUM(CASE WHEN is_compliant THEN 1 ELSE 0 END) as compliant_days,
  ROUND(100.0 * SUM(CASE WHEN is_compliant THEN 1 ELSE 0 END) / COUNT(*), 2) as compliance_percentage
FROM location_compliance
WHERE log_date >= DATE_TRUNC('month', CURRENT_DATE)
GROUP BY user_id;

-- ============================================================================
-- SETUP COMPLETE
-- ============================================================================
-- All tables, indexes, RLS policies, and views have been created
-- Ready for data seeding and application use
