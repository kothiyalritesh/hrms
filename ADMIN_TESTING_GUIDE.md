# Admin Features Testing Guide

## Overview
This guide walks you through testing the newly implemented admin features in the HRMS application.

## Features Implemented

### 1. ✅ User Management
- **Add New Employee**: Create employees with complete information
- **Edit Employee**: Update employee details
- **Activate/Deactivate**: Enable or disable employee accounts
- **Credentials Generation**: Auto-generate login credentials with employment number

### 2. ✅ Credential Generation
- **Username Format**: `EMP{employee_number}` (e.g., EMP0001)
- **Temporary Password**: Secure 12-character password with mixed case, numbers, special chars
- **OTP Setup**: Automatic OTP secret generation with display
- **Secure Display**: One-time display of credentials in modal

### 3. ✅ OTP (Two-Factor Authentication)
- **Automatic Enablement**: OTP enabled when credentials are generated
- **Backup Codes**: Generated for account recovery
- **QR Code**: Can be scanned with authenticator apps

## Step-by-Step Testing

### Test Case 1: Add New Employee

**Prerequisites**: You must be logged in as SYSTEM_ADMIN

**Steps**:
1. Tap the "Admin" tab in the bottom navigation
2. Tap "Admin Dashboard"
3. Look for the "Total Employees" card, tap it
4. Alternatively, tap "Add Employee" in Quick Actions
5. Tap the "Add Employee" button (+ icon)
6. Fill in the form:
   - **Name**: John Doe
   - **Email**: john.doe@company.com
   - **Phone**: +1-555-0123
   - **Employee Number**: 001 (important for credentials)
   - **Role**: Select from dropdown
   - **Office**: Select from dropdown
7. Tap "Add Employee"
8. Confirm success alert
9. Choose "Generate Credentials" when prompted

### Expected Result
- Employee appears in the list
- Credentials modal displays with:
  - ✅ Success indicator
  - Username: EMP0001
  - Temporary password (12 characters)
  - OTP enabled indicator
  - Backup codes message

### Test Case 2: Generate Credentials for Existing Employee

**Steps**:
1. In the employee list, find an employee WITHOUT a username
2. Tap the **key icon** (🔑) on that employee card
3. A credentials generation prompt appears
4. Confirm to generate credentials
5. Review the credentials modal

**Expected Result**:
- Username is generated automatically
- Temporary password is shown
- Can copy credentials using copy button
- Employee card now shows "✓ Username: EMP{number}"

### Test Case 3: Edit Employee Information

**Steps**:
1. Find an employee in the list
2. Tap the **edit icon** (✏️) on the employee card
3. Update one of the fields:
   - Phone number
   - Name
   - Employee number
4. Tap "Save Changes"
5. Confirm success

**Expected Result**:
- Employee record updated in the list
- Changes persist after screen navigation

### Test Case 4: Activate/Deactivate Employee

**Steps**:
1. Find an employee in the list
2. Note their current status (Active/Inactive badge)
3. Tap the **user-x or user-check icon** (depending on current status)
4. Confirm the action in the alert dialog
5. Check the status badge update

**Expected Result**:
- Status badge toggles between "Active" and "Inactive"
- Badge color changes (green for active, red for inactive)
- List refreshes to show updated status

### Test Case 5: Dashboard Navigation

**Steps**:
1. Go to Admin Dashboard
2. Tap different stat cards:
   - "Total Employees" → Goes to User Management
   - "Today's Attendance" → Goes to Attendance Control
   - "Pending Leaves" → Goes to Leave Management
   - "Overdue Tasks" → Goes to Tasks & Projects Control
3. Tap Quick Action buttons:
   - "Add Employee" → User Management with add modal
   - "Send Notification" → Notification Management
   - "View Logs" → Audit Logs

**Expected Result**:
- Navigation works correctly
- Correct screen appears
- Can return to dashboard

## Field Validation Testing

### Employee Number Field
- ✅ Required field - cannot save without it
- ✅ Used to generate username format
- Format: EMP{number} where number is zero-padded to 4 digits

### Email Field
- ✅ Required field
- ✅ Valid email format
- ✅ Used for credential delivery (future)

### Phone Field
- ✅ Optional field
- ✅ Accepts phone number format
- ✅ Stored for contact information

### Role & Office Fields
- ✅ Dropdown selection
- ✅ Can be changed
- ✅ Defaults to empty

## Credential Generation Testing

