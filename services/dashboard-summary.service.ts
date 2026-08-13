import { supabase } from "@/lib/supabase";
import { firstRpcRow } from "@/utils/supabaseRpc";

const EMPLOYEE_CACHE_MS = 15_000;
const ADMIN_CACHE_MS = 30_000;
const REQUEST_TIMEOUT_MS = 20_000;

type CacheEntry<T> = { value: T; fetchedAt: number };

let employeeCache: CacheEntry<any> | null = null;
let employeePending: Promise<any> | null = null;
let employeeCacheUserId: string | null = null;
let adminCache: CacheEntry<any> | null = null;
let adminPending: Promise<any> | null = null;

async function withTimeout<T>(
  operation: PromiseLike<T>,
  message: string,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      Promise.resolve(operation),
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error(message)),
          REQUEST_TIMEOUT_MS,
        );
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function cacheIsFresh<T>(entry: CacheEntry<T> | null, maxAge: number) {
  return !!entry && Date.now() - entry.fetchedAt < maxAge;
}

export const DashboardSummaryService = {
  async getEmployee(userId: string, force = false) {
    if (
      !force &&
      employeeCacheUserId === userId &&
      cacheIsFresh(employeeCache, EMPLOYEE_CACHE_MS)
    ) {
      return employeeCache!.value;
    }
    if (employeePending && employeeCacheUserId === userId) {
      return employeePending;
    }

    employeeCacheUserId = userId;
    employeePending = (async () => {
      const result = await withTimeout<any>(
        supabase.rpc("rpc_employee_dashboard_summary"),
        "Dashboard data did not respond within 20 seconds.",
      );
      if (result.error) throw result.error;
      const summary = firstRpcRow<any>(result.data);
      if (
        summary?.success !== true ||
        summary?.user_id !== userId ||
        !summary?.server_now ||
        !summary?.business_date ||
        !Array.isArray(summary?.pending_tasks)
      ) {
        throw new Error(
          "The server returned an incomplete employee dashboard summary.",
        );
      }
      employeeCache = { value: summary, fetchedAt: Date.now() };
      return summary;
    })();

    try {
      return await employeePending;
    } finally {
      employeePending = null;
    }
  },

  async getAdmin(force = false) {
    if (!force && cacheIsFresh(adminCache, ADMIN_CACHE_MS)) {
      return adminCache!.value;
    }
    if (adminPending) return adminPending;

    adminPending = (async () => {
      const result = await withTimeout<any>(
        supabase.rpc("rpc_admin_dashboard_summary"),
        "Admin dashboard did not respond within 20 seconds.",
      );
      if (result.error) throw result.error;
      const summary = firstRpcRow<any>(result.data);
      if (summary?.success !== true) {
        throw new Error(
          "The server returned an invalid admin dashboard summary.",
        );
      }
      adminCache = { value: summary, fetchedAt: Date.now() };
      return summary;
    })();

    try {
      return await adminPending;
    } finally {
      adminPending = null;
    }
  },

  invalidateEmployee(userId: string) {
    if (employeeCacheUserId === userId) employeeCache = null;
  },

  invalidateAdmin() {
    adminCache = null;
  },
};
