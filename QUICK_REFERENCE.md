# HRMS Admin - Quick Reference Guide

## 🔑 Quick Start

### Access Admin Panel
1. Log in as **SYSTEM_ADMIN** user
2. Tap **Admin** tab (⚙️) in bottom navigation
3. View **Admin Dashboard**

### Add New Employee (30 seconds)
```
Admin Dashboard 
  → "Add Employee" button 
  → Fill form (Name, Email, Phone, Emp#, Role, Office)
  → Tap "Add Employee"
  → Tap "Generate Credentials" 
  → Done! ✅
```

## 📋 Admin Dashboard Overview

### Stat Cards (Clickable)
| Card | Value | Taps To |
|------|-------|---------|
| 👥 Total Employees | Number + Active count | User Management |
| 🕐 Today's Attendance | Count | Attendance Control |
| 📅 Pending Leaves | Count | Leave Management |
| ⚠️ Overdue Tasks | Count | Task Control |
| 🎂 Upcoming Birthdays | Count | Read-only |

### Quick Actions (Buttons)
| Button | Goes To |
|--------|---------|
| 👤➕ Add Employee | User Management |
| 🔔 Send Notification | Notification Management |
| 📄 View Logs | Audit Logs |

## 👥 User Management Screen

### Employee List
Each employee card shows:
- **Name** (header)
- **Email**
- **Phone** (if available)
- **Emp #** (if available)
- **Role • Office**
- Reports to: Manager name (if applicable)
- **Status badge**: Active 🟢 / Inactive 🔴

### Employee Actions (3 Icons)
| Icon | Action | Result |
|------|--------|--------|
| 🔑 Key | Generate Credentials | Shows credentials modal (if no username) |
| ✏️ Edit | Edit employee info | Opens edit modal |
| 👤 User | Toggle status | Active ↔️ Inactive |

## 🔐 Credential Generation

### Automatic When Creating Employee:
1. ✅ **Username** generated: `EMP{employee_number}`
   - Emp # 1 → `EMP0001`
   - Emp # 42 → `EMP0042`
   - Emp # 999 → `EMP0999`

2. ✅ **Password** generated: 12 characters
   - Example: `aR#7mK$1pQx9`
   - Always uppercase, lowercase, numbers, symbols

3. ✅ **OTP Secret** generated: Base32 code
   - Used for authenticator apps
   - Automatic 2FA setup

4. ✅ **Backup Codes** (10): For account recovery
   - Format: `XXXX-XXXX-XXXX`
   - Use if can't access authenticator

### Credentials Modal Display
Shows ONE TIME ONLY:
```
✅ Credentials Generated Successfully!

Employee Name: John Doe
Email: john.doe@company.com

Username: EMP0001 [📋 Copy]
Password: aR#7mK$1pQx9 [📋 Copy]

🛡️ Two-Factor Authentication (OTP)
   Enabled for this account

⚠️ Important Note:
   Save securely. Password is temporary.
   Must change on first login.
```

## 📝 Adding Employee - Form Fields

| Field | Type | Required | Notes |
|-------|------|----------|-------|
| **Name** | Text | ✅ Yes | Full name |
| **Email** | Email | ✅ Yes | Work email |
| **Phone** | Phone | ❌ No | Contact number |
| **Emp #** | Text | ✅ Yes | Used for username |
| **Role** | Dropdown | ❌ No | Job role |
| **Office** | Dropdown | ❌ No | Location |

**Save Button**: "Add Employee" or "Save Changes"

## 🔄 Editing Employee

### Change These Fields:
- Name
- Email
- Phone
- Employee Number
- Role
- Office

### What You Can't Change:
- User ID (internal)
- Created date
- Credentials username

## 🔀 Activate/Deactivate

### Steps:
1. Find employee in list
2. Tap the **user icon** (👤)
3. Confirm action in dialog
4. Status badge updates

### Behavior:
- **Active** 🟢: Can login, access system
- **Inactive** 🔴: Blocked from login, cannot access

### Can be Toggled:
Unlimited times, no side effects

## 🔍 Searching Employees

Currently: List is ordered by name  
Future: Search/filter functionality

**Tip**: Scroll through list to find employees

## ⚠️ Common Issues & Solutions

### "Employee already exists"
**Cause**: Employee number is duplicate
**Fix**: Change employee number to unique value

### Can't see credentials for existing employee
**Reason**: Credentials already generated and displayed (one-time)
**Fix**: Use "Key" icon to reset password / regenerate

### Form won't submit
**Check**: 
- Name filled? ✅
- Email filled? ✅
- Emp # filled? ✅
- Valid email format? ✅

### Back arrow not working
**Solution**: Tap "X" button at top right instead

## 🎯 Role-Based Access

**Who can access admin panel:**
- SYSTEM_ADMIN ✅
- ADMIN ✅
- All other roles ❌

**Check your role**: Profile > Account > View role

## 🌓 Dark/Light Mode

