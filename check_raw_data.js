const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const env = fs.readFileSync('.env', 'utf8');
const supabaseUrl = env.match(/EXPO_PUBLIC_SUPABASE_URL=(.*)/)[1].trim();
const supabaseKey = env.match(/EXPO_PUBLIC_SUPABASE_ANON_KEY=(.*)/)[1].trim();
const supabase = createClient(supabaseUrl, supabaseKey);

async function test() {
  const { data: logs, error: e1 } = await supabase.from('attendance_logs').select('id, user_id, date').eq('date', '2026-09-01').limit(5);
  const { data: smart, error: e2 } = await supabase.from('smartoffice_device_logs').select('id, user_id, log_date_only').eq('log_date_only', '2026-09-01').limit(5);
  console.log('Attendance Logs:', logs?.length, 'Smartoffice Logs:', smart?.length);
  if (smart?.length) console.log('Sample smart:', smart[0]);
}
test();
