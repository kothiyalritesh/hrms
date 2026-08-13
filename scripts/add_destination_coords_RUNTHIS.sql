-- ============================================================
-- RUN THIS NOW in Supabase SQL Editor
-- Adds destination_coords so site visit check-in geo-fence works
-- ============================================================

ALTER TABLE field_visits
  ADD COLUMN IF NOT EXISTS destination_coords JSONB,
  ADD COLUMN IF NOT EXISTS checkin_radius_m   INTEGER DEFAULT 100,
  ADD COLUMN IF NOT EXISTS location_address   TEXT,
  ADD COLUMN IF NOT EXISTS meeting_type       VARCHAR(30),
  ADD COLUMN IF NOT EXISTS contact_name       VARCHAR(255),
  ADD COLUMN IF NOT EXISTS contact_phone      VARCHAR(50),
  ADD COLUMN IF NOT EXISTS company_name       VARCHAR(255),
  ADD COLUMN IF NOT EXISTS project_name       VARCHAR(255),
  ADD COLUMN IF NOT EXISTS notes              TEXT;

-- Force PostgREST to see the new columns immediately
NOTIFY pgrst, 'reload schema';

-- Verify
SELECT column_name FROM information_schema.columns
WHERE table_name = 'field_visits' AND column_name IN (
  'destination_coords','checkin_radius_m','location_address',
  'meeting_type','contact_name','company_name','project_name','notes'
)
ORDER BY column_name;
