# View Logs - Troubleshooting Guide

## Issue: "View Logs" navigation shows no information

### Root Causes

1. **No activity data in database** - Users haven't logged any activities yet
2. **RLS policies blocking access** - Row-level security preventing data retrieval
3. **Table doesn't exist** - `activity_logs` table not created
4. **Authentication issue** - User not properly authenticated

---

## Solution Steps

### Step 1: Verify Database Table

Run this in Supabase SQL Editor:

```sql
-- Check if table exists
SELECT EXISTS (
  SELECT FROM information_schema.tables 
  WHERE table_schema = 'public' 
  AND table_name = 'activity_logs'
) as table_exists;

-- Check row count
SELECT COUNT(*) as total_activities FROM activity_logs;
```

**If table doesn't exist:** Run `scripts/fix_activity_logs_table.sql`

---

### Step 2: Fix RLS Policies

Run the complete script: `scripts/fix_activity_logs_table.sql`

This will:
- Create the table if missing
- Fix all RLS policies
- Create necessary indexes
- Verify the structure

---

### Step 3: Test Data Access

1. **Create test activity:**
   ```sql
   INSERT INTO activity_logs (
     user_id, 
     location_type, 
     location_name, 
     notes, 
     timestamp, 
     activity_type, 
     confidence_score, 
     is_billable_activity, 
     summary
   ) VALUES (
     'YOUR_USER_ID_HERE',
     'office',
     'Main Office',
     'Test activity',
     NOW(),
     'OFFICE_WORK',
     85,
     true,
     'Test activity entry'
   );
   ```

2. **Verify you can read it:**
   ```sql
   SELECT * FROM activity_logs 
   WHERE user_id = 'YOUR_USER_ID_HERE'
   ORDER BY timestamp DESC;
   ```

---

### Step 4: Check App Logs

In your app, check browser console or device logs for errors:

```
[getUserActivities] Error fetching activities: ...
[MyActivityLogs] Error: ...
```

---

### Step 5: Verify Authentication

Make sure user is properly authenticated:

```typescript
// In your app
const { user } = useAuth();
console.log("Current user:", user?.id);
```

---

## Common Issues & Fixes

### Issue: "No activities yet" message
**Solution:** This is normal if no activities have been logged. Create a test activity using the SQL above.

### Issue: "Failed to load your activity logs" error
**Solution:** 
1. Run `scripts/fix_activity_logs_table.sql`
2. Check RLS policies are correct
3. Verify user is authenticated

### Issue: Activities show but with no details
**Solution:** 
1. Check that all required columns exist in the table
2. Verify data is being inserted with all fields
3. Check that `timestamp` is in correct format

---

## How to Log Activities from App

Users can log activities through:
1. **Dashboard** → "Log Activity" button
2. **Activity Logging Screen** → Fill form and submit

The app will:
1. Analyze the activity (determine type, confidence, etc.)
2. Insert into `activity_logs` table
3. Show in "View Logs" screen

---

## Database Schema

```sql
activity_logs (
  id UUID PRIMARY KEY,
  user_id UUID (FK to profiles),
  location_type VARCHAR (office|site|meeting|others),
  location_name VARCHAR,
  notes TEXT,
  destination VARCHAR,
  gps_coordinates JSONB,
  timestamp TIMESTAMP,
  activity_type VARCHAR (SITE_VISIT|CLIENT_MEETING|...),
  confidence_score INTEGER (0-100),
  client_name VARCHAR,
  company_name VARCHAR,
  meeting_purpose VARCHAR,
  is_billable_activity BOOLEAN,
  summary TEXT,
  flag VARCHAR (LOW_QUALITY_ENTRY),
  created_at TIMESTAMP,
  updated_at TIMESTAMP
)
```

---

## Quick Checklist

- [ ] Table `activity_logs` exists
- [ ] RLS policies are enabled and correct
- [ ] User is authenticated
- [ ] Test data exists in the table
- [ ] No errors in app console
- [ ] User has permission to view their own activities
