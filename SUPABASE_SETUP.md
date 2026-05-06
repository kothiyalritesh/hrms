# Supabase Setup Guide for RealtyHRM

## Current Configuration
- **Project URL**: https://jidbrwpzfpbursihtvpg.supabase.co
- **Status**: Ready for database schema initialization

## Step 1: Access Supabase Dashboard

1. Go to [Supabase Dashboard](https://app.supabase.com)
2. Log in with your account
3. Select the **RealtyHRM** project
4. Navigate to **SQL Editor** in the left sidebar

## Step 2: Run Database Setup Scripts

Execute the following scripts in order in the Supabase SQL Editor:

### 2.1 Run Master Setup
Copy and paste the contents of `scripts/MASTER_SETUP.sql` into the SQL Editor and execute.

### 2.2 Initialize Core Tables
Execute these scripts in sequence:
1. `scripts/phase1_schema.sql`
2. `scripts/phase2_schema.sql`
3. `scripts/activity_logs_schema.sql`
4. `scripts/location_compliance_schema.sql`

### 2.3 Configure Additional Features
1. `scripts/add_meeting_details.sql`
2. `scripts/add_checkout_notes.sql`
3. `scripts/add_location_address.sql`
4. `scripts/add_destination_coords.sql`
5. `scripts/add_office_gps_coords.sql`
6. `scripts/add_birthday_support.sql`

### 2.4 Fix RLS Policies
1. `scripts/fix_activity_logs_rls.sql`
2. `scripts/fix_leave_rls.sql`
3. `scripts/fix_admin_daily_log_view.sql`

## Step 3: Verify Database Setup

After running all scripts, verify tables were created:
1. Go to **Table Editor** in Supabase
2. Check for these tables:
   - `profiles`
   - `user_credentials` (if created)
   - `activity_logs`
   - `leaves`
   - `field_visits`
   - `sites`
   - `offices`
   - `meetings`
   - `checkout_notes`
   - `location_compliance`

## Step 4: Create Authentication Users (Optional but Recommended)

### Via Supabase Dashboard:
1. Go to **Authentication** → **Users**
2. Click **Add User**
3. Enter email and password
4. Associate with profile via `profiles.auth_id`

### Via SQL:
```sql
-- Create user_credentials table if not exists
CREATE TABLE IF NOT EXISTS user_credentials (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID UNIQUE NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  username VARCHAR(100) UNIQUE NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  email VARCHAR(255) NOT NULL,
  phone VARCHAR(20),
  otp_secret VARCHAR(32),
  otp_enabled BOOLEAN DEFAULT false,
  otp_verified BOOLEAN DEFAULT false,
  backup_codes TEXT[],
  last_login_at TIMESTAMP,
  login_attempts INT DEFAULT 0,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_user_credentials_user_id ON user_credentials(user_id);
CREATE INDEX idx_user_credentials_username ON user_credentials(username);
CREATE INDEX idx_user_credentials_email ON user_credentials(email);
```

## Step 5: Seed Initial Data

1. Go to **SQL Editor**
2. Run `scripts/seedData.sql` to populate sample data

## Step 6: Verify Environment Variables

Ensure your `.env` file has:
```
EXPO_PUBLIC_SUPABASE_URL=https://jidbrwpzfpbursihtvpg.supabase.co
EXPO_PUBLIC_SUPABASE_ANON_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
```

## Step 7: Test Connection

Run from terminal:
```bash
npm install
npm start
```

The app should connect successfully and authenticate users.

## Troubleshooting

### Connection Issues
- Verify your project is not paused in Supabase dashboard
- Check network connectivity
- Confirm credentials in `.env` match Supabase project settings

### Missing Tables
- Re-run `MASTER_SETUP.sql` 
- Check SQL Editor for error messages during execution
- Verify user has admin permissions

### RLS Policy Errors
- Review policies in **Authentication** → **Policies**
- Run `fix_activity_logs_rls.sql` and related scripts
- Check that user roles are properly set in `profiles.role`

### Email/Auth Issues
- Enable email in **Authentication** → **Providers** → **Email**
- Set custom SMTP settings if using production emails
- Configure redirect URLs in **Authentication** → **URL Configuration**

## Local Development Setup (Optional)

### Install Supabase CLI via Docker:
```bash
docker run -it --rm -v ${PWD}:/workspace supabase/supabase init
docker run -it --rm -v ${PWD}:/workspace supabase/supabase start
```

### Or Download Directly:
- Visit https://github.com/supabase/cli/releases
- Download the Windows binary
- Add to your PATH or use full path to execute commands

## Common Commands

```bash
# Login to Supabase
supabase login

# Link to remote project
supabase link --project-ref jidbrwpzfpbursihtvpg

# Pull remote schema
supabase db pull

# Push local migrations
supabase db push

# Start local development
supabase start

# Stop local development
supabase stop
```

## Next Steps

1. ✅ Access Supabase dashboard
2. ✅ Run database initialization scripts
3. ✅ Verify all tables created
4. ✅ Seed initial data
5. ✅ Test connection from app
6. Create additional user roles and permissions as needed
7. Configure email notifications
8. Set up backups and monitoring

## Support Resources

- [Supabase Documentation](https://supabase.com/docs)
- [React Native with Supabase](https://supabase.com/docs/guides/getting-started/quickstarts/react-native)
- [Row Level Security (RLS)](https://supabase.com/docs/guides/auth/row-level-security)
