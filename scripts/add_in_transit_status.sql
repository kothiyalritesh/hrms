-- Run in Supabase SQL Editor to add IN_TRANSIT status and origin columns

-- 1. Add IN_TRANSIT to status enum (alter table to allow new status)
ALTER TABLE field_visits 
  ALTER COLUMN status TYPE VARCHAR(20) 
  USING status::VARCHAR(20);

-- 2. Drop and recreate check constraint with IN_TRANSIT status
ALTER TABLE field_visits 
  DROP CONSTRAINT IF EXISTS field_visits_status_check;

ALTER TABLE field_visits 
  ADD CONSTRAINT field_visits_status_check 
  CHECK (status IN ('PENDING', 'CHECKED_IN', 'COMPLETED', 'MISSED', 'IN_TRANSIT'));

-- 3. Add origin tracking columns if not exist
ALTER TABLE field_visits
  ADD COLUMN IF NOT EXISTS origin_lat NUMERIC,
  ADD COLUMN IF NOT EXISTS origin_lon NUMERIC,
  ADD COLUMN IF NOT EXISTS origin_name TEXT;

-- 4. Update existing visits to have IN_TRANSIT status if they should be in transit
-- (This will be handled automatically by the app logic below)

SELECT 'field_visits updated with IN_TRANSIT status and origin columns!' AS status;
