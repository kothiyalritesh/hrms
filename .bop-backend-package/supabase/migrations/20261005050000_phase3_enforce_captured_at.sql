-- 20261005050000_phase3_enforce_captured_at.sql
--
-- NO-OP. The committed version of this file was truncated: the body of
-- rpc_attendance_checkin_v2 was cut off after "declare", so it could never
-- execute. The broken text is kept in supabase/_superseded/ for reference.
--
-- Requiring captured_at on check-in is still a planned fix (audit ATT-05), but
-- it must ship AFTER every client sends capturedAt. Web check-in currently
-- does not, so enforcing it now would block check-ins.
SELECT 1;
