SELECT column_name, data_type 
FROM information_schema.columns 
WHERE table_name = 'field_visits' 
  AND column_name IN ('checkin_time', 'checkout_time');
