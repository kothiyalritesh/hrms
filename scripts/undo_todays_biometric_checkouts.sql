-- Undo all biometric-imported checkouts for today
-- Resets checkout_time to NULL and status back to CHECKED_IN
-- Only affects smartoffice_imported records so app check-ins/outs are untouched

UPDATE attendance_logs
SET
  checkout_time = NULL,
  status        = 'CHECKED_IN'
WHERE
  date                = CURRENT_DATE
  AND smartoffice_imported = true
  AND checkout_time IS NOT NULL;

-- Verify
SELECT COUNT(*) AS still_checked_out
FROM attendance_logs
WHERE date = CURRENT_DATE
  AND smartoffice_imported = true
  AND status = 'CHECKED_OUT';
