# Supabase Setup Checklist for RealtyHRM

## 📋 Pre-Setup Verification

- [x] `.env` file has Supabase credentials configured
- [x] Project URL: `https://jidbrwpzfpbursihtvpg.supabase.co`
- [x] EXPO_PUBLIC_SUPABASE_URL is set
- [x] EXPO_PUBLIC_SUPABASE_ANON_KEY is set
- [ ] Verified credentials are correct (test in next steps)

---

## 🔧 Step 1: Database Initialization

### Option A: Web Dashboard (Recommended - Easiest)
- [ ] Open https://app.supabase.com
- [ ] Log in with your Supabase account
- [ ] Select **RealtyHRM** project
- [ ] Click **SQL Editor** in left sidebar
- [ ] Click **New Query**
- [ ] Open file: `scripts/SUPABASE_INIT.sql`
- [ ] Copy entire contents
- [ ] Paste into SQL Editor
- [ ] Click **Run**
- [ ] Wait for completion (should take 30-60 seconds)
- [ ] Check for any error messages
- [ ] If errors, note them and check troubleshooting section

### Option B: Terminal (If CLI works)
```bash
cd c:\Users\ritesh kothiyal\Downloads\RealtyHRM\RealtyHRM
supabase link --project-ref jidbrwpzfpbursihtvpg
supabase db push scripts/SUPABASE_INIT.sql
```
- [ ] Project linked successfully
- [ ] SQL script executed without errors

---

## ✅ Step 2: Verify Database Tables

### Via Web Dashboard:
1. [ ] Go to **Table Editor** in Supabase
2. [ ] Verify these tables exist:
   - [ ] `offices`
   - [ ] `profiles`
   - [ ] `user_credentials`
   - [ ] `sites`
   - [ ] `activity_logs`
   - [ ] `checkout_notes`
   - [ ] `field_visits`
   - [ ] `meetings`
   - [ ] `leaves`
   - [ ] `location_compliance`

3. [ ] Click each table to verify structure
   - At minimum, check that it has columns (not empty)

### Via Terminal (Optional):
```bash
# If you have psql installed:
psql -h aws-0-REGION.pooler.supabase.com -d postgres -U postgres
# Then run: \dt
```
- [ ] All tables listed

---

## 🔐 Step 3: Enable Row Level Security (RLS)

### Via Dashboard:
1. [ ] Go to **Authentication** → **Policies** in Supabase
2. [ ] Verify RLS is enabled on tables:
   - [ ] `profiles`
   - [ ] `activity_logs`
   - [ ] `field_visits`
   - [ ] `leaves`

3. [ ] Review existing policies:
   - Should see policies for "select", "insert", "update" operations
   - Policies should use `auth.uid()` checks

If no policies visible, run this SQL in SQL Editor:
```sql
-- Re-enable RLS
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE activity_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE field_visits ENABLE ROW LEVEL SECURITY;
ALTER TABLE leaves ENABLE ROW LEVEL SECURITY;
```

- [ ] RLS policies verified or created

---

## 🌐 Step 4: Configure Authentication

### Email Provider Setup:
1. [ ] Go to **Authentication** → **Providers** in Supabase
2. [ ] Find **Email** provider
3. [ ] Verify it shows "Enabled" (should be by default)
4. [ ] (Optional) Go to **Email Templates** to customize messages

### Redirect URLs Configuration:
1. [ ] Go to **Authentication** → **URL Configuration**
2. [ ] Add these redirect URLs:
   - [ ] `http://localhost:8081/**` (local dev)
   - [ ] `myapp://callback` (React Native)
   - [ ] `exp://localhost:8081` (Expo)
   - Your production URL when ready

- [ ] Authentication providers configured

---

## 📊 Step 5: Seed Sample Data

### Via Dashboard SQL Editor:
1. [ ] Open new SQL query
2. [ ] Open file: `scripts/seedData.sql`
3. [ ] Copy and paste into SQL Editor
4. [ ] Review what it will create (offices, employees, sample data)
5. [ ] Click **Run**
6. [ ] Wait for completion

### Or Via Terminal:
```bash
npm run seed
# (if seed script is configured in package.json)
```

- [ ] Sample data seeded
- [ ] Can verify via Table Editor (should see data in tables)

---

## 🧪 Step 6: Test Connection in App

### Test 1: Basic Connection
```bash
# In project root:
npm install
npm start
```
- [ ] App starts without errors
- [ ] No connection errors in console

### Test 2: Test Functions (Optional - Advanced)
Create a test file: `test-supabase.ts`
```typescript
import { supabase } from '@/lib/supabase';

export async function testSupabaseConnection() {
  console.log('Testing Supabase connection...');
  
  // Test 1: List offices
  const { data: offices, error: officeError } = await supabase
    .from('offices')
    .select('*')
    .limit(1);
  
  console.log('Offices test:', { offices, error: officeError });
  
  // Test 2: Check auth
  const { data: session, error: sessionError } = await supabase.auth.getSession();
  console.log('Session test:', { session, error: sessionError });
  
  console.log('All tests completed!');
}

// Run this on app startup for testing
```

- [ ] App can query database
- [ ] No "RLS violation" errors
- [ ] No "Invalid API key" errors

---

## 👥 Step 7: Create Admin User (Important)

### Via Dashboard:
1. [ ] Go to **Authentication** → **Users** in Supabase
2. [ ] Click **Add User**
3. [ ] Enter test email (e.g., admin@test.com)
4. [ ] Enter password (strong password)
5. [ ] Click **Create user**
6. [ ] Copy the user ID

