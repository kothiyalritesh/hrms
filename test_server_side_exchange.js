const { createClient } = require('@supabase/supabase-js');

const PROXY_URL = "https://bop.in/HRMS/otp-proxy.php";
const SUPABASE_URL = "https://fuchvtzbgwzdpzfaizbj.supabase.co";
const ANON_KEY = "sb_publishable_SVIfa_ezLPPgKaQ7xlw3mA_uS2_p4PX";

const store = {};
const mockStorage = {
  async getItem(k) { return store[k] || null; },
  async setItem(k, v) { store[k] = v; },
  async removeItem(k) { delete store[k]; }
};

const supabase = createClient(SUPABASE_URL, ANON_KEY, {
  auth: { storage: mockStorage, storageKey: 'test-token', autoRefreshToken: true, persistSession: true, detectSessionInUrl: false }
});

async function main() {
  // 1. Request OTP
  const req = await fetch(PROXY_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "request", phone: "9999999999" }),
  }).then(r => r.json());

  // 2. Verify OTP -> get token_hash
  const ver = await fetch(PROXY_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      action: "verify",
      phone: "9999999999",
      otp: "000011",
      challenge_id: req.challenge_id,
    }),
  }).then(r => r.json());

  console.log("token_hash:", ver.auth.token_hash);

  // 3. Server-side exchange token_hash -> session tokens
  const verifyRes = await fetch(`${SUPABASE_URL}/auth/v1/verify`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      apikey: ANON_KEY,
      Authorization: `Bearer ${ANON_KEY}`,
    },
    body: JSON.stringify({
      token_hash: ver.auth.token_hash,
      type: "magiclink",
    }),
  });
  const sessionResult = await verifyRes.json();
  console.log("Exchange status:", verifyRes.status);
  console.log("Access token received:", !!sessionResult.access_token);

  // 4. Client calls setSession
  const { data, error } = await supabase.auth.setSession({
    access_token: sessionResult.access_token,
    refresh_token: sessionResult.refresh_token,
  });

  console.log("Client setSession error:", error);
  console.log("Client session established:", !!data.session);
  console.log("Client user id:", data.session?.user?.id);

  // 5. Test authenticated RPC or query
  const { data: profile, error: pError } = await supabase
    .from("profiles")
    .select("id, name, role")
    .eq("id", data.session?.user?.id)
    .single();

  console.log("Authenticated query profile:", profile, "pError:", pError);
}

main().catch(console.error);

