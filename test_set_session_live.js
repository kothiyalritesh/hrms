const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = "https://fuchvtzbgwzdpzfaizbj.supabase.co";
const ANON_KEY = "sb_publishable_SVIfa_ezLPPgKaQ7xlw3mA_uS2_p4PX";
const PROXY_URL = "https://bop.in/HRMS/otp-proxy.php";

const store = {};
const mockStorage = {
  async getItem(k) { return store[k] || null; },
  async setItem(k, v) { store[k] = v; },
  async removeItem(k) { delete store[k]; }
};

const supabase = createClient(SUPABASE_URL, ANON_KEY, {
  auth: { storage: mockStorage, storageKey: 'test-key', autoRefreshToken: true, persistSession: true, detectSessionInUrl: false }
});

async function main() {
  const req = await fetch(PROXY_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "request", phone: "9999999999" })
  }).then(r => r.json());
  console.log("Req:", req);

  const ver = await fetch(PROXY_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "verify", phone: "9999999999", otp: "000011", challenge_id: req.challenge_id })
  }).then(r => r.json());
  console.log("Ver has session:", !!ver.auth?.session?.access_token);

  const { data, error } = await supabase.auth.setSession({
    access_token: ver.auth.session.access_token,
    refresh_token: ver.auth.session.refresh_token,
  });

  console.log("setSession result:", { user: data?.user?.id, error });
}

main().catch(console.error);

