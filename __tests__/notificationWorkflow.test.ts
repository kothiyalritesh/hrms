// @ts-nocheck -- source-contract tests; database runtime is verified separately.
import fs from "fs";
import path from "path";

const read = (relativePath: string) =>
  fs.readFileSync(path.resolve(__dirname, "..", relativePath), "utf8");

describe("unified mobile notification workflow", () => {
  const migration = read(
    "supabase/migrations/20260805010000_unified_mobile_notification_outbox.sql",
  );
  const dispatcher = read("supabase/functions/notification-dispatch/index.ts");
  const catchupRepair = read(
    "supabase/migrations/20260805020000_suppress_historical_notification_catchup.sql",
  );

  it("queues one 18:35 IST checkout reminder per employee and date", () => {
    expect(migration).toContain("time '18:35:00'");
    expect(migration).toContain("attendance.checkout_time is null");
    expect(migration).toContain("attendance-missing-checkout:");
    expect(migration).toContain("'Open Checkout'");
    expect(migration).toContain("unique");
    expect(catchupRepair).toContain("historical_field_visit_catchup_suppressed");
  });

  it("covers field visit, leave, regularization, task and HR events", () => {
    for (const contract of [
      "notify_field_visit_workflow",
      "notify_leave_workflow",
      "notify_regularization_workflow",
      "notify_task_workflow",
      "notify_event_updated",
      "notify_holiday_change",
      "task_due_soon",
      "task_overdue",
      "field_visit_overdue",
    ]) {
      expect(migration).toContain(contract);
    }
  });

  it("uses a retrying Expo outbox with receipts and invalid-token cleanup", () => {
    expect(dispatcher).toContain("notification_push_outbox");
    expect(dispatcher).toContain("notification_push_deliveries");
    expect(dispatcher).toContain("push/getReceipts");
    expect(dispatcher).toContain("DeviceNotRegistered");
    expect(dispatcher).toContain('Deno.env.get("SUPABASE_ANON_KEY")');
  });

  it("registers Android channels and checkout action category", () => {
    const nativeNotifications = read("services/location/notification.service.ts");
    expect(nativeNotifications).toContain('"hrms_field_visits"');
    expect(nativeNotifications).toContain('"hrms_leave"');
    expect(nativeNotifications).toContain('"hrms_tasks"');
    expect(nativeNotifications).toContain('"hrms_announcements"');
    expect(nativeNotifications).toContain('identifier: "OPEN_CHECKOUT"');
    expect(nativeNotifications).toContain('buttonTitle: "Open Checkout"');
  });
});
