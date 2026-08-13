-- Add location_address column to store structured address entered by user
ALTER TABLE field_visits ADD COLUMN IF NOT EXISTS location_address TEXT;

-- Verify
SELECT column_name, data_type FROM information_schema.columns
WHERE table_name = 'field_visits' AND column_name = 'location_address';
