# 🔄 RESTORE YOUR DELETED ATTENDANCE DATA - STEP BY STEP

## ⚠️ IMPORTANT: Use the Correct SQL File

**Use this file**: `scripts/RESTORE_ATTENDANCE_DATA.sql`

This file has complete, working SQL that will restore your data.

---

## 🚀 RECOVERY IN 3 STEPS

### STEP 1: Check if Your Data Can Be Restored (1 minute)

1. Open **Supabase Dashboard**: https://supabase.com/dashboard
2. Select your **Project**
3. Go to **SQL Editor**
4. Click **New Query**
5. Copy and paste this:

```sql
SELECT COUNT(*) as deleted_records_count
FROM attendance_logs_backup;
```

6. Click **Run**

**What to look for:**
- If you see a number **> 0**: Your data is backed up! ✅ Go to Step 2
- If you see **0**: No backup found, go to Option 2 below
- If you see an **error**: Table doesn't exist, go to Option 3 below

---

### STEP 2: Restore Your Data (2 minutes)

If Step 1 showed a number > 0, your data can be restored!

1. In the same **SQL Editor**
2. Click **New Query**
3. Copy the **ENTIRE** content from: `scripts/RESTORE_ATTENDANCE_DATA.sql`
4. Paste into SQL Editor
5. Click **Run**
6. Wait for completion

**You should see:**
```
✅ ATTENDANCE DATA RECOVERY COMPLETE!
```

**Your data is now restored!** ✅

---

### STEP 3: Verify Your Data is Back (1 minute)

Run this query to verify:

```sql
SELECT 
  COUNT(*) as total_records,
  MIN(date) as earliest_date,
  MAX(date) as latest_date,
  COUNT(DISTINCT user_id) as unique_employees
FROM attendance_logs;
```

**You should see:**
- `total_records`: A number (your attendance records)
- `earliest_date`: Your oldest attendance date
- `latest_date`: Your newest attendance date
- `unique_employees`: Number of employees

**If you see data, your records are restored!** ✅

---

## 🎯 IF STEP 1 SHOWS 0 (No Backup Found)

### Option 2: Check Supabase Automatic Backups

1. Go to **Supabase Dashboard**
2. Select your **Project**
3. Go to **Settings** (bottom left)
4. Click **Backups**
5. Look for a backup **BEFORE** your deletion date
6. If found:
   - Click the backup
   - Click **Restore**
   - Choose **Restore to new database**
   - Wait 5-10 minutes
   - Your data will be restored!

---

## 🎯 IF STEP 1 SHOWS ERROR (Table Doesn't Exist)

### Option 3: Contact Supabase Support

The backup table doesn't exist, which means the recovery system wasn't set up.

1. Go to: https://supabase.com/dashboard
2. Click **Help** → **Support**
3. Create a ticket:

```
Subject: Recover Deleted Attendance Data

Message:
Project: [Your Project Name]
Table: attendance_logs
Approximate deletion time: [When it was deleted]
Request: Point-in-Time Recovery to [Date before deletion]

I accidentally deleted attendance records and need them restored.
Please recover the data from before [deletion date].
```

**Supabase can recover data from up to 7 days ago!**

---

## ✅ COMPLETE RECOVERY CHECKLIST

- [ ] **Step 1**: Ran COUNT query
  - [ ] Result > 0 (data found)
  - [ ] Result = 0 (no backup)
  - [ ] Error (table doesn't exist)

- [ ] **Step 2**: Ran RESTORE_ATTENDANCE_DATA.sql
  - [ ] Saw "✅ RECOVERY COMPLETE" message
  - [ ] No errors

- [ ] **Step 3**: Verified data
  - [ ] Ran verification query
  - [ ] Saw attendance records
  - [ ] Data is restored ✅

---

## 🔍 QUICK REFERENCE QUERIES

### Check if Backup Exists
```sql
SELECT COUNT(*) as deleted_records_count
FROM attendance_logs_backup;
```

### View What Will Be Restored
```sql
SELECT 
  alb.original_id,
  p.name as employee_name,
  alb.date,
  alb.checkin_time,
  alb.checkout_time,
  alb.deleted_at
FROM attendance_logs_backup alb
LEFT JOIN profiles p ON alb.user_id = p.id
WHERE alb.backup_restored_at IS NULL
LIMIT 50;
```

### Restore All Data
```sql
INSERT INTO attendance_logs (
  id, user_id, date, checkin_time, checkout_time,
  checkin_location, checkout_location, attendance_type, office_id,
  distance_from_office, warning, status, created_at
)
SELECT 
  alb.original_id, alb.user_id, alb.date, alb.checkin_time, alb.checkout_time,
  alb.checkin_location, alb.checkout_location, alb.attendance_type, alb.office_id,
  alb.distance_from_office, alb.warning, alb.status, now()
FROM attendance_logs_backup alb
WHERE alb.backup_restored_at IS NULL
ON CONFLICT (id) DO NOTHING;
```

### Verify Restoration
```sql
SELECT 
  COUNT(*) as total_records,
  MIN(date) as earliest_date,
  MAX(date) as latest_date,
  COUNT(DISTINCT user_id) as unique_employees
FROM attendance_logs;
```

---

## 🚨 IMPORTANT NOTES

1. **Act Fast**: Recovery is easier within 7 days
2. **Don't Delete More**: Stop any further operations
3. **Backup After**: Once recovered, backup immediately
4. **Implement Protection**: Set up soft delete to prevent future loss

---

## 📞 NEED HELP?

If you get stuck:

1. **Check**: Did you use the correct SQL file?
2. **Verify**: Did you copy the ENTIRE script?
3. **Contact**: Supabase support at https://supabase.com/dashboard → Help

---

## 🎯 MOST LIKELY SCENARIO

**Your data is probably in the backup table!**

Just run the RESTORE_ATTENDANCE_DATA.sql script and your data will be back in 2 minutes!

---

## ✨ AFTER RECOVERY

Once your data is restored:

1. **Verify** all data is back
2. **Backup** immediately
3. **Implement** soft delete system (to prevent future loss)
4. **Test** recovery procedures
5. **Document** what happened

---

## 🚀 START NOW!

1. Open Supabase SQL Editor
2. Run Step 1 query (check if backup exists)
3. If > 0, run RESTORE_ATTENDANCE_DATA.sql
4. Verify with Step 3 query
5. Your data is back! ✅

---

**Your data is recoverable! Let's get it back! 🎉**

Follow these 3 steps and your attendance data will be restored!

**Good luck! 💪**
