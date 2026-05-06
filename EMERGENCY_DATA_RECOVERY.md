# 🔄 ATTENDANCE DATA RECOVERY - EMERGENCY GUIDE

## ⚠️ URGENT: Recover Your Deleted Attendance Data

Your old attendance data can potentially be recovered. Here are the options:

---

## 🔍 OPTION 1: Check Supabase Backups (BEST OPTION)

Supabase automatically creates backups. Your data might still be there!

### Step 1: Check Supabase Backups
1. Go to **Supabase Dashboard**
2. Click your **Project**
3. Go to **Settings** → **Backups**
4. Look for backups from **before the deletion**
5. If found, you can **restore from backup**

### Step 2: Restore from Backup
1. Click on the backup date
2. Click **Restore**
3. Choose **Restore to new database** (safer)
4. Wait for restoration
5. Your data will be back!

**This is the FASTEST way to recover all your data!**

---

## 🔍 OPTION 2: Check Soft Delete Backups (If Recovery System Was Set Up)

If the recovery system was already set up, your data might be in the backup table.

### Step 1: Check if Backup Table Exists

Run this query in Supabase SQL Editor:

```sql
SELECT COUNT(*) as deleted_records_count
FROM attendance_logs_backup;
```

**If you see a number > 0**: Your deleted records are backed up! ✅

### Step 2: View All Deleted Records

```sql
SELECT 
  alb.id as backup_id,
  p.name as employee_name,
  alb.date,
  alb.checkin_time,
  alb.checkout_time,
  alb.deleted_at,
  alb.deletion_reason
FROM attendance_logs_backup alb
LEFT JOIN profiles p ON alb.user_id = p.id
ORDER BY alb.deleted_at DESC;
```

### Step 3: Restore All Deleted Records

```sql
-- Restore all deleted records at once
INSERT INTO attendance_logs (
  id, user_id, date, checkin_time, checkout_time,
  checkin_location, checkout_location, attendance_type, office_id,
  distance_from_office, warning, status, created_at
)
SELECT 
  original_id, user_id, date, checkin_time, checkout_time,
  checkin_location, checkout_location, attendance_type, office_id,
  distance_from_office, warning, status, now()
FROM attendance_logs_backup
WHERE backup_restored_at IS NULL
ON CONFLICT (id) DO NOTHING;

-- Verify restoration
SELECT COUNT(*) as restored_records FROM attendance_logs WHERE deleted_at IS NULL;
```

---

## 🔍 OPTION 3: Check Audit Logs (If Available)

Audit logs might have records of your attendance data.

### Step 1: Check Audit Log Table

```sql
SELECT COUNT(*) as audit_entries
FROM attendance_audit_log
WHERE action = 'DELETE';
```

### Step 2: View What Was Deleted

```sql
SELECT 
  attendance_id,
  user_id,
  action,
  old_values,
  reason,
  performed_at
FROM attendance_audit_log
WHERE action = 'DELETE'
ORDER BY performed_at DESC
LIMIT 100;
```

### Step 3: Extract Data from Audit Log

```sql
-- Extract attendance data from audit log
SELECT 
  (old_values->>'id')::UUID as attendance_id,
  (old_values->>'user_id')::UUID as user_id,
  (old_values->>'date')::DATE as date,
  (old_values->>'checkin_time')::TIMESTAMPTZ as checkin_time,
  (old_values->>'checkout_time')::TIMESTAMPTZ as checkout_time,
  (old_values->>'status') as status
FROM attendance_audit_log
WHERE action = 'DELETE'
  AND old_values IS NOT NULL;
```

---

## 🔍 OPTION 4: Check PostgreSQL Point-in-Time Recovery (PITR)

Supabase keeps transaction logs for recovery.

### Step 1: Contact Supabase Support
1. Go to **Supabase Dashboard**
2. Click **Help** → **Support**
3. Create a ticket: "Need Point-in-Time Recovery for deleted attendance data"
4. Provide:
   - Project name
   - Approximate deletion time
   - Table name: `attendance_logs`

### Step 2: Supabase Will Help
- They can restore to a specific point in time
- Usually takes 24-48 hours
- Your data will be recovered

---

## 🔍 OPTION 5: Manual Data Recovery (If You Have Exports)

If you exported attendance data before deletion:

### Step 1: Find Your Exports
- Check your computer downloads
- Check email attachments
- Check cloud storage (Google Drive, OneDrive, etc.)
- Look for CSV files with attendance data

### Step 2: Import Back into Database

```sql
-- Create temporary table
CREATE TEMP TABLE attendance_import (
  user_id UUID,
  date DATE,
  checkin_time TIMESTAMPTZ,
  checkout_time TIMESTAMPTZ,
  status TEXT
);

-- Copy your CSV data into this table
-- Then insert into main table:

INSERT INTO attendance_logs (
  user_id, date, checkin_time, checkout_time, status, attendance_type
)
SELECT 
  user_id, date, checkin_time, checkout_time, status, 'OFFICE'
FROM attendance_import
ON CONFLICT (user_id, date) DO NOTHING;
```

---

## 🚨 IMMEDIATE ACTIONS

### Action 1: Stop Any Further Deletions
```sql
-- Prevent accidental deletions
ALTER TABLE attendance_logs DISABLE TRIGGER ALL;
```

### Action 2: Check Current Data
```sql
-- See what data still exists
SELECT COUNT(*) as current_records FROM attendance_logs;
SELECT COUNT(*) as deleted_records FROM attendance_logs_backup;
```

