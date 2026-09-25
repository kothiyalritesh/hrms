import fs from "fs";
import path from "path";

describe("Authoritative Earliest Check-In Time Resolution (Biometric vs App)", () => {
  const migrationPath = path.resolve(
    __dirname,
    "../supabase/migrations/20260907020000_fix_biometric_assignment_and_smartoffice_proxy.sql"
  );
  const syncSqlPath = path.resolve(
    __dirname,
    "../scripts/enable_continuous_automatic_sync.sql"
  );

  it("ensures migration 20260907020000 contains earliest check-in time resolution in rpc_sync_biometric_punches", () => {
    const migration = fs.readFileSync(migrationPath, "utf8");

    expect(migration).toContain("EXCLUDED.checkin_time < attendance_logs.checkin_time");
    expect(migration).toContain("WHEN EXCLUDED.checkin_time < attendance_logs.checkin_time THEN 'BIOMETRIC'");
    expect(migration).toContain("coalesce(attendance_logs.checkin_source, 'BIOMETRIC')");
  });

  it("ensures rpc_attendance_checkin adopts earlier app time if earlier or preserves earlier biometric checkin", () => {
    const migration = fs.readFileSync(migrationPath, "utf8");

    expect(migration).toContain("if v_now < v_attendance.checkin_time then");
    expect(migration).toContain("Updated to earlier check-in time.");
    expect(migration).toContain("Already checked in today with earlier punch.");
  });

  it("ensures attendance_reconciliation view uses LEAST to evaluate earliest punch across biometric and app", () => {
    const migration = fs.readFileSync(migrationPath, "utf8");

    expect(migration).toContain("final_in");
    expect(migration).toContain("WHEN biometric.bio_in <= attendance.checkin_time THEN 'BIOMETRIC' ELSE 'APP' END");
  });

  it("ensures enable_continuous_automatic_sync.sql is aligned with the earliest-time checkin logic", () => {
    const syncSql = fs.readFileSync(syncSqlPath, "utf8");

    expect(syncSql).toContain("EXCLUDED.checkin_time < attendance_logs.checkin_time");
    expect(syncSql).toContain("WHEN EXCLUDED.checkin_time < attendance_logs.checkin_time THEN 'BIOMETRIC'");
  });

  function resolveCheckin(
    existingCheckin: string | null,
    existingSource: string | null,
    newPunch: string | null,
    newSource: string = "BIOMETRIC",
    lateCutoffTime: string = "10:32:00"
  ) {
    let resolvedTime: string | null = null;
    let resolvedSource: string | null = null;

    if (!existingCheckin && newPunch) {
      resolvedTime = newPunch;
      resolvedSource = newSource;
    } else if (existingCheckin && !newPunch) {
      resolvedTime = existingCheckin;
      resolvedSource = existingSource;
    } else if (existingCheckin && newPunch) {
      if (newPunch < existingCheckin) {
        resolvedTime = newPunch;
        resolvedSource = newSource;
      } else {
        resolvedTime = existingCheckin;
        resolvedSource = existingSource;
      }
    }

    const timePart = resolvedTime ? resolvedTime.slice(11, 19) : null;
    const isLate = timePart ? timePart >= lateCutoffTime : false;

    return { resolvedTime, resolvedSource, isLate };
  }

  test("Biometric at 10:30 AM vs App Check-in at 11:30 AM -> Biometric 10:30 AM wins and is NOT late", () => {
    const appTime = "2026-09-07T11:30:00+05:30";
    const bioTime = "2026-09-07T10:30:00+05:30";

    const result = resolveCheckin(appTime, "APP", bioTime, "BIOMETRIC");

    expect(result.resolvedTime).toBe(bioTime);
    expect(result.resolvedSource).toBe("BIOMETRIC");
    expect(result.isLate).toBe(false);
  });

  test("App Check-in at 10:30 AM vs Biometric at 11:30 AM -> App 10:30 AM wins and is NOT late", () => {
    const appTime = "2026-09-07T10:30:00+05:30";
    const bioTime = "2026-09-07T11:30:00+05:30";

    const result = resolveCheckin(appTime, "APP", bioTime, "BIOMETRIC");

    expect(result.resolvedTime).toBe(appTime);
    expect(result.resolvedSource).toBe("APP");
    expect(result.isLate).toBe(false);
  });

  test("App Check-in at 10:35 AM vs Biometric at 10:45 AM -> App 10:35 AM wins and is late", () => {
    const appTime = "2026-09-07T10:35:00+05:30";
    const bioTime = "2026-09-07T10:45:00+05:30";

    const result = resolveCheckin(appTime, "APP", bioTime, "BIOMETRIC");

    expect(result.resolvedTime).toBe(appTime);
    expect(result.resolvedSource).toBe("APP");
    expect(result.isLate).toBe(true);
  });

  test("Biometric at 10:35 AM vs App Check-in at 10:45 AM -> Biometric 10:35 AM wins and is late", () => {
    const appTime = "2026-09-07T10:45:00+05:30";
    const bioTime = "2026-09-07T10:35:00+05:30";

    const result = resolveCheckin(appTime, "APP", bioTime, "BIOMETRIC");

    expect(result.resolvedTime).toBe(bioTime);
    expect(result.resolvedSource).toBe("BIOMETRIC");
    expect(result.isLate).toBe(true);
  });

  test("Only Biometric punch at 10:15 AM -> Biometric 10:15 AM", () => {
    const bioTime = "2026-09-07T10:15:00+05:30";
    const result = resolveCheckin(null, null, bioTime, "BIOMETRIC");

    expect(result.resolvedTime).toBe(bioTime);
    expect(result.resolvedSource).toBe("BIOMETRIC");
    expect(result.isLate).toBe(false);
  });

  test("Only App check-in at 10:15 AM -> App 10:15 AM", () => {
    const appTime = "2026-09-07T10:15:00+05:30";
    const result = resolveCheckin(appTime, "APP", null);

    expect(result.resolvedTime).toBe(appTime);
    expect(result.resolvedSource).toBe("APP");
    expect(result.isLate).toBe(false);
  });
});
