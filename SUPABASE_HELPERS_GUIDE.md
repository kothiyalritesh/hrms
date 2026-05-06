# Supabase Helpers - Usage Guide

Quick reference for using the Supabase helper functions in your React Native app.

## 📌 Import

```typescript
import {
  AuthHelpers,
  ProfileHelpers,
  ActivityLogHelpers,
  LeaveHelpers,
  FieldVisitHelpers,
  OfficeHelpers,
  LocationComplianceHelpers,
  GeneralHelpers,
} from '@/lib/supabaseHelpers';
```

---

## 🔐 Authentication

### Sign Up
```typescript
const { data, error } = await AuthHelpers.signUp(
  'user@example.com',
  'password123'
);

if (error) {
  console.error('Sign up failed:', error.message);
} else {
  console.log('User created:', data.user.id);
}
```

### Sign In
```typescript
const { data, error } = await AuthHelpers.signIn(
  'user@example.com',
  'password123'
);

if (error) {
  console.error('Login failed:', error.message);
} else {
  console.log('Logged in:', data.session.user.email);
}
```

### Sign Out
```typescript
const { error } = await AuthHelpers.signOut();
if (error) console.error('Logout failed:', error);
```

### Get Current User
```typescript
const { data, error } = await AuthHelpers.getCurrentUser();
if (data?.user) {
  console.log('Current user:', data.user.email);
}
```

### Reset Password
```typescript
const { data, error } = await AuthHelpers.resetPassword('user@example.com');
if (error) {
  console.error('Reset failed:', error.message);
} else {
  console.log('Password reset email sent');
}
```

---

## 👤 User Profiles

### Get Your Profile
```typescript
// Get current user's profile
const { data: user } = await AuthHelpers.getCurrentUser();
const { data: profile } = await ProfileHelpers.getProfileByAuthId(
  user.user.id
);

console.log(profile.name, profile.email);
```

### Get Profile by ID
```typescript
const { data: profile, error } = await ProfileHelpers.getProfile(
  'user-uuid-here'
);
```

### Update Your Profile
```typescript
const { data: updated, error } = await ProfileHelpers.updateProfile(
  profileId,
  {
    first_name: 'John',
    last_name: 'Doe',
    phone: '+1234567890',
  }
);
```

### Search Employees
```typescript
const { data: results } = await ProfileHelpers.searchProfiles('john');
// Returns all employees with "john" in name/email
```

### Get All Employees (Admin Only)
```typescript
// Get all employees in an office
const { data: employees } = await ProfileHelpers.getAllProfiles({
  office_id: 'office-uuid',
  role: 'employee',
});
```

---

## 📍 Activity Logging

### Create Activity (Check-in)
```typescript
const { data: activity, error } = await ActivityLogHelpers.createActivityLog({
  user_id: currentUserId,
  activity_type: 'checkin',
  activity_subtype: 'office',
  location_latitude: 28.6139,
  location_longitude: 77.209,
  location_address: 'Office Address, Delhi',
  check_in_time: new Date().toISOString(),
});
```

### Create Activity (Field Visit)
```typescript
const { data: activity } = await ActivityLogHelpers.createActivityLog({
  user_id: currentUserId,
  activity_type: 'site_visit',
  site_id: siteId,
  location_latitude: 28.5355,
  location_longitude: 77.391,
  location_address: 'Property Address',
  check_in_time: new Date().toISOString(),
  description: 'Site inspection completed',
});
```

### Update Activity (Checkout)
```typescript
const { data: updated } = await ActivityLogHelpers.updateActivityLog(
  activityId,
  {
    check_out_time: new Date().toISOString(),
    duration_minutes: 480,
    notes: 'Day completed successfully',
  }
);
```

### Get Today's Activities
```typescript
const { data: activities } = await ActivityLogHelpers.getTodayActivityLogs(
  currentUserId
);

activities.forEach((activity) => {
  console.log(`${activity.activity_type} at ${activity.check_in_time}`);
});
```

### Get Last 30 Days Activities
```typescript
const { data: activities } = await ActivityLogHelpers.getUserActivityLogs(
  userId,
  30 // number of days
);
```

### Get Daily Summary
```typescript
const { data: summary } = await ActivityLogHelpers.getDailySummary(
  userId,
  '2026-04-30'
);

console.log(summary); // Total activities, time breakdown, etc.
```

