import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.38.4";

// Sends one geofence notification_outbox row (Database Webhook on INSERT).
// notification_outbox columns: id, geofence_event_id, recipient_user_id,
// notification_type, payload, status ('PENDING'|'SENT'|'FAILED'), attempts,
// last_attempted_at, sent_at, created_at.

const EXPO_PUSH_URL = "https://exp.host/--/api/v2/push/send";
const EXPO_TOKEN = /^(ExponentPushToken|ExpoPushToken)\[[A-Za-z0-9_-]+\]$/;
const CHANNEL_ID = "hrms_location_problems"; // created by the Android app

const DEFAULT_TEXT: Record<string, { title: string; body: string }> = {
  ENTER: { title: "Arrived", body: "You have reached the location." },
  EXIT: { title: "Left the location", body: "You have left the location." },
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function acceptedKeys() {
  const keys = new Set<string>();
  for (const name of ["SUPABASE_SERVICE_ROLE_KEY", "SUPABASE_ANON_KEY"]) {
    const value = Deno.env.get(name);
    if (value) keys.add(value);
  }
  for (const name of ["SUPABASE_PUBLISHABLE_KEYS", "PUSH_DISPATCH_ACCEPTED_KEYS"]) {
    const raw = Deno.env.get(name);
    if (!raw) continue;
    try {
      for (const value of Object.values(JSON.parse(raw) ?? {})) {
        if (typeof value === "string" && value) keys.add(value);
      }
    } catch {
      for (const value of raw.split(",")) if (value.trim()) keys.add(value.trim());
    }
  }
  return keys;
}

serve(async (req) => {
  if (req.method !== "POST") return json({ error: "METHOD_NOT_ALLOWED" }, 405);
  const bearer = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (!bearer || !acceptedKeys().has(bearer)) return json({ error: "UNAUTHORIZED" }, 401);

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceKey) return json({ error: "SERVER_NOT_CONFIGURED" }, 500);
  const supabase = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const payload = await req.json().catch(() => ({}));
  const record = payload?.record;
  if (!record?.id || record.status !== "PENDING") {
    return json({ message: "Ignored or not PENDING" });
  }

  const markFailed = (reason: string) =>
    supabase
      .from("notification_outbox")
      .update({
        status: "FAILED",
        attempts: Number(record.attempts ?? 0) + 1,
        last_attempted_at: new Date().toISOString(),
        payload: { ...(record.payload ?? {}), last_error: reason.slice(0, 500) },
      })
      .eq("id", record.id);

  try {
    const { data: tokens, error: tokenError } = await supabase
      .from("device_push_tokens")
      .select("token")
      .eq("user_id", record.recipient_user_id)
      .eq("active", true);
    const valid = (tokens ?? []).map((row) => String(row.token)).filter((t) => EXPO_TOKEN.test(t));
    if (tokenError || valid.length === 0) {
      await markFailed(tokenError?.message ?? "No active push tokens for this user");
      return json({ message: "No active push tokens found" });
    }

    const content = (record.payload ?? {}) as Record<string, unknown>;
    const fallback = DEFAULT_TEXT[String(record.notification_type ?? "").toUpperCase()] ?? {
      title: "Attendance alert",
      body: "Please check your tracking status.",
    };
    const title = typeof content.title === "string" && content.title ? content.title : fallback.title;
    const body =
      typeof content.body === "string" && content.body
        ? content.body
        : typeof content.message === "string" && content.message
          ? content.message
          : fallback.body;

    const messages = valid.map((to) => ({
      to,
      sound: "default",
      title,
      body,
      priority: "high",
      channelId: CHANNEL_ID,
      data: {
        type: String(record.notification_type ?? "geofence"),
        geofence_event_id: record.geofence_event_id ?? null,
        deepLink: typeof content.deepLink === "string" ? content.deepLink : "/HRMS/",
      },
    }));

    const response = await fetch(EXPO_PUSH_URL, {
      method: "POST",
      headers: { Accept: "application/json", "Content-Type": "application/json" },
      body: JSON.stringify(messages),
    });
    const result = await response.json().catch(() => null);
    if (!response.ok || !Array.isArray(result?.data)) {
      await markFailed(`Expo HTTP ${response.status}: ${JSON.stringify(result ?? {}).slice(0, 300)}`);
      return json({ error: "EXPO_REJECTED" }, 502);
    }

    let accepted = 0;
    for (let i = 0; i < result.data.length; i += 1) {
      const ticket = result.data[i];
      if (ticket?.status === "ok") accepted += 1;
      else if (ticket?.details?.error === "DeviceNotRegistered") {
        await supabase.from("device_push_tokens").update({ active: false }).eq("token", valid[i]);
      }
    }
    if (accepted === 0) {
      await markFailed(`All tickets failed: ${JSON.stringify(result.data).slice(0, 300)}`);
      return json({ error: "ALL_TICKETS_FAILED" }, 502);
    }

    await supabase
      .from("notification_outbox")
      .update({
        status: "SENT",
        sent_at: new Date().toISOString(),
        attempts: Number(record.attempts ?? 0) + 1,
        last_attempted_at: new Date().toISOString(),
      })
      .eq("id", record.id);
    return json({ success: true, processed: accepted });
  } catch (err) {
    await markFailed(err instanceof Error ? err.message : String(err));
    return json({ error: "WORKER_FAILED" }, 500);
  }
});
