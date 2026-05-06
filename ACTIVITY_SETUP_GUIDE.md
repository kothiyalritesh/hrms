# HRMS Activity Analysis & Maintenance Setup

## 🔴 Critical Issues to Fix

### 1. **Missing Database View** - attendance records not showing
The admin attendance control screen is looking for `admin_attendance_export` VIEW which doesn't exist.

**Fix:** Run the SQL script in your Supabase console

### 2. **Missing Activity Logs Table** - app crashes when logging activities
The new activity logging feature needs the `activity_logs` table in Supabase.

**Fix:** Run the SQL script in your Supabase console

---

## ✅ Setup Steps

### Step 1: Create Missing Database Objects

1. Go to [Supabase Dashboard](https://app.supabase.com)
2. Select your RealtyHRMS project
3. Go to **SQL Editor**
4. Create a new query and paste the contents of:
   - `scripts/setup_views_and_tables.sql`
5. Click **Run** to execute

**Expected Result:** 
- ✅ `admin_attendance_export` view created
- ✅ `activity_logs` table created with all indexes and RLS policies

---

### Step 2: Verify Attendance Records

After running the SQL:

1. Go to Admin Panel → Attendance Control
2. You should now see attendance records for today
3. Records should show:
   - Employee name
   - Office name
   - Check-in/check-out times
   - Distance from office
   - Any warnings

---

### Step 3: Test Activity Logging

After creating the tables:

1. Log in as employee
2. Go to Dashboard → "Log Activity" button
3. Fill in:
   - Activity Type (e.g., "Site Visit")
   - Location Name (e.g., "ABC Builders Ltd")
   - Notes (e.g., "Project inspection at site")
4. Click "Log Activity"
5. View analytics in Admin Panel → Activity Analysis

---

## 📊 New Features Available

### Employee Features
- **Activity Logging**: Quick activity logging with GPS location capture
- Located at: Dashboard → Quick Actions → **Log Activity**

### Admin Features
- **Activity Analysis Dashboard**: Comprehensive employee activity insights
- Located at: Admin Panel → Activity Analysis Card
- Shows:
  - Activity breakdown by type
  - Top clients
  - Recent activities with quality flags
  - Low-quality entry detection
  - Confidence scoring

---

## 🐛 Troubleshooting

### "No attendance records found" in admin panel
**Cause:** `admin_attendance_export` view doesn't exist
**Solution:** Run `scripts/setup_views_and_tables.sql`

### "Oops! Something went wrong" error
**Cause:** `activity_logs` table doesn't exist
**Solution:** Run `scripts/setup_views_and_tables.sql`

### Attendance shows "CHECKED_IN" but admin sees nothing
**Cause:** Data in `attendance_logs` but view isn't querying it correctly
**Solution:** Verify `admin_attendance_export` view exists and has correct column names

### Activity logging shows but no data in analytics
**Cause:** 
1. Table exists but user doesn't have permission
2. RLS policies blocking access
**Solution:** Check Supabase RLS policies and ensure user has proper role in profiles table

---

## 📋 Database Schema Reference

### attendance_logs table
```
- id (UUID)
- user_id (UUID, FK)
- date (DATE)
- checkin_time (TIMESTAMP)
- checkout_time (TIMESTAMP)
- status (VARCHAR)
- distance_from_office (INT)
- warning (BOOLEAN)
- attendance_type (VARCHAR)
- office_id (UUID, FK)
```

### activity_logs table
```
- id (UUID)
- user_id (UUID, FK)
- location_type (VARCHAR)
- location_name (VARCHAR)
- notes (TEXT)
- destination (VARCHAR)
- gps_coordinates (JSONB)
- timestamp (TIMESTAMP)
- activity_type (VARCHAR)
- confidence_score (INT)
- client_name (VARCHAR)
- company_name (VARCHAR)
- meeting_purpose (VARCHAR)
- location_type_confirmed (VARCHAR)
- is_billable_activity (BOOLEAN)
- summary (TEXT)
- flag (VARCHAR)
```

### admin_attendance_export view
Combines data from `attendance_logs`, `profiles`, and `offices` tables for admin reporting

---

## 🚀 Next Steps After Setup

1. ✅ Run the SQL setup script
2. ✅ Verify attendance records appear in admin panel
3. ✅ Test activity logging feature
4. ✅ Review activity analytics
5. ✅ Customize classification rules if needed (in `services/activity-analysis.service.ts`)

---

## 📞 Need Help?

If you encounter errors:
1. Check browser console for error messages (F12)
2. Check Supabase logs for database errors
3. Verify RLS policies allow your user role
4. Ensure all foreign key references are correct