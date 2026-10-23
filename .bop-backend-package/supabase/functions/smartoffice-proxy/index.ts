import { createClient } from "npm:@supabase/supabase-js@2.39.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const allowedEndpoints = new Set([
  "/api/v2/WebAPI/GetDeviceLogs",
  "/api/v2/WebAPI/GetEmployeeDetails",
  "/api/v2/WebAPI/GetEmployeeAttendanceLogs",
]);

const allowedRoles = new Set(["SYSTEM_ADMIN", "ADMIN", "HR", "HRD"]);
const FUNCTION_VERSION = "20260801.1";
const REQUIRED_BACKEND_SCHEMA_VERSION = "20260810000000";

type SmartOfficeConfig = {
  url?: string;
  api_key?: string;
  account_name?: string | null;
};

function json(body: unknown, status: number) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }
  if (request.method === "POST") {
    try {
      const body = await request.json();
      if (body?.action === "version") {
        return json(
          {
            success: true,
            function: "smartoffice-proxy",
            version: FUNCTION_VERSION,
            requiredBackendSchemaVersion: REQUIRED_BACKEND_SCHEMA_VERSION,
          },
          200,
        );
      }
    } catch {
      // The standard error response below does not disclose service details.
    }
    return json({ success: false, error: "INVALID_ACTION" }, 400);
  }
  if (request.method !== "GET") {
    return json({ error: "METHOD_NOT_ALLOWED" }, 405);
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !anonKey || !serviceRoleKey) {
    return json({ error: "SERVER_NOT_CONFIGURED" }, 503);
  }

  const admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  let smartOfficeUrl = Deno.env.get("SMARTOFFICE_URL")?.trim();
  let smartOfficeApiKey = Deno.env.get("SMARTOFFICE_API_KEY")?.trim();
  let smartOfficeAccount = Deno.env
    .get("SMARTOFFICE_API_ACCOUNT_NAME")
    ?.trim();

  // Existing projects may keep this server-only integration configuration in
  // Database Vault instead of Edge Function secrets. Only the service role can
  // execute the RPC; no credential is returned to the browser.
  if (!smartOfficeUrl || !smartOfficeApiKey) {
    const { data, error } = await admin.rpc(
      "rpc_get_smartoffice_proxy_config",
    );
    if (error) {
      return json({ error: "SERVER_NOT_CONFIGURED" }, 503);
    }
    const raw = Array.isArray(data) ? data[0] : data;
    const config = (raw ?? {}) as SmartOfficeConfig;
    smartOfficeUrl = config.url?.trim();
    smartOfficeApiKey = config.api_key?.trim();
    smartOfficeAccount = config.account_name?.trim() || undefined;
  }

  if (!smartOfficeUrl || !smartOfficeApiKey) {
    return json({ error: "SERVER_NOT_CONFIGURED" }, 503);
  }

  const authHeader = request.headers.get("authorization") ?? "";
  const accessToken = authHeader.replace(/^Bearer\s+/i, "").trim();
  if (!accessToken) return json({ error: "UNAUTHORIZED" }, 401);

  if (accessToken !== serviceRoleKey) {
    const authClient = createClient(supabaseUrl, anonKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data: authData, error: authError } =
      await authClient.auth.getUser(accessToken);
    if (authError || !authData.user) {
      return json({ error: "UNAUTHORIZED" }, 401);
    }

    const { data: profile } = await admin
      .from("profiles")
      .select("role,is_active")
      .eq("id", authData.user.id)
      .maybeSingle();
    if (!profile?.is_active || !allowedRoles.has(profile.role)) {
      return json({ error: "FORBIDDEN" }, 403);
    }
  }

  const incomingUrl = new URL(request.url);
  const endpoint = incomingUrl.pathname.replace(
    /^.*\/smartoffice-proxy/,
    "",
  );
  if (!allowedEndpoints.has(endpoint)) {
    return json({ error: "ENDPOINT_NOT_ALLOWED" }, 404);
  }

  const target = new URL(endpoint, smartOfficeUrl);
  target.searchParams.set("APIKey", smartOfficeApiKey);
  for (const key of ["FromDate", "ToDate", "EmployeeCode"]) {
    const value = incomingUrl.searchParams.get(key);
    if (value) target.searchParams.set(key, value);
  }
  if (smartOfficeAccount && endpoint !== "/api/v2/WebAPI/GetDeviceLogs") {
    target.searchParams.set("APIAccountName", smartOfficeAccount);
  }

  try {
    const response = await fetch(target, {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(20_000),
    });
    return new Response(await response.text(), {
      status: response.status,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    // Say which: no answer in time (server slow/asleep) or no connection at all.
    if (error instanceof DOMException && error.name === "TimeoutError") {
      return json({ error: "SMARTOFFICE_TIMEOUT" }, 504);
    }
    return json({ error: "SMARTOFFICE_UNREACHABLE" }, 502);
  }
});
