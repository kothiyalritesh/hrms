import fs from "fs";
import path from "path";

const mockRpc = jest.fn();
jest.mock("@react-native-async-storage/async-storage", () =>
  require("@react-native-async-storage/async-storage/jest/async-storage-mock"),
);
jest.mock("@/lib/supabase", () => ({
  supabase: { rpc: (...args: unknown[]) => mockRpc(...args), from: jest.fn() },
}));

import {
  AttendanceService,
  GeoFenceError,
  SiteCheckInAvailableError,
} from "@/services/attendance.service";

const read = (relativePath: string) =>
  fs.readFileSync(path.resolve(__dirname, "..", relativePath), "utf8").replace(/\r\n/g, "\n");

const office = { id: "o1", name: "Noida 136", latitude: 28.6, longitude: 77.2, allowed_radius_meters: 200 };
const atSite = { latitude: 28.62, longitude: 77.22, accuracy: 10, mocked: false };
const nimbus = { id: "s1", name: "Nimbus Arista", project_name: "Nimbus", address: null, distance_m: 4, radius_m: 100 };

describe("Home Check-In at a predefined site", () => {
  beforeEach(() => {
    mockRpc.mockReset();
    jest.spyOn(AttendanceService as any, "getActiveOffices").mockResolvedValue([office]);
  });
  afterEach(() => jest.restoreAllMocks());

  test("outside the office but at a site: site check-in is offered, nothing reported as suspicious", async () => {
    mockRpc.mockImplementation(async (name: string) =>
      name === "rpc_checkin_sites_nearby" ? { data: [nimbus], error: null } : { data: null, error: null },
    );
    const attempt = AttendanceService.officeCheckIn({ userId: "u1", location: atSite });
    await expect(attempt).rejects.toBeInstanceOf(SiteCheckInAvailableError);
    await attempt.catch((err: SiteCheckInAvailableError) => expect(err.sites[0].name).toBe("Nimbus Arista"));
    expect(mockRpc.mock.calls.map((c) => c[0])).not.toContain("rpc_report_outside_office_checkin");
    expect(mockRpc.mock.calls.map((c) => c[0])).not.toContain("rpc_attendance_checkin_v3");
  });

  test("outside the office and at no site: unchanged (reported, geofence error)", async () => {
    mockRpc.mockImplementation(async (name: string) =>
      name === "rpc_checkin_sites_nearby" ? { data: [], error: null } : { data: null, error: null },
    );
    await expect(AttendanceService.officeCheckIn({ userId: "u1", location: atSite })).rejects.toBeInstanceOf(GeoFenceError);
    expect(mockRpc.mock.calls.map((c) => c[0])).toContain("rpc_report_outside_office_checkin");
  });

  test("site check-in sends the reading with its capture time; the server decides", async () => {
    mockRpc.mockResolvedValue({
      data: { success: true, mode: "STARTED_DAY", site_name: "Nimbus Arista", message: "Checked in at Nimbus Arista." },
      error: null,
    });
    const result = await AttendanceService.siteCheckIn({
      siteId: "s1",
      location: { ...atSite, capturedAt: "2026-10-22T05:00:00.000Z" },
    });
    expect(result.mode).toBe("STARTED_DAY");
    expect(mockRpc).toHaveBeenCalledWith("rpc_attendance_checkin_at_site", {
      p_site_id: "s1",
      p_location: { latitude: 28.62, longitude: 77.22, accuracy: 10, mocked: false, captured_at: "2026-10-22T05:00:00.000Z" },
    });
  });
});

describe("Office return and site check-in rules ship with the app", () => {
  const sql = read("supabase/migrations/20261022100000_site_checkin_and_office_return.sql");

  test("an office punch after the visit ends it without checking out the day", () => {
    expect(sql).toContain("AND l.log_date > r.started + interval '2 minutes'");
    expect(sql).toContain("auto_close_reason = 'OFFICE_RETURN_BIOMETRIC'");
    // the day's checkout is never assigned here (only read in a WHERE)
    expect(sql).not.toMatch(/attendance_logs SET[^;]*checkout_time\s*=/);
  });

  test("the punch import can never be blocked by the reconciliation", () => {
    expect(sql).toContain("RAISE WARNING 'office return reconciliation skipped");
  });

  test("site check-in reuses the existing day link and the check-in lock", () => {
    expect(sql).toContain("public.sync_field_visit_arrival_attendance(v_visit_id)");
    expect(sql).toContain("pg_advisory_xact_lock(hashtextextended(v_uid::text || ':' || v_today::text, 0))");
  });

  test("Home offers sites and explains the office radius", () => {
    const home = read("screens/DashboardScreen.tsx");
    expect(home).toContain("err instanceof SiteCheckInAvailableError");
    expect(home).toContain("await runSiteCheckIn(err.sites)");
    expect(home).not.toContain('"GEO_FENCE_BLOCKED"');
  });

  test("HR links each biometric machine to its office from the HR Panel", () => {
    const migration = read("supabase/migrations/20261022110000_biometric_device_linking.sql");
    expect(migration).toContain("public.is_profile_admin() OR public.hrms_has_permission('biometric.manage')");
    expect(migration).toContain("WHERE serial_number = v_serial AND office_id IS NULL");
    expect(migration).toContain("public.hrms_close_visits_on_office_return(r.user_id, v_today)");
    expect(read("constants/permissionCatalog.ts")).toContain('BiometricDevices: ["biometric.manage"]');
    expect(read("screens/admin/AdminDashboardScreen.tsx")).toContain('navigation.navigate("BiometricDevices")');
    expect(read("screens/admin/BiometricDevicesScreen.tsx")).toContain('supabase.rpc("rpc_link_biometric_device"');
  });

  test("Attendance Control falls back to the day's site visits when the day story is not available", () => {
    const screen = read("screens/admin/AttendanceControlScreenNew.tsx");
    expect(screen).toContain("<VisitLines visits={dayVisits[key]} textColor={textColor} />");
    expect(screen).toContain("ended ${at} (back at office)");
    expect(screen).toContain("left ${fmt(v.departed_at)}, not checked out");
  });
});

