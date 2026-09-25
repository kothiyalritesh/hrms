import { supabase } from './lib/supabase';
async function test() {
  const { data, error } = await supabase.rpc('rpc_admin_attendance_daily_v3', {
    p_start: '2026-09-25',
    p_end: '2026-09-25',
    p_offset: 0,
    p_limit: 10
  });
  console.log(JSON.stringify({data, error}, null, 2));
}
test();
