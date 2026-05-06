-- Check which users have activities and their details
SELECT 
  al.user_id,
  p.name,
  p.email,
  p.role,
  COUNT(al.id) as activity_count,
  MAX(al.timestamp) as latest_activity
FROM activity_logs al
LEFT JOIN profiles p ON al.user_id = p.id
GROUP BY al.user_id, p.name, p.email, p.role
ORDER BY activity_count DESC;

-- Check sample activities
SELECT 
  id,
  user_id,
  activity_type,
  location_name,
  timestamp,
  created_at
FROM activity_logs
ORDER BY created_at DESC
LIMIT 10;

-- Check if there are any RLS policy issues
-- Try to see all activities (this might fail due to RLS)
SELECT COUNT(*) as total_activities FROM activity_logs;

-- Check RLS policies on activity_logs
SELECT schemaname, tablename, policyname, permissive, roles, qual, with_check
FROM pg_policies
WHERE tablename = 'activity_logs'
ORDER BY policyname;