### Link to Profile:
1. [ ] Go to **Table Editor** → **profiles**
2. [ ] Click **Insert row**
3. [ ] Fill in:
   - `auth_id`: (paste the user ID from above)
   - `first_name`: Admin
   - `last_name`: User
   - `email`: admin@test.com
   - `role`: admin
   - `is_active`: true
4. [ ] Click **Save**

- [ ] Admin user created
- [ ] User exists in both Auth and Profiles table

---

## 🔄 Step 8: Verify Integration

### In Your App:
1. [ ] Open login screen
2. [ ] Try logging in with admin@test.com
3. [ ] Should authenticate successfully
4. [ ] Should see user data in app
5. [ ] Should be able to access admin features

```typescript
// Test in your auth context or login screen:
import { AuthHelpers } from '@/lib/supabaseHelpers';

const handleLogin = async () => {
  const { data, error } = await AuthHelpers.signIn(
    'admin@test.com',
    'your-password-here'
  );
  
  if (error) {
    console.error('Login failed:', error);
  } else {
    console.log('Login successful!', data);
  }
};
```

- [ ] Login works
- [ ] Profile data retrieved
- [ ] No database errors

---

## 🛠️ Step 9: Configure Additional Features (Optional)

### Email Notifications:
- [ ] Go to **Email** settings in Supabase
- [ ] Configure SMTP (if production)
- [ ] Set up email templates for:
  - [ ] Confirmation email
  - [ ] Password reset
  - [ ] Magic link

### File Storage:
- [ ] Go to **Storage** in Supabase
- [ ] Create buckets for:
  - [ ] `profiles` (for profile pictures)
  - [ ] `activities` (for activity photos)
- [ ] Configure permissions

### Backups:
- [ ] Go to **Project Settings** → **Backups**
- [ ] Enable daily backups
- [ ] Set retention period

---

## 📊 Step 10: Monitoring & Maintenance

### Regular Checks:
- [ ] Go to **Project Settings** → **Database**
  - Check disk usage
  - Check project health
  
- [ ] Go to **Logs** (if available)
  - Review for errors
  - Check for slow queries

### Performance:
- [ ] Install Supabase Dashboard extension
- [ ] Monitor:
  - [ ] Query performance
  - [ ] Authentication events
  - [ ] RLS policy violations

---

## 🎯 Next Steps After Setup

### For Developers:
1. [ ] Import `supabaseHelpers.ts` in screens
2. [ ] Use helpers for database operations
3. [ ] Implement screens:
   - [ ] Login/Auth
   - [ ] Profile management
   - [ ] Activity logging
   - [ ] Leave management
   - [ ] Field visits
   - [ ] Reports/Analytics

### Example Usage:
```typescript
import { ProfileHelpers, ActivityLogHelpers } from '@/lib/supabaseHelpers';

// Get user profile
const { data: profile } = await ProfileHelpers.getProfile(userId);

// Log activity
const { data: log } = await ActivityLogHelpers.createActivityLog({
  user_id: userId,
  activity_type: 'checkin',
  location_latitude: currentLat,
  location_longitude: currentLon,
});
```

### For Admins:
1. [ ] Create additional user roles:
   - [ ] Managers (can approve leaves, view reports)
   - [ ] HR (can manage employees, view payroll)
   
2. [ ] Configure office locations
   - [ ] Add office GPS coordinates
   - [ ] Set geofence radius for each office

3. [ ] Set up automation (if available):
   - [ ] Approval workflows
   - [ ] Daily compliance reports
   - [ ] Notifications

---

## 🆘 Troubleshooting

### Problem: "FOREIGN_KEY_VIOLATION"
**Solution**: Run SUPABASE_INIT.sql first to create all tables

### Problem: "RLS policy violation"
**Solution**: 
- Check auth_id in profiles matches auth.uid()
- Run RLS policy scripts
- Ensure user is authenticated

### Problem: "Invalid API Key"
**Solution**:
- Check `.env` has correct key
- Copy fresh key from Supabase dashboard
- Restart app

### Problem: "Tables not found"
**Solution**:
- Verify SQL script ran without errors
- Check Table Editor to confirm tables exist
- Re-run SUPABASE_INIT.sql if needed

### Problem: "Connection timeout"
**Solution**:
- Check project not paused
- Verify internet connection
- Check firewall/VPN blocking Supabase

See **SUPABASE_QUICKSTART.md** or **SUPABASE_SETUP.md** for more troubleshooting

---

## ✨ Success Indicators

- [ ] All 10 tables visible in Table Editor
- [ ] RLS policies enabled on sensitive tables
- [ ] Authentication configured
- [ ] Sample data seeded
- [ ] App connects without errors
- [ ] Can login with test user
- [ ] Can query database from app
- [ ] Can create/read/update data
- [ ] No console errors or warnings
- [ ] Performance is acceptable

---

## 📞 Support & Resources

- **Supabase Docs**: https://supabase.com/docs
- **Supabase Dashboard**: https://app.supabase.com
- **React Native Guide**: https://supabase.com/docs/guides/getting-started/quickstarts/react-native
- **RLS Documentation**: https://supabase.com/docs/guides/auth/row-level-security

---

## 🎉 Congratulations!

Once all items are checked, your Supabase backend is fully configured and ready for production use!

The RealtyHRM app can now:
- ✅ Authenticate users securely
- ✅ Store and retrieve employee data
- ✅ Track activities with location
- ✅ Manage leaves and approvals
- ✅ Log field visits
- ✅ Monitor location compliance
- ✅ Generate reports

**Happy coding!** 🚀
