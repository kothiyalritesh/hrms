import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const EXPO_SEND_URL = "https://exp.host/--/api/v2/push/send";
const EXPO_RECEIPTS_URL = "https://exp.host/--/api/v2/push/getReceipts";
const MAX_BATCH = 300;
// Rows sent at the same time; each row is claimed atomically, so parallel
// sends never deliver one notification twice.
const SEND_CONCURRENCY = 10;
const BACKEND_SCHEMA_VERSION = "20260810000000";
const FUNCTION_VERSION = "20261014.1";

type OutboxRow = {
  id: string;
  recipient_user_id: string;
  title: string;
  body: string;
  event_type: string;
  event_key: string;
  channel_id: string;
  category_id: string | null;
  deep_link: string;
  data: Record<string, unknown> | null;
  sound: string;
  priority: "default" | "normal" | "high";
  attempts: number;
  expires_at: string;
};

type PushTokenRow = { id: string; token: string };

function json(body: unknown, status = 200) {
  return Response.json(body, { status });
}

const RECEIPT_TTL_MS = 24 * 60 * 60_000;

function retryAt(attempts: number) {
  const delaySeconds = Math.min(3600, 30 * 2 ** Math.min(attempts, 7));
  return new Date(Date.now() + delaySeconds * 1000).toISOString();
}

function validExpoToken(token: string) {
  return /^(ExponentPushToken|ExpoPushToken)\[[A-Za-z0-9_-]+\]$/.test(token);
}

async function processReceipts(admin: any) {
  const { data: pending } = await admin
    .from("notification_push_deliveries")
    .select("id,outbox_id,push_token_id,provider_ticket_id,updated_at")
    .eq("status", "SENT")
    .not("provider_ticket_id", "is", null)
    .order("updated_at")
    .limit(300);
  if (!pending?.length) return { checked: 0, delivered: 0, failed: 0 };

  let delivered = 0;
  let failed = 0;
  for (let offset = 0; offset < pending.length; offset += 300) {
    const batch = pending.slice(offset, offset + 300);
    const response = await fetch(EXPO_RECEIPTS_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ ids: batch.map((row: any) => row.provider_ticket_id) }),
    });
    if (!response.ok) continue;
    const payload = await response.json().catch(() => ({ data: {} }));
    for (const row of batch) {
      const receipt = payload?.data?.[row.provider_ticket_id];
      if (!receipt) {
        // Expo keeps receipts ~24 h. Without this, expired tickets stay the
        // oldest SENT rows forever and block every newer receipt check.
        if (Date.parse(row.updated_at) < Date.now() - RECEIPT_TTL_MS) {
          await admin
            .from("notification_push_deliveries")
            .update({
              status: "DELIVERED",
              error_code: "RECEIPT_EXPIRED",
              error_message: "Accepted by the push service; delivery receipt no longer available",
              updated_at: new Date().toISOString(),
            })
            .eq("id", row.id);
        }
        continue;
      }
      const succeeded = receipt.status === "ok";
      await admin
        .from("notification_push_deliveries")
        .update({
          status: succeeded ? "DELIVERED" : "FAILED",
          error_code: succeeded ? null : receipt.details?.error ?? "PROVIDER_ERROR",
          error_message: succeeded ? null : receipt.message ?? "Push delivery failed",
          updated_at: new Date().toISOString(),
        })
        .eq("id", row.id);
      if (succeeded) delivered += 1;
      else {
        failed += 1;
        if (receipt.details?.error === "DeviceNotRegistered") {
          await admin
            .from("device_push_tokens")
            .update({ active: false, updated_at: new Date().toISOString() })
            .eq("id", row.push_token_id);
        }
      }
    }
  }

  const outboxIds = Array.from(new Set(pending.map((row: any) => row.outbox_id)));
  for (const outboxId of outboxIds) {
    const { data: deliveries } = await admin
      .from("notification_push_deliveries")
      .select("status")
      .eq("outbox_id", outboxId);
    if (deliveries?.some((row: any) => row.status === "DELIVERED")) {
      await admin
        .from("notification_push_outbox")
        .update({ status: "DELIVERED", delivered_at: new Date().toISOString(), updated_at: new Date().toISOString() })
        .eq("id", outboxId);
    } else if (deliveries?.length && deliveries.every((row: any) => row.status === "FAILED")) {
      await admin
        .from("notification_push_outbox")
        .update({ status: "FAILED", next_attempt_at: retryAt(4), last_error: "ALL_DEVICE_DELIVERIES_FAILED", updated_at: new Date().toISOString() })
        .eq("id", outboxId);
    }
  }
  return { checked: pending.length, delivered, failed };
}

