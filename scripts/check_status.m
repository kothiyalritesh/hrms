import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'fs';

const envContent = readFileSync('.env', 'utf-8');
const env = {};
envContent.split('\n').forEach(line => {
  const [key, ...rest] = line.split('=');
  if (key && rest.length) {
    env[key.trim()] = rest.join('=').trim();
  }
});

const supabase = createClient(env['EXPO_PUBLIC_SUPABASE_URL'], env['EXPO_PUBLIC_SUPABASE_ANON_KEY']);

async function main() {
  // Get ALL profiles with their smartoffice codes
  const { data: allProfiles } = await supabase
    .from('profiles')
    .select('id, name, employee_number, smartoffice_employee_code')
    .eq('is_active', true)
    .order('name');

  // Get mapped and unmapped
  const mapped = allProfiles.filter(p => p.smartoffice_employee_code);
  const unmapped = allProfiles.filter(p => !p.smartoffice_employee_code);

  console.log(`Total active profiles: ${allProfiles.length}`);
  console.log(`Already mapped: ${mapped.length}`);
  console.log(`Still unmapped: ${unmapped.length}`);
  
  // Show what codes are already mapped
  const usedCodes = new Map();
  for (const p of mapped) {
    usedCodes.set(p.smartoffice_employee_code, p.name);
  }
  
  console.log('\n=== CODES ALREADY IN USE ===');
  for (const [code, name] of [...usedCodes.entries()].sort()) {
    console.log(`  ${code.padEnd(10)} → ${name}`);
  }

  console.log('\n\n=== UNMAPPED PROFILES (need mapping) ===');
  for (const p of unmapped) {
    // Skip system accounts
    if (p.name === 'Admin') continue;
    console.log(`  "${p.name}"  | emp#: ${p.employee_number || 'N/A'}  | id: ${p.id}`);
  }
}

main();