# Local Attendance Data Seeding Guide

## Problem
The Attendance Control screen shows no data on local because there are no attendance records for today.

## Solution

### Option 1: Using Node.js Script (Recommended)

```bash
# From the project root directory
node seed_attendance_local.js
```

This will:
- ✅ Create 20 sample attendance records for today
- ✅ Assign random check-in times (9-10 AM)
- ✅ Assign random check-out times (5-6 PM)
- ✅ Link to active employees and offices
- ✅ Display verification output

### Option 2: Using SQL Script

Run the SQL script in your Supabase SQL editor:

```sql
-- Copy and paste the contents of:
-- scripts/seed_todays_attendance_local.sql
```

### Option 3: Manual SQL Query

```sql
-- Get today's date in IST
WITH today_date AS (
  SELECT (CURRENT_DATE AT TIME ZONE 'Asia/Kolkata')::text as today
)
INSERT INTO attendance_logs (
  id,
  user_id,
  date,
  checkin_time,
  checkout_time,
  office_id,
  status,
  created_at,
  updated_at
)
SELECT
  gen_random_uuid(),
  p.id,
  (SELECT today FROM today_date),
  (SELECT today FROM today_date) || 'T09:' || LPAD((RANDOM() * 59)::int::text, 2, '0') || ':00+05:30',
  (SELECT today FROM today_date) || 'T18:' || LPAD((RANDOM() * 59)::int::text, 2, '0') || ':00+05:30',
  o.id,
  'CHECKED_OUT',
  NOW(),
  NOW()
FROM profiles p
LEFT JOIN offices o ON p.office_id = o.id
WHERE p.is_active = true
  AND o.is_active = true
LIMIT 20;
```

## Verification

After seeding, check the data:

```sql
-- Count records for today
SELECT COUNT(*) as total_records
FROM attendance_logs
WHERE date = (CURRENT_DATE AT TIME ZONE 'Asia/Kolkata')::text;

-- View sample records
SELECT 
  p.name as employee_name,
  o.name as office_name,
  a.checkin_time,
  a.checkout_time,
  a.status
FROM attendance_logs a
LEFT JOIN profiles p ON a.user_id = p.id
LEFT JOIN offices o ON a.office_id = o.id
WHERE a.date = (CURRENT_DATE AT TIME ZONE 'Asia/Kolkata')::text
LIMIT 10;
```

## Reset Data (if needed)

```sql
-- Delete today's attendance records
DELETE FROM attendance_logs
WHERE date = (CURRENT_DATE AT TIME ZONE 'Asia/Kolkata')::text;
```

## Troubleshooting

### No employees found
- Ensure you have active employees in the `profiles` table
- Check: `SELECT COUNT(*) FROM profiles WHERE is_active = true;`

### No offices found
- Ensure you have active offices in the `offices` table
- Check: `SELECT COUNT(*) FROM offices WHERE is_active = true;`

### RLS (Row Level Security) blocking inserts
- If you get permission errors, check RLS policies on `attendance_logs`
- For local testing, you may need to disable RLS temporarily

### Still no data showing in the app
1. Refresh the Attendance Control screen
2. Check browser console for errors
3. Verify the RPC `rpc_admin_attendance_daily_v3` exists
4. Check that your user has admin permissions

## Next Steps

After seeding:
1. ✅ Open the Attendance Control screen
2. ✅ Select "Today" preset
3. ✅ You should see the seeded attendance records
4. ✅ Test filtering, searching, and exporting features