async function dispatchRow(admin: any, candidate: OutboxRow) {
  if (new Date(candidate.expires_at).getTime() <= Date.now()) {
    await admin.from("notification_push_outbox").update({
      status: "EXPIRED",
      last_error: "NOTIFICATION_EXPIRED",
      updated_at: new Date().toISOString(),
    }).eq("id", candidate.id);
    return { status: "EXPIRED", sent: 0 };
  }

  if (
    candidate.event_type === "attendance_checkin_reminder" ||
    candidate.event_type === "attendance_checkout_reminder"
  ) {
    const attendanceDate = String(candidate.data?.attendanceDate ?? "");
    const { data: currentState, error: stateError } = await admin.rpc(
      "hrms_attendance_state",
      {
        p_user_id: candidate.recipient_user_id,
        p_date: attendanceDate,
      },
    );
    if (stateError) throw stateError;
    const stale =
      (candidate.event_type === "attendance_checkin_reminder" &&
        currentState !== "NOT_CHECKED_IN") ||
      (candidate.event_type === "attendance_checkout_reminder" &&
        currentState !== "CHECKED_IN");
    if (stale) {
      const action =
        candidate.event_type === "attendance_checkin_reminder"
          ? "ATTENDANCE_REMINDER_SKIPPED_ALREADY_CHECKED_IN"
          : "CHECKOUT_REMINDER_SKIPPED_ALREADY_CHECKED_OUT";
      await Promise.all([
        admin
          .from("notification_push_outbox")
          .update({
            status: "EXPIRED",
            last_error: `STALE_REMINDER_CURRENT_STATE_${currentState}`,
            updated_at: new Date().toISOString(),
          })
          .eq("id", candidate.id),
        admin.from("hrms_audit_events").insert({
          target_user_id: candidate.recipient_user_id,
          action,
          entity_type: "notification",
          entity_id: candidate.id,
          new_values: {
            attendance_date: attendanceDate,
            attendance_state: currentState,
            outbox_id: candidate.id,
          },
          source: "NOTIFICATION_DISPATCH",
        }),
      ]);
      return { status: "EXPIRED", sent: 0 };
    }
  }

  const { data: claimed } = await admin
    .from("notification_push_outbox")
    .update({
      status: "SENDING",
      attempts: candidate.attempts + 1,
      updated_at: new Date().toISOString(),
    })
    .eq("id", candidate.id)
    .in("status", ["PENDING", "FAILED", "WAITING_TOKEN"])
    .select("id")
    .maybeSingle();
  if (!claimed) return { status: "SKIPPED", sent: 0 };

  const { data: tokenRows, error: tokenError } = await admin
    .from("device_push_tokens")
    .select("id,token")
    .eq("user_id", candidate.recipient_user_id)
    .eq("active", true);
  if (tokenError) throw tokenError;
  const tokens = (tokenRows ?? []).filter((row: PushTokenRow) => validExpoToken(row.token));
  if (!tokens.length) {
    await admin.from("notification_push_outbox").update({
      status: "WAITING_TOKEN",
      next_attempt_at: new Date(Date.now() + 30 * 60_000).toISOString(),
      last_error: "NO_REGISTERED_DEVICE",
      updated_at: new Date().toISOString(),
    }).eq("id", candidate.id);
    return { status: "WAITING_TOKEN", sent: 0 };
  }

  const messages = tokens.map((token: PushTokenRow) => ({
    to: token.token,
    title: candidate.title,
    body: candidate.body,
    sound: candidate.sound || "default",
    priority: candidate.priority || "high",
    channelId: candidate.channel_id,
    ...(candidate.category_id ? { categoryId: candidate.category_id } : {}),
    ttl: Math.max(60, Math.floor((new Date(candidate.expires_at).getTime() - Date.now()) / 1000)),
    tag: candidate.event_key.slice(0, 64),
    collapseId: candidate.event_key.slice(0, 64),
    data: {
      ...(candidate.data ?? {}),
      type: candidate.event_type,
      deepLink: candidate.deep_link,
      outboxId: candidate.id,
    },
  }));
  const response = await fetch(EXPO_SEND_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
      "Accept-Encoding": "gzip, deflate",
    },
    body: JSON.stringify(messages),
  });
  const payload = await response.json().catch(() => ({ data: [], errors: [] }));
  const tickets = Array.isArray(payload?.data) ? payload.data : [];
  let sent = 0;
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    const ticket = tickets[index];
    const succeeded = response.ok && ticket?.status === "ok" && typeof ticket?.id === "string";
    if (succeeded) sent += 1;
    await admin.from("notification_push_deliveries").upsert({
      outbox_id: candidate.id,
      push_token_id: token.id,
      provider_ticket_id: succeeded ? ticket.id : null,
      status: succeeded ? "SENT" : "FAILED",
      error_code: succeeded ? null : ticket?.details?.error ?? `HTTP_${response.status}`,
      error_message: succeeded ? null : ticket?.message ?? "Expo rejected the push request",
      updated_at: new Date().toISOString(),
    }, { onConflict: "outbox_id,push_token_id" });
    if (ticket?.details?.error === "DeviceNotRegistered") {
      await admin.from("device_push_tokens").update({
        active: false,
        updated_at: new Date().toISOString(),
      }).eq("id", token.id);
    }
  }

  await admin.from("notification_push_outbox").update(sent > 0 ? {
    status: "SENT",
    sent_at: new Date().toISOString(),
    last_error: null,
    next_attempt_at: new Date(Date.now() + 60_000).toISOString(),
    updated_at: new Date().toISOString(),
  } : {
    status: "FAILED",
    last_error: payload?.errors?.[0]?.message ?? `EXPO_PUSH_HTTP_${response.status}`,
    next_attempt_at: retryAt(candidate.attempts + 1),
    updated_at: new Date().toISOString(),
  }).eq("id", candidate.id);
  if (sent > 0 && candidate.event_type === "event_announcement") {
    await admin.from("hrms_audit_events").insert({
      target_user_id: candidate.recipient_user_id,
      action: "EVENT_NOTIFICATION_SENT",
      entity_type: "notification",
      entity_id: candidate.id,
      new_values: {
        outbox_id: candidate.id,
        event_key: candidate.event_key,
        device_count: sent,
      },
      source: "NOTIFICATION_DISPATCH",
    });
  }
  return { status: sent > 0 ? "SENT" : "FAILED", sent };
}

