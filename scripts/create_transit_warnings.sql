-- Run in Supabase SQL Editor

-- Logs daily transit + suspicious activity warnings
CREATE TABLE IF NOT EXISTS transit_warnings (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid REFERENCES profiles(id) ON DELETE CASCADE,
  date date NOT NULL DEFAULT CURRENT_DATE,
  warning_type text NOT NULL CHECK (warning_type IN ('transit_overdue', 'suspicious_activity')),
  field_visit_id uuid REFERENCES field_visits(id) ON DELETE SET NULL,
  location_name text,
  destination_address text,
  created_at_time text,            -- time the visit was created e.g. "10:30 AM"
  expected_arrival text,           -- calculated expected arrival time
  overdue_by_minutes int,          -- how many minutes overdue
  origin_coords jsonb,             -- GPS coords of employee at time of visit creation
  distance_km numeric,             -- straight-line or Google Maps distance in km
  duration_minutes int,            -- Google Maps / haversine travel time in minutes
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'dismissed')),
  dismissed_by uuid REFERENCES profiles(id) ON DELETE SET NULL,
  dismissed_at timestamptz,
  dismiss_note text,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE transit_warnings DISABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS transit_warnings_date_idx ON transit_warnings(date);
CREATE INDEX IF NOT EXISTS transit_warnings_user_idx ON transit_warnings(user_id);
CREATE UNIQUE INDEX IF NOT EXISTS transit_warnings_unique ON transit_warnings(user_id, date, field_visit_id, warning_type);
