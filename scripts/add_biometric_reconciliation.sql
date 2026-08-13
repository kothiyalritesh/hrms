CREATE OR REPLACE VIEW attendance_reconciliation AS
WITH app AS (
 SELECT DISTINCT ON(user_id,date) id,user_id,date,checkin_time,checkout_time,distance_from_office,status
 FROM attendance_logs WHERE COALESCE(attendance_type,'APP') <> 'BIOMETRIC' AND COALESCE(smartoffice_imported,FALSE)=FALSE
 ORDER BY user_id,date,created_at
), bio AS (
 SELECT user_id,log_date_only AS date,MIN(log_time) AS bio_in,
   CASE WHEN COUNT(*)>1 THEN MAX(log_time) END AS bio_out,COUNT(*) AS punch_count
 FROM smartoffice_device_logs WHERE user_id IS NOT NULL GROUP BY user_id,log_date_only
), keys AS (SELECT user_id,date FROM app UNION SELECT user_id,date FROM bio)
SELECT k.user_id,k.date,p.name,p.employee_number,p.role,p.team,p.reports_to AS team_head_id,th.name AS team_head_name,p.office_id,o.name AS office_name,
 EXISTS(SELECT 1 FROM field_visits fv WHERE fv.user_id=k.user_id AND fv.date=k.date AND fv.checkin_time IS NOT NULL) AS has_field_visit,
 fraud.severity AS fraud_severity,fraud.score AS fraud_score,
 a.id AS attendance_id,a.checkin_time AS app_in,a.checkout_time AS app_out,b.bio_in,b.bio_out,b.punch_count,
 LEAST(a.checkin_time,((k.date::text||' '||b.bio_in::text)::timestamp AT TIME ZONE 'Asia/Kolkata')) AS final_in,
 GREATEST(a.checkout_time,((k.date::text||' '||b.bio_out::text)::timestamp AT TIME ZONE 'Asia/Kolkata')) AS final_out,
 CASE WHEN a.id IS NOT NULL AND b.user_id IS NOT NULL THEN 'VERIFIED' WHEN a.id IS NOT NULL THEN 'APP_ONLY' ELSE 'BIOMETRIC_ONLY' END AS presence_source,
 CASE
  WHEN a.id IS NOT NULL AND b.user_id IS NOT NULL AND a.distance_from_office>100 THEN 'NEEDS_REVIEW'
  WHEN b.user_id IS NOT NULL AND b.bio_out IS NULL THEN 'NO_CHECKOUT'
  WHEN a.checkout_time IS NOT NULL AND (a.checkout_time AT TIME ZONE 'Asia/Kolkata')::time<TIME '18:00' THEN 'EARLY_CHECKOUT'
  WHEN a.id IS NULL OR b.user_id IS NULL THEN 'MISMATCH'
  WHEN ABS(EXTRACT(EPOCH FROM(a.checkin_time-((k.date::text||' '||b.bio_in::text)::timestamp AT TIME ZONE 'Asia/Kolkata'))))/60)>=15 THEN 'MISMATCH'
  ELSE 'VERIFIED' END AS suggested_status,
 CASE WHEN a.id IS NULL OR b.user_id IS NULL OR ABS(COALESCE(EXTRACT(EPOCH FROM(a.checkin_time-((k.date::text||' '||b.bio_in::text)::timestamp AT TIME ZONE 'Asia/Kolkata'))),0))/60>=15 THEN 'MISMATCH' ELSE 'P' END AS report_status
FROM keys k JOIN profiles p ON p.id=k.user_id LEFT JOIN profiles th ON th.id=p.reports_to LEFT JOIN offices o ON o.id=p.office_id
LEFT JOIN app a ON a.user_id=k.user_id AND a.date=k.date LEFT JOIN bio b ON b.user_id=k.user_id AND b.date=k.date
LEFT JOIN LATERAL (SELECT f.severity,f.score FROM attendance_fraud_events f WHERE f.user_id=k.user_id AND (f.created_at AT TIME ZONE 'Asia/Kolkata')::date=k.date ORDER BY f.score DESC LIMIT 1) fraud ON TRUE;
