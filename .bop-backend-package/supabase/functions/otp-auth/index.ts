import { createClient } from "npm:@supabase/supabase-js@2.39.0";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};
const reply = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, "Content-Type": "application/json" },
  });
const hex = (bytes: Uint8Array) =>
  Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
const normalizePhone = (value: unknown) => {
  const digits = String(value ?? "").replace(/\D/g, "");
  return digits.length === 12 && digits.startsWith("91")
    ? digits.slice(2)
    : digits;
};
const SYSTEM_ADMIN_PHONE = "9999999999";
async function hashOtp(phone: string, otp: string, salt: string) {
  const input = new TextEncoder().encode(`${phone}:${otp}:${salt}`);
  return hex(new Uint8Array(await crypto.subtle.digest("SHA-256", input)));
}

async function createAuthSession(db: any, profile: any, phone: string) {
  const authEmail = `employee-${profile.id}@auth.realtyhrm.invalid`;
  const { data: existingAuth } = await db.auth.admin.getUserById(profile.id);
  if (!existingAuth.user) {
    const { error: createError } = await db.auth.admin.createUser({
      id: profile.id,
      email: authEmail,
      email_confirm: true,
      user_metadata: { profile_id: profile.id, phone },
    });
    if (createError) throw createError;
  }
  const email = existingAuth.user?.email || authEmail;
  const { data: link, error: linkError } = await db.auth.admin.generateLink({
    type: "magiclink",
    email,
  });
  if (linkError || !link?.properties?.hashed_token)
    throw linkError || new Error("Unable to create secure session");
  return {
    email,
    token_hash: link.properties.hashed_token,
    type: "magiclink",
  };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });
  if (req.method !== "POST")
    return reply({ success: false, error: "METHOD_NOT_ALLOWED" }, 405);
  try {
    const body = await req.json();
    if (body?.action === "version") {
      return reply({
        success: true,
        function: "otp-auth",
        version: "20260731.1",
        requiredBackendSchemaVersion: "20260810000000",
      });
    }
    const url = Deno.env.get("SUPABASE_URL");
    const roleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    const configuredSmsKey = Deno.env.get("SMS_OTP_API_KEY");
    if (!url || !roleKey)
      throw new Error("Supabase server secrets are not configured");
    const db = createClient(url, roleKey, { auth: { persistSession: false } });
    const smsKey = configuredSmsKey;
    const action = String(body.action ?? "");
    const phone = normalizePhone(body.phone);
    const phoneCandidates = [phone, `91${phone}`, `+91${phone}`];
    const ip =
      req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null;
    if (!/^\d{10}$/.test(phone))
      return reply(
        {
          success: false,
          error: "INVALID_PHONE",
          message: "Enter a valid 10-digit phone number.",
        },
        400,
      );

    if (action === "request") {
      const since = new Date(Date.now() - 10 * 60_000).toISOString();
      const { count } = await db
        .from("otp_login_challenges")
        .select("id", { count: "exact", head: true })
        .eq("phone", phone)
        .gte("created_at", since);
      if ((count ?? 0) >= 3)
        return reply(
          {
            success: false,
            error: "RATE_LIMITED",
            message: "Too many OTP requests. Try again in 10 minutes.",
          },
          429,
        );
      const { data: profile } = await db
        .from("profiles")
        .select("id,role")
        .in("phone", phoneCandidates)
        .eq("is_active", true)
        .maybeSingle();
      if (!profile)
        return reply({
          success: true,
          message: "If this number is registered, an OTP has been sent.",
        });

      const isSystemAdmin = phone === SYSTEM_ADMIN_PHONE;
      if (isSystemAdmin && profile.role !== "SYSTEM_ADMIN")
        return reply(
          {
            success: false,
            error: "SYSTEM_ADMIN_NOT_CONFIGURED",
            message: "The system administrator account is not configured.",
          },
          403,
        );
      if (isSystemAdmin) {
        const { data: credential, error: credentialError } = await db
          .from("system_admin_login_credentials")
          .select("profile_id")
          .eq("profile_id", profile.id)
          .eq("phone", phone)
          .eq("enabled", true)
          .maybeSingle();
        if (credentialError) throw credentialError;
        if (!credential)
          return reply(
            {
              success: false,
              error: "SYSTEM_ADMIN_OTP_NOT_CONFIGURED",
              message: "The system administrator OTP is not configured.",
            },
            503,
          );
      }
      if (!isSystemAdmin && !smsKey)
        return reply(
          {
            success: false,
            error: "SMS_NOT_CONFIGURED",
            message: "SMS OTP is not configured.",
          },
          503,
        );

      const otp = (
        crypto.getRandomValues(new Uint32Array(1))[0] % 1_000_000
      )
        .toString()
        .padStart(6, "0");
      const salt = hex(crypto.getRandomValues(new Uint8Array(16)));
      const otpHash = await hashOtp(phone, otp, salt);
      const { error: insertError } = await db
        .from("otp_login_challenges")
        .insert({
          phone,
          otp_hash: otpHash,
          salt,
          requested_ip: ip,
          expires_at: new Date(Date.now() + 5 * 60_000).toISOString(),
        });
      if (insertError) throw insertError;
      if (isSystemAdmin)
        return reply({
          success: true,
          message: "Enter the administrator OTP.",
        });

      const sms = await fetch("https://smsapi.edumarcsms.com/api/v1/sendsms", {
        method: "POST",
        headers: { "Content-Type": "application/json", apikey: smsKey },
        body: JSON.stringify({
          number: [phone],
          message: `Your verification code is : ${otp} Regards BOP REALTY`,
          senderId: "REABOP",
          templateId: "1607100000000223009",
        }),
      });
      if (!sms.ok) {
        await db
          .from("otp_login_challenges")
          .delete()
          .eq("phone", phone)
          .eq("otp_hash", otpHash);
        return reply(
          {
            success: false,
            error: "SMS_FAILED",
            message: "OTP delivery failed. Please try again.",
          },
          502,
        );
      }
      return reply({ success: true, message: "OTP sent." });
    }

    if (action === "verify") {
      const otp = String(body.otp ?? "").trim();
      if (!/^\d{6}$/.test(otp))
        return reply(
          {
            success: false,
            error: "INVALID_OTP",
            message: "Enter the 6-digit OTP.",
          },
          400,
        );
      const { data: challenge } = await db
        .from("otp_login_challenges")
        .select("*")
        .eq("phone", phone)
        .is("consumed_at", null)
        .gt("expires_at", new Date().toISOString())
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (!challenge || challenge.attempts >= 5)
        return reply(
          {
            success: false,
            error: "OTP_EXPIRED",
            message: "OTP expired or locked. Request a new code.",
          },
          401,
        );
      const isSystemAdmin = phone === SYSTEM_ADMIN_PHONE;
      let systemAdminCredential: any = null;
      let expectedOtpHash = challenge.otp_hash;
      let suppliedOtpHash = await hashOtp(phone, otp, challenge.salt);
      if (isSystemAdmin) {
        const { data: credential, error: credentialError } = await db
          .from("system_admin_login_credentials")
          .select("profile_id,otp_hash,salt")
          .eq("phone", phone)
          .eq("enabled", true)
          .maybeSingle();
        if (credentialError) throw credentialError;
        if (!credential)
          return reply(
            {
              success: false,
              error: "SYSTEM_ADMIN_OTP_NOT_CONFIGURED",
              message: "The system administrator OTP is not configured.",
            },
            503,
          );
        systemAdminCredential = credential;
        expectedOtpHash = credential.otp_hash;
        suppliedOtpHash = await hashOtp(phone, otp, credential.salt);
      }
      if (suppliedOtpHash !== expectedOtpHash) {
        await db
          .from("otp_login_challenges")
          .update({ attempts: challenge.attempts + 1 })
          .eq("id", challenge.id);
        return reply(
          { success: false, error: "INCORRECT_OTP", message: "Incorrect OTP." },
          401,
        );
      }
      await db
        .from("otp_login_challenges")
        .update({ consumed_at: new Date().toISOString() })
        .eq("id", challenge.id);
      const { data: profile } = await db
        .from("profiles")
        .select("id,name,email,phone,role,avatar,is_active,created_at")
        .in("phone", phoneCandidates)
        .eq("is_active", true)
        .maybeSingle();
      if (!profile)
        return reply(
          {
            success: false,
            error: "USER_NOT_FOUND",
            message: "User not found.",
          },
          404,
        );
      if (
        isSystemAdmin &&
        (profile.id !== systemAdminCredential.profile_id ||
          profile.role !== "SYSTEM_ADMIN")
      )
        return reply(
          {
            success: false,
            error: "SYSTEM_ADMIN_NOT_CONFIGURED",
            message: "The system administrator account is not configured.",
          },
          403,
        );

      return reply({
        success: true,
        profile,
        auth: await createAuthSession(db, profile, phone),
      });
    }
    return reply({ success: false, error: "INVALID_ACTION" }, 400);
  } catch (error) {
    console.error("otp-auth error", error);
    return reply(
      {
        success: false,
        error: "SERVER_ERROR",
        message: "OTP service is temporarily unavailable.",
      },
      500,
    );
  }
});
