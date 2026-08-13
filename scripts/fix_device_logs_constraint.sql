-- Fix: replace the 3-column unique constraint (which breaks when serial_number is NULL)
-- with a 2-column constraint on (employee_code, log_datetime) only.
-- In Postgres, NULL != NULL in unique constraints, so serial_number=NULL rows never deduplicate.

ALTER TABLE smartoffice_device_logs
  DROP CONSTRAINT IF EXISTS uq_device_log;

ALTER TABLE smartoffice_device_logs
  DROP CONSTRAINT IF EXISTS unique_device_log;

ALTER TABLE smartoffice_device_logs
  ADD CONSTRAINT uq_device_log UNIQUE (employee_code, log_datetime);
