import { fetchAllPages } from "@/utils/supabasePagination";

describe("fetchAllPages", () => {
  it("loads every page until the server returns a short page", async () => {
    const source = Array.from({ length: 2501 }, (_, id) => ({ id }));
    const result = await fetchAllPages(
      async (from, to) => ({
        data: source.slice(from, to + 1),
        error: null,
      }),
      1000,
    );
    expect(result.error).toBeNull();
    expect(result.data).toHaveLength(2501);
    expect(result.data?.[2500]).toEqual({ id: 2500 });
  });

  it("stops and returns the database error without partial success", async () => {
    const failure = new Error("database unavailable");
    const result = await fetchAllPages(
      async (from) =>
        from === 0
          ? { data: [{ id: 1 }], error: null }
          : { data: null, error: failure },
      1,
    );
    expect(result.data).toBeNull();
    expect(result.error).toBe(failure);
  });
});
