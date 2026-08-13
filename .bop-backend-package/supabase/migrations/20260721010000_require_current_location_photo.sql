-- Photo evidence is mandatory for every new current-location submission.
-- NOT VALID preserves any older submissions that were allowed without a photo,
-- while PostgreSQL still enforces this constraint for all new/changed rows.

alter table public.field_visits
  drop constraint if exists field_visits_marked_photo_required_ck;

-- Photo evidence is optional. Location, reason, declaration, and GPS-quality
-- constraints remain authoritative in the submission RPC.
