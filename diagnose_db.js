const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');

const env = fs.readFileSync('.env', 'utf8');
const supabaseUrl = env.match(/EXPO_PUBLIC_SUPABASE_URL=(.*)/)[1].trim();
// Use service role key to bypass RLS and diagnose the database state
const supabaseKey = env.match(/SUPABASE_SERVICE_ROLE_KEY=(.*)/);
const key = supabaseKey ? supabaseKey[1].trim() : env.match(/EXPO_PUBLIC_SUPABASE_ANON_KEY=(.*)/)[1].trim();

const supabase = createClient(supabaseUrl, key);

async function diagnose() {
  console.log("Checking admin_grant_permission functions...");
  const { data: funcs, error: err } = await supabase.rpc('exec_sql', { sql: 
    SELECT proname, pg_get_function_arguments(oid) as args 
    FROM pg_proc 
    WHERE proname = 'admin_grant_permission';
  });
  if (funcs) console.log("Functions found:", funcs);
  else console.log("exec_sql failed, trying direct REST call to check...");

  // Try to find what exactly fails with a dummy authenticated call if possible
}
diagnose();
