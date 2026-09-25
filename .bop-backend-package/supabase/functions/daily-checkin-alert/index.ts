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

  // Calculate current date in Asia/Kolkata timezone
  const nowIST = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());

  // 1. Fetch active employees (excluding pending exit or archived)
  const { data: employees, error: empError } = await admin
    .from("profiles")
    .select("id, name, full_name, email, role")
    .eq("is_active", true)
    .or("lifecycle_status.is.null,lifecycle_status.eq.ACTIVE");

  if (empError) {
    return json({ error: "EMPLOYEE_QUERY_FAILED", message: empError.message }, 500);
  }

  // 2. Fetch today's check-ins from attendance_logs
  const { data: attendances, error: attError } = await admin
    .from("attendance_logs")
    .select("user_id")
    .eq("date", nowIST)
    .not("checkin_time", "is", null)
    .is("deleted_at", null);

  if (attError) {
    return json({ error: "ATTENDANCE_QUERY_FAILED", message: attError.message }, 500);
  }

  const checkedInUserIds = new Set((attendances ?? []).map((a: { user_id: string }) => a.user_id));

  // 3. Fetch approved leaves covering today
  const { data: leaves, error: leaveError } = await admin
    .from("leave_requests")
    .select("user_id")
    .eq("status", "approved")
    .lte("start_date", nowIST)
    .gte("end_date", nowIST);

  if (leaveError) {
    return json({ error: "LEAVE_QUERY_FAILED", message: leaveError.message }, 500);
  }

  const onLeaveUserIds = new Set((leaves ?? []).map((l: { user_id: string }) => l.user_id));

  // 4. Identify employees missing check-in
  const missingEmployees = (employees ?? []).filter(
    (e: { id: string }) => !checkedInUserIds.has(e.id) && !onLeaveUserIds.has(e.id),
  );

  let alertedCount = 0;
  for (const emp of missingEmployees) {
    const empName = emp.name || emp.full_name || "there";
    try {
      await admin.rpc("enqueue_hrms_notification", {
        p_user_id: emp.id,
        p_title: "Check-in Reminder",
        p_message: `Hi ${empName}, you haven't checked in for today (${nowIST}). Please log your attendance or notify HR.`,
        p_type: "attendance_missing_checkin",
        p_event_key: `attendance-checkin-alert:${emp.id}:${nowIST}`,
        p_deep_link: "/HRMS/attendance",
        p_field_visit_id: null,
        p_event_id: null,
        p_data: { date: nowIST, action: "OPEN_ATTENDANCE" },
      });
      alertedCount++;
    } catch (notifErr) {
      console.error(`Failed to alert user ${emp.id}:`, notifErr);
    }
  }

  return json({
    success: true,
    date: nowIST,
    total_active_employees: employees?.length ?? 0,
    checked_in_count: checkedInUserIds.size,
    on_leave_count: onLeaveUserIds.size,
    alerted_count: alertedCount,
  });
});

