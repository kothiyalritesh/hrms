const { createClient } = require('@supabase/supabase-js');

const PROXY_URL = "https://bop.in/HRMS/otp-proxy.php";
const SUPABASE_URL = "https://fuchvtzbgwzdpzfaizbj.supabase.co";
const ANON_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZ1Y2h2dHpiZ3d6ZHB6ZmFpemJqIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTIzODA5MTksImV4cCI6MjA2Nzk1NjkxOX0.SVIfa_ezLPPgKaQ7xlw3mA_uS2_p4PXl5EMF4pSCAWU";

const mockStorage = {
  store: {},
  async getItem(key) { return this.store[key] || null; },
  async setItem(key, value) { this.store[key] = value; },
  async removeItem(key) { delete this.store[key]; }
};

const supabaseAuthStorageKey = `sb-${new URL(SUPABASE_URL).hostname.split('.')[0]}-auth-token`;

const supabase = createClient(SUPABASE_URL, ANON_KEY, {
  auth: {
    storage: mockStorage,
    storageKey: supabaseAuthStorageKey,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,
    flowType: "implicit",
  },
});

async function main() {
  console.log("1. Request OTP for 9999999999...");
  const reqRes = await fetch(PROXY_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "request", phone: "9999999999" }),
  });
  const reqJson = await reqRes.json();
  console.log("Request result:", reqJson);
  const challengeId = reqJson.challenge_id;

  console.log("\n2. Verify OTP 000011 for 9999999999...");
  const verRes = await fetch(PROXY_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      action: "verify",
      phone: "9999999999",
      otp: "000011",
      challenge_id: challengeId,
    }),
  });
  const verJson = await verRes.json();
  console.log("Verify result:", verJson.success ? "SUCCESS" : verJson);
  console.log("token_hash:", verJson?.auth?.token_hash);
  console.log("auth type:", verJson?.auth?.type);

  console.log("\n3. Testing supabase.auth.verifyOtp with supabase client...");
  const verifyOtpResult = await supabase.auth.verifyOtp({
    token_hash: verJson.auth.token_hash,
    type: "magiclink",
  });
  console.log("verifyOtp Result:");
  console.log("session:", verifyOtpResult.data?.session ? "EXISTS (user: " + verifyOtpResult.data?.user?.id + ")" : "NULL");
  console.log("error:", verifyOtpResult.error);
}

main().catch(console.error);

