-- Add destination coordinates to field_visits
-- These are set when user creates a visit via LocationSearchInput (Nominatim)
ALTER TABLE field_visits
  ADD COLUMN IF NOT EXISTS destination_coords JSONB; -- {latitude, longitude}

-- Verify
SELECT id, location_name, destination_coords FROM field_visits LIMIT 5;


also give user right to map the location on a emveded map so user have more freedom if user types noida city center or notrth delth map should open at that locaiton so that iots easier for usert to maphis field locaiton on map

