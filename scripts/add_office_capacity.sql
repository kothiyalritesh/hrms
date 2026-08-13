-- Add capacity column to offices table
-- This stores the actual seating capacity, separate from geofence radius

ALTER TABLE offices 
ADD COLUMN IF NOT EXISTS capacity INTEGER DEFAULT 50;

-- Update existing offices with reasonable capacity values
-- You can adjust these based on actual office sizes
UPDATE offices 
SET capacity = 50 
WHERE capacity IS NULL;
