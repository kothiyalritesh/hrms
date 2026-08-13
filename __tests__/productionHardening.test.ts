// @ts-nocheck -- source-contract tests run in Node, not the app runtime.
import fs from "fs";
import path from "path";

const read = (relativePath: string) =>
  fs.readFileSync(path.resolve(__dirname, "..", relativePath), "utf8");

const sourceFiles = (relativeDirectory: string): string[] => {
  const directory = path.resolve(__dirname, "..", relativeDirectory);
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const relativePath = path.join(relativeDirectory, entry.name);
    if (entry.isDirectory()) return sourceFiles(relativePath);
    return /\.(?:ts|tsx|js)$/.test(entry.name) ? [relativePath] : [];
  });
};

describe("production hardening contracts", () => {
  it("uses one configured web base path for Expo and the runtime shell", () => {
    const config = read("app.config.js");
    const app = read("App.tsx");
    const fallback = read("components/ErrorFallback.tsx");
    const webRouting = read("utils/webRouting.ts");
    expect(config).toContain('webBasePath: expoBaseUrl || "/"');
    expect(webRouting).toContain("Constants.expoConfig?.extra?.webBasePath");
    expect(app).not.toContain('EXPO_PUBLIC_WEB_BASE_PATH ?? "HRMS"');
    expect(app).toContain("workerUrl.searchParams.set(\"build\", WEB_BUILD_ID)");
    expect(app).toContain("updateViaCache: \"none\"");
    expect(app).toContain('{ path: webBasePath.replace(/^\\/+|\\/+$/g, "") }');
    expect(app).toContain("ReportsTab: {");
    expect(app).toContain('path: "reports"');
    expect(fallback).toContain("window.location.replace(applicationRoot.href)");
  });

  it("embeds a non-empty backend schema and build identity in every release", () => {
    const release = JSON.parse(read("release.config.json"));
    const config = read("app.config.js");
    const app = read("App.tsx");
    const exporter = read("export_web.ps1");
    expect(release.requiredBackendSchemaVersion).toMatch(/^\d{14}$/);
    expect(release.buildId).not.toBe("local");
    expect(config).toContain(
      "requiredBackendSchemaVersion: releaseConfig.requiredBackendSchemaVersion",
    );
    expect(app).not.toContain("ReleaseContractGuard");
    expect(exporter).toContain("__BOP_PRECACHE_ASSETS__");
    expect(exporter).toContain("Get-ChildItem -LiteralPath $scriptDirectory");
    expect(exporter).toContain("expo export --platform web --clear");
    expect(exporter).toContain("Exported bundle build IDs do not match");
    expect(exporter).toContain("Exported bundle schema versions do not match");
    expect(exporter).toContain("http-equiv=\"X-UA-Compatible\"");
  });

  it("assigns permanent web paths to every navigable employee and admin screen", () => {
    const app = read("App.tsx");
    const routeSources = [
      "navigation/HomeStackNavigator.tsx",
      "navigation/ProfileStackNavigator.tsx",
      "navigation/TasksStackNavigator.tsx",
      "navigation/AdminStackNavigator.tsx",
    ].map(read).join("\n");
    const routeNames = Array.from(
      routeSources.matchAll(/<Stack\.Screen\s+name="([^"]+)"/g),
      (match) => match[1],
    );
    for (const routeName of new Set(routeNames)) {
      expect(app).toContain(`${routeName}:`);
    }
    expect(app).toContain('path: "admin"');
    expect(app).toContain('path: "account"');
    expect(app).toContain('SmartOfficeImportedData: "imported-data"');
  });

  it("exposes configuration and imported biometric records from the admin UI", () => {
    const dashboard = read("screens/admin/AdminDashboardScreen.tsx");
    expect(dashboard).toContain('navigation.navigate("OfficeSettings")');
    expect(dashboard).toContain('navigation.navigate("SmartOfficeImportedData")');
  });

  it("keeps login OTP timers singular and rejects invalid Indian mobile numbers", () => {
    const login = read("screens/LoginScreen.tsx");
    expect(login).toContain("clearResendTimer();");
    expect(login).toContain("useEffect(() => () => clearResendTimer(), [])");
    expect(login).toContain("/^[6-9]\\d{9}$/");
    expect(login).toContain("Failed to resend OTP");
  });

  it("does not silently cap audited record lists", () => {
    const auditedSources = [
      "screens/NotificationsScreen.tsx",
      "screens/admin/NotificationManagementScreen.tsx",
      "screens/admin/AuditLogsScreen.tsx",
      "screens/admin/SuspiciousAttendanceScreen.tsx",
      "screens/admin/SmartOfficeImportedData.tsx",
      "screens/admin/AttendanceControlScreenNew.tsx",
      "screens/MyTeamScreen.tsx",
    ].map(read).join("\n");
    expect(auditedSources).not.toMatch(/\.limit\((?:50|100|500)\)/);
    expect(auditedSources).toContain("fetchAllPages");
  });

  it("never auto-matches biometric attendance by employee name", () => {
    const importer = read("services/attendance-import.service.ts");
    expect(importer).toContain("codeOwnerCount");
    expect(importer).toContain("matchedFileCodes");
    expect(importer).not.toContain("// 2. Exact name match");
    expect(importer).not.toContain("Partial name match");
    expect(importer).not.toContain(".eq('is_active', true)");
  });

  it("verifies the exact biometric file and batch identities", () => {
    const importer = read("services/attendance-import.service.ts");
    const edge = read("supabase/functions/biometric-manual-import/index.ts");
    expect(importer).toContain(
      "String(response?.batch_id).toLowerCase() !== context.batchId.toLowerCase()",
    );
    expect(importer).toContain(
      "String(response?.source_file_hash).toLowerCase() !== context.sourceFileHash.toLowerCase()",
    );
    expect(edge).toContain('"apply_biometric_import_batch_v3"');
    expect(edge).toContain("rows.length > 5000");
  });

  it("allows protected sync for today but rejects future biometric dates", () => {
    const migration = read(
      "supabase/migrations/20260730200000_historical_biometric_import_v3.sql",
    );
    expect(migration).toContain(
      "r.log_date > (now() at time zone 'Asia/Kolkata')::date",
    );
    expect(migration).not.toContain(
      "r.log_date >= (now() at time zone 'Asia/Kolkata')::date",
    );
  });

  it("does not bundle the removed legacy reports implementation", () => {
    expect(
      fs.existsSync(
        path.resolve(__dirname, "..", "screens", "admin", "ReportsScreen.tsx"),
      ),
    ).toBe(false);
    expect(read("navigation/ReportsStackNavigator.tsx")).toContain(
      'import("@/screens/admin/AdvancedAttendanceReportScreen")',
    );
  });

  it("ships CSP and rejects every common missing static asset type", () => {
    const apache = read("public/.htaccess");
    expect(apache).toContain("Content-Security-Policy");
    expect(apache).toContain("frame-ancestors 'none'");
    expect(apache).toContain(
      "frame-src 'self' https://www.google.com https://maps.google.com",
    );
    expect(apache).toContain("woff2?");
    expect(apache).toContain("jpe?g");
    expect(apache).toContain("https://nominatim.openstreetmap.org");
    expect(apache).toContain("https://www.googleapis.com");
  });

  it("uses a client request ID for retry-safe protected biometric sync", () => {
    const screen = read("screens/admin/SmartOfficeSecureSyncScreen.tsx");
    const service = read("services/biometric-sync-secure.service.ts");
    const edge = read("supabase/functions/biometric-attendance-sync/index.ts");
    expect(screen).toContain("biometricSyncService.runRange");
    expect(screen).toContain("recoverPendingRequest()");
    expect(service).toContain("PENDING_SYNC_KEY");
    expect(service).toContain("await savePendingRequest(pending)");
    expect(service).toContain('action: "status"');
    expect(edge).toContain("biometric_sync_requests");
    expect(edge).toContain("const batchId = requestId");
  });

  it("declares every required deployed Edge Function without blocking startup", () => {
    const release = JSON.parse(read("release.config.json"));
    const app = read("App.tsx");
    expect(Object.keys(release.requiredEdgeFunctionVersions).sort()).toEqual(
      [
        "biometric-attendance-sync",
        "biometric-punch-webhook",
        "field-visit-evidence-upload",
        "notification-dispatch",
        "otp-auth",
        "smartoffice-proxy",
      ].sort(),
    );
    expect(app).not.toContain('body: { action: "version" }');
    expect(app).not.toContain("backendEdgeVersions");
    for (const functionName of Object.keys(
      release.requiredEdgeFunctionVersions,
    )) {
      const edge = read(`supabase/functions/${functionName}/index.ts`);
      expect(edge).toContain('action === "version"');
      expect(edge).toContain(`function: "${functionName}"`);
      expect(edge).toContain(release.requiredBackendSchemaVersion);
      const userAuthentication = edge.indexOf(".auth.getUser(");
      if (userAuthentication >= 0) {
        expect(edge.indexOf('action === "version"')).toBeLessThan(
          userAuthentication,
        );
      }
    }
  });

  it("refreshes SmartOffice profiles through one confirmed batch RPC", () => {
    const service = read("services/smartoffice.service.ts");
    const screen = read("screens/admin/SmartOfficeImportedData.tsx");
    expect(service).toContain("rpc_admin_sync_smartoffice_profiles_batch");
    expect(screen).toContain("syncEmployeeProfilesBatch(employees)");
    expect(screen).not.toContain("rpc_admin_sync_smartoffice_profile");
  });

  it("does not guess UTC for offset-less official timestamps", () => {
    const businessDate = read("utils/businessDate.ts");
    const webTimeline = read("components/LocationTimelineModal.web.tsx");
    const nativeTimeline = read("components/LocationTimelineModal.tsx");
    expect(businessDate).toContain("DATABASE_TIMESTAMP_TIMEZONE_REQUIRED");
    expect(webTimeline).not.toContain('recorded_at + "Z"');
    expect(nativeTimeline).not.toContain('recorded_at + "Z"');
  });

  it("sends redacted operational failures to central support monitoring", () => {
    const reporting = read("utils/operationalErrors.ts");
    const migration = read(
      "supabase/migrations/20260730230000_sync_idempotency_monitoring_and_release.sql",
    );
    expect(reporting).toContain("rpc_record_client_operational_error");
    expect(migration).toContain("rpc_admin_recent_client_operational_errors");
    expect(migration).toContain("correlation_id");
  });

  it("never persists biometric mappings derived from employee names", () => {
    const service = read("services/smartoffice.service.ts");
    const importScreen = read("screens/admin/SmartOfficeEmployeeImport.tsx");
    expect(service).not.toContain("localName.includes");
    expect(service).not.toContain("soName.includes");
    expect(importScreen).not.toContain("smartOfficeCode || smartOfficeName");
    expect(importScreen).not.toContain("soCode || soName");
    expect(importScreen).not.toContain("p_employee_code: soName");
  });

  it("provides visible live-location and map-search recovery paths", () => {
    const search = read("components/LocationSearchInput.tsx");
    const webMap = read("components/MapPickerModal.web.tsx");
    expect(search).toContain("Use Live Location");
    expect(search).toContain("searchError");
    expect(search).toContain("maximumAge: 0");
    expect(webMap).toContain("Retry Map");
    expect(webMap).toContain("useLiveLocation");
  });

  it("confirms field-visit business results before changing tracking state", () => {
    const service = read("services/field-visit.service.ts");
    expect(service).toContain("confirmedVisitMutation");
    expect(service).toContain('status: "CHECKED_IN"');
    expect(service).toContain('status: "COMPLETED"');
    expect(service).toContain('status: "MISSED"');
    expect(service).toContain("businessDateUtcRange(today)");
  });

  it("keeps degraded SmartOffice directory rows read-only", () => {
    const service = read("services/smartoffice.service.ts");
    expect(service).toContain('"DEVICE_LOG_FALLBACK"');
    expect(service).toContain('"OFFICIAL_DIRECTORY"');
    expect(service).toContain(
      "Permanent profile refresh is blocked because the official SmartOffice employee directory was unavailable",
    );
  });

  it("uses server policy for warnings and server-confirmed late status", () => {
    const attendance = read("services/attendance.service.ts");
    const control = read("screens/admin/AttendanceControlScreenNew.tsx");
    const migration = read(
      "supabase/migrations/20260730240000_confirm_field_visits_warnings_and_release.sql",
    );
    expect(attendance).toContain("rpc_recalculate_attendance_warnings");
    expect(attendance).not.toContain("distance_from_base > 50");
    expect(control).toContain("isServerConfirmedLate");
    expect(control).not.toContain("lateCutoffMinutes");
    expect(migration).toContain("tracking_warning_policy");
    expect(migration).toContain("set_authoritative_attendance_late_status");
  });

  it("requires server timestamps and permits Google map marker images", () => {
    const event = read("services/event.service.ts");
    const apache = read("public/.htaccess");
    expect(event).not.toContain(
      "result.checkout_time ?? new Date().toISOString()",
    );
    expect(event).toContain(
      "Event check-out was not confirmed with a server timestamp.",
    );
    expect(apache).toContain(
      "img-src 'self' data: blob: https://*.supabase.co https://maps.google.com",
    );
  });

  it("selects the employee attendance month from the server business date", () => {
    const screen = read("screens/AttendanceScreen.tsx");
    expect(screen).toContain("BusinessClockService.getDate(true)");
    expect(screen).toContain(
      "const currentMonthStart = `${serverDate.slice(0, 7)}-01`",
    );
    expect(screen).toContain("calendarMonthStartRef.current");
    expect(screen).not.toContain("const today = new Date()");
  });

  it("confirms current-location evidence and removes rejected orphan uploads", () => {
    const service = read("services/current-location-visit.service.ts");
    const modal = read("components/CurrentLocationFallbackModal.tsx");
    const migration = read(
      "supabase/migrations/20260731000000_confirm_current_location_visit_contract.sql",
    );
    const redeployMigration = read(
      "supabase/migrations/20260805030000_redeploy_current_location_confirmation.sql",
    );
    expect(service).toContain('"submit_field_visit_current_location_v3"');
    expect(service).toContain(
      "requireBusinessSuccess && value?.success !== true",
    );
    expect(service).toContain("await removeUncommittedPhoto(photoPath)");
    expect(service).toContain('.eq("idempotency_key", submission.idempotencyKey)');
    expect(service).toContain("if (!committedError && committed)");
    expect(service).toContain('"delete_orphan"');
    expect(service).toContain("headers: authorizationHeaders(session.access_token)");
    expect(service).toContain("headers: authorizationHeaders(accessToken)");
    expect(service).toContain("await authenticatedSession(true)");
    expect(service).toContain("p_visit_id: submission.visitId");
    expect(service).toContain(
      "value?.source_visit_id !== expectedSourceVisitId",
    );
    expect(service).toContain("parseDatabaseTimestamp");
    expect(modal).toContain("visitId: visit.id");
    expect(modal).toContain("sourceVisitId: visit.id");
    expect(modal).not.toContain("submissionVisitId");
    expect(modal).toContain("VERIFICATION_LABELS[result.verificationStatus]");
    expect(modal).toContain("formatTime(result.checkinTime)");
    expect(migration).toContain("AUTHORITATIVE_FIELD_VISIT_ID_REQUIRED");
    expect(migration).toContain(
      "p_visit_id is distinct from p_source_visit_id",
    );
    expect(migration).toContain("'checkin_time', v_confirmed.checkin_time");
    expect(migration).toContain("'success', true");
    expect(redeployMigration).toContain(
      "create or replace function public.submit_field_visit_current_location_v3",
    );
    expect(redeployMigration).toContain("'status', v_confirmed.status");
    expect(redeployMigration).toContain(
      "'checkin_time', v_confirmed.checkin_time",
    );
    const uploadEdge = read(
      "supabase/functions/field-visit-evidence-upload/index.ts",
    );
    expect(uploadEdge).toContain('body?.action !== "delete_orphan"');
    expect(uploadEdge).toContain('.eq("evidence_photo_path", path)');
    expect(uploadEdge).toContain("path.startsWith(`${user.id}/`)");
    expect(uploadEdge).toContain("admin.auth.getUser(token)");
    expect(uploadEdge).toContain('version: "20260805.1"');
  });

  it("always reduces field-visit photo evidence before upload", () => {
    const modal = read("components/CurrentLocationFallbackModal.tsx");
    expect(modal).toContain("const EVIDENCE_MAX_EDGE_PX = 480");
    expect(modal).toContain("const EVIDENCE_FALLBACK_EDGE_PX = 320");
    expect(modal).toContain("const EVIDENCE_TARGET_BYTES = 150 * 1024");
    expect(modal).toContain("resizeToLongestEdge(asset.width, asset.height");
    expect(modal).toContain("compress: 0.22");
    expect(modal).toContain('format: SaveFormat.JPEG');
    expect(modal).toContain("Photo optimized");
  });

  it("delivers cold-start notification actions only after the web bridge connects", () => {
    const shell = read("components/AndroidHrmsShell.tsx");
    const connector = read("components/NativeShellConnector.tsx");
    expect(shell).toContain("bridgeConnected.current = true");
    expect(shell).toContain("flushPendingEvents()");
    expect(shell).toContain("getLastNotificationResponseAsync()");
    expect(shell).toContain("handledNotificationActions.current.has(key)");
    expect(connector).toContain('nativeBridge.on(\n      "notification.opened"');
    expect(connector).toContain('target.protocol === "re-hrms:"');
  });

  it("falls back to the bundled Android HRMS when the hosted root times out", () => {
    const app = read("App.tsx");
    const shell = read("components/AndroidHrmsShell.tsx");
    expect(app).toContain("useBundledAndroidApp");
    expect(app).toContain("setUseBundledAndroidApp(true)");
    expect(app).toContain('"android_shell.hosted_hrms_unreachable"');
    expect(shell).toContain("onUseBundledApp(reason)");
    expect(shell).toContain("Open built-in HRMS");
    expect(shell).toContain('cacheMode="LOAD_NO_CACHE"');
    expect(shell).toContain("cacheEnabled={false}");
    expect(shell).toContain("?build=${encodeURIComponent(HOSTED_BUILD_ID)}");
    expect(shell).toContain("}, 7_000)");
    const updates = read("components/AutomaticUpdates.tsx");
    expect(updates).toContain("}, 8_000)");
  });

  it("resolves pgcrypto digest inside the confirmed checkout RPC", () => {
    const repair = read(
      "supabase/migrations/20260806000000_fix_checkout_digest_search_path.sql",
    );
    expect(repair).toContain(
      "alter function public.rpc_attendance_checkout_reconciled",
    );
    expect(repair).toContain(
      "set search_path = public, extensions, pg_temp",
    );
  });

  it("requires exact fraud-review confirmation and always resets quick sync", () => {
    const tracking = read("services/tracking-admin.service.ts");
    const control = read("screens/admin/AttendanceControlScreenNew.tsx");
    expect(tracking).toContain("response?.success === true");
    expect(tracking).toContain("response?.event_id === eventId");
    expect(tracking).toContain("response?.reviewed_at");
    expect(control).toContain("await biometricSyncService.runNow()");
    expect(control).toContain("finally {");
    expect(control).toContain("setSyncing(false)");
  });

  it("requires authoritative Field Visit transition timestamps", () => {
    const service = read("services/field-visit.service.ts");
    const screen = read("screens/FieldVisitScreen.tsx");
    expect(service).toContain('timestamp: "checkin_time"');
    expect(service).toContain('timestamp: "checkout_time"');
    expect(service).toContain(
      "(expected.timestamp && !visit[expected.timestamp])",
    );
    expect(screen).toContain("fmt(confirmedVisit?.checkin_time)");
    expect(screen).toContain("formatTime(iso)");
    expect(screen).not.toContain('iso : iso + "Z"');
  });

  it("fails visibly when Field Visit policy or business-date loading fails", () => {
    const fieldVisits = read("screens/FieldVisitScreen.tsx");
    const attendance = read("screens/AttendanceScreen.tsx");
    expect(fieldVisits).toContain("if (error) throw error");
    expect(fieldVisits).toContain("Field visits unavailable");
    expect(fieldVisits).toContain("field_visit.site_lookup");
    expect(fieldVisits).toContain(
      "The selected site's current location policy could not be loaded.",
    );
    expect(fieldVisits).not.toContain(
      "let radius = visit.checkin_radius_m ?? 100",
    );
    expect(attendance).toContain("businessClockError");
    expect(attendance).toContain("Server business date unavailable");
    expect(attendance).toContain("Retry server date");
  });

  it("persists only the opaque pending biometric operation across browser restarts", () => {
    const service = read("services/biometric-sync-secure.service.ts");
    expect(service).toContain("window.localStorage.setItem(PENDING_SYNC_KEY");
    expect(service).toContain(
      "window.localStorage.removeItem(PENDING_SYNC_KEY)",
    );
    expect(service).toContain("This record contains only an opaque UUID");
    expect(service).toContain(
      "access token, employee data, biometric data, or location evidence",
    );
  });

  it("loads the admin dashboard through one protected summary request", () => {
    const screen = read("screens/admin/AdminDashboardScreen.tsx");
    const service = read("services/dashboard-summary.service.ts");
    const migration = read(
      "supabase/migrations/20260730260000_fast_admin_dashboard_summary.sql",
    );
    expect(screen).toContain("DashboardSummaryService.getAdmin");
    expect(service).toContain('supabase.rpc("rpc_admin_dashboard_summary")');
    expect(screen).not.toContain('supabase.from("profiles")');
    expect(service).toContain("if (timer) clearTimeout(timer)");
    expect(screen).toContain('value={hasLoaded ? stats.totalEmployees : "—"}');
    expect(migration).toContain("perform public.require_profile_admin()");
    expect(migration).toContain("'business_date', v_today");
    expect(migration).toContain("count(distinct attendance.user_id)");
  });

  it("coalesces the employee dashboard into one bounded RPC", () => {
    const screen = read("screens/DashboardScreen.tsx");
    const service = read("services/dashboard-summary.service.ts");
    const migration = read(
      "supabase/migrations/20260731033000_fast_employee_dashboard_summary.sql",
    );
    expect(screen).toContain("DashboardSummaryService.getEmployee");
    expect(screen).not.toContain("Dashboard - User");
    expect(service).toContain('supabase.rpc("rpc_employee_dashboard_summary")');
    expect(service).toContain("employeePending");
    expect(migration).toContain("security definer");
    expect(migration).toContain("limit 200");
  });

  it("coalesces shared business-clock requests without a startup release gate", () => {
    const clock = read("services/business-clock.service.ts");
    const app = read("App.tsx");
    expect(clock).toContain("pendingClockRequest");
    expect(clock).toContain("Date.now() - cachedClock.fetchedAt < CACHE_MS");
    expect(clock).toContain("!force &&");
    expect(app).not.toContain("requiredEdgeFunctionVersions");
    expect(app).not.toContain("ReleaseContractGuard");
  });

  it("uses bounded visible pages for unbounded employee and admin histories", () => {
    for (const file of [
      "screens/MyActivityLogsScreen.tsx",
      "screens/NotificationsScreen.tsx",
      "screens/admin/AuditLogsScreen.tsx",
      "screens/admin/NotificationManagementScreen.tsx",
      "screens/admin/SuspiciousAttendanceScreen.tsx",
      "screens/admin/SmartOfficeImportedData.tsx",
    ]) {
      const source = read(file);
      expect(source).toContain("PaginationControls");
      expect(source).not.toContain("QUERY_PAGINATION_LIMIT_EXCEEDED");
    }
    expect(read("screens/MyActivityLogsScreen.tsx")).not.toContain("limit: 50");
  });

  it("adds unique tie-breakers to audited multi-page attendance queries", () => {
    const attendance = read("screens/admin/AttendanceControlScreenNew.tsx");
    const team = read("screens/MyTeamScreen.tsx");
    const calendar = read("screens/admin/AttendanceCalendarScreen.tsx");
    expect(attendance).toContain(".order('id')");
    expect(attendance).toContain('.order("id")');
    expect(team.match(/\.order\("id"\)/g)?.length).toBeGreaterThanOrEqual(7);
    expect(calendar.match(/\.order\("id"\)/g)?.length).toBeGreaterThanOrEqual(3);
  });

  it("shows authoritative employee roles and restores only verified privileged history", () => {
    const screen = read("screens/admin/UserManagementScreen.tsx");
    const migration = read(
      "supabase/migrations/20260731020000_restore_verified_privileged_roles.sql",
    );
    expect(screen).toContain("role_id,");
    expect(screen).toContain(
      'role_name: emp.role || (emp as any).roles?.name || "No Role"',
    );
    expect(screen).toContain(
      "normalizeUserRole(role.name) === normalizeUserRole(emp.role_name)",
    );
    expect(migration).toContain("history.verified");
    expect(migration).toContain(
      "('SYSTEM_ADMIN', 'SUPER_ADMIN', 'ADMIN', 'HRD')",
    );
    expect(migration).toContain("profile_role_repair_audit");
    expect(migration).toContain("previous_role");
    expect(migration).not.toContain("history.name");
    expect(migration).not.toContain("history.designation");
  });

  it("restores cached sessions immediately and validates them through the auth-scoped server profile", () => {
    const auth = read("contexts/AuthContext.tsx");
    const migration = read(
      "supabase/migrations/20260731026000_authoritative_privileged_sessions.sql",
    );
    expect(auth).toContain('supabase.rpc("rpc_get_my_profile_v2")');
    expect(auth).toContain("cached?.id === session.user.id");
    expect(auth).toContain("if (usableCache)");
    expect(auth).toContain("if (!profile.is_active)");
    expect(migration).toContain("where profile.id = auth.uid()");
    expect(migration).toContain(
      "grant execute on function public.rpc_get_my_profile_v2()\n  to authenticated",
    );
    expect(migration).toContain("RITESH_SYSTEM_ADMIN_IDENTITY_MUST_MATCH_ONCE");
    expect(migration).toContain("ADMIN_SYSTEM_ACCOUNT_MUST_MATCH_ONCE");
    expect(migration).toContain("PROTECTED_SYSTEM_ADMIN_CANNOT_BE_DEMOTED");
    expect(migration).toContain("('SYSTEM_ADMIN'), ('ADMIN'), ('HR'), ('HRD')");
    expect(migration).toContain(
      "drop function if exists public.rpc_temporary_role_recovery_diagnostic(uuid)",
    );
  });

  it("uses an inclusive 10:32 IST late-attendance boundary", () => {
    const migration = read(
      "supabase/migrations/20260731036000_attendance_late_from_1032.sql",
    );
    const activity = read("services/activity.service.ts");
    const team = read("screens/MyTeamScreen.tsx");
    expect(migration).toContain("time '10:32:00'");
    expect(migration).toContain(">= v_late_time");
    expect(migration).toContain("policy.late_checkin_time as is_late");
    expect(migration).toContain("attendance_late_boundary', 'INCLUSIVE'");
    expect(activity).toContain("CanonicalAttendanceService.listDay");
    expect(activity).toContain("is_late: attendance.is_late");
    expect(team).toContain("return currentSeconds >= cutoffMinutes * 60");
  });

  it("downloads the complete historical ten-sheet attendance workbook", () => {
    const control = read("screens/admin/AttendanceControlScreenNew.tsx");
    expect(control).not.toContain(
      "await downloadHistoricalAppAttendanceExcel()",
    );
    for (const sheetName of [
      "App Check-ins",
      "Biometric (Device)",
      "AD Attendance",
      "Field Visits",
      "Employee Summary",
      "Daily Pivot",
      "Location Pings (All)",
      "Location Hourly Summary",
      "Combined Sheet",
      "Team Head Wise",
    ]) {
      expect(control).toContain(sheetName);
    }
    expect(control).toContain("Starting complete 10-sheet download");
    expect(control).toContain("Download Complete Attendance Excel (10 sheets)");
    expect(control).toContain("parseAttendanceTimestamp");
    expect(control).toContain("saveExcelWorkbook(");
    expect(control).toContain('type: "array"');
    expect(control).not.toContain("Historical export unavailable");
    expect(control).not.toContain("Historical export is blocked");
  });

  it("classifies complete employee attendance and regularization server-side", () => {
    const attendance = read("screens/AttendanceScreen.tsx");
    const regularization = read(
      "screens/admin/AttendanceRegularizationScreen.tsx",
    );
    const migration = read(
      "supabase/migrations/20260731030000_complete_employee_attendance_status.sql",
    );
    expect(attendance).toContain('if (value?.is_late === true) return "late"');
    expect(attendance).toContain('notyet: "Not Present Yet"');
    expect(attendance).toContain('holiday: "Holiday"');
    expect(attendance).toContain('weeklyoff: "Weekly Off"');
    expect(attendance).toContain("Today&apos;s attendance unavailable:");
    expect(migration).toContain(
      "v_range_start := greatest(v_month_start, v_employment_start)",
    );
    expect(migration).toContain(
      "v_range_end := least(v_month_end, v_today, v_employment_end)",
    );
    expect(migration).toContain(
      "v_now_time <= v_policy.late_checkin_time then 'notyet'",
    );
    expect(migration).toContain("attendance.is_late");
    expect(migration).toContain("v_status := 'holiday'");
    expect(migration).toContain("v_status := 'weeklyoff'");
    expect(migration).toContain("rpc_admin_list_attendance_regularization");
    expect(regularization).toContain(
      'supabase.rpc(\n          "rpc_admin_list_attendance_regularization"',
    );
    expect(regularization).toContain("Regularization requests unavailable");
    expect(regularization).toContain("row.attendance_logs?.is_late");
  });

  it("loads typed policy data and complete selected calendar-day details", () => {
    const attendance = read("screens/AttendanceScreen.tsx");
    const policyMigration = read(
      "supabase/migrations/20260731031000_selected_attendance_day_details.sql",
    );
    const detailMigration = read(
      "supabase/migrations/20260801000000_attendance_page_and_biometric_first_punch.sql",
    );
    expect(attendance).toContain('"rpc_get_my_monthly_attendance_v3"');
    expect(attendance).toContain(
      "const selectedRecord = getRecordForDay(selectedDate)",
    );
    expect(attendance).toContain("Working duration");
    expect(attendance).toContain("Attendance source");
    expect(attendance).toContain("Checkout is missing for this day");
    expect(attendance).toContain("Previous attendance month");
    expect(attendance).toContain("Biometric attendance confirmed");
    expect(policyMigration).toContain("office.name::text");
    expect(policyMigration).toContain("policy.earliest_checkout_time::text");
    expect(detailMigration).toContain(
      "rpc_get_my_monthly_attendance_v2(p_month date)",
    );
    expect(detailMigration).toContain("'workedMinutes', v_worked_minutes");
    expect(detailMigration).toContain("'attendanceSource', v_source");
    expect(detailMigration).toContain("'fieldVisitCheckIn'");
    expect(detailMigration).toContain("'biometricFirstPunch'");
    expect(detailMigration).toContain("'detail_contract', 'attendance-day-v3'");
  });

  it("uses configurable, idempotent event comp-off for assigned attendees", () => {
    const attendance = read("screens/AttendanceScreen.tsx");
    const eventAdmin = read("screens/admin/EventManagementScreen.tsx");
    const creditMigration = read(
      "supabase/migrations/20260801060000_sunday_event_attendee_comp_off.sql",
    );
    const detailMigration = read(
      "supabase/migrations/20260801070000_employee_attendance_comp_off_detail.sql",
    );
    const marketingMigration = read(
      "supabase/migrations/20260801090000_restore_marketing_only_event_comp_off.sql",
    );
    const eventPolicyMigration = read(
      "supabase/migrations/20260810000000_field_event_audience_context_notifications.sql",
    );
    expect(eventAdmin).toContain("Weekly-Off / Holiday Comp-Off");
    expect(eventAdmin).toContain('comp_off_team: "ALL_ATTENDEES"');
    expect(eventPolicyMigration).toContain("event_attendance_policy");
    expect(eventPolicyMigration).toContain("extended_event_threshold_hours");
    expect(eventPolicyMigration).toContain("maximum_comp_off_per_event");
    expect(eventPolicyMigration).toContain("comp_off_earnings");
    expect(creditMigration).toContain("grant_sunday_event_comp_off");
    expect(creditMigration).toContain(
      "on conflict(event_id, user_id) do nothing",
    );
    expect(attendance).toContain("Comp-off earned");
    expect(attendance).toContain("selectedRecord.compOffEarned");
    expect(detailMigration).toContain("'compOffEarned', v_comp_off_days");
    expect(detailMigration).toContain("'detail_contract', 'attendance-day-v5'");
    expect(marketingMigration).toContain("MARKETING_ONLY_IDEMPOTENT");
    expect(marketingMigration).toContain("EVENT_COMP_OFF_REVERSED");
    expect(marketingMigration).not.toContain("'ALL_ATTENDEES'");
  });

  it("uses biometric first-punch check-in and protected rollover checkout", () => {
    const migration = read(
      "supabase/migrations/20260801040000_authoritative_biometric_checkin_and_rollover_checkout.sql",
    );
    expect(migration).toContain(
      "create or replace function public.apply_biometric_daily_punches_v2(",
    );
    expect(migration).toContain("set checkin_time = p_first_punch");
    expect(migration).toContain("checkin_source = 'BIOMETRIC'");
    expect(migration).toContain("smartoffice_imported = true");
    expect(migration).toContain("pg_advisory_xact_lock");
    expect(migration).toContain("'checkin_updated', v_checkin_updated");
    expect(migration).toContain("'checked_out', false");
    expect(migration).toContain(
      "create or replace function public.auto_checkout_attendance_end_of_day()",
    );
    expect(migration).toContain(
      "Day rollover checkout using last verified biometric punch",
    );
    expect(migration).toContain("'attendance-auto-checkout-day-rollover'");
    expect(migration).toContain(
      "coalesce(biometric.bio_in, attendance.checkin_time) as final_in",
    );
    expect(migration).toContain("attendance.checkout_time as final_out");
    expect(migration).not.toContain("and not v_authorized_biometric");
  });

  it("keeps today's attendance report available with configuration warnings", () => {
    const screen = read("screens/admin/AdvancedAttendanceReportScreen.tsx");
    const strictPayrollMigration = read(
      "supabase/migrations/20260801100000_current_day_attendance_report.sql",
    );
    const operationalMigration = read(
      "supabase/migrations/20260803020000_operational_attendance_report.sql",
    );
    const currentDayMigration = read(
      "supabase/migrations/20260803030000_current_day_operational_verification.sql",
    );
    expect(read("services/canonical-attendance.service.ts")).toContain(
      '"rpc_admin_attendance_daily_v3"',
    );
    expect(screen).toContain('"CONFIG_REQUIRED"');
    expect(screen).toContain("filtered.filter(isPresent).length");
    expect(screen).toContain("Setup required");
    expect(screen).toContain('type: "array"');
    expect(screen).toContain("compression: false");
    expect(screen).toContain("await yieldToBrowser()");
    expect(screen).toContain("Creating CSV recovery download");
    expect(screen).toContain("downloadAttendanceCsv(");
    expect(screen).toContain("downloadBrowserBytes(");
    const downloadHelper = read("utils/browserFileDownload.ts");
    expect(downloadHelper).toContain("window.URL.createObjectURL(blob)");
    expect(downloadHelper).toContain("link.download = filename");
    expect(downloadHelper).toContain('"file.shareBase64"');
    expect(screen).toContain("function canonicalLabel(");
    expect(screen).toContain("TEAM_ALIASES");
    expect(screen).toContain('"mohhamad mehdi": "Mohammad Mehdi"');
    expect(screen).toContain('canonicalLabel(row.team, "team")');
    expect(screen).toContain('options("team_head_name", "person")');
    expect(screen).not.toContain("row.team === filters.team");
    expect(screen).toContain("attendance_report.field_visit_export");
    expect(screen).toContain("the attendance workbook was still downloaded");
    expect(strictPayrollMigration).toContain("report_day::date < v_today");
    expect(strictPayrollMigration).toContain(
      "HISTORICAL_ASSIGNMENT_OR_POLICY_NOT_VERIFIED",
    );
    expect(operationalMigration).toContain("report.date <");
    expect(operationalMigration).toContain("'CONFIG_REQUIRED'");
    expect(operationalMigration).toContain(
      "report.history_verified and profile.joining_date is not null",
    );
    expect(operationalMigration).not.toContain("JOINING_DATE_HISTORY_REQUIRED");
    expect(operationalMigration).not.toContain(
      "HISTORICAL_ASSIGNMENT_OR_POLICY_NOT_VERIFIED",
    );
    expect(currentDayMigration).toContain(
      "report.date = (now() at time zone 'Asia/Kolkata')::date",
    );
    expect(currentDayMigration).toContain("then report.is_late");
  });

  it("restores read-only administrator visibility across protected HR data", () => {
    const migration = read(
      "supabase/migrations/20260803000000_restore_admin_data_visibility.sql",
    );
    expect(migration).toContain(
      "create or replace function public.is_profile_admin()",
    );
    expect(migration).toContain("public.normalize_profile_role(actor.role)");
    expect(migration).toContain("for select to authenticated");
    expect(migration).toContain("using (public.is_profile_admin())");
    expect(migration).toContain("'profiles'");
    expect(migration).toContain("'roles'");
    expect(migration).toContain("'offices'");
    expect(migration).toContain("'attendance_logs'");
    expect(migration).toContain("'location_tracking'");
    expect(migration).toContain("'field_visits'");
    expect(migration).not.toContain("grant insert");
    expect(migration).not.toContain("grant update");
    expect(migration).not.toContain("grant delete");
  });

  it("uses the deployed task ownership column and records task creators", () => {
    const employeeTasks = read("screens/TasksScreen.tsx");
    const adminTasks = read("screens/admin/TaskProjectControlScreen.tsx");
    expect(employeeTasks).toContain("assigned_by.eq.${user.id}");
    expect(employeeTasks).not.toContain("created_by.eq.${user.id}");
    expect(employeeTasks).toContain("assigned_by: user?.id || null");
    expect(adminTasks).toContain("assigned_by: user?.id || null");
  });

  it("contains no UTF-8 text that was decoded and saved as Windows-1252", () => {
    const invalidLeadCharacters = [0x00c2, 0x00c3, 0x00e2, 0x00f0, 0x00ef].map(
      (codePoint) => String.fromCodePoint(codePoint),
    );
    const files = [...sourceFiles("components"), ...sourceFiles("screens")];

    for (const relativePath of files) {
      const source = read(relativePath);
      for (const character of invalidLeadCharacters) {
        expect(source).not.toContain(character);
      }
      expect(source).not.toContain(String.fromCodePoint(0xfffd));
      expect(source).not.toMatch(/[\u0080-\u009f]/);
    }
  });
});
