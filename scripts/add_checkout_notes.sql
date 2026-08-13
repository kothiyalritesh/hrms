-- Add checkout_notes to field_visits
ALTER TABLE field_visits ADD COLUMN IF NOT EXISTS checkout_notes TEXT;

-- Verify
SELECT column_name FROM information_schema.columns WHERE table_name = 'field_visits' ORDER BY ordinal_position;
