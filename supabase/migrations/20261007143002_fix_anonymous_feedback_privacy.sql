-- =============================================================================
-- 20261007143002_fix_anonymous_feedback_privacy.sql
--
-- feedback_audit stored auth.uid() for every "anonymous" submission and
-- SYSTEM_ADMIN could read it, so feedback was not actually anonymous.
-- Stop recording the submitter and destroy the identities already stored.
-- Idempotent.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.trg_audit_anonymous_feedback()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
BEGIN
  INSERT INTO public.feedback_audit (feedback_id) VALUES (NEW.id);
  RETURN NEW;
END;
$fn$;

ALTER TABLE public.feedback_audit DROP COLUMN IF EXISTS user_id;

NOTIFY pgrst, 'reload schema';
