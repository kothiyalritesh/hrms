/**
 * PermissionsContext.tsx
 * React context holding the current user's fine-grained scoped permission set.
 * Automatically fetches permissions when a Supabase auth session is detected
 * and clears them on sign-out.
 */

import React, {
  createContext,
  useContext,
  useState,
  useCallback,
  useEffect,
  useMemo,
  ReactNode,
} from "react";
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/contexts/AuthContext';

// Permission key constants
export const PERMISSIONS = {
  VIEW_LIVE_TRACKING: "view_live_tracking",
  VIEW_LOCATION_HISTORY: "view_location_history",
  VIEW_SITE_VISIT_OBSERVER: "view_site_visit_observer",
  VIEW_LOCATION_REPORTS: "view_location_reports",
  VIEW_HR_PANEL: "view_hr_panel",
  VIEW_REPORTS: "view_reports",
  MANAGE_LEAVE: "manage_leave",
  MANAGE_ATTENDANCE: "manage_attendance",
  MANAGE_EMPLOYEE_DETAILS: "manage_employee_details",
  MANAGE_TASKS: "manage_tasks",
} as const;

export type PermissionKey = (typeof PERMISSIONS)[keyof typeof PERMISSIONS];

export type PermissionScope = "GLOBAL" | "OFFICE" | "OFFICE_TREE" | "TEAM" | "TEAM_TREE" | "REPORTS_TO" | "ASSIGNED" | "SELF";

export interface ScopedPermission {
  permission: string;
  scope: PermissionScope;
  scope_id?: string | null;
  /** Legacy multidimensional columns (dropped in 20261005010000); kept optional for old rows. */
  office_id?: string | null;
  department?: string | null;
  team_lead_id?: string | null;
}

export interface GrantScopeOptions {
  scope?: PermissionScope;
  scopeId?: string | null;
  /** Legacy options, no longer sent by the Permission Manager. */
  officeId?: string | null;
  department?: string | null;
  teamLeadId?: string | null;
  teamName?: string | null;
}

export interface PermissionsContextValue {
  permissions: string[];
  scopedPermissions: ScopedPermission[];
  loading: boolean;
  hasPermission: (key: string) => boolean;
  getPermissionScope: (key: string) => PermissionScope | null;
  getScopedPermission: (key: string) => ScopedPermission | null;
  canAccessUser: (
    targetUser: {
      id: string;
      office_id?: string | null;
      department?: string | null;
      reports_to?: string | null;
    },
    permission: string,
  ) => boolean;
  refreshPermissions: () => Promise<void>;
  clearPermissions: () => void;
}

export const PermissionsContext = createContext<PermissionsContextValue>({
  permissions: [],
  scopedPermissions: [],
  loading: false,
  hasPermission: () => false,
  getPermissionScope: () => null,
  getScopedPermission: () => null,
  canAccessUser: () => false,
  refreshPermissions: async () => {},
  clearPermissions: () => {},
});

export function PermissionsProvider({ children }: { children: ReactNode }) {
  const [permissions, setPermissions] = useState<string[]>([]);
  const [scopedPermissions, setScopedPermissions] = useState<ScopedPermission[]>([]);
  const [loading, setLoading] = useState(false);
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const { user } = useAuth();

  const refreshPermissions = useCallback(async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase.rpc("get_my_permissions");
      if (error) {
        console.warn("[Permissions] Failed to fetch:", error.message);
        return;
      }
      setPermissions((data as string[]) ?? []);

      if (Array.isArray(data)) {
        if (
          data.length > 0 &&
          typeof data[0] === "object" &&
          data[0] !== null &&
          "permission" in data[0]
        ) {
          const scoped = data as ScopedPermission[];
          setScopedPermissions(scoped);
          setPermissions(scoped.map((p) => p.permission));
        } else {
          const keys = data as string[];
          setPermissions(keys);
          setScopedPermissions(keys.map((k) => ({ permission: k, scope: "GLOBAL" })));
        }
      } else {
        setPermissions([]);
        setScopedPermissions([]);
      }
    } catch (err) {
      console.warn("[Permissions] Unexpected error:", err);
    } finally {
      setLoading(false);
    }
  }, []);

  const clearPermissions = useCallback(() => {
    setPermissions([]);
    setScopedPermissions([]);
  }, []);

  // Auto-fetch permissions on auth state changes
  useEffect(() => {
    void supabase.auth.getSession().then(({ data }) => {
      if (data.session?.user?.id) {
        setCurrentUserId(data.session.user.id);
        void refreshPermissions();
      }
    });

    const { data: listener } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === "SIGNED_IN" || event === "TOKEN_REFRESHED") {
        if (session?.user?.id) setCurrentUserId(session.user.id);
        void refreshPermissions();
      } else if (event === "SIGNED_OUT") {
        setCurrentUserId(null);
        clearPermissions();
      }
    });

    return () => {
      listener.subscription.unsubscribe();
    };
  }, [refreshPermissions, clearPermissions]);

  const hasPermission = useCallback(
    (key: string): boolean => {
      if (user?.role === "SYSTEM_ADMIN" || user?.role === "ADMIN") return true;
      return permissions.includes(key);
    },
    [permissions, user?.role],
  );

  const getPermissionScope = useCallback(
    (key: string): PermissionScope | null => {
      const found = scopedPermissions.find((p) => p.permission === key);
      return found ? found.scope : null;
    },
    [scopedPermissions],
  );

  const getScopedPermission = useCallback((key: string): ScopedPermission | null => {
    if (user?.role === 'SYSTEM_ADMIN' || user?.role === 'ADMIN') {
      return { permission: key, scope: 'GLOBAL', scope_id: null };
    }
    return scopedPermissions.find((p) => p.permission === key) ?? null;
  }, [scopedPermissions, user?.role]);

  const canAccessUser = useCallback(
    (
      targetUser: {
        id: string;
        office_id?: string | null;
        department?: string | null;
        reports_to?: string | null;
      },
      permission: string,
    ): boolean => {
      const perms = scopedPermissions.filter((p) => p.permission === permission);
      if (perms.length === 0) return false;

      return perms.some((p) => {
        // If GLOBAL with no multidimensional restrictions, allow access
        if (p.scope === "GLOBAL" && !p.office_id && !p.department && !p.team_lead_id) {
          return true;
        }

        // Office check
        if (p.office_id && p.office_id !== targetUser.office_id) {
          return false;
        }

        // Department check
        if (
          p.department &&
          p.department.trim().toLowerCase() !== (targetUser.department ?? "").trim().toLowerCase()
        ) {
          return false;
        }

        // Team Lead check (target is the leader or reports to the leader)
        if (
          p.team_lead_id &&
          targetUser.id !== p.team_lead_id &&
          targetUser.reports_to !== p.team_lead_id
        ) {
          return false;
        }

        // Legacy scope checks
        if (p.scope === "SELF" && currentUserId && targetUser.id !== currentUserId) {
          return false;
        }

        return true;
      });
    },
    [scopedPermissions, currentUserId],
  );

  const value = useMemo<PermissionsContextValue>(
    () => ({
      permissions,
      scopedPermissions,
      loading,
      hasPermission,
      getPermissionScope,
      getScopedPermission,
      canAccessUser,
      refreshPermissions,
      clearPermissions,
    }),
    [
      permissions,
      scopedPermissions,
      loading,
      hasPermission,
      getPermissionScope,
      getScopedPermission,
      canAccessUser,
      refreshPermissions,
      clearPermissions,
    ],
  );

  return (
    <PermissionsContext.Provider value={value}>
      {children}
    </PermissionsContext.Provider>
  );
}

