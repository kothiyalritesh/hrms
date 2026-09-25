SELECT fv.checkin_time, 
       fv.checkin_time AT TIME ZONE 'Asia/Kolkata' as checkin_ist,
       to_char(fv.checkin_time AT TIME ZONE 'Asia/Kolkata', 'HH12:MI AM') as formatted_time
FROM public.field_visits fv
WHERE fv.checkin_time IS NOT NULL
ORDER BY fv.checkin_time DESC
LIMIT 5;
