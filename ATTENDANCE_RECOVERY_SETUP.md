# 🔄 ATTENDANCE RECOVERY SYSTEM - SETUP GUIDE

## ⚠️ IMPORTANT: SQL Setup Instructions

### Step 1: Copy the SQL File

**File to use**: `scripts/ATTENDANCE_RECOVERY_CLEAN.sql`

**DO NOT use**: `scripts/attendance_recovery_system.sql` (may have mixed content)

### Step 2: Run in Supabase SQL Editor

1. Open Supabase Dashboard
2. Go to **SQL Editor**
3. Click **New Query**
4. Copy **entire content** from `ATTENDANCE_RECOVERY_CLEAN.sql`
5. Paste into SQL Editor
6. Click **Run**
7. Wait for completion

### Step 3: Verify Setup

After running, you should see:
```
✅ Soft delete columns added
✅ Attendance recovery system setup complete!
```

If you see errors, check:
- [ ] You're using the CLEAN version
- [ ] No TypeScript code is in the SQL
- [ ] All SQL is properly formatted
- [ ] You have admin access to Supabase

---

## 📋 What Gets Created

### Tables
- ✅ `attendance_logs_backup` - Backup of deleted records
- ✅ `attendance_audit_log` - Audit trail

### Columns (added to attendance_logs)
- ✅ `deleted_at` - When deleted
- ✅ `deleted_by` - Who deleted
- ✅ `deletion_reason` - Why deleted

### Functions
- ✅ `soft_delete_attendance()` - Soft delete with backup
- ✅ `restore_attendance()` - Restore from backup
- ✅ `get_deleted_attendance()` - Query deleted records

### Views
- ✅ `deleted_attendance_view` - View deleted records
- ✅ `active_attendance_logs` - View active records only

### Indexes
- ✅ Performance indexes on key columns

---

## 🚀 Quick Start (After SQL Setup)

### 1. Add Recovery Service

Copy file: `services/attendance-recovery.service.ts`

### 2. Add Recovery Screen

Copy file: `screens/admin/AttendanceRecoveryScreen.tsx`

Add to navigation:
```typescript
// In AdminStackNavigator.tsx
import AttendanceRecoveryScreen from "@/screens/admin/AttendanceRecoveryScreen";

<Stack.Screen 
  name="AttendanceRecovery" 
  component={AttendanceRecoveryScreen}
  options={{ title: "Attendance Recovery" }}
/>
```

### 3. Update Attendance Service

In `services/attendance.service.ts`, replace hard delete:

**Before**:
```typescript
await supabase
  .from("attendance_logs")
  .delete()
  .eq("user_id", userId)
  .eq("date", today);
```

**After**:
```typescript
import { AttendanceRecoveryService } from "@/services/attendance-recovery.service";

const { data: existing } = await supabase
  .from("attendance_logs")
  .select("id")
  .eq("user_id", userId)
  .eq("date", today)
  .single();

if (existing) {
  await AttendanceRecoveryService.softDeleteAttendance(
    existing.id,
    userId,
    "New check-in for same day"
  );
}
```

---

## ✅ Verification Checklist

### SQL Setup
- [ ] Ran ATTENDANCE_RECOVERY_CLEAN.sql
- [ ] No errors in SQL execution
- [ ] Saw "✅ setup complete" message
- [ ] Tables created
- [ ] Functions created
- [ ] Views created

### Code Setup
- [ ] Copied recovery service
- [ ] Copied recovery screen
- [ ] Added to navigation
- [ ] Updated attendance service
- [ ] No TypeScript errors

### Testing
- [ ] Can navigate to recovery screen
- [ ] Screen loads without errors
- [ ] Can see deleted records (if any)
- [ ] Can restore records
- [ ] Can export as CSV

---

## 🧪 Test Recovery

### Test 1: Soft Delete

```typescript
import { AttendanceRecoveryService } from "@/services/attendance-recovery.service";

// Soft delete a record
const result = await AttendanceRecoveryService.softDeleteAttendance(
  attendanceId,
  currentUserId,
  "Test deletion"
);

console.log("Deleted:", result.success); // true
```

### Test 2: View Deleted

