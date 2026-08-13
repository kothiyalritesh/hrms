# Issues Resolution Summary

## 1. ✅ Attendance 409 Conflict Error - FIXED

### Problem
When users tried to mark attendance, the app was failing with a **409 Conflict** error on the POST to `attendance_logs` table:
```
POST https://.../rest/v1/attendance_logs 409 (Conflict)
```

### Root Cause
The `AttendanceService.officeCheckIn()` method was using `.insert()` which fails when a record with the same unique constraint already exists. The `attendance_logs` table likely has a unique constraint on `(user_id, date)` combination.

If a user tried to check in multiple times on the same day (either due to:
- Multiple button clicks
- App reload
- Session persistence issues
- Frontend check not working properly

The second attempt would cause a 409 Conflict.

### Solution Implemented
Changed from `.insert()` to `.upsert()` with the proper conflict resolution:

**File: `services/attendance.service.ts`**

```typescript
// BEFORE (caused 409 conflict)
const { error } = await supabase.from("attendance_logs").insert({
  user_id: userId,
  date: new Date().toISOString().slice(0, 10),
  // ... other fields
});

// AFTER (handles duplicate check-ins)
const { error } = await supabase.from("attendance_logs").upsert(
  {
    user_id: userId,
    date: today,
    // ... other fields
    checkin_time: new Date().toISOString(), // Added timestamp
  },
  {
    onConflict: "user_id,date", // Target the unique constraint
  }
);
```

### Benefits
- ✅ Multiple check-in attempts no longer fail
- ✅ Automatically updates existing record with latest check-in time
- ✅ Adds `checkin_time` field for better tracking
- ✅ More robust against race conditions

---

## 2. 📋 SMS Integration - NOT IMPLEMENTED

### Findings
**There is NO SMS sending functionality currently in the application.**

### What We Found
✅ OTP Service: `/services/otp.service.ts`
- Time-based OTP (TOTP) generation only
- No SMS delivery
- Requires 'speakeasy' library for production use

❌ No SMS Service: Not implemented

❌ No Notification API: `NotificationService` only handles in-app notifications to the database

### Why SMS is Not Needed (Currently)
The application works perfectly fine without SMS because:
1. OTP verification is handled via app-based authenticators (Google Authenticator, Authy, etc.)
2. All notifications are delivered in-app and via the database
3. SMS adds cost and complexity without being critical to functionality

### Adding SMS Support (When Needed)

I've created a template SMS service at `/services/sms.service.ts` with placeholder methods for:
- Sending OTP via SMS
- Attendance notifications
- Leave approval notifications
- Bulk SMS

The template includes instructions for integrating with:
- **Twilio** (Recommended)
- AWS SNS
- Firebase Cloud Messaging
- MessageBird
- Vonage/Nexmo

### Documentation Added
Updated `/BACKEND_SETUP.md` with comprehensive SMS integration guide including:
- Why SMS isn't implemented
- How to add it in the future
- Which providers to use
- Step-by-step setup instructions
- Environment variable configuration

---

## 3. 📊 Files Modified

### 1. `/services/attendance.service.ts`
- **Change**: Modified `officeCheckIn()` to use `.upsert()` instead of `.insert()`
- **Impact**: Fixes 409 Conflict error on duplicate check-ins
- **Date**: Today

### 2. `/services/sms.service.ts` (NEW)
- **Type**: Template/Skeleton
- **Purpose**: Provides structure for SMS integration
- **Status**: All methods are placeholders (log warnings instead of sending)
- **Methods**:
  - `sendOTP(phoneNumber, otp)`
  - `sendAttendanceNotification(phoneNumber, message)`
  - `sendLeaveNotification(phone, leaveType, status, approver)`
  - `sendBulkSMS(phoneNumbers, message)`

### 3. `/BACKEND_SETUP.md`
- **Change**: Added comprehensive SMS section
- **Content**: 
  - Current status (not implemented)
  - Reasons for not implementing
  - How to add SMS in future
  - Provider comparison
  - Setup instructions

---

## 4. 🧪 Testing the Fix

### To Verify Attendance Fix Works:
1. Open the app
2. Go to Attendance section
3. Click "Check In" button → ✅ Should succeed
4. Click "Check In" again → ✅ Should update (not fail with 409)
5. Refresh the page → ✅ Latest check-in time should be shown

### Expected Behavior After Fix:
- First check-in: Creates new record
- Second check-in (same day): Updates existing record with new timestamp
- No more 409 Conflict errors

---

## 5. 🔄 Database Recommendations

For proper attendance tracking, ensure your `attendance_logs` table has:

```sql
CREATE TABLE attendance_logs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES profiles(id),
  date DATE NOT NULL,
  attendance_type VARCHAR(50),
  office_id UUID,
  checkin_location JSONB,
  distance_from_office NUMERIC,
  checkin_time TIMESTAMP,
  checkout_time TIMESTAMP,
  warning BOOLEAN,
  status VARCHAR(50),
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  
  -- Prevent duplicate daily attendance per user
  UNIQUE(user_id, date)
);

CREATE INDEX idx_attendance_user_date ON attendance_logs(user_id, date);
CREATE INDEX idx_attendance_date ON attendance_logs(date);
```

---

## 6. 📝 Future Enhancements

If needed in the future:
1. **SMS Support**: Use the provided template in `/services/sms.service.ts`
2. **Email Notifications**: Create similar template in `/services/email.service.ts`
3. **Push Notifications**: Extend notification system
4. **Webhook System**: For real-time integrations

All of these can be added without affecting existing functionality.

---

## Summary

| Item | Status | Details |
|------|--------|---------|
| Attendance 409 Error | ✅ FIXED | Using `.upsert()` instead of `.insert()` |
| SMS Implementation | ✅ TEMPLATE | Skeleton provided, ready for future integration |
| Documentation | ✅ UPDATED | Added comprehensive SMS guide to BACKEND_SETUP.md |
| Testing | ⏳ PENDING | Ready to test - try multiple check-ins |












curl -X POST -H "Content-Type: application/json" -d '{
"apiKey": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpZCI6IjY4ZGVhNzVlYTM3MDcyNTJiYzJhZWY1NyIsIm5hbWUiOiJBQkMgRGlnaXRhbCBJbmMiLCJhcHBOYW1lIjoiQWlTZW5zeSIsImNsaWVudElkIjoiNjhkZWE3NWVhMzcwNzI1MmJjMmFlZjUyIiwiYWN0aXZlUGxhbiI6IkZSRUVfRk9SRVZFUiIsImlhdCI6MTc1OTQyMjMwMn0.GzXAy0qINll2QxsM9Q73B8SHBPeHMXiXZ1ypm8ScNbE",
"campaignName": "ticketopen",
"destination": "919999929832",
"userName": "ABC Digital Inc",
"templateParams": [],
"source": "new-landing-page form",
"media": {},
"buttons": [],
"carouselCards": [],
"location": {},
"attributes": {},
"paramsFallbackValue": {}
}' https://backend.aisensy.com/campaign/t1/api/v2

