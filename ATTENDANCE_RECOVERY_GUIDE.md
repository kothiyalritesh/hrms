# 🔄 Attendance Recovery System - Complete Guide

## Overview

The Attendance Recovery System prevents data loss by:
- ✅ Soft deleting records instead of hard deleting
- ✅ Creating automatic backups of deleted records
- ✅ Maintaining complete audit trail
- ✅ Allowing easy restoration of deleted attendance
- ✅ Tracking who deleted what and when

---

## 🚀 Quick Start

### Step 1: Run Database Migration

```bash
# File: scripts/attendance_recovery_system.sql
# Run in Supabase SQL Editor
```

This creates:
- Soft delete columns on `attendance_logs`
- `attendance_logs_backup` table
- `attendance_audit_log` table
- Recovery functions
- Recovery views

### Step 2: Add Recovery Service

```bash
# Copy: services/attendance-recovery.service.ts
```

### Step 3: Add Recovery Screen

```bash
# Copy: screens/admin/AttendanceRecoveryScreen.tsx
# Add to AdminStackNavigator
```

### Step 4: Update Attendance Service

Replace the hard delete in `services/attendance.service.ts`:

**Before** (Hard Delete):
```typescript
await supabase
  .from("attendance_logs")
  .delete()
  .eq("user_id", userId)
  .eq("date", today);
```

**After** (Soft Delete):
```typescript
import { AttendanceRecoveryService } from "@/services/attendance-recovery.service";

// Get existing record to delete
const { data: existing } = await supabase
  .from("attendance_logs")
  .select("id")
  .eq("user_id", userId)
  .eq("date", today)
  .single();

if (existing) {
  // Soft delete instead of hard delete
  await AttendanceRecoveryService.softDeleteAttendance(
    existing.id,
    userId,
    "New check-in for same day"
  );
}
```

---

## 📊 Database Schema

### Soft Delete Columns (Added to attendance_logs)
```sql
deleted_at TIMESTAMPTZ          -- When deleted
deleted_by UUID                 -- Who deleted it
deletion_reason TEXT            -- Why deleted
```

### Backup Table (attendance_logs_backup)
```sql
id                   UUID        -- Backup record ID
original_id          UUID        -- Original attendance_logs ID
user_id              UUID        -- Employee ID
date                 DATE        -- Attendance date
checkin_time         TIMESTAMPTZ -- Check-in time
checkout_time        TIMESTAMPTZ -- Check-out time
status               TEXT        -- Attendance status
deleted_at           TIMESTAMPTZ -- Deletion timestamp
deleted_by           UUID        -- Who deleted
deletion_reason      TEXT        -- Why deleted
backup_created_at    TIMESTAMPTZ -- When backed up
backup_restored_at   TIMESTAMPTZ -- When restored (if any)
```

### Audit Log Table (attendance_audit_log)
```sql
id                   UUID        -- Audit entry ID
attendance_id        UUID        -- Attendance record ID
user_id              UUID        -- Employee ID
action               TEXT        -- INSERT, UPDATE, DELETE, RESTORE
old_values           JSONB       -- Previous values
new_values           JSONB       -- New values
reason               TEXT        -- Action reason
performed_by         UUID        -- Who performed action
performed_at         TIMESTAMPTZ -- When performed
```

---

## 🔧 Service Methods

### Get Deleted Records

```typescript
import { AttendanceRecoveryService } from "@/services/attendance-recovery.service";

// Get all deleted records
const deleted = await AttendanceRecoveryService.getDeletedAttendance();

// Get deleted records for specific user
const userDeleted = await AttendanceRecoveryService.getUserDeletedAttendance(userId);

// Get deleted records for date range
const rangeDeleted = await AttendanceRecoveryService.getDeletedAttendanceByDateRange(
  "2024-01-01",
  "2024-01-31"
);
```

### Restore Records

```typescript
// Restore single record
const result = await AttendanceRecoveryService.restoreAttendance(
  backupId,
  currentUserId,
  "Restored from recovery screen"
);

if (result.success) {
  console.log("Restored:", result.restored_id);
}

// Restore multiple records
const results = await AttendanceRecoveryService.restoreMultipleAttendance(
  [backupId1, backupId2, backupId3],
  currentUserId,
  "Batch restoration"
);
```

### Soft Delete Records

```typescript
// Soft delete instead of hard delete
const result = await AttendanceRecoveryService.softDeleteAttendance(
  attendanceId,
  currentUserId,
  "New check-in for same day"
);
```

### Get Audit Information

