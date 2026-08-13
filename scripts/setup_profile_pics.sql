-- ============================================================
-- Profile Picture Storage Setup
-- Run in Supabase SQL Editor
-- ============================================================

-- 1. Add avatar_url column to profiles (if not exists)
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS avatar_url TEXT;

-- 2. Create storage bucket for profile pics (run in Supabase Dashboard > Storage
--    OR via this SQL using the storage schema)
INSERT INTO storage.buckets (id, name, public)
VALUES ('profile-pics', 'profile-pics', false)
ON CONFLICT (id) DO UPDATE SET public = false;

-- 3. Allow employees to read only their own private avatar
DROP POLICY IF EXISTS "Public read profile pics" ON storage.objects;
CREATE POLICY "Users read own avatar"
  ON storage.objects FOR SELECT
  USING (
    bucket_id = 'profile-pics'
    AND (storage.foldername(name))[1] = 'avatars'
    AND split_part(storage.filename(name), '.', 1) = auth.uid()::text
  );

-- 4. Allow authenticated users to upload their own avatar
DROP POLICY IF EXISTS "Users upload own avatar" ON storage.objects;
CREATE POLICY "Users upload own avatar"
  ON storage.objects FOR INSERT
  WITH CHECK (
    bucket_id = 'profile-pics'
    AND (storage.foldername(name))[1] = 'avatars'
    AND split_part(storage.filename(name), '.', 1) = auth.uid()::text
  );

-- 5. Allow users to update/replace their own avatar
DROP POLICY IF EXISTS "Users update own avatar" ON storage.objects;
CREATE POLICY "Users update own avatar"
  ON storage.objects FOR UPDATE
  USING (
    bucket_id = 'profile-pics'
    AND (storage.foldername(name))[1] = 'avatars'
    AND split_part(storage.filename(name), '.', 1) = auth.uid()::text
  )
  WITH CHECK (
    bucket_id = 'profile-pics'
    AND (storage.foldername(name))[1] = 'avatars'
    AND split_part(storage.filename(name), '.', 1) = auth.uid()::text
  );

SELECT 'Profile pics storage ready' AS status;
