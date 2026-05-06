-- ============================================================
-- Fix Departments and Designations Schema
-- Run this script to add missing fields required by the application
-- ============================================================

-- Add missing fields to departments table
ALTER TABLE departments
ADD COLUMN IF NOT EXISTS code TEXT,
ADD COLUMN IF NOT EXISTS parent_id UUID REFERENCES departments(id) ON DELETE SET NULL,
ADD COLUMN IF NOT EXISTS budget_allocated DECIMAL(15, 2),
ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT now(),
ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;

-- Add missing fields to designations table
ALTER TABLE designations
ADD COLUMN IF NOT EXISTS code TEXT,
ADD COLUMN IF NOT EXISTS description TEXT,
ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT now(),
ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;

-- Update existing departments to have unique code if missing
UPDATE departments
SET code = UPPER(SUBSTR(name, 1, 3)) || SUBSTR(md5(id::TEXT), 1, 3)
WHERE code IS NULL;

-- Update existing records with current timestamp for updated_at
UPDATE departments
SET updated_at = created_at
WHERE updated_at IS NULL;

UPDATE designations
SET updated_at = created_at
WHERE updated_at IS NULL;

-- Create indexes for better query performance
CREATE INDEX IF NOT EXISTS idx_departments_code ON departments(code);
CREATE INDEX IF NOT EXISTS idx_departments_parent_id ON departments(parent_id);
CREATE INDEX IF NOT EXISTS idx_departments_deleted_at ON departments(deleted_at);
CREATE INDEX IF NOT EXISTS idx_designations_code ON designations(code);
CREATE INDEX IF NOT EXISTS idx_designations_deleted_at ON designations(deleted_at);
CREATE INDEX IF NOT EXISTS idx_designations_department_id ON designations(department_id);

-- ============================================================
-- Verify the schema changes
-- ============================================================

-- View departments structure
-- SELECT column_name, data_type, is_nullable FROM information_schema.columns WHERE table_name = 'departments' ORDER BY ordinal_position;

-- View designations structure
-- SELECT column_name, data_type, is_nullable FROM information_schema.columns WHERE table_name = 'designations' ORDER BY ordinal_position;
