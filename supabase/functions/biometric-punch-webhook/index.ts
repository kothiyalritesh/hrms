import { createClient } from "npm:@supabase/supabase-js@2.39.0";

const FUNCTION_VERSION = "20260803.1";
const REQUIRED_BACKEND_SCHEMA_VERSION = "20260810000000";
const CORS_HEADERS = {
  "access-control-allow-origin": "*",
  "access-control-allow-headers":
    "authorization,x-client-info,x-supabase-api-version,apikey,content-type,x-smartoffice-webhook-secret",
  "access-control-allow-methods": "POST,OPTIONS",
  "access-control-max-age": "86400",
};

function response(body: unknown, status = 200) {
  return Response.json(body, { status, headers: { ...CORS_HEADERS, "content-type": "application/json" } });
}

function punchRows(body: any) {
  const values = Array.isArray(body) ? body : Array.isArray(body?.punches) ? body.punches : [body];
  return values.map((value: any) => ({
    device_id: String(value.device_id ?? value.DeviceId ?? value.SerialNumber ?? "").trim(),
    biometric_employee_code: String(value.biometric_employee_code ?? value.EmployeeCode ?? "").trim(),
    punch_timestamp: String(value.punch_timestamp ?? value.LogDate ?? "").trim(),
    punch_direction: value.punch_direction ?? value.Direction ?? value.PunchDirection ?? null,
    source_event_id: value.source_event_id ?? value.EventId ?? "",
  }));
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: CORS_HEADERS });
  if (request.method !== "POST") return response({ error: "METHOD_NOT_ALLOWED" }, 405);
  const body = await request.json().catch(() => null);
  if (body?.action === "version") {
    return response({
      success: true,
      function: "biometric-punch-webhook",
      version: FUNCTION_VERSION,
      requiredBackendSchemaVersion: REQUIRED_BACKEND_SCHEMA_VERSION,
    });
  }

  const expectedSecret = Deno.env.get("SMARTOFFICE_WEBHOOK_SECRET") || "";
  const suppliedSecret = request.headers.get("x-smartoffice-webhook-secret") || "";
  if (!expectedSecret || suppliedSecret !== expectedSecret) {
    return response({ error: "UNAUTHORIZED" }, 401);
  }
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceRoleKey) return response({ error: "SERVER_NOT_CONFIGURED" }, 500);

  const punches = punchRows(body);
  if (!punches.length || punches.length > 1000) return response({ error: "INVALID_BATCH_SIZE" }, 400);
  for (const punch of punches) {
    if (!punch.device_id || !punch.biometric_employee_code || Number.isNaN(Date.parse(punch.punch_timestamp))) {
      return response({ error: "INVALID_PUNCH_CONTRACT" }, 400);
    }
  }

  const admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data, error } = await admin.rpc("ingest_biometric_punches", { p_punches: punches });
  if (error) {
    return response({ error: "BIOMETRIC_INGEST_FAILED", message: error.message }, 503);
  }
  const result = Array.isArray(data) ? data[0] : data;
  if (result?.success !== true || result?.transaction_status !== "COMMITTED") {
    return response({ error: "DATABASE_COMMIT_NOT_CONFIRMED" }, 500);
  }
  return response(result);
});
