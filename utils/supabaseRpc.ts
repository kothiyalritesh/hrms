/**
 * Supabase returns a JSON object for scalar JSON RPCs, but PostgreSQL
 * table-returning functions are represented as an array. Keep callers
 * independent of that database implementation detail.
 */
export function firstRpcRow<T>(data: T | T[] | null | undefined): T | null {
  if (Array.isArray(data)) return data[0] ?? null;
  return data ?? null;
}