{
"apiKey": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpZCI6IjY4ZGVhNzVlYTM3MDcyNTJiYzJhZWY1NyIsIm5hbWUiOiJBQkMgRGlnaXRhbCBJbmMiLCJhcHBOYW1lIjoiQWlTZW5zeSIsImNsaWVudElkIjoiNjhkZWE3NWVhMzcwNzI1MmJjMmFlZjUyIiwiYWN0aXZlUGxhbiI6IkZSRUVfRk9SRVZFUiIsImlhdCI6MTc1OTQyMjMwMn0.GzXAy0qINll2QxsM9Q73B8SHBPeHMXiXZ1ypm8ScNbE",
"campaignName": "ticketclosed",
"destination": "919999929832",
"userName": "ABC Digital Inc",
"templateParams": [],
"source": "new-landing-page form",
"media": {},
"buttons": [],
"carouselCards": [],
"location": {},
"attributes": {},
"paramsFallbackValue": {}
}

eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpZCI6IjY4ZGVhNzVlYTM3MDcyNTJiYzJhZWY1NyIsIm5hbWUiOiJBQkMgRGlnaXRhbCBJbmMiLCJhcHBOYW1lIjoiQWlTZW5zeSIsImNsaWVudElkIjoiNjhkZWE3NWVhMzcwNzI1MmJjMmFlZjUyIiwiYWN0aXZlUGxhbiI6IkZSRUVfRk9SRVZFUiIsImlhdCI6MTc1OTQyMjMwMn0.GzXAy0qINll2QxsM9Q73B8SHBPeHMXiXZ1ypm8ScNbE

and below is api docs Skip to main content
AiSensy Help Center
Website
Login

English
English
Search for articles...
Search for articles...
All Collections
Template Messages & Broadcasting
API Reference Docs
API Reference Docs
API Reference Docs to run automated API campaigns.

Written by Shivam Aggarwal
June 3, 2025
Wish to automate WhatsApp campaigns by connecting your CRM with AiSensy?

