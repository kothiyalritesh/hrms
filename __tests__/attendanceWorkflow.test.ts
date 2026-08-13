// @ts-nocheck -- source-level integration contract guards.
import fs from "fs";
import path from "path";

const read = (file: string) =>
  fs.readFileSync(path.resolve(__dirname, "..", file), "utf8");

describe("authoritative attendance and field-visit workflow", () => {
  const migration = read(
    "supabase/migrations/20260803040000_attendance_field_biometric_location_optimization.sql",
  );
  const firstPunchMigration = read(
    "supabase/migrations/20260804010000_biometric_first_punch_and_unmapped_admin.sql",
  );
  const fieldVisitIdempotencyFix = read(
    "supabase/migrations/20260804020000_fix_field_visit_idempotency_text_uuid.sql",
  );

  it("does not redirect checkout into the Field Visit screen", () => {
    expect(read("screens/DashboardScreen.tsx")).not.toContain("checkoutIntent");
    expect(read("screens/AttendanceScreen.tsx")).not.toContain(
      "checkoutIntent",
    );
    expect(read("components/AttendanceCheckoutFlow.tsx")).toContain(
      "What are you doing next?",
    );
    expect(read("components/AttendanceCheckoutFlow.tsx")).toContain(
      'reason: "GOING_HOME"',
    );
  });

  it("sends the complete idempotent checkout contract and requires a server timestamp", () => {
    const service = read("services/attendance.service.ts");
    for (const parameter of [
      "p_user_id",
      "p_attendance_id",
      "p_checkout_location",
      "p_checkout_reason",
      "p_idempotency_key",
    ])
      expect(service).toContain(parameter);
    expect(service).toContain("CHECKOUT_NOT_COMMITTED");
    expect(migration).toContain("for update");
    expect(migration).toContain("IDEMPOTENCY_KEY_REUSE_CONFLICT");
    expect(migration).toContain("attendance_state = 'CHECKED_OUT'");
  });

  it("keeps attendance active for destination visits", () => {
    expect(migration).toContain("attendance_state='ON_FIELD_VISIT'");
    expect(migration).toContain("VALID_DESTINATION_COORDINATES_REQUIRED");
    expect(migration).toContain("visit_state='COMPLETED'");
    const createBlock = migration.slice(
      migration.indexOf("if v_action='CREATE'"),
      migration.indexOf("else\n    if p_visit_id"),
    );
    expect(createBlock).not.toContain("checkout_time=");
  });

  it("matches the established text field-visit idempotency column", () => {
    expect(fieldVisitIdempotencyFix).toContain(
      "v_key text := nullif(btrim(p_values->>'idempotency_key'),'')",
    );
    expect(fieldVisitIdempotencyFix).toContain("idempotency_key=v_key");
    expect(fieldVisitIdempotencyFix).not.toContain(
      "p_values->>'idempotency_key','')::uuid",
    );
    expect(fieldVisitIdempotencyFix).toContain(
      "rpc_mutate_own_field_visit(text,uuid,jsonb)",
    );
  });

  it("deduplicates biometric punches without auto-checking out", () => {
    expect(migration).toContain("employee_biometric_mappings");
    expect(migration).toContain("partition by range(punch_timestamp)");
    expect(migration).toContain(
      "unique(device_id,biometric_employee_code,punch_timestamp,source_event_id)",
    );
    expect(migration).toContain("PUNCH_AFTER_GOING_HOME");
    expect(migration).toContain("FIRST_VALID_PUNCH_NO_AUTOMATIC_CHECKOUT");
  });

  it("uses only the earliest biometric punch and audits check-in corrections", () => {
    expect(firstPunchMigration).toContain(
      "least(coalesce(checkin_time, v_day_first), v_day_first)",
    );
    expect(firstPunchMigration).toContain(
      "biometric_attendance_correction_audit",
    );
    expect(firstPunchMigration).toContain("BIOMETRIC_CHECKIN_TIME_CORRECTED");
    expect(firstPunchMigration).toContain("biometric_last_punch = null");
    expect(firstPunchMigration).toContain("biometric_punch_count = 1");
    expect(firstPunchMigration).not.toContain(
      "set checkout_time = p_last_punch",
    );
  });

  it("provides a classified, exportable manual biometric mapping workflow", () => {
    const screen = read("screens/admin/BiometricUserMatchScreen.tsx");
    expect(firstPunchMigration).toContain(
      "rpc_list_unmapped_biometric_employees",
    );
    expect(firstPunchMigration).toContain("name_only_matching_disabled");
    expect(firstPunchMigration).toContain("HRMS_EMPLOYEE_NUMBER");
    expect(screen).toContain("Export Unmapped Employees to Excel");
    expect(screen).toContain("Map Employee");
    expect(screen).toContain("Unmapped Biometric Employees");
  });

  it("bounds location search and ignores old responses", () => {
    const search = read("components/LocationSearchInput.tsx");
    expect(search).toContain("q.length < 3");
    expect(search).toContain("debouncedSearch = useDebounce(search, 400)");
    expect(search).toContain("sequence !== searchSequence.current");
    expect(search).toContain("slice(0, 6)");
    expect(search).toContain("9_000");
    expect(search).toContain("AutocompleteSessionToken");
  });

  it("provides device sessions, RLS, PostGIS and bounded maintenance", () => {
    expect(migration).toContain("user_device_sessions");
    expect(migration).toContain("enable row level security");
    expect(migration).toContain("using gist(location_point)");
    expect(migration).toContain("run_hrms_maintenance");
    expect(migration).toContain("limit p_batch_size");
  });

  it("provides the exact private check-in overload used by the protected RPC", () => {
    const hotfix = read(
      "supabase/migrations/20260804000000_fix_attendance_checkin_rpc_overload.sql",
    );
    expect(hotfix).toContain("p_distance double precision");
    expect(hotfix).toContain("p_source text");
    expect(hotfix).toContain("attendance_state = 'WORKING'");
    expect(hotfix).toContain("pg_advisory_xact_lock");
  });
});
