const mockStore = new Map<string, string>();
const mockInvoke = jest.fn();

jest.mock("@/lib/supabase", () => ({ supabase: { functions: { invoke: (...a: unknown[]) => mockInvoke(...a) } } }));
jest.mock("@/utils/secureStorage", () => ({
  secureStorage: {
    getItem: jest.fn(async (k: string) => mockStore.get(k) ?? null),
    setItem: jest.fn(async (k: string, v: string) => void mockStore.set(k, v)),
    removeItem: jest.fn(async (k: string) => void mockStore.delete(k)),
  },
}));
jest.mock("expo-crypto", () => ({ randomUUID: () => "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" }));
jest.mock("@/services/business-clock.service", () => ({
  BusinessClockService: { getDate: jest.fn(async () => "2026-10-22") },
}));

import { biometricSyncService } from "@/services/biometric-sync-secure.service";

const PENDING_KEY = "@hrms_pending_biometric_sync_v1";

function committed(requestId: string, date: string) {
  return {
    success: true, transaction_status: "NO_CHANGES", clientRequestId: requestId, fromDate: date, toDate: date,
    importBatchId: null, rollbackId: null, fetchedPunches: 0, submittedPunches: 0, insertedPunches: 0,
    duplicatePunches: 0, rejectedPunches: 0, matchedEmployees: 0, unmatchedEmployeeCodes: 0,
    checkedIn: 0, checkedOut: 0, summariesUpdated: 0,
  };
}

describe("an old unconfirmed sync no longer blocks Sync Now", () => {
  beforeEach(() => {
    mockStore.clear();
    mockInvoke.mockReset();
  });

  test("yesterday's unknown request is checked once, dropped, and today's sync runs", async () => {
    mockStore.set(PENDING_KEY, JSON.stringify({
      requestId: "4cfd4fb1-93f6-4fee-9d6a-957189d560b7", fromDate: "2026-10-21", toDate: "2026-10-21",
      createdAt: new Date().toISOString(),
    }));
    mockInvoke.mockImplementation(async (_fn: string, { body }: any) =>
      body.requestId === "4cfd4fb1-93f6-4fee-9d6a-957189d560b7"
        ? { data: { error: "BIOMETRIC_SYNC_FAILED", message: "ACTIVE_MAPPED_EMPLOYEE_REQUIRED" }, error: null }
        : { data: committed(body.requestId, body.fromDate), error: null },
    );

    const result = await biometricSyncService.runNow();

    expect(result.fromDate).toBe("2026-10-22");
    expect(mockInvoke.mock.calls[0][1].body).toMatchObject({ action: "status", requestId: "4cfd4fb1-93f6-4fee-9d6a-957189d560b7" });
    expect(mockStore.has(PENDING_KEY)).toBe(false);
  });

  // supabase-js on a non-2xx answer: data null, error.context = the Response.
  const httpError = (status: number, body: unknown) => ({
    data: null,
    error: { message: "Edge Function returned a non-2xx status code", context: new Response(JSON.stringify(body), { status }) },
  });

  test("a busy server is retried with the same request until it succeeds", async () => {
    jest.spyOn(global, "setTimeout").mockImplementation(((fn: () => void) => {
      fn();
      return 0 as any;
    }) as any);
    let calls = 0;
    mockInvoke.mockImplementation(async (_fn: string, { body }: any) => {
      calls += 1;
      return calls <= 2
        ? httpError(409, { error: "SYNC_BUSY", message: "Another biometric synchronization is running." })
        : { data: committed(body.requestId, body.fromDate), error: null };
    });

    const result = await biometricSyncService.runNow();

    expect(result.transactionStatus).toBe("NO_CHANGES");
    const ids = new Set(mockInvoke.mock.calls.map((c) => c[1].body.requestId));
    expect(ids.size).toBe(1);
    (global.setTimeout as unknown as jest.Mock).mockRestore();
  });

  test("the server's reason is shown instead of 'non-2xx status code'", async () => {
    mockInvoke.mockResolvedValue(httpError(403, { error: "ADMIN_PERMISSION_REQUIRED" }));
    await expect(biometricSyncService.runNow()).rejects.toThrow("Only admin and HR can run a manual biometric sync.");
  });
});
