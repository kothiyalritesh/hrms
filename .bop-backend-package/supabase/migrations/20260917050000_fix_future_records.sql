-- Fix the remaining records that were skipped because they were "in the future"
UPDATE public.field_visits
SET checkin_time = checkin_time - interval '5 hours 30 minutes'
WHERE checkin_time > now();

UPDATE public.field_visits
SET checkout_time = checkout_time - interval '5 hours 30 minutes'
WHERE checkout_time > now();
