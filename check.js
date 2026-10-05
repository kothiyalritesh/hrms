const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const env = fs.readFileSync('.env', 'utf8');
const urlMatch = env.match(/EXPO_PUBLIC_SUPABASE_URL=([^\r\n]+)/);
const keyMatch = env.match(/EXPO_PUBLIC_SUPABASE_ANON_KEY=([^\r\n]+)/);
const supabase = createClient(urlMatch[1], keyMatch[1]);

async function check() {
  const { data, error } = await supabase.from('profiles').select('id, name, weekly_off_day').not('weekly_off_day', 'is', null).limit(5);
  console.log('With weekly_off_day:', data);
  const { data: all } = await supabase.from('profiles').select('id, name, weekly_off_day').limit(5);
  console.log('All:', all);
}
check();
