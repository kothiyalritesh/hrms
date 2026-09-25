const { createClient } = require('@supabase/supabase-js');
const supabaseUrl = 'https://fuchvtzbgwzdpzfaizbj.supabase.co';
const supabaseKey = 'sb_publishable_SVIfa_ezLPPgKaQ7xlw3mA_uS2_p4PX';
const supabase = createClient(supabaseUrl, supabaseKey);

async function test() {
  const d = new Date().toISOString().split('T')[0];
  const { data, error } = await supabase.from('attendance_logs').select('count', { count: 'exact' }).eq('date', d).eq('status', 'CHECKED_IN');
  console.log('Checked in today:', data, error);
}
test();
