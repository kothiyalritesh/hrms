import { createClient } from "npm:@supabase/supabase-js@2.39.0";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const reply = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status, headers: { ...cors, "Content-Type": "application/json" },
});
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX_PHOTO_BYTES = 2 * 1024 * 1024;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });
  if (req.method !== "POST") return reply({ error: "METHOD_NOT_ALLOWED" }, 405);
  try {
    if (req.headers.get("content-type")?.includes("application/json")) {
      const body = await req.json();
      if (body?.action === "version") {
        return reply({
          success: true,
          function: "field-visit-evidence-upload",
          version: "20260805.1",
          requiredBackendSchemaVersion: "20260810000000",
        });
      }
      if (body?.action !== "delete_orphan") {
        return reply({ success: false, error: "INVALID_ACTION" }, 400);
      }
      const url = Deno.env.get("SUPABASE_URL");
      const serviceRole = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
      if (!url || !serviceRole) throw new Error("SERVER_CONFIGURATION_MISSING");
      const authenticated = await authenticate(req, url, serviceRole);
      if (!authenticated) {
        return reply({
          success: false,
          error: "AUTHENTICATION_REQUIRED",
          message: "Your HRMS session has expired. Reopen the app and try again.",
        }, 401);
      }
      const { admin, user } = authenticated;
      const path = String(body?.path || "");
      if (!path.startsWith(`${user.id}/`) || path.includes("..")) {
        return reply({ success: false, error: "INVALID_EVIDENCE_PATH" }, 400);
      }
      const { data: references, error: referenceError } = await admin
        .from("field_visits")
        .select("id")
        .eq("evidence_photo_path", path)
        .limit(1);
      if (referenceError) throw referenceError;
      if ((references ?? []).length > 0) {
        return reply({
          success: true,
          deleted: false,
          referenced: true,
          path,
        });
      }
      const { error: deleteError } = await admin.storage
        .from("field-visit-evidence")
        .remove([path]);
      if (deleteError) throw deleteError;
      return reply({
        success: true,
        deleted: true,
        referenced: false,
        path,
      });
    }
    const url = Deno.env.get("SUPABASE_URL");
    const serviceRole = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!url || !serviceRole) throw new Error("SERVER_CONFIGURATION_MISSING");
    const authenticated = await authenticate(req, url, serviceRole);
    if (!authenticated) return reply({
      error: "AUTHENTICATION_REQUIRED",
      message: "Your HRMS session has expired. Reopen the app and try again.",
    }, 401);
    const { admin, user } = authenticated;

    const form = await req.formData();
    const file = form.get("file");
    const visitId = String(form.get("visit_id") || "");
    const idempotencyKey = String(form.get("idempotency_key") || "");
    const capturedAt = new Date(String(form.get("captured_at") || ""));
    if (!(file instanceof File) || !uuid.test(visitId) || !uuid.test(idempotencyKey) || !Number.isFinite(capturedAt.getTime())) return reply({ error: "INVALID_UPLOAD_REQUEST" }, 400);
    if (file.size <= 0 || file.size > MAX_PHOTO_BYTES) return reply({ error: "PHOTO_SIZE_NOT_ALLOWED", message: "Compressed photo must be 2 MB or smaller." }, 413);

    const bytes = new Uint8Array(await file.arrayBuffer());
    const jpeg = bytes.length > 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
    const png = bytes.length > 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47 && bytes[4] === 0x0d && bytes[5] === 0x0a && bytes[6] === 0x1a && bytes[7] === 0x0a;
    if (!jpeg && !png) return reply({ error: "PHOTO_CONTENT_NOT_ALLOWED" }, 415);

    const extension = jpeg ? "jpg" : "png";
    const contentType = jpeg ? "image/jpeg" : "image/png";
    const path = `${user.id}/${capturedAt.getUTCFullYear()}/${String(capturedAt.getUTCMonth() + 1).padStart(2, "0")}/${visitId}/${idempotencyKey}.${extension}`;
    const { error } = await admin.storage.from("field-visit-evidence").upload(path, bytes, { contentType, upsert: false, cacheControl: "3600" });
    if (error && !/duplicate|already exists/i.test(error.message)) throw error;
    return reply({ path, content_type: contentType, photo_bytes: file.size });
  } catch (error) {
    console.error("field-visit-evidence-upload", error);
    return reply({ error: "UPLOAD_FAILED", message: error instanceof Error ? error.message : "Photo upload failed" }, 500);
  }
});

function accessToken(req: Request) {
  const authorization = req.headers.get("Authorization")?.trim() || "";
  const match = /^Bearer\s+(.+)$/i.exec(authorization);
  return match?.[1]?.trim() || null;
}

async function authenticate(req: Request, url: string, serviceRole: string) {
  const token = accessToken(req);
  if (!token) return null;
  const admin = createClient(url, serviceRole, {
    auth: { persistSession: false },
  });
  const { data, error } = await admin.auth.getUser(token);
  if (error || !data.user) return null;
  return { admin, user: data.user };
}
