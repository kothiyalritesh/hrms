#!/usr/bin/env node

/**
 * Seed today's attendance data for local testing
 * Run: node seed_attendance_local.js
 */

const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = process.env.EXPO_PUBLIC_SUPABASE_URL || 'http://localhost:54321';
const SUPABASE_KEY = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP3sSgLWcY8uNkiiPH_xCabA0XSUcuWxRrB_IgQbc';

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

async function seedAttendance() {
  try {
    console.log('🌱 Seeding today\'s attendance data...\n');

    // Get today's date in IST format
    const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
    console.log(`📅 Today's date (IST): ${today}\n`);

    // 1. Get all active employees
    console.log('📋 Fetching active employees...');
    const { data: employees, error: empError } = await supabase
      .from('profiles')
      .select('id, name, office_id')
      .eq('is_active', true)
      .limit(20);

    if (empError) throw empError;
    console.log(`✅ Found ${employees?.length || 0} active employees\n`);

    if (!employees || employees.length === 0) {
      console.log('❌ No active employees found. Please create employees first.');
      return;
    }

    // 2. Get active offices
    console.log('🏢 Fetching active offices...');
    const { data: offices, error: offError } = await supabase
      .from('offices')
      .select('id, name')
      .eq('is_active', true);

    if (offError) throw offError;
    console.log(`✅ Found ${offices?.length || 0} active offices\n`);

    // 3. Check if attendance already exists for today
    console.log(`🔍 Checking for existing attendance records for ${today}...`);
    const { data: existing, error: checkError } = await supabase
      .from('attendance_logs')
      .select('id')
      .eq('date', today);

    if (checkError) throw checkError;

    if (existing && existing.length > 0) {
      console.log(`⚠️  Found ${existing.length} existing records for today. Skipping insertion.\n`);
      console.log('💡 To reset, run: DELETE FROM attendance_logs WHERE date = \'' + today + '\';\n');
      return;
    }

    // 4. Create attendance records
    console.log(`📝 Creating attendance records for ${today}...\n`);

    const attendanceRecords = employees.map((emp, index) => {
      const officeId = emp.office_id || (offices?.[index % offices.length]?.id);
      const checkinHour = 9 + Math.floor(Math.random() * 2); // 9-10 AM
      const checkinMin = Math.floor(Math.random() * 60);
      const checkoutHour = 17 + Math.floor(Math.random() * 2); // 5-6 PM
      const checkoutMin = Math.floor(Math.random() * 60);

      return {
        user_id: emp.id,
        date: today,
        checkin_time: `${today}T${String(checkinHour).padStart(2, '0')}:${String(checkinMin).padStart(2, '0')}:00+05:30`,
        checkout_time: `${today}T${String(checkoutHour).padStart(2, '0')}:${String(checkoutMin).padStart(2, '0')}:00+05:30`,
        office_id: officeId,
        status: 'CHECKED_OUT',
        warning: false,
      };
    });

    // Insert in batches
    const batchSize = 10;
    for (let i = 0; i < attendanceRecords.length; i += batchSize) {
      const batch = attendanceRecords.slice(i, i + batchSize);
      const { error: insertError } = await supabase
        .from('attendance_logs')
        .insert(batch);

      if (insertError) {
        console.error(`❌ Error inserting batch ${Math.floor(i / batchSize) + 1}:`, insertError.message);
      } else {
        console.log(`✅ Inserted batch ${Math.floor(i / batchSize) + 1} (${batch.length} records)`);
      }
    }

    // 5. Verify insertion
    console.log(`\n🔍 Verifying inserted records...\n`);
    const { data: verified, error: verifyError } = await supabase
      .from('attendance_logs')
      .select(`
        id,
        date,
        checkin_time,
        checkout_time,
        status,
        profiles:user_id(name),
        offices:office_id(name)
      `)
      .eq('date', today)
      .limit(5);

    if (verifyError) throw verifyError;

    console.log(`📊 Sample records for ${today}:\n`);
    verified?.forEach((record, idx) => {
      console.log(`${idx + 1}. ${record.profiles?.name || 'Unknown'}`);
      console.log(`   Office: ${record.offices?.name || 'N/A'}`);
      console.log(`   Check-in: ${record.checkin_time?.slice(11, 16) || 'N/A'}`);
      console.log(`   Check-out: ${record.checkout_time?.slice(11, 16) || 'N/A'}`);
      console.log(`   Status: ${record.status}\n`);
    });

    const { data: countData, error: countError } = await supabase
      .from('attendance_logs')
      .select('id', { count: 'exact' })
      .eq('date', today);

    if (!countError) {
      console.log(`✅ Total records created for ${today}: ${countData?.length || 0}\n`);
    }

    console.log('🎉 Attendance data seeded successfully!');
    console.log('💡 Refresh the Attendance Control screen to see the data.\n');

  } catch (error) {
    console.error('❌ Error seeding attendance:', error.message);
    process.exit(1);
  }
}

seedAttendance();
