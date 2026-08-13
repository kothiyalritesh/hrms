-- ============================================================
-- Ensure avatar column exists on profiles table
-- Run in Supabase SQL Editor → New Query → Run
-- ============================================================

-- Step 1: Add avatar column if it doesn't exist
ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS avatar TEXT;

-- Step 2: Verify
SELECT id, name, avatar FROM profiles LIMIT 5;

-- ============================================================
-- Step 3: Ensure the storage bucket exists and is private
-- (Run once — safe to re-run)
-- ============================================================
INSERT INTO storage.buckets (id, name, public)
VALUES ('profile-pics', 'profile-pics', false)
ON CONFLICT (id) DO UPDATE SET public = false;

-- Step 4: Allow employees to read only their own avatar
DROP POLICY IF EXISTS "profile-pics public read" ON storage.objects;
CREATE POLICY "profile-pics own read"
  ON storage.objects FOR SELECT
  USING (
    bucket_id = 'profile-pics'
    AND (storage.foldername(name))[1] = 'avatars'
    AND split_part(storage.filename(name), '.', 1) = auth.uid()::text
  );

-- Step 5: Allow authenticated users to upload their own pic
DROP POLICY IF EXISTS "profile-pics user upload" ON storage.objects;
CREATE POLICY "profile-pics user upload"
  ON storage.objects FOR INSERT
  WITH CHECK (
    bucket_id = 'profile-pics'
    AND (storage.foldername(name))[1] = 'avatars'
    AND split_part(storage.filename(name), '.', 1) = auth.uid()::text
  );

-- Step 6: Allow authenticated users to update/replace their own pic
DROP POLICY IF EXISTS "profile-pics user update" ON storage.objects;
CREATE POLICY "profile-pics user update"
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
