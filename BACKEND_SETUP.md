# HRMS Backend Setup Guide

## Overview
This document outlines the backend setup required for the HRMS system to function properly, including user management, credential generation, and OTP authentication.

## Required Database Tables

### 1. **user_credentials** (CRITICAL)
This table stores login credentials and OTP settings for each user.

```sql
CREATE TABLE user_credentials (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID UNIQUE NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  
  -- Login Credentials
  username VARCHAR(100) UNIQUE NOT NULL,
  password_hash VARCHAR(255) NOT NULL,  -- Use bcrypt in production, NOT base64!
  is_temporary BOOLEAN DEFAULT true,    -- Flag for temporary password
  
  -- Email & Phone
  email VARCHAR(255) NOT NULL,
  phone VARCHAR(20),
  
  -- OTP Configuration (TOTP - Time-based OTP)
  otp_secret VARCHAR(32),               -- Base32 encoded secret for TOTP
  otp_enabled BOOLEAN DEFAULT false,
  otp_verified BOOLEAN DEFAULT false,   -- True after user confirms OTP setup
  backup_codes TEXT[],                  -- Array of backup codes for account recovery
  
  -- Audit Trail
  last_login_at TIMESTAMP,
  login_attempts INT DEFAULT 0,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- Indexes for performance
CREATE INDEX idx_user_credentials_user_id ON user_credentials(user_id);
CREATE INDEX idx_user_credentials_username ON user_credentials(username);
CREATE INDEX idx_user_credentials_email ON user_credentials(email);
```

### 2. **profiles** (Updates Required)
Add these columns to the existing profiles table:

```sql
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS name VARCHAR(255);
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS first_name VARCHAR(100);
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS last_name VARCHAR(100);
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS email VARCHAR(255);
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS username VARCHAR(100);
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS phone VARCHAR(20);
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS employee_number VARCHAR(50);
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS is_active BOOLEAN DEFAULT true;

-- Add unique constraint
CREATE UNIQUE INDEX idx_profiles_employee_number ON profiles(employee_number) 
WHERE employee_number IS NOT NULL;

-- Add index for username
CREATE UNIQUE INDEX idx_profiles_username ON profiles(username) 
WHERE username IS NOT NULL;

-- Add index for name ordering
CREATE INDEX idx_profiles_name ON profiles(name);
```

### 3. **otp_verification_logs** (Optional but Recommended)
Track OTP verification attempts for security/audit purposes:

```sql
CREATE TABLE otp_verification_logs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  ip_address VARCHAR(45),
  user_agent TEXT,
  success BOOLEAN,
  attempt_at TIMESTAMP DEFAULT NOW(),
  
  -- Rate limiting
  failed_attempts INT DEFAULT 0,
  locked_until TIMESTAMP
);

CREATE INDEX idx_otp_logs_user_id ON otp_verification_logs(user_id);
```

### 4. **password_reset_tokens** (Optional)
For secure password reset functionality:

```sql
CREATE TABLE password_reset_tokens (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  token VARCHAR(255) UNIQUE NOT NULL,
  expires_at TIMESTAMP NOT NULL,
  used_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_reset_tokens_user_id ON password_reset_tokens(user_id);
CREATE INDEX idx_reset_tokens_token ON password_reset_tokens(token);
```

## OTP Implementation Details

### Enabling OTP for Users

1. **Generation**: When creating a new user, generate a TOTP secret using the `generateOTPSecret()` function
2. **Display**: Show QR code to user (using a library like `react-native-qr-code`)
3. **Verification**: User scans with authenticator app (Google Authenticator, Authy, Microsoft Authenticator, etc.)
4. **Confirmation**: User enters 6-digit code to verify setup
5. **Backup Codes**: Generate 8-10 backup codes for account recovery

### Required Dependencies for Backend

```bash
# For TOTP verification (Node.js backend)
npm install speakeasy qrcode

# For password hashing
npm install bcrypt

# For email sending (credentials delivery)
npm install nodemailer
```

### Backend API Endpoints Required

#### Authentication Endpoints
```
POST /api/auth/login
  Body: { username, password, otp_code? }
  Returns: { token, user, requires_otp }

POST /api/auth/verify-otp
  Body: { username, otp_code }
  Returns: { token, user }

POST /api/auth/setup-otp
  Body: { user_id }
  Returns: { secret, qr_code }

POST /api/auth/confirm-otp
  Body: { user_id, otp_code }
  Returns: { verified: boolean, backup_codes: string[] }

POST /api/auth/disable-otp
  Body: { user_id, password }
  Returns: { disabled: boolean }

POST /api/auth/reset-password
  Body: { old_password, new_password }
  Returns: { success: boolean }
```

#### Admin User Management Endpoints
```
POST /api/admin/users/create
  Body: { name, email, phone, employee_number, role_id, office_id }
  Returns: { user, credentials: { username, temp_password } }

PUT /api/admin/users/:id
  Body: { name, email, phone, role_id, office_id }
  Returns: { user }

GET /api/admin/users/:id/credentials
  Returns: { username, email, phone, otp_enabled, created_at }

POST /api/admin/users/:id/reset-password
  Returns: { temp_password }

POST /api/admin/users/:id/toggle-otp
  Body: { enabled: boolean }
  Returns: { otp_enabled: boolean }

DELETE /api/admin/users/:id
  Returns: { deleted: boolean }
```

## Security Recommendations

### Password Hashing
```javascript
// Backend implementation (Node.js with bcrypt)
const bcrypt = require('bcrypt');

// Hashing
const hashedPassword = await bcrypt.hash(temporaryPassword, 10);

// Verification
const isValid = await bcrypt.compare(inputPassword, hashedPassword);
```

