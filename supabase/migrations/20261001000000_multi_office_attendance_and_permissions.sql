-- =============================================================================
-- MIGRATION: Multi-Office Attendance & Unified Permission System
-- Date: 2026-10-01
-- Version: 1.0.1
-- =============================================================================

-- STEP 1: Fix v_attendance_daily_canonical
-- Keeps security_invoker=true and correct base from 20260929000014
-- Just adds check_in_office_id, check_in_office_name, attendance_source

CREATE OR REPLACE VIEW public.v_attendance_daily_canonical
WITH (security_invoker=true) AS
WITH employee_days AS (
  SELECT p.id user_id, day::date work_date, p.name employee_name, p.employee_number,
    p.office_id, o.name office_name, p.team_id, COALESCE(t.name,p.team) team_name,
    p.reports_to team_head_id, manager.name team_head_name, p.role, p.show_on_tv,
    p.joining_date, p.is_active
  FROM public.profiles p
  LEFT JOIN public.offices o ON o.id=p.office_id
  LEFT JOIN public.teams t ON t.id=p.team_id
  LEFT JOIN public.profiles manager ON manager.id=p.reports_to
  CROSS JOIN LATERAL generate_series(
    greatest(COALESCE(p.joining_date,(p.created_at AT TIME ZONE 'Asia/Kolkata')::date), date '2020-01-01'),
    least(COALESCE(p.last_working_date,(now() AT TIME ZONE 'Asia/Kolkata')::date),(now() AT TIME ZONE 'Asia/Kolkata')::date),
    INTERVAL '1 day') day
  WHERE p.attendance_reporting_enabled
    AND (day::date < (now() AT TIME ZONE 'Asia/Kolkata')::date OR p.is_active)
), evidence AS (
SELECT employee.*,
  attendance.id attendance_log_id,

  -- *** NEW: Actual check-in office (from attendance_logs row, not profile) ***
  COALESCE(attendance.office_id, employee.office_id) AS check_in_office_id,
  COALESCE(ci_office.name, employee.office_name) AS check_in_office_name,
  COALESCE(attendance.checkin_source, 'APP') AS attendance_source,

  COALESCE(attendance.app_checkin_time,
    CASE WHEN upper(COALESCE(attendance.checkin_source,attendance.attendance_type,'')) LIKE 'APP%'
         THEN attendance.checkin_time END) app_first_in,
  COALESCE(attendance.biometric_first_punch,biometric.first_punch) biometric_first_in,
  visit.first_in field_visit_first_in,
  attendance.checkout_time raw_checkout,
  CASE WHEN upper(COALESCE(attendance.checkout_source,''))
         NOT IN ('ADMIN','REGULARIZATION','SYSTEM','BIOMETRIC','FIELD_VISIT')
       THEN attendance.checkout_time END app_checkout,
  regularization.requested_checkout approved_regularization_checkout,
  CASE WHEN regularization.id IS NULL
         AND upper(COALESCE(attendance.checkout_source,''))='ADMIN'
       THEN attendance.checkout_time END admin_corrected_checkout,
  COALESCE(attendance.biometric_last_punch,biometric.last_punch) biometric_last_punch_evidence,
  visit.last_out field_visit_checkout, visit.has_visit, visit.active_id, visit.active_name,
  visit.distance_m,
  policy.late_checkin_time, policy.allow_field_visit_checkout, policy.policy_id,
  calendar.value calendar_value, leave_request.leave_type,
  attendance.warning attendance_warning,
  ping.recorded_at latest_ping_at, ping.accuracy latest_accuracy_m,
  ping.status latest_tracking_status,
  ping.distance_from_base distance_from_office_m,
  session.status tracking_session_status,
  health.reason tracking_health_reason,
  settings.tv_tracking_stale_minutes,
  visit.active_site_name
FROM employee_days employee
LEFT JOIN LATERAL (
  SELECT a.* FROM public.attendance_logs a
  WHERE a.user_id=employee.user_id AND a.date=employee.work_date
  ORDER BY a.created_at, a.id LIMIT 1) attendance ON true
-- Join actual check-in office name
LEFT JOIN public.offices ci_office ON ci_office.id = attendance.office_id
LEFT JOIN LATERAL (
  SELECT min(d.log_date) first_punch, max(d.log_date) last_punch
  FROM public.smartoffice_device_logs d
  WHERE d.user_id=employee.user_id AND d.log_date_only=employee.work_date) biometric ON true
LEFT JOIN LATERAL (
  SELECT
    min(public.hrms_timestamp(v.checkin_time))  first_in,
    max(public.hrms_timestamp(v.checkout_time)) last_out,
    bool_or(v.checkin_time IS NOT NULL) has_visit,
    (array_agg(v.id ORDER BY public.hrms_timestamp(v.checkin_time) DESC NULLS LAST, v.created_at DESC)
      FILTER (WHERE v.status IN ('CHECKED_IN','IN_TRANSIT','PENDING')))[1] active_id,
    (array_agg(COALESCE(v.project_name,v.location_name)
      ORDER BY public.hrms_timestamp(v.checkin_time) DESC NULLS LAST, v.created_at DESC)
      FILTER (WHERE v.status IN ('CHECKED_IN','IN_TRANSIT','PENDING')))[1] active_name,
    (array_agg(v.last_distance_m ORDER BY v.last_distance_at DESC NULLS LAST))[1] distance_m,
    (array_agg(COALESCE(s.project_name, s.site_label)
      ORDER BY public.hrms_timestamp(v.checkin_time) DESC NULLS LAST, v.created_at DESC)
      FILTER (WHERE v.status IN ('CHECKED_IN','IN_TRANSIT','PENDING')))[1] active_site_name
  FROM public.field_visits v
  LEFT JOIN public.predefined_sites s ON s.id = v.selected_site_id
  WHERE v.user_id=employee.user_id AND v.date=employee.work_date
  AND COALESCE(v.verification_status,'PENDING') <> 'REJECTED') visit ON true
LEFT JOIN LATERAL (
  SELECT r.id, r.requested_checkout
  FROM public.attendance_regularization_requests r
  WHERE r.attendance_id=attendance.id AND r.status='APPROVED'
  ORDER BY r.reviewed_at DESC NULLS LAST, r.created_at DESC LIMIT 1) regularization ON true
LEFT JOIN LATERAL (
  SELECT p.id policy_id, p.late_checkin_time, p.allow_field_visit_checkout
  FROM public.attendance_policies p
  WHERE p.is_active
    AND employee.work_date BETWEEN p.effective_from AND COALESCE(p.effective_to,'infinity'::date)
    AND (p.office_id=employee.office_id OR p.office_id IS NULL)
    AND lower(COALESCE(p.role,'all')) IN (lower(COALESCE(employee.role,'')),'all')
  ORDER BY CASE
    WHEN p.office_id=employee.office_id AND lower(p.role)=lower(COALESCE(employee.role,'')) THEN 1
    WHEN p.office_id=employee.office_id AND lower(COALESCE(p.role,'all'))='all' THEN 2
    WHEN p.office_id IS NULL AND lower(p.role)=lower(COALESCE(employee.role,'')) THEN 3
    ELSE 4 END
  LIMIT 1) policy ON true
LEFT JOIN LATERAL (
  SELECT public.resolve_hrms_calendar_day(employee.user_id,employee.work_date) value) calendar ON true
LEFT JOIN LATERAL (
  SELECT r.leave_type
  FROM public.leave_requests r
  WHERE r.user_id=employee.user_id AND r.status='APPROVED'
    AND employee.work_date BETWEEN r.start_date AND r.end_date
  ORDER BY r.created_at DESC LIMIT 1) leave_request ON true
LEFT JOIN LATERAL (
  SELECT tl.recorded_at, tl.accuracy, tl.distance_from_base, ts.status,
    th.reason
  FROM public.location_tracking tl
  JOIN public.tracking_sessions ts ON ts.id=tl.tracking_session_id
  LEFT JOIN public.tracking_health_events th ON th.tracking_session_id=ts.id
  WHERE tl.user_id=employee.user_id
  ORDER BY tl.recorded_at DESC LIMIT 1
) ping ON true
LEFT JOIN LATERAL (
  SELECT t.status
  FROM public.tracking_sessions t
  WHERE t.user_id=employee.user_id AND (t.started_at AT TIME ZONE 'Asia/Kolkata')::date=employee.work_date
  ORDER BY t.started_at DESC LIMIT 1
) session ON true
LEFT JOIN LATERAL (
  SELECT th.reason
  FROM public.tracking_health_events th
  JOIN public.tracking_sessions ts ON ts.id=th.tracking_session_id
  WHERE ts.user_id=employee.user_id AND (ts.started_at AT TIME ZONE 'Asia/Kolkata')::date=employee.work_date
  ORDER BY th.occurred_at DESC LIMIT 1
) health ON true
CROSS JOIN (
  SELECT COALESCE(
    current_setting('app.tv_tracking_stale_minutes', true),
    '15'
  )::integer tv_tracking_stale_minutes
) settings
)
SELECT
    e.user_id, e.work_date, e.employee_name, e.employee_number,
    e.office_id, e.office_name, e.team_id, e.team_name,
    e.team_head_id, e.team_head_name, e.role, e.show_on_tv,
    e.joining_date, e.is_active,
    e.attendance_log_id,
    e.app_first_in, e.biometric_first_in, e.field_visit_first_in,
    e.raw_checkout, e.app_checkout, e.approved_regularization_checkout,
    e.admin_corrected_checkout, e.biometric_last_punch_evidence,
    e.field_visit_checkout, e.has_visit, e.active_id, e.active_name,
    e.distance_m, e.late_checkin_time, e.allow_field_visit_checkout,
    e.policy_id, e.calendar_value, e.leave_type, e.attendance_warning,
    e.latest_ping_at, e.latest_accuracy_m, e.latest_tracking_status,
    e.distance_from_office_m, e.tracking_session_status,
    e.tracking_health_reason, e.tv_tracking_stale_minutes,
    e.active_site_name,
  COALESCE(
    e.approved_regularization_checkout,
    e.admin_corrected_checkout,
    CASE WHEN COALESCE(e.allow_field_visit_checkout,true) THEN COALESCE(e.app_checkout,e.field_visit_checkout) ELSE e.app_checkout END,
    e.app_checkout,
    e.raw_checkout
  ) effective_checkout,
  COALESCE(
    e.app_first_in,
    e.field_visit_first_in,
    e.biometric_first_in
  ) effective_checkin,
  (CASE
    WHEN e.leave_type IS NOT NULL THEN 'LEAVE'
    WHEN e.calendar_value->>'kind'='WEEK_OFF' THEN 'WEEK_OFF'
    WHEN e.calendar_value->>'kind'='HOLIDAY' THEN 'HOLIDAY'
    WHEN e.raw_checkout IS NOT NULL OR e.approved_regularization_checkout IS NOT NULL OR e.admin_corrected_checkout IS NOT NULL THEN 'CHECKED_OUT'
    WHEN e.app_first_in IS NOT NULL OR e.biometric_first_in IS NOT NULL OR e.field_visit_first_in IS NOT NULL THEN 'CHECKED_IN'
    ELSE 'ABSENT'
  END) effective_status,
  EXISTS(
    SELECT 1 FROM public.attendance_logs a
    WHERE a.id=e.attendance_log_id AND a.auto_closed=true
  ) is_auto_closed,
  e.check_in_office_id,
  e.check_in_office_name,
  e.attendance_source
