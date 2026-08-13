-- ============================================================
-- Add checkout_office_id column to field_visits
-- Also create auto-checkout function for end-of-day
-- ============================================================

-- Add column to store nearest office at checkout time
ALTER TABLE field_visits
  ADD COLUMN IF NOT EXISTS checkout_office_id UUID REFERENCES offices(id) ON DELETE SET NULL;

-- Create function to auto-checkout field visits at end of day
CREATE OR REPLACE FUNCTION auto_checkout_field_visits()
RETURNS void AS $$
DECLARE
  today_date TEXT;
BEGIN
  today_date := TO_CHAR(NOW() AT TIME ZONE 'Asia/Kolkata', 'YYYY-MM-DD');
  
  -- Mark all CHECKED_IN field visits as COMPLETED with auto-checkout
  UPDATE field_visits
  SET 
    status = 'COMPLETED',
    checkout_time = NOW(),
    checkout_notes = 'Auto checked out at end of day'
  WHERE 
    status = 'CHECKED_IN'
    AND date = today_date;
    
  RAISE NOTICE 'Auto-checked out % field visits for %', 
    (SELECT COUNT(*) FROM field_visits WHERE status = 'COMPLETED' AND checkout_notes = 'Auto checked out at end of day' AND date = today_date),
    today_date;
END;
$$ LANGUAGE plpgsql;

-- Grant execute permission
GRANT EXECUTE ON FUNCTION auto_checkout_field_visits() TO authenticated;
GRANT EXECUTE ON FUNCTION auto_checkout_field_visits() TO service_role;