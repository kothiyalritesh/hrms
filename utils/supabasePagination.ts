type PageResult<T> = {
  data: T[] | null;
  error: any;
};

/**
 * Reads a complete ordered Supabase result without relying on a fixed client
 * limit or the project's PostgREST max-rows setting.
 */
export async function fetchAllPages<T>(
  fetchPage: (from: number, to: number) => PromiseLike<PageResult<T>>,
  pageSize = 1000,
  maxPages = 100,
): Promise<PageResult<T>> {
  const rows: T[] = [];
  for (let page = 0; page < maxPages; page += 1) {
    const from = page * pageSize;
    const result = await fetchPage(from, from + pageSize - 1);
    if (result.error) return { data: null, error: result.error };
    const pageRows = result.data ?? [];
    rows.push(...pageRows);
    if (pageRows.length < pageSize) return { data: rows, error: null };
  }
  return {
    data: null,
    error: new Error(`QUERY_PAGINATION_LIMIT_EXCEEDED:${pageSize * maxPages}`),
  };
}