```typescript
// Get audit log for specific record
const audit = await AttendanceRecoveryService.getAttendanceAuditLog(attendanceId);

// Get audit log for user
const userAudit = await AttendanceRecoveryService.getUserAuditLog(userId);

// Get deletion history
const deletions = await AttendanceRecoveryService.getDeletionHistory();

// Get restoration history
const restorations = await AttendanceRecoveryService.getRestorationHistory();
```

### Get Statistics

```typescript
// Get deleted attendance summary
const summary = await AttendanceRecoveryService.getDeletedAttendanceSummary();
console.log(summary.total_deleted);
console.log(summary.by_employee);
console.log(summary.by_reason);

// Get recovery statistics
const stats = await AttendanceRecoveryService.getRecoveryStatistics();
console.log(stats.total_deleted_records);
console.log(stats.total_restored_records);
console.log(stats.recovery_rate);
```

### Export Data

```typescript
// Export deleted attendance as CSV
const csv = await AttendanceRecoveryService.exportDeletedAttendanceCSV();
// Download or save the CSV
```

---

## 🎯 Use Cases

### Use Case 1: Employee Accidentally Deleted

**Scenario**: Employee's attendance was accidentally deleted

**Solution**:
```typescript
// 1. Find the deleted record
const deleted = await AttendanceRecoveryService.getUserDeletedAttendance(employeeId);

// 2. Restore it
const result = await AttendanceRecoveryService.restoreAttendance(
  deleted[0].backup_id,
  adminUserId,
  "Accidental deletion - restored by admin"
);

// 3. Verify
if (result.success) {
  console.log("Attendance restored successfully");
}
```

### Use Case 2: Bulk Restoration

**Scenario**: Multiple records were deleted and need to be restored

**Solution**:
```typescript
// 1. Get all deleted records for a date range
const deleted = await AttendanceRecoveryService.getDeletedAttendanceByDateRange(
  "2024-01-01",
  "2024-01-31"
);

// 2. Restore all
const backupIds = deleted.map(d => d.backup_id);
const results = await AttendanceRecoveryService.restoreMultipleAttendance(
  backupIds,
  adminUserId,
  "Bulk restoration - system recovery"
);

// 3. Report
const successful = results.filter(r => r.success).length;
console.log(`Restored ${successful}/${results.length} records`);
```

### Use Case 3: Audit Trail

**Scenario**: Need to track who deleted what and when

**Solution**:
```typescript
// Get deletion history
const deletions = await AttendanceRecoveryService.getDeletionHistory();

deletions.forEach(d => {
  console.log(`
    Record: ${d.attendance_id}
    Employee: ${d.user_id}
    Action: ${d.action}
    Reason: ${d.reason}
    By: ${d.performed_by}
    At: ${d.performed_at}
  `);
});
```

### Use Case 4: Recovery Report

**Scenario**: Generate report of all deleted and restored records

**Solution**:
```typescript
// Get summary
const summary = await AttendanceRecoveryService.getDeletedAttendanceSummary();

// Get statistics
const stats = await AttendanceRecoveryService.getRecoveryStatistics();

// Export
const csv = await AttendanceRecoveryService.exportDeletedAttendanceCSV();

// Save or send report
```

---

## 🖥️ Admin Screen Features

### View Deleted Records
- List all deleted attendance records
- Filter by employee name
- Filter by deletion reason
- See deletion timestamp and who deleted

### Restore Records
- Single record restoration
- Batch restoration (select multiple)
- Confirmation before restore
- Success/error feedback

### Export Data
- Export all deleted records as CSV
- Includes all details (employee, date, times, reason, etc.)
- Download to local machine

### Statistics
- Total deleted records
- Deleted by employee
- Deleted by reason
- Recovery rate

---

## 📋 SQL Functions

### soft_delete_attendance()
```sql
SELECT * FROM soft_delete_attendance(
  p_attendance_id := 'attendance-id',
  p_deleted_by := 'user-id',
  p_reason := 'Reason for deletion'
);
```

**Returns**:
- success: boolean
- message: text
- backup_id: UUID

### restore_attendance()
```sql
SELECT * FROM restore_attendance(
  p_backup_id := 'backup-id',
  p_restored_by := 'user-id',
  p_reason := 'Reason for restoration'
);
```

**Returns**:
- success: boolean
- message: text
- restored_id: UUID

### get_deleted_attendance()
```sql
SELECT * FROM get_deleted_attendance(
  p_user_id := NULL,
  p_start_date := NULL,
  p_end_date := NULL
);
```

**Returns**: List of deleted attendance records

---

## 📊 Views

### deleted_attendance_view
Shows all deleted but not yet restored attendance records

```sql
SELECT * FROM deleted_attendance_view;
```

### active_attendance_logs
Shows only active (not soft deleted) attendance records

```sql
SELECT * FROM active_attendance_logs;
```

---

