import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'fs';

// Read .env manually
const envContent = readFileSync('.env', 'utf-8');
const env = {};
envContent.split('\n').forEach(line => {
  const [key, ...rest] = line.split('=');
  if (key && rest.length) {
    env[key.trim()] = rest.join('=').trim();
  }
});

const supabase = createClient(
  env['EXPO_PUBLIC_SUPABASE_URL'],
  env['EXPO_PUBLIC_SUPABASE_ANON_KEY']
);

async function main() {
  // 1. Get all profiles with their smartoffice codes
  const { data: allProfiles, error } = await supabase
    .from('profiles')
    .select('id, name, employee_number, smartoffice_employee_code')
    .eq('is_active', true)
    .order('name');

  if (error) {
    console.error('Error:', error);
    return;
  }

  console.log('=== ALL ACTIVE PROFILES ===');
  console.log(JSON.stringify(allProfiles, null, 2));

  // 2. Get unmapped profiles
  const unmapped = allProfiles.filter(p => !p.smartoffice_employee_code);
  console.log('\n=== UNMAPPED PROFILES ===');
  console.log(JSON.stringify(unmapped, null, 2));
  console.log(`\nTotal active: ${allProfiles.length}`);
  console.log(`Unmapped: ${unmapped.length}`);
}

main();