const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');

const env = fs.readFileSync('.env', 'utf8');
const supabaseUrl = env.match(/EXPO_PUBLIC_SUPABASE_URL=(.*)/)[1].trim();
const supabaseKey = env.match(/EXPO_PUBLIC_SUPABASE_ANON_KEY=(.*)/)[1].trim();
const supabase = createClient(supabaseUrl, supabaseKey);

async function test() {
  const userId = '00000000-0000-0000-0000-000000000000';
  console.log('Testing grant for user:', userId);
  const { data, error } = await supabase.rpc('admin_grant_permission', {
    p_user_id: userId,
    p_permission: 'test.perm',
    p_scope: 'GLOBAL',
    p_scope_id: null
  });
  console.log('Grant result:', { data, error });
}
test();
