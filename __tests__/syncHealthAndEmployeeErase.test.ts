import fs from "fs";
import path from "path";

const mockStore = new Map<string, string>();
const mockInvoke = jest.fn();
const mockRpc = jest.fn();

jest.mock("@/lib/supabase", () => ({
  supabase: {
    functions: { invoke: (...a: unknown[]) => mockInvoke(...a) },
    rpc: (...a: unknown[]) => mockRpc(...a),
  },
}));
jest.mock("@/utils/secureStorage", () => ({
  secureStorage: {
    getItem: jest.fn(async (k: string) => mockStore.get(k) ?? null),
    setItem: jest.fn(async (k: string, v: string) => void mockStore.set(k, v)),
    removeItem: jest.fn(async (k: string) => void mockStore.delete(k)),
  },
}));
jest.mock("expo-crypto", () => ({ randomUUID: () => "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" }));
jest.mock("@/services/business-clock.service", () => ({
  BusinessClockService: { getDate: jest.fn(async () => "2026-10-23") },
}));

import {
  biometricSyncService,
  describeSyncHealth,
  friendlySyncMessage,
  type BiometricSyncHealth,
} from "@/services/biometric-sync-secure.service";
import { readableEraseError, sameName, summarizeErase } from "@/services/employee-erase.service";

const read = (relativePath: string) =>
  fs.readFileSync(path.resolve(__dirname, "..", relativePath), "utf8").replace(/\r\n/g, "\n");
const PENDING_KEY = "@hrms_pending_biometric_sync_v1";
const httpError = (status: number, body: unknown) => ({
  data: null,
  error: { message: "Edge Function returned a non-2xx status code", context: new Response(JSON.stringify(body), { status }) },
});

describe("SmartOffice failures in words", () => {
  test("server down, slow, or refusing the key", () => {
    expect(friendlySyncMessage("SMARTOFFICE_FETCH: SMARTOFFICE_HTTP_503")).toMatch(/not answering.*every minute/);
    expect(friendlySyncMessage("SMARTOFFICE_FETCH: SMARTOFFICE_HTTP_504 (SMARTOFFICE_TIMEOUT)")).toMatch(/within 20 seconds/);
    expect(friendlySyncMessage("SMARTOFFICE_FETCH: SMARTOFFICE_HTTP_401")).toMatch(/API key/);
    expect(friendlySyncMessage("SMARTOFFICE_FETCH: SMARTOFFICE_HTTP_503 (SERVER_NOT_CONFIGURED)")).toMatch(/connection settings/);
    expect(friendlySyncMessage("APPLY_BATCH: something else")).toBeNull();
  });
});

describe("the banner shows the server's every-minute sync, not one failed run", () => {
  const now = Date.parse("2026-10-23T05:25:00Z"); // 10:55 IST
  const health = (h: Partial<BiometricSyncHealth>): BiometricSyncHealth => ({
    now: "", last_success_at: null, last_attempt_at: null, last_status: null, failing_since: null,
    consecutive_failures: 0, last_failure: null, ...h,
  });

  test("synced 2 minutes ago is up to date even if the last run failed", () => {
    const line = describeSyncHealth(health({ last_success_at: "2026-10-23T05:23:00Z", last_status: "FAILED" }), now);
    expect(line).toMatchObject({ tone: "ok", fresh: true });
    expect(line.text).toBe("Biometric up to date · synced 10:53 (2 min ago), automatic every minute");
  });

  test("failing for a while: since when, and the last good sync", () => {
    const line = describeSyncHealth(health({ last_success_at: "2026-10-23T05:10:00Z", failing_since: "2026-10-23T05:12:00Z" }), now);
    expect(line).toMatchObject({ tone: "warn", fresh: false });
    expect(line.text).toBe("SmartOffice server not answering since 10:42 · last synced 10:40 (15 min ago). HRMS keeps retrying every minute.");
    expect(describeSyncHealth(health({ last_success_at: "2026-10-23T04:00:00Z", failing_since: "2026-10-23T04:01:00Z" }), now).tone).toBe("error");
  });
});

