/**
 * Debug script: diagnose "Unable to establish a secure session" error
 * Run: node debug_auth.js
 */

const PROXY_URL = "https://bop.in/HRMS/otp-proxy.php";
const SUPABASE_URL = "https://fuchvtzbgwzdpzfaizbj.supabase.co";
const ANON_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZ1Y2h2dHpiZ3d6ZHB6ZmFpemJqIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTIzODA5MTksImV4cCI6MjA2Nzk1NjkxOX0.SVIfa_ezLPPgKaQ7xlw3mA_uS2_p4PXl5EMF4pSCAWU";
const TEST_PHONE = "7830580839";

async function main() {
  console.log("=== STEP 1: Request OTP ===");
  const reqRes = await fetch(PROXY_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "request", phone: TEST_PHONE }),
  });
  const reqJson = await reqRes.json();
  console.log("Status:", reqRes.status);
  console.log("Response:", JSON.stringify(reqJson, null, 2));

  if (!reqJson.success) {
    console.error("\n❌ OTP request failed. Cannot proceed.");
    return;
  }

  const challengeId = reqJson.challenge_id;
  console.log("\nChallenge ID:", challengeId);
  console.log("\n⚠️  An OTP has been sent to", TEST_PHONE);
  console.log("Enter the OTP below (or press Ctrl+C to exit):");

  // Read OTP from stdin
  const otp = await new Promise((resolve) => {
    process.stdin.resume();
    process.stdin.setEncoding("utf8");
    process.stdout.write("OTP: ");
    process.stdin.once("data", (data) => {
      process.stdin.pause();
      resolve(data.trim());
    });
  });

  console.log("\n=== STEP 2: Verify OTP ===");
  const verRes = await fetch(PROXY_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      action: "verify",
      phone: TEST_PHONE,
      otp,
      challenge_id: challengeId,
    }),
  });
  const verJson = await verRes.json();
  console.log("Status:", verRes.status);
  console.log("Response:", JSON.stringify(verJson, null, 2));

  if (!verJson.success) {
    console.error("\n❌ OTP verification failed at edge function level.");
    return;
  }

  const tokenHash = verJson?.auth?.token_hash;
  console.log("\ntoken_hash received:", tokenHash ? tokenHash.substring(0, 30) + "..." : "MISSING");
  console.log("profile:", JSON.stringify(verJson?.profile, null, 2));

  if (!tokenHash) {
    console.error("\n❌ No token_hash in response. Edge function bug.");
    return;
  }

  console.log("\n=== STEP 3: supabase.auth.verifyOtp ===");
  // Use fetch directly (no supabase-js dependency)
  const otpRes = await fetch(
    `${SUPABASE_URL}/auth/v1/verify`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: ANON_KEY,
        Authorization: `Bearer ${ANON_KEY}`,
      },
      body: JSON.stringify({
        token_hash: tokenHash,
        type: "magiclink",
        redirect_to: SUPABASE_URL,
      }),
    }
  );
  const otpJson = await otpRes.json();
  console.log("Status:", otpRes.status);
  console.log("Response:", JSON.stringify(otpJson, null, 2));

  if (otpRes.status === 200 && otpJson.access_token) {
    console.log("\n✅ Session established! User ID:", otpJson.user?.id);
  } else {
    console.error("\n❌ verifyOtp failed.");
    console.log("\n--- Diagnosis ---");
    if (otpJson.error_code === "otp_expired") {
      console.log("Token has expired. This is likely a timing issue.");
    } else if (otpJson.message?.includes("email")) {
      console.log("Email auth may be disabled on this Supabase project.");
      console.log("Check Supabase Dashboard → Authentication → Providers → Email");
    } else {
      console.log("Unknown error:", otpJson);
    }
  }
}

main().catch(console.error);

