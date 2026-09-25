const { createClient } = require('@supabase/supabase-js');
const supabase = createClient('https://fuchvtzbgwzdpzfaizbj.supabase.co', 'sb_publishable_SVIfa_ezLPPgKaQ7xlw3mA_uS2_p4PX');
async function test() {
  const { data, error } = await supabase.rpc('get_business_clock');
  console.log('RPC result:', data, error);
}
test();
