jest.mock("@/lib/supabase", () => ({ supabase: { rpc: jest.fn() } }));

import { BusinessClockService } from "@/services/business-clock.service";
import { supabase } from "@/lib/supabase";

const mockRpc = supabase.rpc as jest.Mock;

describe("BusinessClockService", () => {
  it("bypasses the successful cache when force refresh is requested", async () => {
    mockRpc
      .mockResolvedValueOnce({
        data: { now: "2026-08-04T23:59:59+05:30", date: "2026-08-04", timezone: "Asia/Kolkata" },
        error: null,
      })
      .mockResolvedValueOnce({
        data: { now: "2026-08-05T00:00:01+05:30", date: "2026-08-05", timezone: "Asia/Kolkata" },
        error: null,
      });
    await expect(BusinessClockService.getDate()).resolves.toBe("2026-08-04");
    await expect(BusinessClockService.getDate(true)).resolves.toBe("2026-08-05");
    expect(mockRpc).toHaveBeenCalledTimes(2);
  });
});

describe("BusinessClockService offline fallback", () => {
  it("retries once, then falls back to the device IST date instead of throwing", async () => {
    mockRpc.mockReset();
    mockRpc.mockRejectedValue(new TypeError("Load failed"));
    const clock = await BusinessClockService.get(true);
    expect(clock.source).toBe("device");
    expect(clock.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(mockRpc).toHaveBeenCalledTimes(2);
  });
});
