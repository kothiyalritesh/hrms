const { createClient } = require('@supabase/supabase-js');
const supabaseUrl = 'https://fuchvtzbgwzdpzfaizbj.supabase.co';
const supabaseKey = 'sb_publishable_SVIfa_ezLPPgKaQ7xlw3mA_uS2_p4PX';
const supabase = createClient(supabaseUrl, supabaseKey);

async function test() {
  const { data, error } = await supabase.from('attendance_logs').select('date, status').order('date', { ascending: false }).limit(5);
  console.log('Most recent logs:', data, error);
}
test();
