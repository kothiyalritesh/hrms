# Supabase Setup - Quick Start Guide

## ✅ Current Status

Your Supabase project is configured with:
- **Project ID**: jidbrwpzfpbursihtvpg
- **URL**: https://jidbrwpzfpbursihtvpg.supabase.co
- **Region**: Likely US or EU (check dashboard)
- **Status**: Ready for database initialization

## 🚀 Quick Setup Steps (5-10 minutes)

### Step 1: Log Into Supabase Dashboard
```
Visit: https://app.supabase.com
Select: RealtyHRM project
```

### Step 2: Initialize Database Schema (Choose One Method)

#### Method A: SQL Editor (Easiest)
1. Click **SQL Editor** in left sidebar
2. Click **New Query**
3. Copy entire contents of `scripts/SUPABASE_INIT.sql`
4. Paste into editor
5. Click **Run**
6. Wait for completion ✅

#### Method B: Via Terminal
```bash
# If you can install CLI successfully:
supabase db push scripts/SUPABASE_INIT.sql
```

### Step 3: Verify Setup
1. Go to **Table Editor** in Supabase
2. Verify you see these tables:
   - ✅ offices
   - ✅ profiles
   - ✅ user_credentials
   - ✅ sites
   - ✅ activity_logs
   - ✅ field_visits
   - ✅ leaves
   - ✅ meetings
   - ✅ checkout_notes
   - ✅ location_compliance

### Step 4: Add Sample Data
```bash
# Option 1: Via SQL Editor in Supabase
# Copy scripts/seedData.sql and run

# Option 2: Via Terminal
npm run seed
```

### Step 5: Test Connection in App
```bash
npm install
npm start
```

## 📋 What Each Script Does

| Script | Purpose |
|--------|---------|
| `SUPABASE_INIT.sql` | **START HERE** - Creates all tables, indexes, and RLS policies |
| `MASTER_SETUP.sql` | Alternative: Full setup with additional configurations |
| `seedData.sql` | Adds sample offices, employees, and test data |
| `activity_logs_schema.sql` | Activity logging specific setup |
| `location_compliance_schema.sql` | Location tracking and compliance |

## 🔑 Environment Variables

Your `.env` file already has credentials:
```env
EXPO_PUBLIC_SUPABASE_URL=https://jidbrwpzfpbursihtvpg.supabase.co
EXPO_PUBLIC_SUPABASE_ANON_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
```

**✅ No changes needed** - you're ready to go!

## 🔐 Security Setup

### Enable Authentication
1. Go to **Authentication** → **Providers**
2. Enable **Email** provider
3. Configure email templates (optional)

### Configure URL Settings
1. Go to **Authentication** → **URL Configuration**
2. Add your app domain(s):
   - Development: `localhost:*`
   - Staging: `staging.yourapp.com`
   - Production: `app.yourapp.com`

## 📊 Database Schema Overview

```
Employees (via profiles table)
├── Belong to Offices
├── Log Activities (activity_logs)
├── Request Leaves (leaves)
├── Perform Field Visits (field_visits)
├── Attend Meetings (meetings)
└── Track Location Compliance (location_compliance)

Sites & Offices
├── Used for location tracking
└── Configured with GPS coordinates
```

## 🧪 Testing the Setup

### Test 1: Verify Database Connection
```typescript
// In your React Native app
import { supabase } from '@/lib/supabase';

const testConnection = async () => {
  const { data, error } = await supabase
    .from('offices')
    .select('*')
    .limit(1);
  
  console.log('Connection test:', { data, error });
};
```

### Test 2: Verify Authentication
```typescript
const testAuth = async () => {
  const { data, error } = await supabase.auth.getSession();
  console.log('Auth test:', { data, error });
};
```

## ⚠️ Common Issues & Solutions

### Issue: "Tables not found"
**Solution**: 
- Run `SUPABASE_INIT.sql` again in SQL Editor
- Check for errors in the output
- Verify you're logged in with correct project selected

### Issue: "RLS policy violation"
**Solution**:
- Go to **Authentication** → **Policies**
- Verify `auth.uid()` matches profile auth_id
- Run `fix_activity_logs_rls.sql` script

### Issue: "Connection timeout"
**Solution**:
- Check project is not paused (dashboard → Overview)
- Verify API key in `.env` is correct
- Check internet connection

### Issue: "API Key invalid"
**Solution**:
- Go to **Project Settings** → **API**
- Copy the correct anon key
- Update `.env` file
- Restart app

## 📱 App Integration Checklist

- [ ] `.env` file has correct credentials
- [ ] Database tables created (verified in Table Editor)
- [ ] RLS policies enabled (verified in Policies tab)
- [ ] Sample data seeded (if desired)
- [ ] App can connect (test with TestConnection code above)
- [ ] Authentication configured (email enabled)
- [ ] URL redirects configured

## 🔗 Next Steps

1. **Seed Sample Data**
   ```bash
   npm run seed
   ```

2. **Create Admin User**
   - Go to **Authentication** → **Users**
   - Add your email/password
   - Edit profile to set role as "admin"

3. **Configure Email Service** (Optional)
   - Go to **Project Settings** → **Email**
   - Add your SMTP credentials
   - Test with password reset

4. **Enable Additional Features**
   - Run additional SQL scripts as needed
   - Configure push notifications
   - Set up backups and monitoring

## 📚 Resources

- [Supabase Docs](https://supabase.com/docs)
- [Supabase JavaScript Guide](https://supabase.com/docs/reference/javascript)
- [Row Level Security](https://supabase.com/docs/guides/auth/row-level-security)
- [Supabase Dashboard](https://app.supabase.com)

## ✨ You're Done!

Your Supabase backend is now ready. The app can:
- ✅ Authenticate users
- ✅ Store and retrieve employee data
- ✅ Log activities with location tracking
- ✅ Manage leaves and approvals
- ✅ Track field visits
- ✅ Monitor location compliance

**Next**: Build your frontend screens and connect them to these tables!
