import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const EXPO_PUSH_URL = "https://exp.host/--/api/v2/push/send";

interface RequestBody {
  journeyEventId?: string;
  record?: { id?: string };
}

Deno.serve(async (request) => {
  if (request.method !== "POST") {
    return Response.json({ error: "METHOD_NOT_ALLOWED" }, { status: 405 });
  }

  const webhookSecret = Deno.env.get("JOURNEY_PUSH_WEBHOOK_SECRET");
  const suppliedSecret = request.headers.get("x-journey-webhook-secret");
  if (!webhookSecret || suppliedSecret !== webhookSecret) {
    return Response.json({ error: "UNAUTHORIZED" }, { status: 401 });
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
  const journeyEventId = body.journeyEventId ?? body.record?.id;
  if (!journeyEventId) {
    return Response.json(
      { error: "JOURNEY_EVENT_ID_REQUIRED" },
      { status: 400 },
    );
  }

  const admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: event, error: eventError } = await admin
    .from("journey_events")
    .select(
      "id,user_id,field_visit_id,event_type,distance_m,occurred_at,metadata",
    )
    .eq("id", journeyEventId)
    .maybeSingle();
  if (eventError || !event) {
    return Response.json({ error: "EVENT_NOT_FOUND" }, { status: 404 });
  }
  if (!["ENTERED_1KM", "ENTERED_500M", "ARRIVED"].includes(event.event_type)) {
    return Response.json({ sent: 0, skipped: "EVENT_NOT_PUSHABLE" });
  }

  const [{ data: employee }, { data: visit }, { data: escalationRows }] =
    await Promise.all([
      admin
        .from("profiles")
        .select("name,reports_to")
        .eq("id", event.user_id)
        .maybeSingle(),
      admin
        .from("field_visits")
        .select("location_name,project_name")
        .eq("id", event.field_visit_id)
        .maybeSingle(),
      admin.from("escalation_matrix").select("user_id"),
    ]);

  const recipientIds = Array.from(
    new Set(
      [
        employee?.reports_to,
        ...(escalationRows ?? []).map((row) => row.user_id),
      ].filter((id): id is string => typeof id === "string"),
    ),
  );
  if (!recipientIds.length) return Response.json({ sent: 0 });

  const { data: tokens, error: tokenError } = await admin
    .from("device_push_tokens")
    .select("id,user_id,token")
    .in("user_id", recipientIds)
    .eq("active", true);
  if (tokenError || !tokens?.length) return Response.json({ sent: 0 });

  const destinationName =
    visit?.project_name || visit?.location_name || "the destination";
  const employeeName = employee?.name || "Employee";
  const message =
    event.event_type === "ENTERED_1KM"
      ? `${employeeName} is approximately 1 km from ${destinationName}.`
      : event.event_type === "ENTERED_500M"
        ? `${employeeName} is approximately 500 m from ${destinationName}.`
        : `${employeeName} arrived at ${destinationName}.`;
  const title =
    event.event_type === "ARRIVED"
      ? "Employee arrived"
      : "Employee approaching destination";

  const claimedTokens: typeof tokens = [];
  for (const token of tokens) {
    const { error } = await admin.from("push_delivery_log").upsert(
      {
        journey_event_id: event.id,
        recipient_user_id: token.user_id,
        push_token_id: token.id,
        status: "PENDING",
        updated_at: new Date().toISOString(),
      },
      { onConflict: "journey_event_id,push_token_id", ignoreDuplicates: true },
    );
    if (!error) {
      const { data: delivery } = await admin
        .from("push_delivery_log")
        .update({
          status: "SENDING",
          updated_at: new Date().toISOString(),
        })
        .eq("journey_event_id", event.id)
        .eq("push_token_id", token.id)
        .in("status", ["PENDING", "FAILED"])
        .select("id")
        .maybeSingle();
      if (delivery) claimedTokens.push(token);
    }
  }
  if (!claimedTokens.length) {
    return Response.json({ sent: 0, skipped: "ALREADY_DELIVERED" });
  }

  const expoResponse = await fetch(EXPO_PUSH_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
      "Accept-Encoding": "gzip, deflate",
    },
    body: JSON.stringify(
      claimedTokens.map((token) => ({
        to: token.token,
        title,
        body: message,
        sound: "default",
        priority: "high",
        channelId: "hrms_manager_updates",
        data: {
          type: "manager_journey_update",
          journeyEventId: event.id,
          fieldVisitId: event.field_visit_id,
          occurredAt: event.occurred_at,
          deepLink: `re-hrms://field-visits/${event.field_visit_id}`,
        },
      })),
    ),
  });
  const tickets = await expoResponse.json();
  const ticketRows = Array.isArray(tickets?.data) ? tickets.data : [];

  await Promise.all(
    claimedTokens.map((token, index) => {
      const ticket = ticketRows[index];
      const succeeded = expoResponse.ok && ticket?.status === "ok";
      return admin
        .from("push_delivery_log")
        .update({
          status: succeeded ? "SENT" : "FAILED",
          provider_ticket_id: ticket?.id ?? null,
          error_message: succeeded
            ? null
            : ticket?.message || `Expo push HTTP ${expoResponse.status}`,
          updated_at: new Date().toISOString(),
        })
        .eq("journey_event_id", event.id)
        .eq("push_token_id", token.id);
    }),
  );

  return Response.json({
    sent: ticketRows.filter((ticket: any) => ticket?.status === "ok").length,
    attempted: claimedTokens.length,
  });
});