---

## 🏖️ Leave Management

### Request Leave
```typescript
const { data: leave, error } = await LeaveHelpers.requestLeave({
  user_id: currentUserId,
  leave_type: 'sick', // or 'vacation', 'personal', etc.
  from_date: '2026-05-01',
  to_date: '2026-05-03',
  duration_days: 3,
  reason: 'Medical appointment',
});
```

### Get My Leave Requests
```typescript
const { data: leaves } = await LeaveHelpers.getUserLeaves(currentUserId);

// Or filter by status
const { data: pending } = await LeaveHelpers.getUserLeaves(currentUserId, {
  status: 'pending',
});

const { data: approved } = await LeaveHelpers.getUserLeaves(currentUserId, {
  status: 'approved',
});
```

### Get Pending Leaves (Manager/Admin)
```typescript
// Get all pending leave requests to approve
const { data: pendingLeaves } = await LeaveHelpers.getPendingLeaves();

// Or filter by office
const { data: officeLeaves } = await LeaveHelpers.getPendingLeaves(officeId);

pendingLeaves?.forEach((leave) => {
  console.log(`${leave.profiles.name} requested leave`);
});
```

### Approve Leave
```typescript
const { data: approved } = await LeaveHelpers.approveLeave(
  leaveId,
  managerId // ID of who's approving
);
```

### Reject Leave
```typescript
const { data: rejected } = await LeaveHelpers.rejectLeave(
  leaveId,
  'Already on leave during this period'
);
```

---

## 🏢 Field Visits

### Create Field Visit
```typescript
const { data: visit, error } = await FieldVisitHelpers.createFieldVisit({
  user_id: currentUserId,
  site_id: propertyId,
  visit_date: '2026-04-30',
  check_in_time: new Date().toISOString(),
  latitude: 28.5355,
  longitude: 77.391,
  address: 'Property Address, City',
  purpose: 'Site inspection',
  notes: 'Property in good condition',
});
```

### Get Field Visits
```typescript
const { data: visits } = await FieldVisitHelpers.getUserFieldVisits(userId, 30);

visits?.forEach((visit) => {
  console.log(`${visit.address} - ${visit.visit_date}`);
});
```

### Update Field Visit (Checkout)
```typescript
const { data: updated } = await FieldVisitHelpers.updateFieldVisit(visitId, {
  check_out_time: new Date().toISOString(),
  photos: ['photo_url_1', 'photo_url_2'],
  is_approved: true,
});
```

---

## 🏢 Offices

### Get All Offices
```typescript
const { data: offices } = await OfficeHelpers.getAllOffices();

offices?.forEach((office) => {
  console.log(`${office.name} - ${office.city}`);
});
```

### Get Single Office
```typescript
const { data: office } = await OfficeHelpers.getOffice(officeId);

console.log(`
  Office: ${office.name}
  Address: ${office.address}
  Geofence Radius: ${office.radius_km} km
  Coordinates: ${office.latitude}, ${office.longitude}
`);
```

### Create Office (Admin Only)
```typescript
const { data: newOffice } = await OfficeHelpers.createOffice({
  name: 'Mumbai Branch',
  address: '123 Business Street',
  city: 'Mumbai',
  state: 'Maharashtra',
  latitude: 19.076,
  longitude: 72.8479,
  radius_km: 5.0,
});
```

---

## 📊 Location Compliance

### Get Compliance Summary
```typescript
// For current user
const { data: compliance } = await LocationComplianceHelpers.getComplianceSummary();

console.log(`
  Days Tracked: ${compliance[0].days_tracked}
  Compliant: ${compliance[0].compliant_days}
  Compliance %: ${compliance[0].compliance_percentage}%
`);

// Or for specific user (Admin)
const { data: userCompliance } = await LocationComplianceHelpers.getComplianceSummary(
  userId
);
```

### Get Compliance Range
```typescript
const { data: compliance } = await LocationComplianceHelpers.getUserComplianceRange(
  userId,
  '2026-04-01',
  '2026-04-30'
);

compliance?.forEach((day) => {
  console.log(`
    Date: ${day.log_date}
    Time at Office: ${day.time_at_office} minutes
    Time at Sites: ${day.time_at_sites} minutes
    Compliant: ${day.is_compliant}
  `);
});
```

---

## 🛠️ General Utilities

