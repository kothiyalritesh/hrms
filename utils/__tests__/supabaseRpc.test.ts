import { firstRpcRow } from "../supabaseRpc";

describe("firstRpcRow", () => {
  it("accepts a scalar JSON RPC response", () => {
    expect(firstRpcRow({ success: true })).toEqual({ success: true });
  });

  it("accepts a PostgreSQL table-returning RPC response", () => {
    expect(firstRpcRow([{ success: true, id: "1" }])).toEqual({
      success: true,
      id: "1",
    });
  });

  it("returns null for an empty response", () => {
    expect(firstRpcRow([])).toBeNull();
    expect(firstRpcRow(null)).toBeNull();
  });
});

