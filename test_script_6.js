const { createClient } = require('@supabase/supabase-js');
const supabase = createClient('https://fuchvtzbgwzdpzfaizbj.supabase.co', 'sb_publishable_SVIfa_ezLPPgKaQ7xlw3mA_uS2_p4PX');
async function test() {
  const d = new Date().toISOString().split('T')[0];
  const { data, error } = await supabase.rpc('rpc_admin_attendance_daily_v3', {
    p_start: d,
    p_end: d,
    p_offset: 0,
    p_limit: 10
  });
  console.log('rpc_admin_attendance_daily_v3 returned', data ? data.length : null, error);
}
test();
