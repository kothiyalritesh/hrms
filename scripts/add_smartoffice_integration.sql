-- Add SmartOffice integration columns to profiles table
-- Run this migration to enable SmartOffice employee sync

-- Add SmartOffice employee code for matching
ALTER TABLE profiles 
ADD COLUMN IF NOT EXISTS smartoffice_employee_code VARCHAR(50) UNIQUE;

-- Add SmartOffice employee details
ALTER TABLE profiles 
ADD COLUMN IF NOT EXISTS smartoffice_department VARCHAR(100),
ADD COLUMN IF NOT EXISTS smartoffice_designation VARCHAR(100),
ADD COLUMN IF NOT EXISTS smartoffice_grade VARCHAR(50),
ADD COLUMN IF NOT EXISTS smartoffice_location VARCHAR(100),
ADD COLUMN IF NOT EXISTS smartoffice_company VARCHAR(100),
ADD COLUMN IF NOT EXISTS smartoffice_team VARCHAR(100),
ADD COLUMN IF NOT EXISTS smartoffice_synced_at TIMESTAMP WITH TIME ZONE;

-- Create index for faster lookups
CREATE INDEX IF NOT EXISTS idx_profiles_smartoffice_code 
ON profiles(smartoffice_employee_code) 
WHERE smartoffice_employee_code IS NOT NULL;

-- Create index for sync status queries
CREATE INDEX IF NOT EXISTS idx_profiles_smartoffice_sync 
ON profiles(smartoffice_synced_at) 
WHERE smartoffice_synced_at IS NOT NULL;

-- Add comment for documentation
COMMENT ON COLUMN profiles.smartoffice_employee_code IS 'Employee code from SmartOffice biometric system for matching';
COMMENT ON COLUMN profiles.smartoffice_synced_at IS 'Last time this profile was synced with SmartOffice data';