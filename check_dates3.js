const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const env = fs.readFileSync('.env', 'utf8');
const supabaseUrl = env.match(/EXPO_PUBLIC_SUPABASE_URL=(.*)/)[1].trim();
const supabaseKey = env.match(/SUPABASE_SERVICE_ROLE_KEY=(.*)/);
if (!supabaseKey) { console.log('No service role key found'); process.exit(0); }
const supabase = createClient(supabaseUrl, supabaseKey[1].trim());

async function test() {
  const { data: logs } = await supabase.from('attendance_logs').select('date').order('date', { ascending: false }).limit(20);
  const { data: smart } = await supabase.from('smartoffice_device_logs').select('log_date_only').order('log_date_only', { ascending: false }).limit(20);
  console.log('Attendance dates:', [...new Set((logs || []).map(s => s.date))]);
  console.log('Smartoffice dates:', [...new Set((smart || []).map(s => s.log_date_only))]);
}
test();
