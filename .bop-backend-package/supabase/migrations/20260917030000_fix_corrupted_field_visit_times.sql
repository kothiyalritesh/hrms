-- ==============================================================================
-- FIX CORRUPTED DATA: Shift all timestamps forward by 5.5 hours to recover from 
-- the bad migration that interpreted UTC times as local Indian times.
-- Only applies to records created before this fix runs.
-- ==============================================================================
UPDATE public.field_visits
SET checkin_time = checkin_time + interval '5 hours 30 minutes'
WHERE checkin_time IS NOT NULL AND checkin_time < now();

UPDATE public.field_visits
SET checkout_time = checkout_time + interval '5 hours 30 minutes'
WHERE checkout_time IS NOT NULL AND checkout_time < now();
