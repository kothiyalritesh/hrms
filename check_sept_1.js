const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const env = fs.readFileSync('.env', 'utf8');
const supabaseUrl = env.match(/EXPO_PUBLIC_SUPABASE_URL=(.*)/)[1].trim();
const supabaseKey = env.match(/EXPO_PUBLIC_SUPABASE_ANON_KEY=(.*)/)[1].trim();
const supabase = createClient(supabaseUrl, supabaseKey);

async function test() {
  const { data, error } = await supabase.from('v_attendance_daily_canonical')
    .select('work_date, employee_name, effective_checkin, effective_status')
    .eq('work_date', '2026-09-01')
    .limit(5);
  console.log('Sept 1st Data:', data, 'Error:', error);
}
test();
