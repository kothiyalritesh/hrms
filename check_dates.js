const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const env = fs.readFileSync('.env', 'utf8');
const supabaseUrl = env.match(/EXPO_PUBLIC_SUPABASE_URL=(.*)/)[1].trim();
const supabaseKey = env.match(/EXPO_PUBLIC_SUPABASE_ANON_KEY=(.*)/)[1].trim();
const supabase = createClient(supabaseUrl, supabaseKey);

async function test() {
  const { data: smart } = await supabase.from('smartoffice_device_logs').select('log_date_only').order('log_date_only', { ascending: false }).limit(20);
  const uniqueDates = [...new Set(smart.map(s => s.log_date_only))];
  console.log('Smartoffice dates:', uniqueDates);
}
test();