### Email Delivery (Credentials)
Implement secure delivery of credentials to employees:

```javascript
// Example with sendgrid or nodemailer
const sendCredentialsEmail = async (email, name, username, tempPassword) => {
  const template = `
    <h1>Welcome, ${name}!</h1>
    <p>Your account has been created in the HRMS system.</p>
    <hr>
    <p><strong>Username:</strong> ${username}</p>
    <p><strong>Temporary Password:</strong> ${tempPassword}</p>
    <hr>
    <p>⚠️ Important:</p>
    <ul>
      <li>Change your password immediately after first login</li>
      <li>Enable Two-Factor Authentication (OTP) for enhanced security</li>
      <li>Never share these credentials with anyone</li>
    </ul>
  `;
  
  // Send email...
};
```

### Rate Limiting
Implement rate limiting on login and OTP verification endpoints:

```javascript
// Example: Max 5 failed attempts per 15 minutes
const isRateLimited = (loginAttempts, lastAttemptTime) => {
  const fifteenMinutesAgo = Date.now() - 15 * 60 * 1000;
  if (lastAttemptTime > fifteenMinutesAgo && loginAttempts >= 5) {
    return true;
  }
  return false;
};
```

### OTP Best Practices
- **Window**: Accept OTP codes within ±30 seconds (1 time window before/after)
- **Backup Codes**: Once used, delete from database
- **Rate Limit OTP**: Max 5 attempts per minute
- **Session Based**: Require password again before disabling OTP

## Current Implementation Status

✅ Frontend user credential generation  
✅ User management UI with employee creation  
✅ OTP flag setup  
✅ Temporary password generation  

⏳ Backend Tables - Need to create in Supabase  
⏳ OTP Verification Logic - Implement with speakeasy  
⏳ Email Service - Setup credential delivery  
⏳ Login API - Implement full authentication  
⏳ Password Reset Flow - Implement token-based reset  

## Testing the System

### Manual Testing Checklist
- [ ] Create a new employee via User Management
- [ ] Verify credentials are generated correctly
- [ ] Check username format: `EMP{employee_number}`
- [ ] Verify password meets complexity: 12 chars, mixed case, numbers, special
- [ ] Test OTP setup flow on created user
- [ ] Test login with username and password
- [ ] Test OTP verification during login
- [ ] Test backup code usage
- [ ] Test password reset
- [ ] Test deactivating/reactivating user

## Migration from Dev Mode

When moving from dev mode to production:

1. Set `DEV_MODE = false` in AuthContext.tsx
2. Implement all backend endpoints
3. Update Supabase auth configuration
4. Implement row-level security (RLS) policies
5. Set up email service for credential delivery
6. Configure SSL/TLS for all communications
7. Implement refresh token rotation
8. Add comprehensive logging and monitoring

## Troubleshooting

### Issue: OTP codes not working
- Check time sync on server and client devices
- Verify TOTP secret is Base32 encoded
- Check OTP window tolerance (±30 seconds)
- Verify backup codes are active

### Issue: Users can't login after creation
- Verify user_credentials record exists
- Check password hash format
- Verify username uniqueness
- Check if user account is active

### Issue: Credentials not sent to email
- Verify email service is configured
- Check employee email address
- Review email logs for delivery status
- Check spam/junk folders

## SMS Service - NOT CURRENTLY IMPLEMENTED

### Current Status
⚠️ **SMS sending is NOT configured in this application**

SMS functionality is completely optional and currently not integrated. This includes:
- SMS OTP delivery
- Attendance notifications via SMS
- Leave approval notifications via SMS
- Bulk messaging

### Why SMS is Not Implemented
1. Requires third-party SMS provider (Twilio, AWS SNS, etc.)
2. Incurs additional costs per message
3. Not critical for basic HRMS functionality
4. Can be added later if business requirements change

### Implementing SMS (When Needed)

If you need to add SMS notifications in the future, follow these steps:

#### 1. Choose an SMS Provider
Popular options:
- **Twilio** (Recommended - easy to use): https://www.twilio.com
- **AWS SNS**: https://aws.amazon.com/sns/
- **Firebase Cloud Messaging**: https://firebase.google.com
- **MessageBird**: https://www.messagebird.com
- **Vonage/Nexmo**: https://www.vonage.com

#### 2. Install SDK
```bash
# For Twilio (recommended)
npm install twilio

# For AWS SNS
npm install aws-sdk
```

#### 3. Set Environment Variables
```env
# For Twilio
TWILIO_ACCOUNT_SID=your_account_sid
TWILIO_AUTH_TOKEN=your_auth_token
TWILIO_PHONE_NUMBER=+1234567890

# Or for AWS SNS
AWS_ACCESS_KEY_ID=your_access_key
AWS_SECRET_ACCESS_KEY=your_secret_key
AWS_SNS_REGION=us-east-1
```

#### 4. Use the SMS Service Template
See `/services/sms.service.ts` which contains a template implementation.

#### 5. Integrate into Application
Once implemented, you can use SMS in:
- OTP delivery during login
- Attendance notifications
- Leave approval notifications
- Manager alerts for attendance warnings

### SMS Service Template
A skeleton SMS service is provided in `/services/sms.service.ts` with:
- `sendOTP()` - Send OTP code via SMS
- `sendAttendanceNotification()` - Notify about attendance status
- `sendLeaveNotification()` - Notify about leave approval
- `sendBulkSMS()` - Send messages to multiple users

All methods currently log warnings instead of sending messages.

