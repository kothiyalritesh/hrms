# Profile Schema Migration Guide

## Issue
The application was failing with error `42703: column profiles.name does not exist` when trying to load user data.

## Root Cause
The `profiles` table was missing several columns that the application code expects to exist:
- `name` - Full name of the employee
- `first_name` - First name (optional, for future use)
- `last_name` - Last name (optional, for future use)
- `email` - Email address
- `is_active` - Boolean flag for active/inactive status

## Solution
Run these SQL migrations in your Supabase database to add the missing columns:

### Step 1: Adding Missing Columns to profiles Table

```sql
-- Add name-related columns
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS name VARCHAR(255);
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS first_name VARCHAR(100);
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS last_name VARCHAR(100);

-- Add email column (if not already present)
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS email VARCHAR(255);

-- Add is_active flag (if not already present)
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS is_active BOOLEAN DEFAULT true;

-- Add indexes for better performance
CREATE INDEX IF NOT EXISTS idx_profiles_name ON profiles(name);
CREATE INDEX IF NOT EXISTS idx_profiles_is_active ON profiles(is_active);
```

### Step 2: Migrating Existing Data (Optional)

If you already have user emails in the `auth.users` table, you can copy them to `profiles`:

```sql
UPDATE profiles 
SET email = (SELECT email FROM auth.users WHERE auth.users.id = profiles.id)
WHERE email IS NULL;
```

## Verification

After running the migrations, verify the columns exist:

```sql
SELECT column_name, data_type, is_nullable 
FROM information_schema.columns 
WHERE table_name = 'profiles'
ORDER BY ordinal_position;
```

You should see:
- `id` (uuid)
- `updated_at` (timestamp)
- `name` (varchar)
- `first_name` (varchar)
- `last_name` (varchar)
- `email` (varchar)
- `username` (varchar)
- `phone` (varchar)
- `employee_number` (varchar)
- `is_active` (boolean)

## Code Changes Made

The following files have been updated to work with these new columns:

1. **BACKEND_SETUP.md** - Updated with complete migration SQL
2. **UserManagementScreen.tsx** - Fixed to properly query profiles with name column
3. **AttendanceControlScreenNew.tsx** - Updated profiles query
4. **attendance.service.ts** - Removed invalid `updated_at` field from insert operations

## Testing

After applying the migrations:

1. Navigate to Admin → User Management
2. You should see the employee list loading without errors
3. Try adding a new employee
4. Verify the employee appears in the list

## Rollback (If Needed)

If you need to revert, you can drop the columns:

```sql
ALTER TABLE profiles DROP COLUMN IF EXISTS name;
ALTER TABLE profiles DROP COLUMN IF EXISTS first_name;
ALTER TABLE profiles DROP COLUMN IF EXISTS last_name;
ALTER TABLE profiles DROP COLUMN IF EXISTS email;
ALTER TABLE profiles DROP COLUMN IF EXISTS is_active;

DROP INDEX IF EXISTS idx_profiles_name;
DROP INDEX IF EXISTS idx_profiles_is_active;
```

## Next Steps

1. Apply the SQL migrations to your Supabase database
2. Restart your application
3. Test the User Management and Attendance screens
index-605c6bd68a6533011a5222481b402ed9.js:1 Failed to load resource: the server responded with a status of 404 ()
favicon.ico:1 Failed to load resource: the server responded with a status of 404 ()
We get this we extracted in publichtml/HRMS and link is https://airportnoida.in/HRMS/