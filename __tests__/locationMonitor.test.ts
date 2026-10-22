import fs from "fs";
import path from "path";

import { formatPhone, telUrl } from "@/utils/phoneCall";

const read = (relativePath: string) =>
  fs.readFileSync(path.resolve(__dirname, "..", relativePath), "utf8").replace(/\r\n/g, "\n");

describe("Call employee uses the HRMS login phone", () => {
  test("10-digit login phones are dialled with +91", () => {
    expect(telUrl("9876543210")).toBe("tel:+919876543210");
    expect(telUrl("+91 98765-43210")).toBe("tel:+919876543210");
    expect(telUrl("919876543210")).toBe("tel:+919876543210");
    expect(formatPhone("9876543210")).toBe("+91 98765 43210");
  });

  test("missing or junk numbers give no call link", () => {
    expect(telUrl(null)).toBeNull();
    expect(telUrl("  ")).toBeNull();
    expect(telUrl("12")).toBeNull();
  });
});

describe("Location monitor and office exit flow are wired end to end", () => {
  const sql = read("supabase/migrations/20261021120000_location_monitor_and_exit_reasons.sql");

  test("outside needs a recent fix; stale and missing locations are separate", () => {
    expect(sql).toContain("WHEN b.fix_at IS NULL THEN 'NO_LOCATION'");
    expect(sql).toContain("WHEN b.age_min > 15 THEN 'NO_RECENT_LOCATION'");
    expect(sql).toContain("SELECT public.authorized_user_ids('live_tracking.view')");
  });

  test("the reason form is shown app-wide, not only on the home screen", () => {
    expect(read("App.tsx")).toContain("<OfficeExitReasonHost />");
    const home = read("screens/DashboardScreen.tsx");
    expect(home).not.toContain("<GeofenceReasonModal");
    expect(home).toContain("requestOfficeExitPrompt(String(linkedGeofenceEvent))");
    expect(read("screens/NotificationsScreen.tsx")).toContain("requestOfficeExitPrompt(officeExitEventIdFrom(");
  });

  test("HR Panel opens the monitor with the tracking permission", () => {
    expect(read("constants/permissionCatalog.ts")).toContain('LocationMonitor: ["live_tracking.view"]');
    expect(read("screens/admin/AdminDashboardScreen.tsx")).toContain('navigation.navigate("LocationMonitor")');
    expect(read("App.tsx")).toContain('LocationMonitor: "location-monitor"');
  });
});
