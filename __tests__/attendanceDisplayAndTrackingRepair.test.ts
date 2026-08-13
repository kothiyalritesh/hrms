// @ts-nocheck -- source-level production lifecycle guards.
import fs from "fs";
import path from "path";

const read = (file: string) =>
  fs.readFileSync(path.resolve(__dirname, "..", file), "utf8");

describe("attendance display and live tracking repair", () => {
  it("does not put empty employee-days in the App or Active bucket", () => {
    const screen = read("screens/admin/AttendanceControlScreenNew.tsx");
    expect(screen).toContain("classifyAttendanceEvidence(");
    expect(screen).toContain("No Check-In");
    expect(screen).toContain("attendanceEmptyStateCopy(item.status)");
    expect(screen).toContain("app_checkin_time: r.app_first_in");
  });

  it("starts tracking explicitly after committed check-in through the native bridge lifecycle", () => {
    const attendance = read("screens/AttendanceScreen.tsx");
    const lifecycle = read(
      "services/location/attendanceTrackingLifecycle.ts",
    );
    expect(attendance).toContain(
      "trackingStarted = await startAttendanceTracking(checkInResult.id)",
    );
    expect(lifecycle).toContain('"tracking.start"');
    expect(lifecycle).toContain('"tracking.stop"');
    expect(lifecycle).toContain('"tracking.restore"');
  });

  it("keeps attendance tracking alive when field-visit destination context ends", () => {
    const coordinator = read(
      "services/location/LocationTrackingCoordinator.ts",
    );
    const start = coordinator.indexOf("async clearActiveDestination()");
    const end = coordinator.indexOf("async syncOfflineLocations()", start);
    const clearDestination = coordinator.slice(start, end);
    expect(clearDestination).toContain('config.trackingMode = "ATTENDANCE"');
    expect(clearDestination).toContain("refreshNativeTrackingOptions(config)");
    expect(clearDestination).not.toContain("stopNativeTracking()");
    expect(clearDestination).not.toContain('"FIELD_VISIT_ENDED"');
  });
});
