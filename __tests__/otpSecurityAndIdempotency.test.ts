import fs from "fs";
import path from "path";

const read = (relativePath: string) =>
  fs.readFileSync(path.resolve(__dirname, "..", relativePath), "utf8");

describe("OTP Security, Idempotency & Architecture", () => {
  const edgeFunction = read("supabase/functions/otp-auth/index.ts");
  const phpProxy = read("public/otp-proxy.php");
  const authContext = read("contexts/AuthContext.tsx");
  const loginScreen = read("screens/LoginScreen.tsx");
  const migration = read(
    "supabase/migrations/20260911010000_otp_idempotency_and_security.sql",
  );

  it("centralizes all OTP generation and verification in the Edge Function", () => {
    expect(edgeFunction).toContain("Deno.serve");
    expect(edgeFunction).toContain("action === \"request\"");
    expect(edgeFunction).toContain("action === \"verify\"");
    expect(edgeFunction).toContain("hashOtp(phone, otp, salt)");
    expect(edgeFunction).toContain("crypto.getRandomValues");

    // PHP Proxy must not generate OTPs or touch database directly
    expect(phpProxy).not.toContain("generate_otp");
    expect(phpProxy).not.toContain("service_role");
    expect(phpProxy).not.toContain("PostgREST");
    expect(phpProxy).toContain("/functions/v1/otp-auth");
  });

  it("enforces idempotency and request deduplication in Edge Function & Migration", () => {
    expect(migration).toContain("ADD COLUMN IF NOT EXISTS request_id TEXT");
    expect(migration).toContain("ADD COLUMN IF NOT EXISTS resend_count INTEGER");
    expect(migration).toContain("idx_otp_request_id");
    expect(edgeFunction).toContain("requestId");
    expect(edgeFunction).toContain(".eq(\"request_id\", requestId)");
    expect(edgeFunction).toContain("retry_after");
    expect(edgeFunction).toContain("challenge_id: insertedChallenge.id");
  });

  it("enforces IP rate limiting on PHP proxy and phone rate limiting on Edge Function", () => {
    expect(phpProxy).toContain("IP_RATE_LIMITED");
    expect(phpProxy).toContain("429");
    expect(edgeFunction).toContain("RATE_LIMITED");
    expect(edgeFunction).toContain("429");
    expect(edgeFunction).toContain("challenge.attempts >= 5");
  });

  it("wires request_id, challenge_id, and retry_after through AuthContext and LoginScreen", () => {
    expect(authContext).toContain("request_id: requestId");
    expect(authContext).toContain("challenge_id: challengeId");
    expect(authContext).toContain("challenge_id: data?.challenge_id");
    expect(authContext).toContain("retry_after: data?.retry_after");
    expect(loginScreen).toContain("challengeId");
    expect(loginScreen).toContain("startResendTimer(retry_after ?? 30)");
  });

  it("strictly prohibits plaintext OTP storage in database", () => {
    expect(edgeFunction).toContain("otp_hash: otpHash");
    expect(edgeFunction).toContain("salt");
    expect(edgeFunction).not.toContain("otp: otp,");
    expect(migration).toContain("otp_hash TEXT NOT NULL");
  });
});

