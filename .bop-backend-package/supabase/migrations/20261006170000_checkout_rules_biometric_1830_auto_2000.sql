-- =============================================================================
-- 20261006170000_checkout_rules_biometric_1830_auto_2000.sql
--
-- Business rule (single source of truth):
--   A day's checkout is, in priority order:
--     1. an approved regularization checkout
--     2. an admin correction
--     3. the employee pressing Check-out in the application
--     4. the LAST biometric punch of the day, but only if it is at/after 18:30 IST
--     5. otherwise an automatic checkout at 20:00 IST
--        (applied once 20:00 IST has passed, and for every earlier day)
--   Biometric punches before 18:30 IST are NOT a checkout: people tap the
--   machine during the day and were wrongly shown as "Checked Out / Home".
--   A field-visit checkout ends the visit, not the working day.
--
-- Parts:
--   A. hrms_checkout_policy()            the two times (edit only here)
--   B. hrms_canonical_row_patch(jsonb)   what every screen/report shows
--   C. hrms_apply_day_end_checkouts()    writes the checkout at 20:00 IST
--      reconcile_missing_attendance_checkouts(date) now uses the same rule"private_key": Required
--   D. pg_cron: 20:00 IST (close) and 23:58 IST (upgrade to a later punch)
--
-- Requires 20261006150000 + 20261006160000. Idempotent.
-- =============================================================================

-- ─── A. Policy times ─────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.hrms_checkout_policy(
  OUT biometric_checkout_from time,
  OUT auto_checkout_at time
)
LANGUAGE sql
IMMUTABLE
SET search_path = public, pg_temp
AS $$
  SELECT time '18:30', time '20:00';
$$;

GRANT EXECUTE ON FUNCTION public.hrms_checkout_policy() TO authenticated, service_role;

-- ─── B. Display rule (used by rpc_attendance_canonical_range) ────────────────

CREATE OR REPLACE FUNCTION public.hrms_canonical_row_patch(r jsonb)
RETURNS jsonb
LANGUAGE sql
STABLE
SET search_path = public, pg_temp
AS $$
  WITH pol AS (
    SELECT * FROM public.hrms_checkout_policy()
  ), v AS (
    SELECT (r->>'work_date')::date                               AS work_date,
           (r->>'app_first_in')::timestamptz                     AS app_in,
           (r->>'biometric_first_in')::timestamptz               AS bio_in,
           (r->>'field_visit_first_in')::timestamptz             AS fv_in,
           upper(coalesce(r->>'attendance_source', ''))          AS src,
           (r->>'approved_regularization_checkout')::timestamptz AS reg_out,
           (r->>'admin_corrected_checkout')::timestamptz         AS adm_out,
           (r->>'app_checkout')::timestamptz                     AS app_out,
           (r->>'biometric_last_punch_evidence')::timestamptz    AS bio_last,
           (r->>'raw_checkout')::timestamptz                     AS raw_out
  ), f AS (
    SELECT v.*,
           CASE WHEN v.src = 'ADMIN' AND v.app_in IS NOT NULL THEN v.app_in
                ELSE least(v.app_in, v.bio_in, v.fv_in) END AS first_in,
           ((v.work_date::text || ' ' || pol.biometric_checkout_from::text)::timestamp
              AT TIME ZONE 'Asia/Kolkata') AS bio_from,
           ((v.work_date::text || ' ' || pol.auto_checkout_at::text)::timestamp
              AT TIME ZONE 'Asia/Kolkata') AS auto_at
    FROM v, pol
  ), c AS (
    SELECT f.*,
      CASE
        WHEN f.reg_out IS NOT NULL AND f.reg_out > f.first_in THEN f.reg_out
        WHEN f.adm_out IS NOT NULL AND f.adm_out > f.first_in THEN f.adm_out
        WHEN f.app_out IS NOT NULL AND f.app_out > f.first_in THEN f.app_out
        WHEN f.bio_last IS NOT NULL AND f.bio_last >= f.bio_from AND f.bio_last > f.first_in THEN f.bio_last
        -- a checkout written by the day-end job / older imports, only if it obeys the rule
        WHEN f.raw_out IS NOT NULL AND f.raw_out >= f.bio_from AND f.raw_out > f.first_in THEN f.raw_out
        WHEN now() >= f.auto_at AND f.first_in < f.auto_at THEN f.auto_at
      END AS last_out,
      CASE
        WHEN f.reg_out IS NOT NULL AND f.reg_out > f.first_in THEN 'REGULARIZATION'
        WHEN f.adm_out IS NOT NULL AND f.adm_out > f.first_in THEN 'ADMIN_CORRECTED'
        WHEN f.app_out IS NOT NULL AND f.app_out > f.first_in THEN 'APP'
        WHEN f.bio_last IS NOT NULL AND f.bio_last >= f.bio_from AND f.bio_last > f.first_in THEN 'BIOMETRIC'
        WHEN f.raw_out IS NOT NULL AND f.raw_out >= f.bio_from AND f.raw_out > f.first_in THEN
          CASE WHEN f.raw_out = f.auto_at THEN 'AUTO_8PM' ELSE 'SYSTEM' END
        WHEN now() >= f.auto_at AND f.first_in < f.auto_at THEN 'AUTO_8PM'
        ELSE 'NO_DATA'
      END AS last_out_source
    FROM f
  )
  SELECT CASE
    WHEN c.first_in IS NULL THEN '{}'::jsonb      -- absent / leave / off: untouched
    ELSE jsonb_build_object(
      'effective_checkin', c.first_in,
      'official_first_in', c.first_in,
      'first_in_source', CASE
          WHEN c.src = 'ADMIN' AND c.app_in IS NOT NULL THEN 'ADMIN_CORRECTED'
          WHEN c.first_in = c.app_in THEN 'APP'
          WHEN c.first_in = c.bio_in THEN 'BIOMETRIC'
          WHEN c.first_in = c.fv_in  THEN 'FIELD_VISIT'
          ELSE r->>'first_in_source' END,
      'effective_checkout', c.last_out,
      'official_last_out',  c.last_out,
      'last_out_source',    c.last_out_source,
      'working_minutes', CASE WHEN c.last_out IS NOT NULL
                              THEN floor(extract(epoch FROM (c.last_out - c.first_in)) / 60)::int END,
      'effective_status', CASE
          WHEN r->>'effective_status' IN ('CHECKED_IN', 'CHECKED_OUT')
            THEN CASE WHEN c.last_out IS NULL THEN 'CHECKED_IN' ELSE 'CHECKED_OUT' END
          ELSE r->>'effective_status' END,
      'attendance_status', CASE
          WHEN r->>'attendance_status' IN ('CHECKED_IN', 'CHECKED_OUT')
            THEN CASE WHEN c.last_out IS NULL THEN 'CHECKED_IN' ELSE 'CHECKED_OUT' END
          ELSE r->>'attendance_status' END,
      'warning', CASE
          WHEN c.last_out_source = 'AUTO_8PM' THEN to_jsonb('Auto checkout at 8 PM (no app checkout, no biometric after 6:30 PM)'::text)
          WHEN c.last_out IS NULL AND (r->>'warning') = 'No checkout' THEN 'null'::jsonb
          ELSE r->'warning' END
    )
  END
  FROM c;
