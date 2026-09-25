const { createClient } = require('@supabase/supabase-js');
const supabase = createClient(
  'https://fuchvtzbgwzdpzfaizbj.supabase.co',
  'sb_publishable_SVIfa_ezLPPgKaQ7xlw3mA_uS2_p4PX'
);
async function check() {
  const { count, error } = await supabase.from('biometric_device_punches').select('*', { count: 'exact', head: true });
  console.log('punches:', count, error);
}
check();