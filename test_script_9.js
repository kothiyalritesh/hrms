const { createClient } = require('@supabase/supabase-js');
const supabase = createClient('https://fuchvtzbgwzdpzfaizbj.supabase.co', 'sb_publishable_SVIfa_ezLPPgKaQ7xlw3mA_uS2_p4PX');
async function test() {
  const { data, error } = await supabase.from('site_visit_live_locations').select('user_id').limit(1);
  console.log('site_visit_live_locations:', data, error);
}
test();
