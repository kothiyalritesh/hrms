ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS home_address TEXT;
ALTER TABLE public.field_visits ADD COLUMN IF NOT EXISTS lead_source TEXT;
