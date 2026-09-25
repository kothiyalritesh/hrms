/**
 * Fixed debug script — send ONLY token_hash and type (no redirect_to)
 */

const PROXY_URL = "https://bop.in/HRMS/otp-proxy.php";
const SUPABASE_URL = "https://fuchvtzbgwzdpzfaizbj.supabase.co";
const ANON_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZ1Y2h2dHpiZ3d6ZHB6ZmFpemJqIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTIzODA5MTksImV4cCI6MjA2Nzk1NjkxOX0.SVIfa_ezLPPgKaQ7xlw3mA_uS2_p4PXl5EMF4pSCAWU";
const TEST_PHONE = "7830580839";
const TEST_OTP = process.argv[2];

if (!TEST_OTP) {
  console.error("Usage: node debug_auth2.js <OTP>");
  process.exit(1);
}

async function main() {
  // Step 1: Request OTP
  console.log("=== STEP 1: Request OTP ===");
  const reqRes = await fetch(PROXY_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "request", phone: TEST_PHONE }),
  });
  const reqJson = await reqRes.json();
  console.log("Status:", reqRes.status, reqJson.success ? "✅" : "❌");
  if (!reqJson.success) { console.error(reqJson); return; }
  const challengeId = reqJson.challenge_id;

  // Step 2: Verify OTP
  console.log("\n=== STEP 2: Verify OTP with:", TEST_OTP, "===");
  const verRes = await fetch(PROXY_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "verify", phone: TEST_PHONE, otp: TEST_OTP, challenge_id: challengeId }),
  });
  const verJson = await verRes.json();
  console.log("Status:", verRes.status, verJson.success ? "✅" : "❌");
  console.log("Profile:", verJson?.profile?.name, "| Role:", verJson?.profile?.role);
  if (!verJson.success) { console.error(verJson); return; }

  const tokenHash = verJson?.auth?.token_hash;
  console.log("token_hash:", tokenHash ? tokenHash.substring(0, 20) + "..." : "MISSING ❌");
  if (!tokenHash) return;

  // Step 3: verifyOtp — ONLY token_hash + type
  console.log("\n=== STEP 3: supabase /auth/v1/verify (token_hash + type ONLY) ===");
  const otpRes = await fetch(`${SUPABASE_URL}/auth/v1/verify`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      apikey: ANON_KEY,
      Authorization: `Bearer ${ANON_KEY}`,
    },
    body: JSON.stringify({ token_hash: tokenHash, type: "magiclink" }),
  });
  const otpJson = await otpRes.json();
  console.log("Status:", otpRes.status);
  if (otpRes.status === 200 && otpJson.access_token) {
    console.log("✅ SESSION ESTABLISHED!");
    console.log("User ID:", otpJson.user?.id);
    console.log("User email:", otpJson.user?.email);
    console.log("Access token (first 30):", otpJson.access_token?.substring(0, 30) + "...");
  } else {
    console.error("❌ verifyOtp failed:", JSON.stringify(otpJson, null, 2));
    // Check if email auth is enabled
    if (otpJson.msg?.includes("Email") || otpJson.error_code?.includes("email")) {
      console.log("\n⚠️  DIAGNOSIS: Email auth provider may be DISABLED in Supabase.");
      console.log("Go to: https://supabase.com/dashboard/project/fuchvtzbgwzdpzfaizbj/auth/providers");
      console.log("Make sure 'Email' provider is ENABLED.");
    }
  }
}

main().catch(console.error);