All admin screens support:
- ✅ Light mode
- ✅ Dark mode
- Toggle in app settings

## 🔒 Security Tips

### For Admins:
1. **Never share credentials** in chat/email plaintext
2. **Copy to clipboard** then paste securely
3. **One-time display** - save before closing modal
4. **OTP is mandatory** - users must set up 2FA
5. **Backup codes** - keep safe for emergencies

### For Employees:
Instructions to share:
```
1. Open HRMS app
2. Login with username: EMP0001
3. Password: [temporary password from email]
4. System will ask to scan OTP
5. Use Google Authenticator app
6. After login, change your password
```

## 📊 Dashboard Metrics

### What the Numbers Mean:

**Total Employees: 42 (12 active)**
- Total in system: 42
- Currently active: 12
- Inactive/on leave: 30

**Today's Attendance: 35**
- Employees marked present: 35
- Not yet marked: 7

**Pending Leaves: 5**
- Leave requests awaiting approval: 5
- Needs admin action

**Overdue Tasks: 2**
- Tasks past deadline: 2
- Not yet completed

**Upcoming Birthdays: 3**
- In next 7 days: 3
- Good for sendoff planning

## 🔄 Refresh Data

### Manual Refresh:
On Admin Dashboard:
- Pull down to refresh
- Swipe to refresh data
- Data updates in real-time

### Auto Refresh:
- When navigating back from other screens
- Every time Admin tab is focus

## 🎬 Typical Workflows

### New Hire Onboarding:
1. HR creates employee record
2. System generates credentials
3. HR sends credentials securely
4. Employee logs in first time
5. Employee changes password
6. Employee sets up OTP
7. Employee starts using system

### Deactivating Employee:
1. Admin goes to User Management
2. Finds employee
3. Taps user icon
4. Confirms deactivation
5. Employee blocked from login

### Password Reset:
1. Admin finds employee
2. Taps key icon
3. New password generated
4. Employee gets new temp password
5. Must change on next login

## 🚀 Performance Tips

### Load faster:
- Minimize open modals
- Close credentials modal after viewing
- Compress images (if uploading later)

### Prevent errors:
- Use valid email format
- Unique employee numbers
- Fill all required fields
- Use specific office selections

## 📱 Mobile Optimization

**Works on**:
- ✅ Phones (recommended)
- ✅ Tablets
- ✅ Web browsers

**Best experience**: Portrait mode on phone

## 🔗 Related Flows

After creating employee:
→ Notify employee of credentials
→ Employee logs in with temp password
→ System forces password change
→ Employee sets up authenticator app
→ OTP verification on each login
→ Employee fully onboarded ✅

## 🎓 Learning Resources

**Read These First**:
1. ADMIN_TESTING_GUIDE.md (how to test)
2. IMPLEMENTATION_SUMMARY.md (what was built)
3. BACKEND_SETUP.md (technical details)

**Key Files**:
- userCredentials.service.ts - Credential logic
- UserManagementScreen.tsx - Admin UI
- otp.service.ts - OTP implementation

## 🆘 Need Help?

### Check These Docs:
- ✅ ADMIN_TESTING_GUIDE.md - Common test cases
- ✅ BACKEND_SETUP.md - Technical errors
- ✅ IMPLEMENTATION_SUMMARY.md - Architecture
- ✅ This guide - Quick answers

### Common Questions:

**Q: Where do I access admin panel?**
A: Tap Admin tab (⚙️) in bottom navigation (SYSTEM_ADMIN only)

**Q: How are usernames created?**
A: From employee number: EMP0001, EMP0042, etc.

**Q: What if employee forgets password?**
A: Use key icon to reset and generate new temp password

**Q: Can I change OTP settings?**
A: System forces OTP on all new users (future: admin toggle)

**Q: What if backup codes are lost?**
A: Admin needs to reset OTP (will be feature later)

**Q: Can I bulk import employees?**
A: Not yet - add manually for now (future feature)

**Q: Where are audit logs?**
A: Admin → Audit Logs screen

**Q: How to disable a user account?**
A: Tap user icon and confirm deactivation

## ✅ Success Checklist

You've mastered the admin panel when:
- ✅ Can navigate to admin from any screen
- ✅ Understand all dashboard metrics
- ✅ Can create new employee in < 1 minute
- ✅ Know how credentials are generated
- ✅ Can copy/share credentials safely
- ✅ Can edit employee information
- ✅ Can activate/deactivate users
- ✅ Know OTP is enabled automatically
- ✅ Can troubleshoot basic issues
- ✅ Know when to contact support

## 🔮 Coming Soon (Future Features)

- 🔄 Bulk employee import (CSV)
- 📧 Email credential delivery
- 📊 Advanced analytics
- 🔐 Enhanced OTP management
- 🕐 Shift scheduling
- 📋 Custom forms
- 🔗 Integration APIs

---

**Last Updated**: March 25, 2026  
**Version**: 1.0  
**Status**: Production Ready (Backend Required)

