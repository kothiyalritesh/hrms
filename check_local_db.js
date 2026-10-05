#!/usr/bin/env node

/**
 * Diagnostic script to check local database state
 * Run: node check_local_db.js
 */

const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = process.env.EXPO_PUBLIC_SUPABASE_URL || 'http://localhost:54321';
const SUPABASE_KEY = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP3sSgLWcY8uNkiiPH_xCabA0XSUcuWxRrB_IgQbc';

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

async function checkDatabase() {
  try {
    console.log('\n🔍 Local Database Diagnostic Report\n');
    console.log('=' .repeat(50) + '\n');

    // Get today's date
    const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
    console.log(`📅 Today's date (IST): ${today}\n`);

    // 1. Check employees
    console.log('👥 EMPLOYEES');
    console.log('-'.repeat(50));
    const { data: empCount, error: empError } = await supabase
      .from('profiles')
      .select('id', { count: 'exact' })
      .eq('is_active', true);

    if (empError) {
      console.log(`❌ Error: ${empError.message}`);
    } else {
      console.log(`✅ Active employees: ${empCount?.length || 0}`);
    }

    // 2. Check offices
    console.log('\n🏢 OFFICES');
    console.log('-'.repeat(50));
    const { data: offCount, error: offError } = await supabase
      .from('offices')
      .select('id', { count: 'exact' })
      .eq('is_active', true);

    if (offError) {
      console.log(`❌ Error: ${offError.message}`);
    } else {
      console.log(`✅ Active offices: ${offCount?.length || 0}`);
    }

    // 3. Check today's attendance
    console.log(`\n📊 TODAY'S ATTENDANCE (${today})`);
    console.log('-'.repeat(50));
    const { data: todayAtt, error: attError } = await supabase
      .from('attendance_logs')
      .select('id', { count: 'exact' })
      .eq('date', today);

    if (attError) {
      console.log(`❌ Error: ${attError.message}`);
    } else {
      console.log(`✅ Records for today: ${todayAtt?.length || 0}`);
    }

    // 4. Check recent attendance
    console.log('\n📈 RECENT ATTENDANCE (Last 5 days)');
    console.log('-'.repeat(50));
    const { data: recentDates, error: recentError } = await supabase
      .from('attendance_logs')
      .select('date')
      .order('date', { ascending: false })
      .limit(5);

    if (recentError) {
      console.log(`❌ Error: ${recentError.message}`);
    } else {
      const uniqueDates = [...new Set(recentDates?.map(r => r.date) || [])];
      if (uniqueDates.length === 0) {
        console.log('⚠️  No attendance records found in database');
      } else {
        uniqueDates.forEach(date => {
          console.log(`  • ${date}`);
        });
      }
    }

    // 5. Check RPC
    console.log('\n⚙️  RPC FUNCTIONS');
    console.log('-'.repeat(50));
    try {
      const { data, error } = await supabase.rpc('rpc_admin_attendance_daily_v3', {
        p_start: today,
        p_end: today,
        p_offset: 0,
        p_limit: 1,
      });

      if (error) {
        console.log(`❌ RPC Error: ${error.message}`);
      } else {
        console.log(`✅ RPC rpc_admin_attendance_daily_v3 is working`);
        console.log(`   Returned ${data?.length || 0} records`);
      }
    } catch (e) {
      console.log(`❌ RPC Error: ${e.message}`);
    }

    console.log('\n' + '='.repeat(50));
    console.log('\n📋 RECOMMENDATIONS:\n');

    if ((todayAtt?.length || 0) === 0) {
      console.log('⚠️  No attendance data for today!');
      console.log('   Run: node seed_attendance_local.js\n');
    } else {
      console.log('✅ Attendance data exists for today');
      console.log('   Refresh the Attendance Control screen\n');
    }

    if ((empCount?.length || 0) === 0) {
      console.log('⚠️  No active employees found');
      console.log('   Create employees first in User Management\n');
    }

    if ((offCount?.length || 0) === 0) {
      console.log('⚠️  No active offices found');
      console.log('   Create offices first in Office Settings\n');
    }

  } catch (error) {
    console.error('❌ Diagnostic error:', error.message);
    process.exit(1);
  }
}

checkDatabase();