$$;

REVOKE ALL ON FUNCTION public.hrms_canonical_row_patch(jsonb) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.hrms_canonical_row_patch(jsonb) TO authenticated;

-- ─── C. Day-end job (writes the checkout to attendance_logs) ─────────────────

CREATE OR REPLACE FUNCTION public.hrms_apply_day_end_checkouts(p_business_date date DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_now      timestamptz := now();
  v_today    date := (now() AT TIME ZONE 'Asia/Kolkata')::date;
  v_pol      record;
  v_row      record;
  v_bio_from timestamptz;
  v_auto_at  timestamptz;
  v_bio_last timestamptz;
  v_out      timestamptz;
  v_reason   text;
  v_closed   integer := 0;
  v_upgraded integer := 0;
BEGIN
  SELECT * INTO v_pol FROM public.hrms_checkout_policy();

  -- Lets the machine-checkout guard and the protected-checkout trigger accept
  -- this as an authorized day-end action (an audit row is written for each).
  PERFORM set_config('app.authorized_attendance_checkout', 'DAY_END', true);

  FOR v_row IN
    SELECT a.*
    FROM public.attendance_logs a
    WHERE a.checkin_time IS NOT NULL
      -- Scheduled runs (no date) touch only today and yesterday; history is
      -- repaired explicitly, one date at a time (see the implementation guide).
      AND (CASE WHEN p_business_date IS NULL THEN a.date >= v_today - 1
                ELSE a.date = p_business_date END)
      AND a.date <= v_today
      AND (
        a.checkout_time IS NULL
        -- an earlier automatic close that broke the rule (e.g. a 13:03 punch)
        OR (upper(coalesce(a.checkout_source, '')) = 'SYSTEM'
            AND (a.checkout_time AT TIME ZONE 'Asia/Kolkata')::time < v_pol.biometric_checkout_from)
        -- closed at 20:00 automatically; a later biometric punch may exist now
        OR (upper(coalesce(a.checkout_source, '')) = 'SYSTEM'
            AND (a.checkout_time AT TIME ZONE 'Asia/Kolkata')::time = v_pol.auto_checkout_at)
        -- the biometric sync stores the FIRST punch after 18:30; the rule is the LAST
        OR upper(coalesce(a.checkout_source, '')) = 'BIOMETRIC'
      )
    ORDER BY a.date, a.id
    FOR UPDATE
  LOOP
    v_bio_from := ((v_row.date::text || ' ' || v_pol.biometric_checkout_from::text)::timestamp AT TIME ZONE 'Asia/Kolkata');
    v_auto_at  := ((v_row.date::text || ' ' || v_pol.auto_checkout_at::text)::timestamp AT TIME ZONE 'Asia/Kolkata');

    -- Not yet 20:00 IST for this day: leave it open.
    CONTINUE WHEN v_now < v_auto_at;

    SELECT max(d.log_date) INTO v_bio_last
    FROM public.smartoffice_device_logs d
    WHERE d.user_id = v_row.user_id AND d.log_date_only = v_row.date;
    v_bio_last := greatest(v_bio_last, v_row.biometric_last_punch);

    IF v_bio_last IS NOT NULL AND v_bio_last >= v_bio_from AND v_bio_last > v_row.checkin_time THEN
      v_out := v_bio_last;
      v_reason := 'BIOMETRIC_LAST_PUNCH_AFTER_1830: last biometric punch of the day';
    ELSIF v_row.checkin_time < v_auto_at THEN
      v_out := v_auto_at;
      v_reason := 'AUTO_8PM: no app checkout and no biometric punch after 18:30 IST';
    ELSE
      CONTINUE;   -- checked in after 20:00: leave for manual handling
    END IF;

    CONTINUE WHEN v_row.checkout_time IS NOT DISTINCT FROM v_out;
    -- never replace a biometric checkout with something earlier
    CONTINUE WHEN upper(coalesce(v_row.checkout_source, '')) = 'BIOMETRIC'
                  AND v_row.checkout_time IS NOT NULL AND v_out <= v_row.checkout_time;

    UPDATE public.attendance_logs
    SET checkout_time        = v_out,
        checkout_source      = 'SYSTEM',
        status               = 'AUTO_CHECKED_OUT',
        auto_checkout        = true,
        auto_checkout_reason = v_reason,
        undo_token           = NULL,
        undo_expires_at      = NULL,
        work_hours           = greatest(0, round((extract(epoch FROM (v_out - v_row.checkin_time)) / 3600)::numeric, 2)),
        updated_at           = now()
    WHERE id = v_row.id;

    INSERT INTO public.attendance_audit_logs (
      attendance_id, user_id, action, old_status, new_status,
      old_checkout_at, new_checkout_at, reason, source
    ) VALUES (
      v_row.id, v_row.user_id, 'CHECKOUT_AUTO', v_row.status, 'AUTO_CHECKED_OUT',
      v_row.checkout_time, v_out, v_reason, 'SYSTEM'
    );

    IF v_row.checkout_time IS NULL THEN
      v_closed := v_closed + 1;
    ELSE
      v_upgraded := v_upgraded + 1;
    END IF;
  END LOOP;

  RETURN jsonb_build_object('success', true, 'closed', v_closed, 'corrected', v_upgraded,
                            'business_date', coalesce(p_business_date, v_today));
END;
$$;

REVOKE ALL ON FUNCTION public.hrms_apply_day_end_checkouts(date) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.hrms_apply_day_end_checkouts(date) TO service_role;

-- Old entry point (called by the auto-end-time Edge Function): same rule now.
CREATE OR REPLACE FUNCTION public.reconcile_missing_attendance_checkouts(
  p_target_date date DEFAULT (now() AT TIME ZONE 'Asia/Kolkata')::date
)
RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_result jsonb;
BEGIN
  v_result := public.hrms_apply_day_end_checkouts(p_target_date);
  RETURN coalesce((v_result->>'closed')::int, 0) + coalesce((v_result->>'corrected')::int, 0);
END;
$$;

REVOKE ALL ON FUNCTION public.reconcile_missing_attendance_checkouts(date) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reconcile_missing_attendance_checkouts(date) TO service_role;

-- ─── D. Schedules (IST = UTC+5:30) ───────────────────────────────────────────

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    PERFORM cron.unschedule(jobid) FROM cron.job
    WHERE jobname IN ('hrms-auto-checkout-reconcile-830pm-ist',
                      'hrms-day-end-checkout-8pm-ist',
                      'hrms-day-end-checkout-2358-ist');
    -- 20:00 IST: close open days (biometric >= 18:30, else 20:00)
    PERFORM cron.schedule('hrms-day-end-checkout-8pm-ist', '30 14 * * *',
      $job$ select public.hrms_apply_day_end_checkouts(null); $job$);
    -- 23:58 IST: pick up biometric punches made after 20:00
    PERFORM cron.schedule('hrms-day-end-checkout-2358-ist', '28 18 * * *',
      $job$ select public.hrms_apply_day_end_checkouts(null); $job$);
  ELSE
    RAISE NOTICE 'pg_cron not installed: schedule hrms_apply_day_end_checkouts(null) at 20:00 and 23:58 IST in the Supabase dashboard.';
  END IF;
END $$;

NOTIFY pgrst, 'reload schema';

-- =============================================================================
-- ROLLBACK (manual): re-run 20261006150000 section 2 for the previous patch
-- function, and re-run 20260910000000 for the old 20:30 schedule.
-- =============================================================================