In this document, we'll explain the exact steps to automate WhatsApp notifications via API campaigns using AiSensy.

Step: 1- Create an API campaign in AiSensy.

In AiSensy App, go to Campaigns, click on +Launch & select API Campaign

Add a Campaign name, select a pre-approved template to which you wish to send using the campaign & set the API campaign live

Note: Make sure your WhatsApp template message is created & approved before creating the API Campaign. For reference, check out how to create WhatsApp templates in AiSensy.
​

Step 2: Integrating AiSensy with your CRM
For this step, you would need your development team to help you out with the integration process.

Connect your trigger point of your CRM/ website/ 3rd party software using JSON key format & endpoint URL given below HTTP Request POST https://backend.aisensy.com/campaign/t1/api/v2

{
"apiKey": string,
"campaignName": string,
"destination": string,
"userName": string,
"source": string,
"media": {
"url": string,
"filename": string
},
"templateParams": [
string
],
"tags": [
string
],
"attributes": {
"attribute_name": string
}
}

Send notifications to users through API:

NOTE: In case of a new user (i.e. the user doesn’t exist on your contact list in AiSensy Platform) then a new contact will get created with the incoming details.

Populate the Jason key strings against each attribute according to the table below

Fields

Description

apiKey

string
​
​Required. API key generated from the dashboard.

Go to manage> API Key >Copy the key

campaignName

string
​
​Required. Name of the campaign which has to be sent to the user. The status of the campaign should be ‘Live’.

Go to campaigns> Copy the name of the API campaign created

destination

string
​
​Required. Mobile number of users with country dial-code to whom the campaign has to be sent.
e.g. – +917428526285 (India)

For all numbers outside India, it's mandatory to provide it in +(country code)(phone number)

For Indian numbers, it's optional to provide it in +(country code)(phone number)

If a phone number can't be resolved to any country then, it is by default considered to be from India(+91).

userName

string
​
​Required Name of the user to whom the campaign has to be sent.

source

string
​
​Optional. Source of lead. It is to create a source-based segment to re-target.
e.g.- ‘Facebook forms’, ‘Website lead’, ‘Youtube lead’

media

object
​
​Optional. URL & filename of media that has to be sent with the template message.

location

string

Required. latitude, longitude, name & address of location that has to be sent with the template message.

templateParams[]

string
​
​Optional. An array of parameter values to fill in a template message

If there is any dynamic value included in the template message enter the details of it. Multiple values are separated by comma

tags[]

string
​
​Optional. An array of tag names to assign to the user.

attributes

object with key-value pairs. The only string is allowed as the key's value.

Optional. The object should contain keys already added as assistant attributes paired with values that you want to set as user's attributes.

Example Postman Request
Step 1 - Setup request type to "POST"

Step 2 - Setup URL

Step 3 - Choose body type "raw"

Step 4 - Select "JSON" type

Step 5 - Set content of the request

You can find more examples here - Open in Postman

NOTES:

Optional fields are not necessary for the request payload

The medial URL provided in the media object should be publically accessible, otherwise, the request will be rejected

The length of the template params array should be equal to the number of params required in the campaign whose name is provided in campaignName field. Otherwise, the request will be rejected

Tags should be created in your project before using them. It can be done by anyone with manager level access

If a tag doesn't exist in your project, it will be ignored

Attributes should be added to the project before using them. It can be done by anyone with manager level access

If an attribute doesn't exist in your project, it will be ignored

Response Body
If successful, the response body will return a status of 200.

Prerequisites

You have verified WhatsApp Business API. How?

You have template messages approved.

You have already created an API Campaign. How to create API Campaign?

Related Articles
AiSensy X Zapier Integration Doc
How to automate API campaigns using Pabbly?
DaySchedule X AiSensy Integration
How to connect Joonweb with AiSensy
How to connect Investwell with AiSensy & automate WhatsApp messages
Did this answer your question?
😞😐😃
Step: 1- Create an API campaign in AiSensy.

In AiSensy App, go to Campaigns, click on +Launch & select API Campaign

Add a Campaign name, select a pre-approved template to which you wish to send using the campaign & set the API campaign live Step 2: Integrating AiSensy with your CRM

Connect your trigger point of your CRM/ website/ 3rd party software using JSON key format & endpoint URL given below HTTP Request Example Postman Request Response Body AiSensy Help Center AiSensy Communications Pvt Ltd We run on Intercom Contact Us Talk to Sales we wanbt that evry timne user generates a ticket it shopukd goit to all admin and hr users and when tickt is closed it should go to all hr and the user who raisded the ticket


