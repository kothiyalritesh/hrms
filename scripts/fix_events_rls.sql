-- ============================================================
-- Events: disable RLS (app uses custom auth, auth.uid() = NULL)
-- Run this in Supabase SQL Editor
-- ============================================================

ALTER TABLE events          DISABLE ROW LEVEL SECURITY;
ALTER TABLE event_checkins  DISABLE ROW LEVEL SECURITY;

-- Storage bucket for event photos (run once)
-- If the bucket doesn't exist yet, create it via Supabase Dashboard:
--   Storage → New Bucket → Name: "event-photos" → Public: ON
-- Then run this to allow all operations (custom auth, no JWT):
INSERT INTO storage.buckets (id, name, public)
VALUES ('event-photos', 'event-photos', true)
ON CONFLICT (id) DO UPDATE SET public = true;

-- Allow anyone to upload/read (custom auth — no Supabase JWT)
DROP POLICY IF EXISTS "event_photos_all" ON storage.objects;
CREATE POLICY "event_photos_all"
ON storage.objects FOR ALL
USING (bucket_id = 'event-photos')
WITH CHECK (bucket_id = 'event-photos');

SELECT tablename, rowsecurity
FROM pg_tables
WHERE schemaname = 'public' AND tablename IN ('events', 'event_checkins');
