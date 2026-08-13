-- ============================================================
-- Back-fill: The biometric sync previously skipped storing
-- device log rows for employee codes that had no HRMS match.
-- This means unmatched codes are simply absent from the table.
-- There is no data to back-fill from the DB side — they were
-- never inserted. The fix is in the sync service (already done):
-- future syncs will store ALL codes, matched or not.
--
-- What we CAN do here:
-- 1. Make user_id truly optional (already is — no NOT NULL)
-- 2. Ensure the employee_code column is indexed for fast match lookups
-- 3. Allow NULL user_id rows to be updated later when admin matches
-- ============================================================

-- Index for fast "show me all rows for this code" lookup used by match panel
CREATE INDEX IF NOT EXISTS idx_sdl_employee_code
  ON smartoffice_device_logs(employee_code);

-- Index for admin match panel query (unmatched codes = user_id IS NULL)
CREATE INDEX IF NOT EXISTS idx_sdl_unmatched
  ON smartoffice_device_logs(employee_code)
  WHERE user_id IS NULL;

-- Ensure the update policy exists so admin can set user_id after matching
DROP POLICY IF EXISTS "system_update_device_logs" ON smartoffice_device_logs;
CREATE POLICY "system_update_device_logs" ON smartoffice_device_logs
  FOR UPDATE USING (true) WITH CHECK (true);

-- Allow inserts with user_id = NULL (unmatched codes)
DROP POLICY IF EXISTS "system_insert_device_logs" ON smartoffice_device_logs;
CREATE POLICY "system_insert_device_logs" ON smartoffice_device_logs
  FOR INSERT WITH CHECK (true);
