const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = 'https://fuchvtzbgwzdpzfaizbj.supabase.co';
const supabaseAnonKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZ1Y2h2dHpiZ3d6ZHB6ZmFpemJqIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTIzODA5MTksImV4cCI6MjA2Nzk1NjkxOX0.SVIfa_ezLPPgKaQ7xlw3mA_uS2_p4PXl5EMF4pSCAWU';

// Simulated storage like secureStorage / persistentAuthStorage
const mockStorage = {
  store: {},
  async getItem(key) {
    console.log('[Storage] getItem:', key);
    return this.store[key] || null;
  },
  async setItem(key, value) {
    console.log('[Storage] setItem:', key, 'length:', value.length);
    this.store[key] = value;
  },
  async removeItem(key) {
    console.log('[Storage] removeItem:', key);
    delete this.store[key];
  }
};

const supabaseAuthStorageKey = `sb-${new URL(supabaseUrl).hostname.split('.')[0]}-auth-token`;

const client = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    storage: mockStorage,
    storageKey: supabaseAuthStorageKey,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,
    flowType: 'implicit'
  }
});

async function main() {
  // Let's test with a fake token_hash first to see what verifyOtp logs/returns
  const res = await client.auth.verifyOtp({
    token_hash: 'abc123def456',
    type: 'magiclink'
  });
  console.log('Result with fake token:', JSON.stringify(res, null, 2));
}

main().catch(console.error);