Deno.serve(async (request) => {
  if (request.method !== "POST") return json({ error: "METHOD_NOT_ALLOWED" }, 405);
  // The scheduled call (pg_cron) sends the project's publishable key
  // (sb_publishable_...). Older projects expose only the legacy anon JWT as
  // SUPABASE_ANON_KEY, so comparing with that alone rejected every scheduled
  // run with 401 and no push was ever sent. Accept the legacy key or any of the
  // project's publishable keys. The call carries no caller input: it only
  // drains this project's own outbox.
  const acceptedKeys = new Set<string>();
  const legacyKey = Deno.env.get("SUPABASE_ANON_KEY");
  if (legacyKey) acceptedKeys.add(legacyKey);
  for (const name of ["SUPABASE_PUBLISHABLE_KEYS", "PUSH_DISPATCH_ACCEPTED_KEYS"]) {
    const raw = Deno.env.get(name);
    if (!raw) continue;
    try {
      const parsed = JSON.parse(raw);
      for (const value of Object.values(parsed ?? {})) {
        if (typeof value === "string" && value) acceptedKeys.add(value);
      }
    } catch {
      for (const value of raw.split(",")) if (value.trim()) acceptedKeys.add(value.trim());
    }
  }
  const authorization = request.headers.get("authorization") ?? "";
  const suppliedApiKey = request.headers.get("apikey") ?? "";
  if (
    !acceptedKeys.size ||
    !acceptedKeys.has(suppliedApiKey) ||
    authorization !== `Bearer ${suppliedApiKey}`
  ) {
    return json({ error: "UNAUTHORIZED" }, 401);
  }
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceRoleKey) return json({ error: "SERVER_NOT_CONFIGURED" }, 500);

  const body = await request.json().catch(() => ({}));
  if (body?.action === "version") {
    return json({
      function: "notification-dispatch",
      functionVersion: FUNCTION_VERSION,
      backendSchemaVersion: BACKEND_SCHEMA_VERSION,
    });
  }

  const admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const receipts = await processReceipts(admin);
  // A run that crashed or timed out mid-send leaves rows in SENDING, which the
  // candidate query below never picks up again. Hand them back for a retry.
  await admin
    .from("notification_push_outbox")
    .update({
      status: "FAILED",
      last_error: "RECOVERED_STUCK_SENDING",
      next_attempt_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq("status", "SENDING")
    .lt("updated_at", new Date(Date.now() - 5 * 60_000).toISOString());
  const now = new Date().toISOString();
  const columns = "id,recipient_user_id,title,body,event_type,event_key,channel_id,category_id,deep_link,data,sound,priority,attempts,expires_at";
  // New notifications first. Retries (no phone registered yet, earlier
  // failures) used to sit ahead of a fresh broadcast and delay it.
  const { data: fresh, error } = await admin
    .from("notification_push_outbox")
    .select(columns)
    .eq("status", "PENDING")
    .lte("next_attempt_at", now)
    .order("created_at")
    .limit(MAX_BATCH);
  if (error) return json({ error: "OUTBOX_QUERY_FAILED", message: error.message }, 500);
  let retries: OutboxRow[] = [];
  if ((fresh?.length ?? 0) < MAX_BATCH) {
    const { data: retryRows, error: retryError } = await admin
      .from("notification_push_outbox")
      .select(columns)
      .in("status", ["FAILED", "WAITING_TOKEN"])
      .lte("next_attempt_at", now)
      .order("next_attempt_at")
      .limit(MAX_BATCH - (fresh?.length ?? 0));
    if (retryError) return json({ error: "OUTBOX_QUERY_FAILED", message: retryError.message }, 500);
    retries = (retryRows ?? []) as OutboxRow[];
  }
  const candidates = [...((fresh ?? []) as OutboxRow[]), ...retries];

  const outcomes = { sent: 0, failed: 0, waitingToken: 0, expired: 0, skipped: 0 };
  const handle = async (row: OutboxRow) => {
    try {
      const result = await dispatchRow(admin, row);
      if (result.status === "SENT") outcomes.sent += result.sent;
      else if (result.status === "WAITING_TOKEN") outcomes.waitingToken += 1;
      else if (result.status === "EXPIRED") outcomes.expired += 1;
      else if (result.status === "SKIPPED") outcomes.skipped += 1;
      else outcomes.failed += 1;
    } catch (dispatchError) {
      outcomes.failed += 1;
      await admin.from("notification_push_outbox").update({
        status: "FAILED",
        last_error: dispatchError instanceof Error ? dispatchError.message.slice(0, 1000) : "DISPATCH_FAILED",
        next_attempt_at: retryAt(row.attempts + 1),
        updated_at: new Date().toISOString(),
      }).eq("id", row.id);
    }
  };
  for (let index = 0; index < candidates.length; index += SEND_CONCURRENCY) {
    await Promise.all(candidates.slice(index, index + SEND_CONCURRENCY).map(handle));
  }
  return json({ success: true, receipts, candidates: candidates.length, ...outcomes });
});
