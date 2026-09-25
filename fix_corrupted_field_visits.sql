-- Fix corrupted checkin times that were shifted backward by 5.5 hours
UPDATE public.field_visits
SET checkin_time = checkin_time + interval '5 hours 30 minutes'
WHERE checkin_time IS NOT NULL;

UPDATE public.field_visits
SET checkout_time = checkout_time + interval '5 hours 30 minutes'
WHERE checkout_time IS NOT NULL;
