import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const EXPO_PUSH_URL = "https://exp.host/--/api/v2/push/send";
const MAX_EXPO_BATCH = 100;

interface RequestBody {
  eventId?: string;
  recipientUserId?: string;
  record?: { id?: string };
}

type EventRow = {
  id: string;
  title: string;
  description: string | null;
  event_date: string;
  start_time: string;
  end_time: string;
  address: string;
};

Deno.serve(async (request) => {
  if (request.method !== "POST") {
    return Response.json({ error: "METHOD_NOT_ALLOWED" }, { status: 405 });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceRoleKey) {
    return Response.json({ error: "SERVER_NOT_CONFIGURED" }, { status: 500 });
  }

  let body: RequestBody;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "INVALID_JSON" }, { status: 400 });
  }

  const eventId = body.eventId ?? body.record?.id;
  const recipientUserId = body.recipientUserId;
  if (!eventId && !recipientUserId) {
    return Response.json(
      { error: "EVENT_ID_OR_RECIPIENT_REQUIRED" },
      { status: 400 },
    );
  }

  const admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  let events: EventRow[] = [];
  if (eventId) {
    const { data, error } = await admin
      .from("events")
      .select("id,title,description,event_date,start_time,end_time,address")
      .eq("id", eventId)
      .maybeSingle();
    if (error || !data) {
      return Response.json({ error: "EVENT_NOT_FOUND" }, { status: 404 });
    }
    events = [data as EventRow];
  } else {
    const { data: announcements } = await admin
      .from("event_announcements")
      .select("event_id")
      .eq("user_id", recipientUserId!)
      .is("acknowledged_at", null)
      .limit(20);
    const eventIds = Array.from(
      new Set((announcements ?? []).map((row) => row.event_id)),
    );
    if (eventIds.length) {
      const istDate = new Intl.DateTimeFormat("en-CA", {
        timeZone: "Asia/Kolkata",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
      }).format(new Date());
      const { data } = await admin
        .from("events")
        .select("id,title,description,event_date,start_time,end_time,address")
        .in("id", eventIds)
        .gte("event_date", istDate)
        .order("event_date");
      events = (data ?? []) as EventRow[];
    }
  }

  if (!events.length) {
    return Response.json({ sent: 0, skipped: "NO_PENDING_EVENTS" });
  }

  const eventIds = events.map((event) => event.id);
  let announcementQuery = admin
    .from("event_announcements")
    .select("event_id,user_id")
    .in("event_id", eventIds);
  if (recipientUserId) {
    announcementQuery = announcementQuery.eq("user_id", recipientUserId);
  }
  const { data: announcements } = await announcementQuery;
  const recipientIds = Array.from(
    new Set((announcements ?? []).map((row) => row.user_id)),
  );
  if (!recipientIds.length) return Response.json({ sent: 0 });

  const { data: tokens, error: tokenError } = await admin
    .from("device_push_tokens")
    .select("id,user_id,token")
    .in("user_id", recipientIds)
    .eq("active", true);
  if (tokenError || !tokens?.length) {
    return Response.json({ sent: 0, skipped: "NO_REGISTERED_DEVICES" });
  }

  const announcementsByEvent = new Map<string, Set<string>>();
  for (const announcement of announcements ?? []) {
    const users =
      announcementsByEvent.get(announcement.event_id) ?? new Set<string>();
    users.add(announcement.user_id);
    announcementsByEvent.set(announcement.event_id, users);
  }

  const claimed: Array<{
    event: EventRow;
    token: (typeof tokens)[number];
  }> = [];
  for (const event of events) {
    const eventRecipients = announcementsByEvent.get(event.id) ?? new Set();
    for (const token of tokens) {
      if (!eventRecipients.has(token.user_id)) continue;
      await admin.from("event_push_delivery_log").upsert(
        {
          event_id: event.id,
          recipient_user_id: token.user_id,
          push_token_id: token.id,
          status: "PENDING",
          updated_at: new Date().toISOString(),
        },
        {
          onConflict: "event_id,push_token_id",
          ignoreDuplicates: true,
        },
      );
      const { data: delivery } = await admin
        .from("event_push_delivery_log")
        .update({ status: "SENDING", updated_at: new Date().toISOString() })
        .eq("event_id", event.id)
        .eq("push_token_id", token.id)
        .in("status", ["PENDING", "FAILED"])
        .select("id")
        .maybeSingle();
      if (delivery) claimed.push({ event, token });
    }
  }

  if (!claimed.length) {
    return Response.json({ sent: 0, skipped: "ALREADY_DELIVERED" });
  }

  let sent = 0;
  for (let offset = 0; offset < claimed.length; offset += MAX_EXPO_BATCH) {
    const batch = claimed.slice(offset, offset + MAX_EXPO_BATCH);
    const expoResponse = await fetch(EXPO_PUSH_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        "Accept-Encoding": "gzip, deflate",
      },
      body: JSON.stringify(
        batch.map(({ event, token }) => ({
          to: token.token,
          title: `HRMS Event: ${event.title}`,
          body: `${event.event_date} • ${event.start_time.slice(0, 5)}-${event.end_time.slice(0, 5)} • ${event.address}`,
          sound: "default",
          priority: "high",
          channelId: "hrms_events",
          categoryId: "hrms_event_actions",
          data: {
            type: "event_announcement",
            eventId: event.id,
            deepLink: `re-hrms://tasks/${event.id}`,
          },
        })),
      ),
    });
    const payload = await expoResponse.json().catch(() => ({ data: [] }));
    const tickets = Array.isArray(payload?.data) ? payload.data : [];

    await Promise.all(
      batch.map(async ({ event, token }, index) => {
        const ticket = tickets[index];
        const succeeded = expoResponse.ok && ticket?.status === "ok";
        if (succeeded) sent += 1;
        if (ticket?.details?.error === "DeviceNotRegistered") {
          await admin
            .from("device_push_tokens")
            .update({ active: false, updated_at: new Date().toISOString() })
            .eq("id", token.id);
        }
        return admin
          .from("event_push_delivery_log")
          .update({
            status: succeeded ? "SENT" : "FAILED",
            provider_ticket_id: ticket?.id ?? null,
            error_message: succeeded
              ? null
              : ticket?.message || `Expo push HTTP ${expoResponse.status}`,
            updated_at: new Date().toISOString(),
          })
          .eq("event_id", event.id)
          .eq("push_token_id", token.id);
      }),
    );
  }

  return Response.json({ sent, attempted: claimed.length });
});
