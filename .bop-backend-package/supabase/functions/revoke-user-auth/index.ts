import { createClient } from "npm:@supabase/supabase-js@2.39.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

const ALLOWED_ROLES = new Set(["SYSTEM_ADMIN", "ADMIN", "HR", "HRD"]);

Deno.serve(async (request: Request) => {
  if (request.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  if (request.method !== "POST") {
    return json({ error: "METHOD_NOT_ALLOWED" }, 405);
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

  if (!supabaseUrl || !serviceRoleKey) {
    return json({ error: "SERVICE_UNAVAILABLE", message: "Missing Supabase configuration." }, 500);
  }

  const admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  // Verify caller identity and permission
  const authHeader = request.headers.get("Authorization") ?? "";
  const token = authHeader.replace(/^Bearer\s+/i, "");

  if (!token) {
    return json({ error: "UNAUTHORIZED", message: "Missing bearer token." }, 401);
  }

  // Check caller role
  const { data: { user: callerUser }, error: callerError } = await admin.auth.getUser(token);
  if (callerError || !callerUser) {
    return json({ error: "UNAUTHORIZED", message: "Invalid token." }, 401);
  }

  const { data: callerProfile } = await admin
    .from("profiles")
    .select("role")
    .eq("id", callerUser.id)
    .single();

  const callerRole = String(callerProfile?.role ?? "").toUpperCase();
  if (!ALLOWED_ROLES.has(callerRole)) {
    // Also check if caller has manage_employee_details permission
    const { data: perm } = await admin
      .from("user_permissions")
      .select("id")
      .eq("user_id", callerUser.id)
      .eq("permission", "manage_employee_details")
      .is("revoked_at", null)
      .maybeSingle();

    if (!perm) {
      return json({ error: "FORBIDDEN", message: "Insufficient permissions to revoke user auth." }, 403);
    }
  }

  let body: { user_id?: string; reason?: string };
  try {
    body = await request.json();
  } catch {
    return json({ error: "INVALID_BODY", message: "Invalid JSON body." }, 400);
  }

  const targetUserId = body.user_id;
  if (!targetUserId) {
    return json({ error: "USER_ID_REQUIRED", message: "Target user_id is required." }, 400);
  }

  try {
    // 1. Invalidate all active sessions for the user
    await admin.auth.admin.signOut(targetUserId, "global");

    // 2. Ban / deactivate user in auth to prevent immediate re-login
    await admin.auth.admin.updateUserById(targetUserId, {
      ban_duration: "876000h", // 100 years
    });

    // 3. Log audit event
    await admin.rpc("log_audit_event", {
      p_action: "AUTH_SESSION_REVOKED",
      p_entity: "profiles",
      p_entity_id: targetUserId,
      p_old_value: null,
      p_new_value: {
        revoked_by: callerUser.id,
        reason: body.reason ?? "EMPLOYEE_EXIT_ARCHIVE",
        timestamp: new Date().toISOString(),
      },
    });

    return json({
      success: true,
      message: `Authentication sessions successfully revoked and user banned for ${targetUserId}.`,
      user_id: targetUserId,
    });
  } catch (err: any) {
    console.error("Failed to revoke user auth:", err);
    return json({ error: "REVOCATION_FAILED", message: err.message }, 500);
  }
});