describe("a failed sync is not left as 'Unfinished sync'", () => {
  beforeEach(() => {
    mockStore.clear();
    mockInvoke.mockReset();
  });

  test("an old unfinished entry (the 2026-09-08 card) is dropped when the screen opens", async () => {
    mockStore.set(PENDING_KEY, JSON.stringify({
      requestId: "4cfd4fb1-93f6-4fee-9d6a-957189d560b7", fromDate: "2026-09-08", toDate: "2026-09-08",
      createdAt: "2026-09-08T06:00:00.000Z",
    }));
    expect(await biometricSyncService.recoverPendingRequest()).toEqual({ pending: null, result: null });
    expect(mockInvoke).not.toHaveBeenCalled();
    expect(mockStore.has(PENDING_KEY)).toBe(false);
  });

  test("the server says it failed: the error is shown in words and nothing stays pending", async () => {
    mockInvoke.mockImplementation(async (_fn: string, { body }: any) =>
      body.action === "status"
        ? httpError(409, { error: "SYNC_PREVIOUSLY_FAILED", message: "SMARTOFFICE_FETCH: SMARTOFFICE_HTTP_502" })
        : httpError(502, { error: "BIOMETRIC_SYNC_FAILED", message: "SMARTOFFICE_FETCH: SMARTOFFICE_HTTP_502 (SMARTOFFICE_UNREACHABLE)" }),
    );
    await expect(biometricSyncService.runNow()).rejects.toThrow(/not answering/);
    expect(mockStore.has(PENDING_KEY)).toBe(false);
  });

  test("a lost answer still keeps the request to check later", async () => {
    mockInvoke.mockRejectedValue(new TypeError("Failed to fetch"));
    await expect(biometricSyncService.runNow()).rejects.toThrow();
    expect(mockStore.has(PENDING_KEY)).toBe(true);
  });
});

describe("Delete employee erases everything after a preview", () => {
  test("the preview lists what goes, most first, without the profile itself", () => {
    const { lines, total } = summarizeErase({
      attendance_logs: 120, location_pings: 3400, smartoffice_device_logs: 210, profiles: 1, "auth.users": 1,
      attendance_action_requests: 2,
    });
    expect(lines).toEqual(["3,400 location points", "210 biometric punches", "120 attendance days", "2 attendance action requests"]);
    expect(total).toBe(3732);
  });

  test("the typed name compares like the server; errors are readable", () => {
    expect(sameName(" viral  kumar", "Viral Kumar")).toBe(true);
    expect(sameName("Viral", "Viral Kumar")).toBe(false);
    expect(readableEraseError("SYSTEM_ADMIN_PERMISSION_REQUIRED: only a system admin can delete an admin")).toBe("Only a system admin can delete an admin.");
    expect(readableEraseError("ERASE_BLOCKED: payroll_lines (user_id): permission denied")).toBe("Blocked by payroll_lines (user_id): permission denied");
  });

  test("the trash button erases (it used to only deactivate)", () => {
    const screen = read("screens/admin/UserManagementScreen.tsx");
    const del = screen.slice(screen.indexOf("const deleteEmployee"), screen.indexOf("const confirmErase"));
    expect(del).toContain("previewErase(employeeId)");
    expect(del).not.toContain("rpc_admin_set_profile_active");
    expect(screen).toContain("disabled={erase.running || !sameName(erase.typed, erase.name)}");
  });

  test("the server erase is one transaction, previewed by rolling back", () => {
    const sql = read("supabase/migrations/20261023100000_employee_erase_sync_health_joining_date.sql");
    expect(sql).toContain("RAISE EXCEPTION USING ERRCODE = 'P0099', MESSAGE = 'HRMS_ERASE_PREVIEW_ROLLBACK'");
    expect(sql).toContain("CONFIRM_NAME_MISMATCH");
    expect(sql).toContain("'EMPLOYEE_ERASED'");
  });
});

describe("joining date is never the account creation date", () => {
  test("profile and attendance intelligence", () => {
    const profile = read("screens/ProfileScreen.tsx");
    expect(profile).not.toMatch(/joining_date \|\| user\?\.created_at/);
    expect(profile).toContain('"Not set (ask HR)"');
    expect(profile).toContain("setDateOfJoining(data?.date_of_joining || null);");
    const master = read("services/attendanceIntelligence/employeeMaster.service.ts");
    expect(master).toContain("joining_date: p.date_of_joining || null,");
    expect(read("supabase/migrations/20261023110000_joining_date_columns_stay_separate.sql"))
      .toContain("DROP TRIGGER IF EXISTS hrms_profiles_sync_joining_date_trg ON public.profiles;");
  });
});