## 🔐 Security Features

✅ Audit trail for all deletions
✅ Track who deleted what and when
✅ Reason for deletion recorded
✅ Soft delete prevents accidental data loss
✅ Backup created before deletion
✅ Restoration tracked in audit log
✅ Admin-only recovery screen

---

## 🧪 Testing Recovery

### Test 1: Soft Delete

```typescript
// 1. Create attendance record
const { data: attendance } = await supabase
  .from("attendance_logs")
  .insert([{ user_id, date, checkin_time, checkout_time }])
  .select()
  .single();

// 2. Soft delete it
const result = await AttendanceRecoveryService.softDeleteAttendance(
  attendance.id,
  adminId,
  "Test deletion"
);

// 3. Verify it's soft deleted
const { data: deleted } = await supabase
  .from("attendance_logs")
  .select("deleted_at")
  .eq("id", attendance.id)
  .single();

console.log("Soft deleted:", deleted.deleted_at !== null); // true
```

### Test 2: Restore

```typescript
// 1. Get deleted record
const deleted = await AttendanceRecoveryService.getDeletedAttendance();

// 2. Restore it
const result = await AttendanceRecoveryService.restoreAttendance(
  deleted[0].backup_id,
  adminId,
  "Test restoration"
);

// 3. Verify it's restored
const { data: restored } = await supabase
  .from("attendance_logs")
  .select("deleted_at")
  .eq("id", deleted[0].original_id)
  .single();

console.log("Restored:", restored.deleted_at === null); // true
```

### Test 3: Audit Trail

```typescript
// 1. Get audit log
const audit = await AttendanceRecoveryService.getAttendanceAuditLog(attendanceId);

// 2. Verify entries
console.log("Audit entries:", audit.length); // Should have DELETE and RESTORE

// 3. Check details
audit.forEach(entry => {
  console.log(`${entry.action} by ${entry.performed_by} at ${entry.performed_at}`);
});
```

---

## 🐛 Troubleshooting

### Issue: Restore fails with "Backup record not found"
**Solution**:
- Verify backup_id is correct
- Check if backup was already restored
- Check if backup record exists in database

### Issue: Soft delete not working
**Solution**:
- Verify function exists: `SELECT * FROM information_schema.routines WHERE routine_name = 'soft_delete_attendance'`
- Check user permissions
- Verify attendance record exists

### Issue: Audit log not recording
**Solution**:
- Check if attendance_audit_log table exists
- Verify triggers are enabled
- Check database logs for errors

### Issue: Recovery screen not loading
**Solution**:
- Verify service imports correctly
- Check for TypeScript errors
- Review console logs
- Verify database connection

---

## 📈 Best Practices

1. **Always use soft delete** instead of hard delete
2. **Provide reason** for every deletion
3. **Track who deleted** for accountability
4. **Regular backups** of backup table
5. **Monitor audit log** for suspicious activity
6. **Export reports** periodically
7. **Test restoration** regularly
8. **Document deletions** for compliance

---

## 🔄 Recovery Workflow

```
1. Deletion Occurs
   ↓
2. Soft Delete Function Called
   ├─ Create backup record
   ├─ Mark as deleted in main table
   └─ Log to audit trail
   ↓
3. Record appears in Recovery Screen
   ├─ Shows employee name
   ├─ Shows deletion reason
   ├─ Shows who deleted
   └─ Shows when deleted
   ↓
4. Admin Reviews & Restores
   ├─ Selects record(s)
   ├─ Clicks restore
   ├─ Confirms action
   └─ System restores
   ↓
5. Restoration Complete
   ├─ Record restored to main table
   ├─ Backup marked as restored
   ├─ Audit log updated
   └─ Admin notified
```

---

## 📞 Support

For issues or questions:
1. Check troubleshooting section
2. Review audit logs
3. Check database functions
4. Review service code
5. Check console logs

---

## ✅ Verification Checklist

- [ ] Database migration completed
- [ ] Soft delete columns added
- [ ] Backup table created
- [ ] Audit log table created
- [ ] Recovery functions created
- [ ] Recovery views created
- [ ] Recovery service added
- [ ] Recovery screen added
- [ ] Attendance service updated
- [ ] Navigation updated
- [ ] Test soft delete
- [ ] Test restore
- [ ] Test audit trail
- [ ] Test recovery screen

---

**Your attendance data is now protected! 🔒**

All deletions are tracked, backed up, and can be easily restored.

---

## 📝 Version Info

- **System**: Attendance Recovery System
- **Version**: 1.0
- **Status**: Production Ready
- **Database**: Supabase PostgreSQL
- **Features**: Soft delete, backup, audit trail, restoration

---

**Never lose attendance data again! 🚀**
