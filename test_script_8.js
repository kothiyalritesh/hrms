const { createClient } = require('@supabase/supabase-js');
const supabase = createClient('https://fuchvtzbgwzdpzfaizbj.supabase.co', 'sb_publishable_SVIfa_ezLPPgKaQ7xlw3mA_uS2_p4PX');
async function test() {
  const { data, error } = await supabase.from('location_tracking').select('id').limit(1);
  console.log('location_tracking:', data, error);
}
test();
