-- =============================================================================
-- Employee birthday field in the Add / Edit Employee form
-- =============================================================================
-- Birthdays live in public.profiles.date_of_birth (20260926130514). The
-- employee form saves through rpc_admin_save_profile, whose body (since
-- 20261007120000 it is public.rpc_admin_save_profile__core behind a permission
-- wrapper) never wrote date_of_birth, so a birthday typed in the form, or a
-- date_of_birth column in the bulk import (20260927_update_import_rpc*), was
-- silently dropped.
--
-- This migration:
--   1. makes sure profiles.date_of_birth exists (no-op when it does);
--   2. adds hrms_profile_dob_from_values(p_values, current):
--        key missing / JSON null -> keep current value (imports without a DOB
--                                   never wipe an existing birthday)
--        ""                      -> clear (NULL)
--        "YYYY-MM-DD"            -> that date when it is 1900-01-01 .. today
--                                   (IST); an unreadable or impossible date
--                                   keeps the current value with a warning, so
--                                   one bad cell never fails a bulk import (the
--                                   form validates before saving)
--   3. patches the existing save-profile body in place (pg_get_functiondef +
--      anchored replace; each anchor must match exactly once or the migration
--      stops). Nothing else in the function changes. Re-running is a no-op
--      (marker HRMS_DOB_FIELD).
-- =============================================================================

ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS date_of_birth date;

CREATE OR REPLACE FUNCTION public.hrms_profile_dob_from_values(p_values jsonb, p_current date)
RETURNS date
LANGUAGE plpgsql
STABLE
SET search_path = public, pg_temp
AS $$
DECLARE
  v_raw text;
  v_dob date;
BEGIN
  IF p_values IS NULL
     OR NOT (p_values ? 'date_of_birth')
     OR jsonb_typeof(p_values->'date_of_birth') = 'null' THEN
    RETURN p_current;
  END IF;

  v_raw := btrim(p_values->>'date_of_birth');
  IF v_raw = '' THEN
    RETURN NULL;
  END IF;

  BEGIN
    v_dob := v_raw::date;
  EXCEPTION WHEN others THEN
    RAISE WARNING 'date_of_birth ignored (unreadable): %', v_raw;
    RETURN p_current;
  END;

  IF v_dob > (now() AT TIME ZONE 'Asia/Kolkata')::date OR v_dob < date '1900-01-01' THEN
    RAISE WARNING 'date_of_birth ignored (out of range): %', v_raw;
    RETURN p_current;
  END IF;

  RETURN v_dob;
END;
$$;
REVOKE ALL ON FUNCTION public.hrms_profile_dob_from_values(jsonb, date) FROM public, anon, authenticated;

DO $$
DECLARE
  v_fn  regprocedure;
  v_def text;
  v_new text;
  -- INSERT column list:  ..., gender, date_of_joining ) VALUES (
  a1 text := $a$gender,\s*date_of_joining(\s*\)\s*VALUES\s*\()$a$;
  -- INSERT values:       ..., v_doj ) RETURNING id INTO v_id;
  a2 text := $a$(\s+)v_doj(\s*\)\s*RETURNING\s+id\s+INTO\s+v_id\s*;)$a$;
  -- UPDATE set list:     date_of_joining = coalesce(v_doj, date_of_joining),
  a3 text := $a$(\s+)date_of_joining\s*=\s*coalesce\(\s*v_doj\s*,\s*date_of_joining\s*\)\s*,$a$;
BEGIN
  v_fn := coalesce(to_regprocedure('public.rpc_admin_save_profile__core(uuid, jsonb)'),
                   to_regprocedure('public.rpc_admin_save_profile(uuid, jsonb)'));
  IF v_fn IS NULL THEN
    RAISE EXCEPTION 'rpc_admin_save_profile(uuid, jsonb) not found';
  END IF;

  v_def := pg_get_functiondef(v_fn);
  IF position('HRMS_DOB_FIELD' IN v_def) > 0 THEN
    RETURN; -- already patched
  END IF;

  IF (SELECT count(*) FROM regexp_matches(v_def, a1, 'g')) <> 1 THEN
    RAISE EXCEPTION '%: INSERT column list anchor not found exactly once', v_fn;
  END IF;
  IF (SELECT count(*) FROM regexp_matches(v_def, a2, 'g')) <> 1 THEN
    RAISE EXCEPTION '%: INSERT values anchor not found exactly once', v_fn;
  END IF;
  IF (SELECT count(*) FROM regexp_matches(v_def, a3, 'g')) <> 1 THEN
    RAISE EXCEPTION '%: UPDATE date_of_joining anchor not found exactly once', v_fn;
  END IF;

  v_new := regexp_replace(v_def, a1, $b$gender, date_of_joining, date_of_birth\1$b$);
  v_new := regexp_replace(v_new, a2,
    $b$\1v_doj,\1/* HRMS_DOB_FIELD */ public.hrms_profile_dob_from_values(p_values, NULL)\2$b$);
  v_new := regexp_replace(v_new, a3,
    $b$\1date_of_joining = coalesce(v_doj, date_of_joining),\1date_of_birth = public.hrms_profile_dob_from_values(p_values, date_of_birth), /* HRMS_DOB_FIELD */$b$);

  EXECUTE v_new; -- CREATE OR REPLACE keeps owner, grants and SECURITY DEFINER
END $$;

NOTIFY pgrst, 'reload schema';

-- ─── CHECK (read-only, run after) ────────────────────────────────────────────
-- SELECT p.proname,
--        (length(pg_get_functiondef(p.oid)) - length(replace(pg_get_functiondef(p.oid), 'HRMS_DOB_FIELD', ''))) / length('HRMS_DOB_FIELD') AS dob_markers  -- expect 2
-- FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
-- WHERE n.nspname = 'public' AND p.proname IN ('rpc_admin_save_profile', 'rpc_admin_save_profile__core');
-- SELECT public.hrms_profile_dob_from_values('{}'::jsonb, date '1990-01-01')                         AS keep_1990,
--        public.hrms_profile_dob_from_values('{"date_of_birth": null}'::jsonb, date '1990-01-01')    AS keep_1990_null,
--        public.hrms_profile_dob_from_values('{"date_of_birth": ""}'::jsonb, date '1990-01-01')      AS cleared_null,
--        public.hrms_profile_dob_from_values('{"date_of_birth": "1992-07-04"}'::jsonb, NULL)         AS set_1992;
-- SELECT count(*) FILTER (WHERE date_of_birth IS NOT NULL) AS with_dob, count(*) AS total FROM public.profiles;
