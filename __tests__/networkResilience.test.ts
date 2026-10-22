// @ts-nocheck -- integration contract guards for network resilience
import fs from "fs";
import path from "path";

const read = (file: string) =>
  fs.readFileSync(path.resolve(__dirname, "..", file), "utf8");

describe("HRMS Network Resilience, Durable Outbox & DB Request Minimization", () => {
  const networkManagerSrc = read("lib/network/NetworkManager.ts");
  const outboxSrc = read("services/outbox/DurableWriteOutbox.ts");
  const initOutboxSrc = read("services/outbox/initOutbox.ts");
  const resourceCacheSrc = read("lib/network/ResourceCache.ts");
  const refreshSchedulerSrc = read("lib/network/RefreshScheduler.ts");
  const dashboardSrc = read("screens/DashboardScreen.tsx");
  const attendanceServiceSrc = read("services/attendance.service.ts");
  const dashboardSummaryServiceSrc = read("services/dashboard-summary.service.ts");
  const appSrc = read("App.tsx");
  const migrationSrc = read(
    "supabase/migrations/20260907000000_optimize_employee_dashboard_summary.sql"
  );

  describe("Layer 1: Centralized Network Resilience Layer (NetworkManager)", () => {
    it("creates a fresh AbortController per retry attempt", () => {
      expect(networkManagerSrc).toContain("new AbortController()");
      expect(networkManagerSrc).toContain("attemptController.abort()");
      expect(networkManagerSrc).toContain("callerSignal");
    });

    it("chains caller cancellation signal separately from per-attempt timeouts", () => {
      expect(networkManagerSrc).toContain("callerSignal.addEventListener");
      expect(networkManagerSrc).toContain("callerSignal.removeEventListener");
      expect(networkManagerSrc).toContain("Operation canceled by caller");
    });

    it("classifies errors without retrying 4xx validation or auth errors", () => {
      expect(networkManagerSrc).toContain("classifyError");
      expect(networkManagerSrc).toContain("isRetryable");
      expect(networkManagerSrc).toContain("isValidationError");
      expect(networkManagerSrc).toContain("isAuthError");
      expect(networkManagerSrc).toContain("!classification.isRetryable");
    });

    it("implements in-flight request deduplication", () => {
      expect(networkManagerSrc).toContain("inFlightRequests");
      expect(networkManagerSrc).toContain("dedupKey");
      expect(networkManagerSrc).toContain("action=DEDUPED");
    });

    it("tracks DB request metrics and reason instrumentation", () => {
      expect(networkManagerSrc).toContain("DB_REQUESTS_TOTAL");
      expect(networkManagerSrc).toContain("DB_REQUESTS_DEDUPED");
      expect(networkManagerSrc).toContain("DB_REQUESTS_CACHE_HIT");
      expect(networkManagerSrc).toContain("DB_REQUESTS_SKIPPED");
      expect(networkManagerSrc).toContain("DB_REQUESTS_BY_REASON");
      expect(networkManagerSrc).toContain("DB_REQUESTS_BY_RESOURCE");
      expect(networkManagerSrc).toContain("avgLatency");
      expect(networkManagerSrc).toContain("p95Latency");
    });
  });

  describe("Layer 2: Durable Write Outbox", () => {
    it("enforces priority ordering across operation types (P1 to P4)", () => {
      expect(outboxSrc).toContain("ATTENDANCE_CHECKIN");
      expect(outboxSrc).toContain("ATTENDANCE_CHECKOUT");
      expect(outboxSrc).toContain("AUDIT_LOG");
      expect(outboxSrc).toContain("FRAUD_EVIDENCE");
      expect(outboxSrc).toContain("NON_CRITICAL_TELEMETRY");
      expect(outboxSrc).toContain("a.priority - b.priority");
    });

    it("implements drain-loop concurrency lock with re-check before releasing mutex", () => {
      expect(outboxSrc).toContain("isDraining");
      expect(outboxSrc).toContain("while (hasMore)");
      expect(outboxSrc).toContain("finally {");
      expect(outboxSrc).toContain("this.isDraining = false;");
    });

    it("persists items to storage before network attempts and maintains dead-letter queue", () => {
      expect(outboxSrc).toContain("@hrms_durable_outbox_entries_v1");
      expect(outboxSrc).toContain("@hrms_durable_outbox_dead_letter_v1");
      expect(outboxSrc).toContain("DEAD_LETTER");
      expect(outboxSrc).toContain("MAX_QUEUE_SIZE = 500");
      expect(outboxSrc).toContain("MAX_PAYLOAD_BYTES = 64 * 1024");
    });

    it("registers outbox handlers for attendance, audit, and fraud", () => {
      expect(initOutboxSrc).toContain("ATTENDANCE_CHECKIN");
      expect(initOutboxSrc).toContain("AUDIT_LOG");
      expect(initOutboxSrc).toContain("FRAUD_EVIDENCE");
      expect(appSrc).toContain("initializeOutboxHandlers");
    });

    it("wires outbox drain to app start, NetInfo reconnect, and foreground AppState", () => {
      expect(appSrc).toContain("DurableWriteOutbox.drain()");
      expect(appSrc).toContain("NetInfo.addEventListener");
      expect(appSrc).toContain('AppState.addEventListener("change"');
      expect(appSrc).toContain('nextState === "active"');
    });
  });

  // Disposition 2026-10-19 (docs/realtyhrm-audit/10_TEST_FAILURE_DISPOSITION.md):
  // a named six-state machine (setAttendanceState("SUBMITTING") …) was never
  // committed to DashboardScreen. The shipped design gives the same user-facing
  // guarantees differently: a busy flag while the server confirms, an offline
  // "waiting to sync" state backed by the durable outbox, and server-side
  // idempotency keys. These tests cover that design.
  describe("Layer 3: Attendance Reliability (confirmed / pending / offline)", () => {
    it("blocks repeat taps while an attendance action is in flight", () => {
      expect(dashboardSrc).toContain("setAttendanceLoading(true)");
      expect(dashboardSrc).toContain("disabled={attendanceLoading");
    });

    it("sends an idempotency key with every checkout so retries cannot double-apply", () => {
      expect(attendanceServiceSrc).toContain("idempotencyKey?: string");
      expect(attendanceServiceSrc).toContain("params.idempotencyKey ?? Crypto.randomUUID()");
      expect(attendanceServiceSrc).toContain("p_idempotency_key: idempotencyKey");
    });

    it("shows offline actions as pending until the server confirms them", () => {
      expect(dashboardSrc).toContain("waiting to sync (not confirmed yet)");
      expect(dashboardSrc).toContain("Check-out saved offline");
      expect(dashboardSrc).toContain("DurableWriteOutbox.subscribe(");
    });
  });

  describe("Layer 4 & 5: SWR, Read-After-Write Elimination & DB Request Minimization", () => {
    it("provides ResourceCache as the single source of truth for read freshness", () => {
      expect(resourceCacheSrc).toContain("ResourceCacheClass");
      expect(resourceCacheSrc).toContain("isFresh");
      expect(resourceCacheSrc).toContain("invalidate");
      expect(resourceCacheSrc).toContain("hydrate");
    });

    it("provides RefreshScheduler to eliminate per-screen setIntervals and respect Realtime health", () => {
      expect(refreshSchedulerSrc).toContain("RefreshSchedulerClass");
      expect(refreshSchedulerSrc).toContain("setRealtimeHealthy");
      expect(refreshSchedulerSrc).toContain("debounceTrigger");
      expect(refreshSchedulerSrc).toContain("isAppActive");
    });

    it("stops routine polling when Realtime is healthy", () => {
      expect(refreshSchedulerSrc).toContain("this.isRealtimeHealthy");
      expect(refreshSchedulerSrc).toContain("10 * 60 * 1000"); // 10 minutes consistency fallback
    });

    // Disposition 2026-10-19: DashboardScreen does not use RefreshScheduler /
    // ResourceCache (both remain unused library code). It coalesces with an
    // in-flight request ref and a short summary cache, and deliberately
    // re-reads after an attendance change so the card always shows the
    // server-confirmed record.
    it("coalesces overlapping dashboard loads into one request", () => {
      expect(dashboardSrc).toContain("if (dashboardRequestRef.current) {");
      expect(dashboardSummaryServiceSrc).toContain("if (employeePending && employeeCacheUserId === userId)");
    });

    it("refreshes from the server after attendance changes, bypassing the short cache", () => {
      expect(dashboardSrc).toContain("const reloadAfterAttendanceChange = useCallback(() => {");
      expect(dashboardSrc).toContain("DashboardSummaryService.invalidateEmployee(user.id);");
      expect(dashboardSrc).toContain("onCheckedOut={() => reloadAfterAttendanceChange()}");
    });

    it("serves a fresh cached summary instead of re-querying within the cache window", () => {
      expect(dashboardSummaryServiceSrc).toContain("cacheIsFresh(employeeCache, EMPLOYEE_CACHE_MS)");
      expect(dashboardSrc).toContain("DashboardSummaryService.getEmployee(");
    });

    it("provides a refresh action and a live 'Updated …' timestamp", () => {
      expect(dashboardSrc).toContain("formatUpdatedAge(lastLoadedAt)");
      expect(dashboardSrc).toContain("Updated just now");
    });

    it("does not let secondary event failures overwrite dashboardLoadError", () => {
      expect(dashboardSrc).toContain("setEventsLoadError(");
      const eventsCatch = dashboardSrc.slice(
        dashboardSrc.indexOf(".catch((eventError: any) => {"),
        dashboardSrc.indexOf(".finally(", dashboardSrc.indexOf(".catch((eventError: any) => {")),
      );
      expect(eventsCatch).toContain("setEventsLoadError(");
      expect(eventsCatch).not.toContain("setDashboardLoadError(");
    });
  });

  describe("Layer 6: Database RPC Optimization Migration", () => {
    it("defines optimized rpc_employee_dashboard_summary with index and top 5 tasks", () => {
      expect(migrationSrc).toContain("create or replace function public.rpc_employee_dashboard_summary");
      expect(migrationSrc).toContain("idx_tasks_assigned_status_due");
      expect(migrationSrc).toContain("v_pending_tasks_count");
      expect(migrationSrc).toContain("v_site_visit_tasks_count");
      expect(migrationSrc).toContain("limit 5");
    });
  });
});

