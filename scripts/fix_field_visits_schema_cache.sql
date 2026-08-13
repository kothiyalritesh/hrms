-- ============================================================
-- FIX: field_visits schema cache error — 400 on create visit
-- "could not find the origin_lat column of field_visits in schema cache"
--
-- HOW TO RUN:
--   Supabase Dashboard → SQL Editor → New Query → paste all → Run
--
-- Safe to run multiple times. All ADD COLUMN use IF NOT EXISTS.
-- ============================================================

-- ── Step 0: Show what columns exist RIGHT NOW ─────────────────────────────────
-- (Read this output to confirm the problem before and after)
SELECT column_name, data_type
FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'field_visits'
ORDER BY ordinal_position;

-- ── Step 1: Core columns that may be missing ──────────────────────────────────
ALTER TABLE field_visits ADD COLUMN IF NOT EXISTS predefined_site_id UUID REFERENCES predefined_sites(id) ON DELETE SET NULL;
ALTER TABLE field_visits ADD COLUMN IF NOT EXISTS location_address   TEXT;
ALTER TABLE field_visits ADD COLUMN IF NOT EXISTS destination_coords JSONB;
ALTER TABLE field_visits ADD COLUMN IF NOT EXISTS checkin_radius_m   INTEGER DEFAULT 100;
ALTER TABLE field_visits ADD COLUMN IF NOT EXISTS origin_lat         NUMERIC;
ALTER TABLE field_visits ADD COLUMN IF NOT EXISTS origin_lon         NUMERIC;
ALTER TABLE field_visits ADD COLUMN IF NOT EXISTS origin_name        TEXT;
ALTER TABLE field_visits ADD COLUMN IF NOT EXISTS dest_lat           NUMERIC;
ALTER TABLE field_visits ADD COLUMN IF NOT EXISTS dest_lon           NUMERIC;
ALTER TABLE field_visits ADD COLUMN IF NOT EXISTS meeting_type       VARCHAR(30);
ALTER TABLE field_visits ADD COLUMN IF NOT EXISTS contact_name       VARCHAR(255);
ALTER TABLE field_visits ADD COLUMN IF NOT EXISTS contact_phone      VARCHAR(50);
ALTER TABLE field_visits ADD COLUMN IF NOT EXISTS company_name       VARCHAR(255);
ALTER TABLE field_visits ADD COLUMN IF NOT EXISTS project_name       VARCHAR(255);
ALTER TABLE field_visits ADD COLUMN IF NOT EXISTS notes              TEXT;

-- ── Step 2: Fix status constraint (add IN_TRANSIT if missing) ─────────────────
ALTER TABLE field_visits DROP CONSTRAINT IF EXISTS field_visits_status_check;
ALTER TABLE field_visits ADD CONSTRAINT field_visits_status_check
  CHECK (status IN ('PENDING', 'CHECKED_IN', 'COMPLETED', 'MISSED', 'IN_TRANSIT'));

-- ── Step 3: Indexes ────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_field_visits_predefined_site ON field_visits(predefined_site_id);
CREATE INDEX IF NOT EXISTS idx_field_visits_user_date       ON field_visits(user_id, date);
CREATE INDEX IF NOT EXISTS idx_field_visits_status          ON field_visits(status);

-- ── Step 4: Force PostgREST schema cache reload immediately ───────────────────
-- Without this, Supabase takes up to 5 min to notice the new columns.
NOTIFY pgrst, 'reload schema';

-- ── Step 5: Confirm all columns now exist ─────────────────────────────────────
SELECT column_name, data_type
FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'field_visits'
ORDER BY ordinal_position;

-- You should now see: origin_lat, origin_lon, origin_name, dest_lat, dest_lon,
-- destination_coords, checkin_radius_m, meeting_type, contact_name, contact_phone,
-- company_name, project_name, notes, predefined_site_id, location_address
