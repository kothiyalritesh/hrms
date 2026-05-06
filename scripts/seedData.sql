-- ============================================================
-- Seed Data for Roles and Offices
-- Run this in Supabase SQL Editor to populate initial data
-- ============================================================

-- Insert Roles
INSERT INTO roles (name) VALUES
  ('Business Head'),
  ('Commercial Team'),
  ('Accounts Team'),
  ('Marketing Team'),
  ('Team Head'),
  ('Team Lead'),
  ('Sales Executive')
ON CONFLICT (name) DO NOTHING;

-- Insert Offices
INSERT INTO offices (name) VALUES
  ('Sector 63'),
  ('Greater Noida 136'),
  ('Greater Noida Alpha 2'),
  ('Gurugram')
ON CONFLICT (name) DO NOTHING;

-- Verify the inserts
SELECT 'Roles' as type, COUNT(*) as count FROM roles
UNION ALL
SELECT 'Offices' as type, COUNT(*) as count FROM offices;