```typescript
// Get deleted records
const deleted = await AttendanceRecoveryService.getDeletedAttendance();

console.log("Found deleted:", deleted.length); // Should be > 0
```

### Test 3: Restore

```typescript
// Restore a record
const result = await AttendanceRecoveryService.restoreAttendance(
  deleted[0].backup_id,
  currentUserId,
  "Test restoration"
);

console.log("Restored:", result.success); // true
```

---

## 🎯 Usage Examples

### Get All Deleted Records
```typescript
const deleted = await AttendanceRecoveryService.getDeletedAttendance();
```

### Get User's Deleted Records
```typescript
const userDeleted = await AttendanceRecoveryService.getUserDeletedAttendance(userId);
```

### Get Deleted by Date Range
```typescript
const rangeDeleted = await AttendanceRecoveryService.getDeletedAttendanceByDateRange(
  "2024-01-01",
  "2024-01-31"
);
```

### Restore Single Record
```typescript
const result = await AttendanceRecoveryService.restoreAttendance(
  backupId,
  currentUserId,
  "Restored from recovery screen"
);
```

### Restore Multiple Records
```typescript
const results = await AttendanceRecoveryService.restoreMultipleAttendance(
  [backupId1, backupId2, backupId3],
  currentUserId,
  "Batch restoration"
);
```

### Export Deleted Records
```typescript
const csv = await AttendanceRecoveryService.exportDeletedAttendanceCSV();
// Download or save the CSV
```

### Get Audit Log
```typescript
const audit = await AttendanceRecoveryService.getAttendanceAuditLog(attendanceId);
```

### Get Statistics
```typescript
const stats = await AttendanceRecoveryService.getRecoveryStatistics();
console.log(stats.total_deleted_records);
console.log(stats.total_restored_records);
console.log(stats.recovery_rate);
```

---

## 🐛 Troubleshooting

### Error: "syntax error at or near &quot;{"

**Cause**: TypeScript code mixed with SQL

**Solution**: 
- Use `ATTENDANCE_RECOVERY_CLEAN.sql` (not the other one)
- Make sure NO TypeScript code is in SQL editor
- Copy only SQL content

### Error: "function soft_delete_attendance does not exist"

**Cause**: SQL migration not run

**Solution**:
- Run `ATTENDANCE_RECOVERY_CLEAN.sql` in Supabase
- Verify functions were created
- Check for SQL errors

### Error: "table attendance_logs_backup does not exist"

**Cause**: SQL migration not run

**Solution**:
- Run `ATTENDANCE_RECOVERY_CLEAN.sql` in Supabase
- Verify tables were created
- Check for SQL errors

### Recovery screen not loading

**Cause**: Service not imported or navigation not updated

**Solution**:
- Verify service file copied
- Verify screen file copied
- Verify added to navigation
- Check console for errors

### Can't restore records

**Cause**: Backup not created or wrong backup ID

**Solution**:
- Verify soft delete was used (not hard delete)
- Check backup table has records
- Verify backup_id is correct
- Check audit log for errors

---

## 📞 Support

For issues:
1. Check troubleshooting section
2. Verify SQL migration completed
3. Check database tables exist
4. Review console logs
5. Check service code

---

## 📁 Files Reference

| File | Purpose |
|------|---------|
| `ATTENDANCE_RECOVERY_CLEAN.sql` | SQL migration (USE THIS) |
| `attendance-recovery.service.ts` | Recovery service |
| `AttendanceRecoveryScreen.tsx` | Admin recovery screen |
| `ATTENDANCE_RECOVERY_GUIDE.md` | Complete documentation |

---

## ✨ Summary

Your attendance system now has:

✅ **Soft Delete** - No permanent data loss
✅ **Automatic Backup** - Every deletion backed up
✅ **Complete Audit Trail** - Track all actions
✅ **Easy Recovery** - One-click restoration
✅ **Admin Dashboard** - Full visibility
✅ **Export & Reporting** - Generate reports

**Your data is now protected! 🔒**

---

## 🎉 Next Steps

1. ✅ Run SQL migration
2. ✅ Add recovery service
3. ✅ Add recovery screen
4. ✅ Update attendance service
5. ✅ Test recovery
6. ✅ Deploy to production

**Total time: 30 minutes**

---

**Never lose attendance data again! 🚀**
