-- Add SmartOffice columns to profiles table
ALTER TABLE profiles 
ADD COLUMN IF NOT EXISTS smartoffice_employee_code TEXT,
ADD COLUMN IF NOT EXISTS smartoffice_department TEXT,
ADD COLUMN IF NOT EXISTS smartoffice_designation TEXT,
ADD COLUMN IF NOT EXISTS smartoffice_grade TEXT,
ADD COLUMN IF NOT EXISTS smartoffice_location TEXT,
ADD COLUMN IF NOT EXISTS smartoffice_company TEXT,
ADD COLUMN IF NOT EXISTS smartoffice_team TEXT,
ADD COLUMN IF NOT EXISTS smartoffice_synced_at TIMESTAMPTZ;

-- Create index for faster lookups
CREATE INDEX IF NOT EXISTS idx_profiles_smartoffice_code ON profiles(smartoffice_employee_code);

-- Create unique constraint to prevent duplicate imports
ALTER TABLE profiles 
ADD CONSTRAINT unique_smartoffice_employee_code UNIQUE (smartoffice_employee_code);

SELECT 'SmartOffice columns added to profiles table' AS status;
