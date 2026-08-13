// @ts-nocheck -- source-level regression guard for the Deno Edge Function.
import fs from "fs";
import path from "path";

const read = (relativePath: string) =>
  fs.readFileSync(path.resolve(__dirname, "..", relativePath), "utf8");

describe("protected system administrator OTP", () => {
  const edgeFunction = read("supabase/functions/otp-auth/index.ts");
  const authContext = read("contexts/AuthContext.tsx");
  const loginScreen = read("screens/LoginScreen.tsx");
  const protectedAdminMigration = read(
    "supabase/migrations/20260731026000_authoritative_privileged_sessions.sql",
  );
  const credentialMigration = read(
    "supabase/migrations/20260803010000_protected_system_admin_login.sql",
  );

  it("stores only a private salted verifier and never exposes the fixed OTP", () => {
    expect(edgeFunction).toContain('from("system_admin_login_credentials")');
    expect(edgeFunction).not.toContain("000011");
    expect(credentialMigration).not.toContain("000011");
    expect(authContext).not.toContain("000011");
    expect(loginScreen).not.toContain("000011");
    expect(credentialMigration).toContain(
      "alter table public.system_admin_login_credentials enable row level security",
    );
    expect(credentialMigration).toContain(
      "grant select on public.system_admin_login_credentials to service_role",
    );
  });

  it("requires a fresh rate-limited challenge for the protected admin profile", () => {
    expect(edgeFunction).toContain(
      'const SYSTEM_ADMIN_PHONE = "9999999999"',
    );
    expect(edgeFunction).toContain('profile.role !== "SYSTEM_ADMIN"');
    expect(edgeFunction).toContain('.from("otp_login_challenges")');
    expect(edgeFunction).toContain("expires_at: new Date(Date.now() + 5 * 60_000)");
    expect(edgeFunction).toContain("challenge.attempts >= 5");
    expect(edgeFunction).toContain("await hashOtp(phone, otp, challenge.salt)");
  });

  it("keeps the designated account active and protected from demotion", () => {
    expect(protectedAdminMigration).toContain("'9999999999'");
    expect(protectedAdminMigration).toContain(
      "'Designated 9999999999 bootstrap system account'",
    );
    expect(protectedAdminMigration).toContain(
      "PROTECTED_SYSTEM_ADMIN_CANNOT_BE_DEMOTED",
    );
  });
});