// Hook
export function usePermissions() {
  return useContext(PermissionsContext);
}

// Admin helpers
export async function adminGrantPermission(
  userId: string,
  permission: string,
  scopeOrOptions?: PermissionScope | GrantScopeOptions,
  legacyScopeId?: string | null,
): Promise<{ success: boolean; error?: string }> {
  if (!userId?.trim()) return { success: false, error: "User ID is required" };
  if (!permission?.trim()) return { success: false, error: "Permission is required" };

  let scope: PermissionScope = "GLOBAL";
  let sanitizedScopeId: string | null = null;
  let officeId: string | null = null;
  let department: string | null = null;
  let teamLeadId: string | null = null;
  let teamName: string | null = null;

  if (typeof scopeOrOptions === "object" && scopeOrOptions !== null) {
    scope = scopeOrOptions.scope || "GLOBAL";
    sanitizedScopeId = scopeOrOptions.scopeId?.trim() || null;
    officeId = scopeOrOptions.officeId?.trim() || null;
    department = scopeOrOptions.department?.trim() || null;
    teamLeadId = scopeOrOptions.teamLeadId?.trim() || null;
    teamName = scopeOrOptions.teamName?.trim() || null;
  } else if (typeof scopeOrOptions === "string") {
    scope = scopeOrOptions;
    sanitizedScopeId = legacyScopeId?.trim() || null;
  }

  const { data, error } = await supabase.rpc("admin_grant_permission", {
    p_user_id: userId.trim(),
    p_permission: permission.trim(),
    p_scope: scope,
    p_scope_id: sanitizedScopeId,
    
    
    
    
  });
  if (error) return { success: false, error: error.message };
  const result = Array.isArray(data) ? data[0] : data;
  return result ?? { success: false, error: "No response" };
}

export async function adminRevokePermission(
  userId: string,
  permission: string,
  scope?: PermissionScope,
): Promise<{ success: boolean; error?: string }> {
  if (!userId?.trim()) return { success: false, error: "User ID is required" };
  if (!permission?.trim()) return { success: false, error: "Permission is required" };

  const { data, error } = await supabase.rpc("admin_revoke_permission", {
    p_user_id: userId.trim(),
    p_permission: permission.trim(),
    p_scope: scope ?? null,
  });
  if (error) return { success: false, error: error.message };
  const result = Array.isArray(data) ? data[0] : data;
  return result ?? { success: false, error: "No response" };
}

export async function adminListAllPermissions(): Promise<
  Array<{
    user_id: string;
    permission: string;
    scope: PermissionScope;
    scope_id: string | null;
    office_id: string | null;
    department: string | null;
    team_lead_id: string | null;
    team_name: string | null;
    granted_at: string;
    granted_by: string | null;
  }>
> {
  const { data, error } = await supabase
    .from("user_permissions")
    .select(
      "user_id, permission, scope, scope_id, created_at, created_by",
    )
    .is("revoked_at", null)
    .order("user_id")
    .order("permission");
  if (error) throw error;
  return (data as any) ?? [];
}