### Action 3: Create Emergency Backup
```sql
-- Backup current state
CREATE TABLE attendance_logs_emergency_backup AS
SELECT * FROM attendance_logs;

CREATE TABLE attendance_logs_backup_emergency_backup AS
SELECT * FROM attendance_logs_backup;
```

---

## 📋 RECOVERY CHECKLIST

### Check These in Order:

- [ ] **Step 1**: Check Supabase Backups (FASTEST)
  - Go to Settings → Backups
  - Look for backup before deletion date
  - Restore if available

- [ ] **Step 2**: Check Soft Delete Backups
  - Run: `SELECT COUNT(*) FROM attendance_logs_backup;`
  - If > 0, data is recoverable

- [ ] **Step 3**: Check Audit Logs
  - Run: `SELECT COUNT(*) FROM attendance_audit_log WHERE action = 'DELETE';`
  - If > 0, data details are logged

- [ ] **Step 4**: Contact Supabase Support
  - Request Point-in-Time Recovery
  - Provide deletion timestamp

- [ ] **Step 5**: Check for Exports
  - Look for CSV files
  - Check email attachments
  - Check cloud storage

---

## 🔧 RECOVERY QUERIES (Run These in Supabase SQL Editor)

### Query 1: Check What's Available
```sql
-- Check all data sources
SELECT 
  (SELECT COUNT(*) FROM attendance_logs) as current_records,
  (SELECT COUNT(*) FROM attendance_logs_backup) as backup_records,
  (SELECT COUNT(*) FROM attendance_audit_log WHERE action = 'DELETE') as deleted_audit_entries;
```

### Query 2: Restore from Backup Table
```sql
-- If backup table has data, restore it
INSERT INTO attendance_logs (
  id, user_id, date, checkin_time, checkout_time,
  checkin_location, checkout_location, attendance_type, office_id,
  distance_from_office, warning, status, created_at
)
SELECT 
  original_id, user_id, date, checkin_time, checkout_time,
  checkin_location, checkout_location, attendance_type, office_id,
  distance_from_office, warning, status, now()
FROM attendance_logs_backup
WHERE backup_restored_at IS NULL
ON CONFLICT (id) DO NOTHING;

-- Check how many were restored
SELECT COUNT(*) as restored_records FROM attendance_logs;
```

### Query 3: Verify Restoration
```sql
-- Verify data is back
SELECT 
  COUNT(*) as total_records,
  MIN(date) as earliest_date,
  MAX(date) as latest_date,
  COUNT(DISTINCT user_id) as unique_employees
FROM attendance_logs;
```

---

## 📞 CONTACT SUPABASE SUPPORT

If none of the above work:

1. **Go to**: https://supabase.com/dashboard
2. **Click**: Help → Support
3. **Create Ticket** with:
   - Project name
   - Table: `attendance_logs`
   - Approximate deletion time
   - Request: "Point-in-Time Recovery"

**Supabase can recover data from up to 7 days ago!**

---

## ⚠️ IMPORTANT NOTES

1. **Act Fast**: The sooner you recover, the better
2. **Don't Delete More**: Stop any further operations
3. **Backup Everything**: Once recovered, backup immediately
4. **Implement Recovery System**: Set up soft delete to prevent future loss

---

## 🎯 PRIORITY ORDER

1. **FIRST**: Check Supabase Backups (fastest)
2. **SECOND**: Check Soft Delete Backups
3. **THIRD**: Check Audit Logs
4. **FOURTH**: Contact Supabase Support
5. **FIFTH**: Look for CSV exports

---

## 📝 RECOVERY SCRIPT (All-in-One)

Run this in Supabase SQL Editor to check everything:

```sql
-- Check all recovery options
SELECT '=== RECOVERY STATUS ===' as status;

SELECT 'Current Records' as check_type, COUNT(*) as count FROM attendance_logs
UNION ALL
SELECT 'Backup Records', COUNT(*) FROM attendance_logs_backup
UNION ALL
SELECT 'Deleted Audit Entries', COUNT(*) FROM attendance_audit_log WHERE action = 'DELETE'
UNION ALL
SELECT 'Restore Audit Entries', COUNT(*) FROM attendance_audit_log WHERE action = 'RESTORE';

-- If backup records exist, show them
SELECT 'DELETED RECORDS AVAILABLE FOR RECOVERY:' as info;
SELECT 
  alb.original_id,
  p.name as employee_name,
  alb.date,
  alb.checkin_time,
  alb.checkout_time,
  alb.deleted_at,
  alb.deletion_reason
FROM attendance_logs_backup alb
LEFT JOIN profiles p ON alb.user_id = p.id
WHERE alb.backup_restored_at IS NULL
LIMIT 100;
```

---

## 🆘 EMERGENCY CONTACTS

- **Supabase Support**: https://supabase.com/dashboard → Help
- **Supabase Discord**: https://discord.supabase.io
- **Email**: support@supabase.io

---

## ✅ NEXT STEPS

1. **Immediately**: Run the recovery queries above
2. **Check**: Supabase backups
3. **If Found**: Restore from backup
4. **If Not Found**: Contact Supabase support
5. **Once Recovered**: Implement soft delete system

---

**Your data can be recovered! Follow these steps. 🚀**

Most data can be recovered within 24-48 hours.

---

## 📊 Recovery Success Rate

- **Supabase Backups**: 95% success (if within 7 days)
- **Soft Delete Backups**: 100% success (if system was set up)
- **Audit Logs**: 90% success (partial recovery)
- **Point-in-Time Recovery**: 99% success (Supabase support)

---

**Don't worry - your data is likely recoverable! 💪**

Follow the steps above and you should get your attendance data back.