### Calculate Distance
```typescript
const distanceKm = GeneralHelpers.calculateDistance(
  28.6139, // user latitude
  77.209,  // user longitude
  28.5355, // office latitude
  77.391   // office longitude
);

console.log(`Distance to office: ${distanceKm.toFixed(2)} km`);
```

### Check if Within Radius
```typescript
const isAtOffice = GeneralHelpers.isLocationWithinRadius(
  currentLat,
  currentLon,
  office.latitude,
  office.longitude,
  office.radius_km
);

if (isAtOffice) {
  console.log('User is at office');
} else {
  console.log('User is outside office geofence');
}
```

### Upload File
```typescript
const { data: uploaded, error } = await GeneralHelpers.uploadFile(
  'activities', // bucket name
  `${userId}/photo_${Date.now()}.jpg`, // file path
  imageFile // File or Blob
);
```

### Get Public URL
```typescript
const publicUrl = GeneralHelpers.getPublicUrl(
  'activities',
  `${userId}/photo_123.jpg`
);

console.log('Image URL:', publicUrl);
```

---

## 🎯 Common Workflows

### Daily Check-in
```typescript
export async function dailyCheckIn() {
  // Get current user
  const { data: user } = await AuthHelpers.getCurrentUser();
  const { data: profile } = await ProfileHelpers.getProfileByAuthId(user.user.id);

  // Get user's office
  const { data: office } = await OfficeHelpers.getOffice(profile.office_id);

  // Get current location
  const location = await getCurrentLocation(); // Your location code

  // Check if within office geofence
  const isAtOffice = GeneralHelpers.isLocationWithinRadius(
    location.latitude,
    location.longitude,
    office.latitude,
    office.longitude,
    office.radius_km
  );

  // Create activity
  const { data: activity } = await ActivityLogHelpers.createActivityLog({
    user_id: profile.id,
    activity_type: isAtOffice ? 'checkin' : 'site_visit',
    activity_subtype: isAtOffice ? 'office' : 'field',
    location_latitude: location.latitude,
    location_longitude: location.longitude,
    location_address: location.address,
    check_in_time: new Date().toISOString(),
  });

  return activity;
}
```

### Request and Track Leave
```typescript
export async function requestLeave(fromDate, toDate, reason) {
  const { data: user } = await AuthHelpers.getCurrentUser();
  const { data: profile } = await ProfileHelpers.getProfileByAuthId(user.user.id);

  // Calculate days
  const days = Math.floor(
    (new Date(toDate) - new Date(fromDate)) / (1000 * 60 * 60 * 24)
  ) + 1;

  // Request leave
  const { data: leave } = await LeaveHelpers.requestLeave({
    user_id: profile.id,
    leave_type: 'vacation',
    from_date: fromDate,
    to_date: toDate,
    duration_days: days,
    reason,
  });

  return leave;
}
```

---

## ⚠️ Error Handling

Always handle errors:
```typescript
try {
  const { data, error } = await ProfileHelpers.getProfile(userId);

  if (error) {
    console.error('Database error:', error.message);
    // Show error to user
    showError('Failed to load profile');
    return null;
  }

  return data;
} catch (err) {
  console.error('Unexpected error:', err);
  showError('Something went wrong');
}
```

---

## 💡 Tips & Best Practices

1. **Always destructure** `{ data, error }` from responses
2. **Check for errors** before using data
3. **Use try-catch** for unexpected issues
4. **Cache data** in state to reduce queries
5. **Use dates** in ISO format (e.g., '2026-04-30')
6. **Test with sample** data first
7. **Monitor console** for RLS policy violations
8. **Handle offline** scenarios in production

---

## 📝 Example: Complete Login Flow

```typescript
import { AuthHelpers, ProfileHelpers } from '@/lib/supabaseHelpers';

export async function handleLogin(email, password) {
  try {
    // 1. Authenticate
    const { data: authData, error: authError } = await AuthHelpers.signIn(
      email,
      password
    );

    if (authError) throw authError;

    // 2. Get profile
    const { data: profile, error: profileError } =
      await ProfileHelpers.getProfileByAuthId(authData.session.user.id);

    if (profileError) throw profileError;

    // 3. Return user data
    return {
      user: authData.session.user,
      profile,
      success: true,
    };
  } catch (error) {
    return {
      error: error.message,
      success: false,
    };
  }
}
```

Happy coding! 🚀
