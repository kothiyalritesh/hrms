const fs = require('fs');
const env = fs.readFileSync('.env', 'utf8');
const urlMatch = env.match(/EXPO_PUBLIC_SUPABASE_URL=(.*)/);
const keyMatch = env.match(/EXPO_PUBLIC_SUPABASE_ANON_KEY=(.*)/);
const { createClient } = require('@supabase/supabase-js');
const supabase = createClient(urlMatch[1].trim(), keyMatch[1].trim());

async function test() {
  const { data: { user }, error: authErr } = await supabase.auth.signInWithPassword({
    phone: '9000000001',
    password: 'password123'
  });
  if (authErr) { console.log('Auth error:', authErr); return; }
  
  const { data, error } = await supabase.rpc('rpc_admin_attendance_daily_v3', {
    p_start: '2026-09-01', p_end: '2026-09-25'
  });
  console.log('Error:', error);
  console.log('Data length:', data ? data.length : null);
}
test();