### Password Characteristics
Every generated password should:
- ✅ Be exactly 12 characters
- ✅ Contain uppercase letters (A-Z)
- ✅ Contain lowercase letters (a-z)
- ✅ Contain numbers (0-9)
- ✅ Contain special characters (!@#$%^&*)
- ✅ Be unique each time (randomized)

**Example valid passwords**:
- `aR#7mK$1pQx9`
- `B2@wN4*jLo8D`
- `sT5!cF6$vY9H`

### Username Generation
- ✅ Format: `EMP` + zero-padded employee number
- Employee number "1" → `EMP0001`
- Employee number "42" → `EMP0042`
- Employee number "999" → `EMP0999`
- Employee number "1234" → `EMP1234`

## OTP Testing

### OTP Display
When credentials are generated:
- ✅ OTP enabled indicator shows
- ✅ Backup codes message displays
- ✅ Blue shield icon with OTP info
- ✅ Warning message about 2FA requirement

### QR Code (Future Implementation)
Once backend is ready:
- ✅ Scan with Google Authenticator
- ✅ Scan with Microsoft Authenticator
- ✅ Scan with Authy
- All should generate 6-digit codes

## Error Handling Testing

### Test Case: Missing Required Fields
1. Try to add employee without name → Error: "Name is required"
2. Try to add employee without email → Error: "Email is required"
3. Try to add employee without employee number → Error: "Employee number is required"

### Test Case: Duplicate Employee Number
1. Create employee with number "001"
2. Try to create another with "001"
3. Should either warn or prevent duplicate

**Expected**: Appropriate error messages

### Test Case: Invalid Email Format
1. Enter "not-an-email" as email
2. Try to save
3. Should validate email format

## Accessibility Testing

### Keyboard Navigation
- ✅ Tab through form fields
- ✅ Can select dropdowns with keyboard
- ✅ Can submit form with Enter key
- ✅ Can cancel with Escape

### Color Contrast
- ✅ Text readable on all backgrounds
- ✅ Status badges clearly visible
- ✅ Icons easily distinguishable

### Icons Meaning
- 🔑 Key icon = Generate/Reset credentials
- ✏️ Edit icon = Modify employee info
- 👤 User icon = Toggle active status (X = deactivate, ✓ = activate)

## Dark Mode Testing

Test all features in:
- ✅ Light mode
- ✅ Dark mode
- Credentials modal should be readable
- Stat cards should be visible
- Text contrast should be maintained

## Performance Testing

### Loading
- Employee list loads within 2 seconds
- No blank screens during data load
- Smooth transitions between screens

### Creating Employee
- Credentials generate within 1 second
- Modal displays immediately
- Passwords are unique

## Database Integration Testing

Once backend is connected:

### User Credentials Table
- [ ] Verify credentials are saved to `user_credentials` table
- [ ] Verify username is unique
- [ ] Verify password is hashed (not plain text)
- [ ] Verify OTP secret is stored correctly

### Profiles Table Updates
- [ ] Username field populated
- [ ] Phone field saved
- [ ] Employee number saved

## Login Testing (Future)

Once authentication is fully implemented:
1. Use generated username and temporary password to login
2. System should force password change
3. OTP setup should be required
4. After setup, OTP codes should work with app

## Cleanup & Rollback

After testing, clean up test data:
```sql
-- Delete test employees (if needed)
DELETE FROM profiles 
WHERE email LIKE 'test%' OR name LIKE 'Test%';

-- Delete credentials for test users
DELETE FROM user_credentials 
WHERE user_id IN (
  SELECT id FROM profiles WHERE email LIKE 'test%'
);
```

## Known Limitations

⏳ = Requires backend implementation

- ⏳ Cannot actually receive credential emails yet
- ⏳ OTP QR codes cannot be scanned yet (visual only)
- ⏳ Actual login with generated credentials not available
- ⏳ Password reset flow not implemented
- ⏳ Duplicate employee number prevention not enforced
- ⏳ Email validation against existing records

## Success Criteria

You have successfully tested the admin features when:

✅ Can create new employee with all fields  
✅ Credentials generate automatically  
✅ Username follows EMP format  
✅ Password has 12 characters with mixed content  
✅ OTP indicator shows for new users  
✅ Can edit employee information  
✅ Can activate/deactivate employees  
✅ Dashboard navigates correctly  
✅ All error messages are helpful  
✅ UI works in light and dark mode  

## Next Steps for Backend

1. Create database tables (see BACKEND_SETUP.md)
2. Implement authentication API endpoints
3. Setup email service for credential delivery
4. Implement TOTP verification with speakeasy
5. Add password reset flow
6. Setup session/JWT token management
7. Implement role-based access control (RBAC)
8. Add comprehensive audit logging

