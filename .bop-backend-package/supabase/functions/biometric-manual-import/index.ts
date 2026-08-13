import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const ADMIN_ROLES = new Set([
  "SYSTEM_ADMIN",
  "SUPER_ADMIN",
  "ADMIN",
  "HR",
  "HRD",
]);
const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") {
    return new Response("ok", { headers: CORS_HEADERS });
  }
  if (request.method !== "POST") {
    return Response.json(
      { error: "METHOD_NOT_ALLOWED" },
      { status: 405, headers: CORS_HEADERS },
    );
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !anonKey || !serviceRoleKey) {
    return Response.json(
      { error: "SERVER_NOT_CONFIGURED" },
      { status: 500, headers: CORS_HEADERS },
    );
  }

  const authorization = request.headers.get("authorization") ?? "";
  const userClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authorization } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: userData } = await userClient.auth.getUser();
  if (!userData.user) {
    return Response.json(
      { error: "UNAUTHORIZED" },
      { status: 401, headers: CORS_HEADERS },
    );
  }
  const { data: profile } = await userClient
    .from("profiles")
    .select("role,is_active")
    .eq("id", userData.user.id)
    .maybeSingle();
  if (
    !profile?.is_active ||
    !ADMIN_ROLES.has(String(profile.role).toUpperCase())
  ) {
    return Response.json(
      { error: "ADMIN_PERMISSION_REQUIRED" },
      { status: 403, headers: CORS_HEADERS },
    );
  }

  const body = await request.json().catch(() => ({}));
  const rows = body?.rows;
  const batchId = String(body?.batch_id ?? "");
  const sourceFileHash = String(body?.source_file_hash ?? "").toLowerCase();
  if (
    !Array.isArray(rows) ||
    rows.length < 1 ||
    rows.length > 5000 ||
    !/^[0-9a-f]{64}$/.test(sourceFileHash) ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(batchId)
  ) {
    return Response.json(
      { error: "INVALID_IMPORT_ROWS" },
      { status: 400, headers: CORS_HEADERS },
    );
  }

  const admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const source = `MANUAL_UPLOAD:${userData.user.id}`;

  try {
    const { data, error } = await admin.rpc("apply_biometric_import_batch_v3", {
      p_batch_id: batchId,
      p_source: source,
      p_source_file_hash: sourceFileHash,
      p_requested_by: userData.user.id,
      p_rows: rows,
    });
    if (error) throw error;
    const result = Array.isArray(data) ? data[0] : data;
    if (
      result?.success !== true ||
      result?.transaction_status !== "COMMITTED" ||
      String(result?.batch_id).toLowerCase() !== batchId.toLowerCase() ||
      String(result?.source_file_hash).toLowerCase() !== sourceFileHash ||
      !Number.isInteger(Number(result?.submitted_punches)) ||
      !Number.isInteger(Number(result?.inserted_punches)) ||
      !Number.isInteger(Number(result?.duplicate_punches)) ||
      !Number.isInteger(Number(result?.rejected_punches))
    ) throw new Error("DATABASE_IMPORT_CONFIRMATION_INVALID");
    return Response.json(result, { headers: CORS_HEADERS });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return Response.json(
      { error: "BIOMETRIC_IMPORT_FAILED", message },
      { status: 422, headers: CORS_HEADERS },
    );
  }
});