FROM evidence e;

-- STEP 2: Add office_id to smartoffice_device_logs for device->office mapping

ALTER TABLE public.smartoffice_device_logs
ADD COLUMN IF NOT EXISTS office_id uuid REFERENCES public.offices(id);

-- STEP 3: Create biometric_devices table (maps device serial_number → office)

CREATE TABLE IF NOT EXISTS public.biometric_devices (
id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
device_name text NOT NULL,
device_identifier text NOT NULL UNIQUE, -- matches smartoffice_device_logs.serial_number
office_id uuid NOT NULL REFERENCES public.offices(id),
status text NOT NULL DEFAULT 'ACTIVE'
CHECK (status IN ('ACTIVE', 'INACTIVE')),
last_sync_at timestamptz,
created_at timestamptz NOT NULL DEFAULT now(),
updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.biometric_devices ENABLE ROW LEVEL SECURITY;

-- Admins can manage devices
DROP POLICY IF EXISTS biometric_devices_admin ON public.biometric_devices;
CREATE POLICY biometric_devices_admin ON public.biometric_devices
FOR ALL TO authenticated
USING (
EXISTS (
SELECT 1 FROM public.profiles
WHERE id = auth.uid()
AND is_active = true
AND upper(COALESCE(role,'')) IN ('SYSTEM_ADMIN','SUPER_ADMIN','ADMIN','HRD','HR')
)
)
WITH CHECK (
EXISTS (
SELECT 1 FROM public.profiles
WHERE id = auth.uid()
AND is_active = true
AND upper(COALESCE(role,'')) IN ('SYSTEM_ADMIN','SUPER_ADMIN','ADMIN','HRD','HR')
)
);

-- All authenticated users can read device list (for display)
DROP POLICY IF EXISTS biometric_devices_read ON public.biometric_devices;
CREATE POLICY biometric_devices_read ON public.biometric_devices
FOR SELECT TO authenticated
USING (true);

-- Index for fast serial_number lookups
CREATE INDEX IF NOT EXISTS idx_biometric_devices_identifier
ON public.biometric_devices(device_identifier);
CREATE INDEX IF NOT EXISTS idx_biometric_devices_office
ON public.biometric_devices(office_id);

-- Index to speed up office_id lookups on device_logs
CREATE INDEX IF NOT EXISTS idx_smartoffice_logs_office
ON public.smartoffice_device_logs(office_id) WHERE office_id IS NOT NULL;

-- STEP 4: Backfill smartoffice_device_logs.office_id from biometric_devices
-- (Future: when you add a device via the UI, run a backfill or use a trigger)
-- This trigger auto-populates office_id on new inserts if device is registered.

CREATE OR REPLACE FUNCTION public.trg_populate_biometric_log_office()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
IF NEW.office_id IS NULL AND NEW.serial_number IS NOT NULL THEN
SELECT bd.office_id INTO NEW.office_id
FROM public.biometric_devices bd
WHERE bd.device_identifier = NEW.serial_number
AND bd.status = 'ACTIVE'
LIMIT 1;
END IF;
RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_biometric_log_office ON public.smartoffice_device_logs;
CREATE TRIGGER trg_biometric_log_office
BEFORE INSERT ON public.smartoffice_device_logs
FOR EACH ROW EXECUTE FUNCTION public.trg_populate_biometric_log_office();

-- STEP 5: Fix apply_biometric_daily_punches_v2 to use device office
-- Keep the 6-parameter signature, keep the 18:30 IST checkout logic, use the resolved office_id.

create or replace function public.apply_biometric_daily_punches_v2(
  p_user_id uuid,
  p_attendance_date date,
  p_first_punch timestamptz,
  p_last_punch timestamptz,
  p_punch_count integer,
  p_checkout_punch timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_attendance public.attendance_logs%rowtype;
  v_previous_checkin timestamptz;
  v_previous_checkout timestamptz;
  v_work_hours numeric;
  v_created boolean := false;
  v_checkin_updated boolean := false;
  v_checked_out boolean := false;
  v_resolved_office_id uuid;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'SERVICE_ROLE_REQUIRED';
  end if;

  if p_user_id is null
     or p_attendance_date is null
     or p_first_punch is null
     or p_last_punch is null
     or coalesce(p_punch_count, 0) < 1
     or p_last_punch < p_first_punch then
    raise exception 'INVALID_BIOMETRIC_PUNCH_SUMMARY';
  end if;

  if (p_first_punch at time zone 'Asia/Kolkata')::date <> p_attendance_date
     or (p_last_punch at time zone 'Asia/Kolkata')::date <> p_attendance_date
  then
    raise exception 'BIOMETRIC_PUNCH_DATE_MISMATCH';
  end if;

  if p_checkout_punch is not null and (
       p_punch_count < 2
       or p_checkout_punch <= p_first_punch
       or p_checkout_punch > p_last_punch
       or (p_checkout_punch at time zone 'Asia/Kolkata')::date
            <> p_attendance_date
       or (p_checkout_punch at time zone 'Asia/Kolkata')::time
            < time '18:30:00'
     ) then
    raise exception 'INVALID_BIOMETRIC_CHECKOUT_PUNCH';
  end if;

  if not exists (
    select 1
    from public.profiles
    where id = p_user_id
      and is_active = true
      and nullif(btrim(smartoffice_employee_code), '') is not null
  ) then
    raise exception 'ACTIVE_MAPPED_EMPLOYEE_REQUIRED';
  end if;

  -- Resolve actual office based on device log mapping, with fallback to registered office
  v_resolved_office_id := COALESCE(
    (SELECT bd.office_id
     FROM public.biometric_devices bd
     WHERE bd.device_identifier = (
       SELECT sdl.serial_number
       FROM public.smartoffice_device_logs sdl
       WHERE sdl.user_id = p_user_id
         AND sdl.log_date_only = p_attendance_date
         AND sdl.serial_number IS NOT NULL
       LIMIT 1
     )
     AND bd.status = 'ACTIVE'
     LIMIT 1),
    (SELECT sdl.office_id
     FROM public.smartoffice_device_logs sdl
     WHERE sdl.user_id = p_user_id
       AND sdl.log_date_only = p_attendance_date
       AND sdl.office_id IS NOT NULL
     LIMIT 1),
    (SELECT office_id FROM public.profiles WHERE id = p_user_id)
  );

  perform pg_advisory_xact_lock(
    hashtextextended(p_user_id::text || ':' || p_attendance_date::text, 0)
  );

  select * into v_attendance
  from public.attendance_logs
  where user_id = p_user_id and date = p_attendance_date
  for update;

  if not found then
    insert into public.attendance_logs(
      user_id, date, office_id, checkin_time, checkin_source, checkout_time, status,
      attendance_status, day_status, attendance_type, smartoffice_imported,
      biometric_first_punch, biometric_last_punch, biometric_punch_count
    ) values (
      p_user_id, p_attendance_date, v_resolved_office_id, p_first_punch, 'BIOMETRIC', null,
      'CHECKED_IN', 'PRESENT', 'P', 'BIOMETRIC', true,
      p_first_punch, p_last_punch, p_punch_count
    )
    returning * into v_attendance;
    v_created := true;
    v_checkin_updated := true;
  else
    v_previous_checkin := v_attendance.checkin_time;
    update public.attendance_logs
    set checkin_time = case
          when checkin_time is null or p_first_punch < checkin_time
            then p_first_punch
          else checkin_time
        end,
        checkin_source = case
          when checkin_time is null or p_first_punch < checkin_time
            then 'BIOMETRIC'
          else checkin_source
        end,
        office_id = case
          when checkin_time is null
            then coalesce(v_resolved_office_id, office_id)
          else office_id
        end,
        status = case
          when checkin_time is null then 'CHECKED_IN'
          else status
        end,
        attendance_status = case
          when checkin_time is null then 'PRESENT'
          else coalesce(attendance_status, 'PRESENT')
        end,
        day_status = case
          when checkin_time is null then 'P'
          else coalesce(day_status, 'P')
        end,
        attendance_type = case
          when checkin_time is null then 'BIOMETRIC'
          else attendance_type
        end,
        smartoffice_imported = true,
        biometric_first_punch = least(
          coalesce(biometric_first_punch, p_first_punch),
          p_first_punch
        ),
        biometric_last_punch = greatest(
          coalesce(biometric_last_punch, p_last_punch),
          p_last_punch
        ),
        biometric_punch_count = greatest(
          coalesce(biometric_punch_count, 0),
          p_punch_count
        ),
        updated_at = now()
    where id = v_attendance.id
    returning * into v_attendance;
    v_checkin_updated := v_previous_checkin is distinct from
      v_attendance.checkin_time;
  end if;

  -- EVENT checkout remains location-verified and manual. For other attendance,
  -- the first biometric punch at or after 18:30 IST is the checkout.
  if p_checkout_punch is not null
     and upper(coalesce(v_attendance.attendance_type, '')) <> 'EVENT'
     and (
       v_attendance.checkout_time is null
       or (
         upper(coalesce(v_attendance.checkout_source, '')) = 'BIOMETRIC'
         and p_checkout_punch < v_attendance.checkout_time
       )
     )
     and v_attendance.checkout_time is distinct from p_checkout_punch then
    v_previous_checkout := v_attendance.checkout_time;
    v_work_hours := greatest(
      0,
      round(
        (extract(epoch from (
          p_checkout_punch - v_attendance.checkin_time
        )) / 3600)::numeric,
        2
      )
    );

    insert into public.attendance_audit_logs(
      attendance_id, user_id, action, old_status, new_status,
      old_checkout_at, new_checkout_at, reason, source
    ) values (
      v_attendance.id, p_user_id, 'CHECKOUT_AUTO', v_attendance.status,
      'CHECKED_OUT', v_previous_checkout, p_checkout_punch,
      'First biometric punch at or after 18:30 IST', 'BIOMETRIC'
    );

    perform set_config(
      'app.authorized_attendance_checkout',
      'BIOMETRIC_SYNC',
      true
    );

    update public.attendance_logs
    set checkout_time = p_checkout_punch,
        checkout_source = 'BIOMETRIC',
        status = 'CHECKED_OUT',
        attendance_status = 'PRESENT',
        day_status = 'P',
        auto_checkout = false,
        auto_checkout_reason = null,
        work_hours = v_work_hours,
        updated_at = now()
    where id = v_attendance.id;
    v_checked_out := true;
  end if;

  return jsonb_build_object(
    'success', true,
    'attendance_id', v_attendance.id,
    'created', v_created,
    'checkin_updated', v_checkin_updated,
    'checkin_time', v_attendance.checkin_time,
    'checkin_source', v_attendance.checkin_source,
    'checked_out', v_checked_out,
    'checkout_eligible', p_checkout_punch is not null,
    'punch_count', p_punch_count
  );
end;
$$;

revoke all on function public.apply_biometric_daily_punches_v2(
  uuid, date, timestamptz, timestamptz, integer, timestamptz
) from public, anon, authenticated;
grant execute on function public.apply_biometric_daily_punches_v2(
  uuid, date, timestamptz, timestamptz, integer, timestamptz
) to service_role;


-- STEP 6: Fix has_permission() to include ADMIN bypass
-- (previously only SYSTEM_ADMIN was bypassed, causing Admins to be locked out)

CREATE OR REPLACE FUNCTION public.has_permission(p_permission text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
SELECT
-- SYSTEM_ADMIN and ADMIN always have all permissions
EXISTS (
SELECT 1 FROM public.profiles
WHERE id = auth.uid()
AND is_active = true
AND upper(COALESCE(role,'')) IN ('SYSTEM_ADMIN', 'SUPER_ADMIN', 'ADMIN')
)
OR
-- Explicit permission grant in user_permissions
EXISTS (
SELECT 1 FROM public.user_permissions
WHERE user_id = auth.uid()
AND permission = p_permission
AND revoked_at IS NULL
);
$$;

REVOKE ALL ON FUNCTION public.has_permission(text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.has_permission(text) TO authenticated;

-- STEP 7: Add OFFICE to permission_scope enum if not already there
-- (needed for scope-based attendance filtering by actual check-in office)

DO $$
BEGIN
IF NOT EXISTS (
SELECT 1 FROM pg_enum e
JOIN pg_type t ON t.oid = e.enumtypid
WHERE t.typname = 'permission_scope'
AND e.enumlabel = 'OFFICE'
) THEN
ALTER TYPE public.permission_scope ADD VALUE IF NOT EXISTS 'OFFICE';
END IF;
EXCEPTION WHEN others THEN NULL;
END $$;

-- STEP 8: Seed missing action-level permission keys
-- These are referenced in AdminStackNavigator.tsx but missing from DB
-- Removed SYSTEM_ADMIN seed as it's a role, not a permission key

INSERT INTO public.permissions (permission_key, module, action, description) VALUES
-- Attendance actions
('attendance.view', 'ATTENDANCE', 'view', 'View attendance records'),
('attendance.edit', 'ATTENDANCE', 'edit', 'Edit/correct attendance'),
('attendance.approve', 'ATTENDANCE', 'approve', 'Approve regularization requests'),
('attendance.export', 'ATTENDANCE', 'export', 'Export attendance data'),
-- Employee actions
('employee.view', 'EMPLOYEE', 'view', 'View employee profiles'),
('employee.create', 'EMPLOYEE', 'create', 'Add new employees'),
('employee.edit', 'EMPLOYEE', 'edit', 'Edit employee profiles'),
('employee.delete', 'EMPLOYEE', 'delete', 'Archive/delete employees'),
('employee.export', 'EMPLOYEE', 'export', 'Export employee data'),
-- Leave actions
('leave.view', 'LEAVE', 'view', 'View leave requests'),
('leave.approve', 'LEAVE', 'approve', 'Approve/reject leave'),
('manage_leave', 'LEAVE', 'manage', 'Full leave management'),
-- Location/tracking
('location.view_live', 'LOCATION', 'view', 'View live tracking'),
-- Permissions management
('permissions.manage', 'PERMISSIONS','manage', 'Manage user permissions'),
-- Biometric
('biometric.sync', 'BIOMETRIC', 'sync', 'Trigger/manage biometric sync'),
('biometric.manage', 'BIOMETRIC', 'manage', 'Manage biometric devices'),
-- Screen-level permissions (additional ones not yet seeded)
('screen.permissions_manager','SCREEN', 'access', 'Permissions Manager Screen'),
('screen.site_visit_observer', 'SCREEN', 'access', 'Site Visit Observer Screen'),
('screen.in_transit',          'SCREEN', 'access', 'In Transit Monitor Screen'),
('screen.duplicate_devices',   'SCREEN', 'access', 'Duplicate Devices Screen')
ON CONFLICT (permission_key) DO NOTHING;

-- STEP 9: RPC to manage biometric devices (Admin-only)

CREATE OR REPLACE FUNCTION public.rpc_upsert_biometric_device(
p_device_name text,
p_device_identifier text,
p_office_id uuid,
p_status text DEFAULT 'ACTIVE'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
v_actor_role text;
v_device_id uuid;
BEGIN
SELECT upper(COALESCE(role,'')) INTO v_actor_role
FROM public.profiles WHERE id = auth.uid() AND is_active = true;

IF v_actor_role NOT IN ('SYSTEM_ADMIN','SUPER_ADMIN','ADMIN','HRD','HR') THEN
RAISE EXCEPTION 'UNAUTHORIZED: Only admins can manage biometric devices';
END IF;

INSERT INTO public.biometric_devices (device_name, device_identifier, office_id, status)
VALUES (p_device_name, p_device_identifier, p_office_id, p_status)
ON CONFLICT (device_identifier) DO UPDATE
SET device_name = EXCLUDED.device_name,
office_id = EXCLUDED.office_id,
status = EXCLUDED.status,
updated_at = now()
RETURNING id INTO v_device_id;

-- Backfill existing log rows for this device with the new office_id
UPDATE public.smartoffice_device_logs
SET office_id = p_office_id
WHERE serial_number = p_device_identifier
AND office_id IS NULL;

RETURN jsonb_build_object('success', true, 'device_id', v_device_id);
END;
$$;

REVOKE ALL ON FUNCTION public.rpc_upsert_biometric_device(text, text, uuid, text)
FROM public, anon;
GRANT EXECUTE ON FUNCTION public.rpc_upsert_biometric_device(text, text, uuid, text)
TO authenticated;

-- STEP 10: RPC to get biometric devices list (for admin UI)

CREATE OR REPLACE FUNCTION public.rpc_get_biometric_devices()
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
SELECT COALESCE(
jsonb_agg(
jsonb_build_object(
'id', bd.id,
'device_name', bd.device_name,
'device_identifier', bd.device_identifier,
'office_id', bd.office_id,
'office_name', o.name,
'status', bd.status,
'last_sync_at', bd.last_sync_at,
'created_at', bd.created_at
) ORDER BY o.name, bd.device_name
),
'[]'::jsonb
)
FROM public.biometric_devices bd
LEFT JOIN public.offices o ON o.id = bd.office_id;
$$;

REVOKE ALL ON FUNCTION public.rpc_get_biometric_devices() FROM public, anon;
GRANT EXECUTE ON FUNCTION public.rpc_get_biometric_devices() TO authenticated;

-- Notify PostgREST to reload schema

NOTIFY pgrst, 'reload schema';
