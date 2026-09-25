import { createClient } from "npm:@supabase/supabase-js@2.39.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (request: Request) => {
  if (request.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

  if (!supabaseUrl || !serviceRoleKey) {
    return json({ error: "SERVICE_UNAVAILABLE", message: "Missing Supabase configuration." }, 500);
  }

  const admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  let targetDate: string | null = null;
  if (request.method === "POST") {
    try {
      const body = await request.json();
      if (body?.target_date) {
        targetDate = String(body.target_date);
      }
    } catch {
      // Empty or non-JSON body allowed; fallback to current IST date
    }
  }

  if (!targetDate) {
    targetDate = new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Kolkata",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(new Date());
  }

  // Call reconcile_missing_attendance_checkouts RPC
  const { data: closedCount, error: rpcError } = await admin.rpc(
    "reconcile_missing_attendance_checkouts",
    { p_target_date: targetDate },
  );

  if (rpcError) {
    return json(
      { error: "RECONCILE_FAILED", message: rpcError.message, target_date: targetDate },
      500,
    );
  }

  return json({
    success: true,
    target_date: targetDate,
    auto_closed_count: closedCount ?? 0,
    message: `Successfully reconciled missing checkouts for ${targetDate}. ${closedCount ?? 0} records auto-closed.`,
  });
});

