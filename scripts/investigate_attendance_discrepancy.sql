-- ============================================================================
-- Phase 0: Attendance Discrepancy Investigation Script
-- Target Date: 2026-09-07
-- Problem: App shows 203 employees; Browser shows 208 employees (Diff: 5 employees)
-- ============================================================================

-- 1. Parameter Comparison & Universe Queries
-- App query (AttendanceControlScreenNew.tsx / CanonicalAttendanceService):
--   is_active = true
--   attendance_reporting_enabled = true
--   last_working_date IS NULL OR last_working_date >= '2026-09-07'

-- Browser query (Attendance Intelligence / EmployeeMasterService / Profiles):
--   neq("is_active", false)  (i.e. is_active IS TRUE OR is_active IS NULL)
--   does NOT filter attendance_reporting_enabled

-- 2. Extract Browser & App Employee Universes for 2026-09-07
WITH browser_universe AS (
  SELECT
    p.id,
    p.name,
    p.employee_number,
    p.department,
    p.office_id,
    p.role,
    p.reports_to,
    p.is_active,
    p.attendance_reporting_enabled,
    p.last_working_date,
    p.joining_date
  FROM public.profiles p
  WHERE coalesce(p.is_active, true) = true
),
app_universe AS (
  SELECT
    p.id,
    p.name,
    p.employee_number,
    p.department,
    p.office_id,
    p.role,
    p.reports_to,
    p.is_active,
    p.attendance_reporting_enabled,
    p.last_working_date,
    p.joining_date
  FROM public.profiles p
  WHERE p.is_active = true
    AND coalesce(p.attendance_reporting_enabled, false) = true
    AND (p.last_working_date IS NULL OR p.last_working_date >= '2026-09-07')
),
browser_only AS (
  SELECT b.*
  FROM browser_universe b
  LEFT JOIN app_universe a ON a.id = b.id
  WHERE a.id IS NULL
),
app_only AS (
  SELECT a.*
  FROM app_universe a
  LEFT JOIN browser_universe b ON b.id = a.id
  WHERE b.id IS NULL
)
SELECT 
  'BROWSER_ONLY' AS diff_type,
  bo.id AS employee_id,
  bo.name,
  bo.employee_number,
  bo.is_active,
  bo.attendance_reporting_enabled,
  bo.last_working_date,
  bo.joining_date,
  bo.department,
  bo.role,
  bo.reports_to,
  (SELECT count(*) FROM public.attendance_logs al WHERE al.user_id = bo.id AND al.date = '2026-09-07') AS attendance_log_count,
  (SELECT count(*) FROM public.smartoffice_device_logs dl WHERE dl.user_id = bo.id AND dl.log_date_only = '2026-09-07') AS biometric_punch_count
FROM browser_only bo
UNION ALL
SELECT
  'APP_ONLY' AS diff_type,
  ao.id AS employee_id,
  ao.name,
  ao.employee_number,
  ao.is_active,
  ao.attendance_reporting_enabled,
  ao.last_working_date,
  ao.joining_date,
  ao.department,
  ao.role,
  ao.reports_to,
  (SELECT count(*) FROM public.attendance_logs al WHERE al.user_id = ao.id AND al.date = '2026-09-07') AS attendance_log_count,
  (SELECT count(*) FROM public.smartoffice_device_logs dl WHERE dl.user_id = ao.id AND dl.log_date_only = '2026-09-07') AS biometric_punch_count
FROM app_only ao;

