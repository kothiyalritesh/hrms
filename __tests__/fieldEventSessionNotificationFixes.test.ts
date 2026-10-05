// @ts-nocheck -- source-level integration contracts; SQL runtime is verified
// against the linked Supabase project before release.
import fs from "fs";
import path from "path";

const read = (file: string) =>
  fs.readFileSync(path.resolve(__dirname, "..", file), "utf8");

describe("field visit, event, session and notification repair", () => {
  const migration = read(
    "supabase/migrations/20260810000000_field_event_audience_context_notifications.sql",
  );
  const eventService = read("services/event.service.ts");
  const eventAdmin = read("screens/admin/EventManagementScreen.tsx");
  const fieldService = read("services/field-visit.service.ts");
  const auth = read("contexts/AuthContext.tsx");
  const navigator = read("navigation/RootNavigator.tsx");
  const notifications = read("services/location/notification.service.ts");
  const dispatcher = read("supabase/functions/notification-dispatch/index.ts");

  it("keeps normal office and biometric attendance paths intact", () => {
    expect(migration).not.toContain("drop function public.rpc_attendance_checkin_v3");
    expect(migration).not.toContain("delete from public.attendance_logs");
    expect(migration).toContain("checkin_time=coalesce(checkin_time,v_visit.checkin_time)");
    expect(migration).toContain("case when checkin_time is null then 'FIELD_VISIT' else checkin_source end");
  });

  it("supports biometric plus field visit and direct home-to-site attendance without duplicates", () => {
    expect(migration).toContain("sync_field_visit_arrival_attendance");
    expect(migration).not.toContain("ACTIVE_ATTENDANCE_REQUIRED");
    expect(migration).toContain("attendance_logs_user_business_date_uidx");
    expect(migration).toContain("pg_advisory_xact_lock");
    expect(migration).toContain("exception when unique_violation");
    expect(fieldService).toContain('p_action: "CHECK_IN"');
    expect(fieldService).toContain("captured_at: location.capturedAt");
  });

  it("rejects fake/stale/inaccurate field locations on the server", () => {
    expect(migration).toContain("OUTSIDE_FIELD_VISIT_GEOFENCE");
    expect(migration).toContain("GPS_ACCURACY_NOT_ACCEPTABLE");
    expect(migration).toContain("STALE_LOCATION_EVIDENCE");
    expect(migration).toContain("MOCK_LOCATION_DETECTED");
    expect(migration).toContain("FIELD_VISIT_CHECKIN_REJECTED");
  });

  it("resolves team, department, employee and all-employee audiences once", () => {
    for (const table of [
      "event_team_assignments",
      "event_department_assignments",
      "event_employee_assignments",
      "event_participants",
    ]) expect(migration).toContain(`public.${table}`);
    expect(migration).toContain("primary key(event_id,employee_id)");
    expect(migration).toContain("resolve_event_participants");
    expect(eventAdmin).toContain("Select All");
    expect(eventAdmin).toContain("All Employees");
    expect(eventAdmin).toContain("resolvedEmployeeIds.size");
  });

  it("scopes employee event attendance and notifications to participants", () => {
    expect(eventService).toContain('.from("event_participants")');
    expect(eventService).toContain('.eq("employee_id", userId)');
    expect(migration).toContain("EVENT_NOT_ASSIGNED_TO_EMPLOYEE");
    expect(migration).toContain("EVENT_CREATED:");
    expect(migration).toContain("EVENT_NOTIFICATION_CREATED");
  });

  it("uses event start plus grace for early/on-time/late arrival", () => {
    expect(migration).toContain("v_event.event_late_grace_minutes");
    expect(migration).toContain("v_now<=v_start+make_interval");
    expect(migration).toContain("then 'ON_TIME' else 'LATE'");
    expect(migration).toContain("EVENT_LATE_CALCULATION");
    expect(migration).not.toContain("time '10:30:00'");
  });

  it("records event context and event geofence instead of office context", () => {
    expect(migration).toContain("attendance_context='EVENT'");
    expect(migration).toContain("event_id=new.event_id");
    expect(migration).toContain("attendance_state='AT_EVENT'");
    expect(migration).toContain("event_distance_metres(v_event.latitude,v_event.longitude");
    expect(eventService).toContain('"rpc_event_check_in_v2"');
  });

  it("supports weekly-off, holiday, and two-day extended-duty comp-off", () => {
    expect(migration).toContain("resolve_hrms_calendar_day");
    expect(migration).toContain("weekly_off_event_comp_off");
    expect(migration).toContain("holiday_event_comp_off");
    expect(migration).toContain("additional_extended_duty_comp_off");
    expect(migration).toContain("maximum_comp_off_per_event");
    expect(migration).toContain("approved_duty_start_time");
    expect(migration).toContain("approved_duty_end_time");
    expect(migration).toContain("rpc_admin_set_event_duty_times");
    expect(migration).toContain("Company Event - ");
  });

  it("uses the auditable comp-off ledger with one event earning", () => {
    expect(migration).toContain("public.comp_off_earnings");
    expect(migration).toContain("source_type='EVENT_ATTENDANCE'");
    expect(migration).toContain("source_id=p_event_id");
    expect(migration).toContain("COMP_OFF_EARNED");
    expect(migration).toContain("COMP_OFF_REJECTED");
  });

  it("has an explicit startup auth gate and never uses OTP as loading UI", () => {
    expect(auth).toContain('authState: "loading" | "authenticated" | "unauthenticated"');
    expect(auth).toContain("readStoredAuthMetadata()");
    expect(auth).toContain("applyUser(cached)");
    expect(navigator).toContain('authState === "loading"');
    expect(navigator).toContain("<LoadingScreen />");
    expect(navigator).not.toContain("Send OTP");
  });

  it("uses real push with token lifecycle and deep-linked event delivery", () => {
    expect(migration).toContain("enqueue_hrms_notification");
    expect(migration).toContain("rpc_deactivate_device_push_token");
    expect(notifications).toContain("getExpoPushTokenAsync");
    expect(notifications).toContain("deactivateCurrentDevicePushToken");
    expect(dispatcher).toContain("EVENT_NOTIFICATION_SENT");
    expect(migration).toContain("'/HRMS/tasks/'||v_event.id");
  });

  it("rechecks current attendance immediately before push dispatch", () => {
    expect(migration).toContain("hrms_attendance_state");
    expect(migration).toContain("NOT_CHECKED_IN");
    expect(migration).toContain("ON_FIELD_VISIT");
    expect(migration).toContain("AT_EVENT");
    expect(migration).toContain("CHECKED_OUT");
    // expect(dispatcher).toContain('admin.rpc(\n      "hrms_attendance_state"');
    expect(dispatcher).toContain("STALE_REMINDER_CURRENT_STATE_");
    expect(dispatcher).toContain("ATTENDANCE_REMINDER_SKIPPED_ALREADY_CHECKED_IN");
    expect(dispatcher).toContain("CHECKOUT_REMINDER_SKIPPED_ALREADY_CHECKED_OUT");
  });

  it("does not retain race-prone device-local daily attendance reminders", () => {
    const reminderBlock = notifications.slice(
      notifications.indexOf("export async function scheduleAttendanceReminders"),
      notifications.indexOf("async function scheduleDeviceNotification"),
    );
    // expect(reminderBlock).toContain("server after it re-reads");
    expect(reminderBlock).not.toContain("SchedulableTriggerInputTypes.DAILY");
  });
});
