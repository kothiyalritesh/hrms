import { useCallback, useEffect, useState } from 'react';
import { AppState } from 'react-native';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/lib/supabase';
import {
  canonicalPermission,
  DATA_ADMIN_ROLES,
  PERMISSION_ADMIN_ROLES,
  SCREEN_PERMISSIONS,
} from '@/constants/permissionCatalog';

export interface ScopedPermission {
  permission: string;
  scope: 'GLOBAL' | 'OFFICE' | 'OFFICE_TREE' | 'TEAM' | 'TEAM_TREE' | 'REPORTS_TO' | 'ASSIGNED' | 'SELF' | 'DEPARTMENT';
  scope_id?: string | null;
  scope_label?: string | null;
  source?: string | null;
  expires_at?: string | null;
}

/**
 * The signed-in user's access, shared by every screen.
 *
 * Source: get_my_access (server-expanded: capabilities, implied View, role
 * templates, the Manager template, full data access, screen map). Older
 * databases without it fall back to get_my_permissions + role names.
 * A failed load is never cached; the next screen or foreground retries.
 * A change to the user's access bumps user_permission_versions, which the
 * app hears through Realtime and refetches within seconds.
 */
type AccessState = {
  userId: string;
  grants: ScopedPermission[];
  fullDataAccess: boolean | null;          // null = old server, use role names
  permissionAdmin: { view: boolean; assign: boolean; revoke: boolean } | null;
  roleAdmin: boolean | null;
  hasReports: boolean;
  screens: Record<string, string[]> | null;
  version: number;
};

let current: AccessState | null = null;
let lastError: string | null = null;
let inflight: Promise<void> | null = null;
let inflightUser: string | null = null;
const listeners = new Set<() => void>();
const notify = () => listeners.forEach((listener) => listener());

function parse(data: unknown) {
  if (typeof data === 'string') {
    try { return JSON.parse(data); } catch { return null; }
  }
  return data;
}

async function fetchAccess(userId: string): Promise<void> {
  if (inflight && inflightUser === userId) return inflight;
  inflightUser = userId;
  inflight = (async () => {
    try {
      const v3 = await supabase.rpc('get_my_access');
      const access = parse(v3.data) as any;
      if (!v3.error && access && Array.isArray(access.grants)) {
        current = {
          userId,
          grants: access.grants,
          fullDataAccess: !!access.full_data_access,
          permissionAdmin: access.permission_admin ?? null,
          roleAdmin: !!access.role_admin,
          hasReports: !!access.has_reports,
          screens: access.screens && Object.keys(access.screens).length ? access.screens : null,
          version: Number(access.version ?? 0),
        };
        lastError = null;
        return;
      }
      // Server without the v3 migration: the older list (role names decide admin).
      const legacy = await supabase.rpc('get_my_permissions');
      const list = parse(legacy.data);
      if (!legacy.error && Array.isArray(list)) {
        current = {
          userId, grants: list as ScopedPermission[], fullDataAccess: null, permissionAdmin: null,
          roleAdmin: null, hasReports: false, screens: null, version: 0,
        };
        lastError = null;
        return;
      }
      lastError = (v3.error ?? legacy.error)?.message ?? 'Could not load permissions';
    } catch (err: any) {
      lastError = err?.message ?? 'Could not load permissions';
      console.warn('[usePermissions] Error loading permissions', err);
    } finally {
      inflight = null;
      inflightUser = null;
      notify();
    }
  })();
  return inflight;
}

/** Call this after any grant / revoke: every screen refetches. */
export function invalidatePermissionsCache() {
  const userId = current?.userId;
  if (userId) void fetchAccess(userId);
}

// One Realtime subscription per signed-in user, shared by all hook instances.
let channel: ReturnType<typeof supabase.channel> | null = null;
let channelUser: string | null = null;
let channelUsers = 0;

function subscribeVersion(userId: string) {
  channelUsers += 1;
  if (channel && channelUser === userId) return;
  if (channel) void supabase.removeChannel(channel);
  channelUser = userId;
  try {
    channel = supabase
      .channel(`perm-version-${userId}`)
      .on(
        'postgres_changes' as any,
        { event: '*', schema: 'public', table: 'user_permission_versions', filter: `user_id=eq.${userId}` },
        () => void fetchAccess(userId),
      )
      .subscribe();
  } catch (err) {
    channel = null;
    console.warn('[usePermissions] live refresh unavailable', err);
  }
}

function unsubscribeVersion() {
  channelUsers = Math.max(0, channelUsers - 1);
  if (channelUsers === 0 && channel) {
    void supabase.removeChannel(channel);
    channel = null;
    channelUser = null;
  }
}

export function usePermissions() {
  const { user } = useAuth();
  const userId = user?.id ?? null;
  const [, setTick] = useState(0);

  useEffect(() => {
    const listener = () => setTick((n) => n + 1);
    listeners.add(listener);
    return () => { listeners.delete(listener); };
  }, []);

  useEffect(() => {
    if (!userId) return;
    if (!current || current.userId !== userId) void fetchAccess(userId);
    subscribeVersion(userId);
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') void fetchAccess(userId);
    });
    return () => {
      sub.remove();
      unsubscribeVersion();
    };
  }, [userId]);

  const mine = current && current.userId === userId ? current : null;
  const loading = !!userId && !mine && !lastError;
  const grants = mine?.grants ?? [];

  const role = String(user?.role ?? '').toUpperCase();
  const isRoleAdmin = mine?.roleAdmin ?? PERMISSION_ADMIN_ROLES.includes(role);
  const isDataAdmin = mine?.fullDataAccess ?? DATA_ADMIN_ROLES.includes(role);

  const holds = useCallback(
    (key: string) => {
      const canonical = canonicalPermission(key);
      return grants.some((g) => g.permission === key || canonicalPermission(g.permission) === canonical);
    },
    [grants],
  );

  // Same rules as the server (hrms_has_permission / hrms_is_permission_admin).
  const hasPermission = useCallback(
    (permName: string): boolean => {
      const key = canonicalPermission(permName);
      if (key.startsWith('permissions.')) {
        const action = key.split('.')[1] as 'view' | 'assign' | 'revoke';
        if (mine?.permissionAdmin) return !!mine.permissionAdmin[action];
        return isRoleAdmin || holds(key);
      }
      return isDataAdmin || holds(key);
    },
    [mine, isRoleAdmin, isDataAdmin, holds],
  );

  const hasAnyPermission = useCallback((keys: string[]) => keys.some((key) => hasPermission(key)), [hasPermission]);

  /**
   * Whether an HR-panel screen (route name) may be opened. ignoreManager:
   * judge without the Manager-template access (managers use My Team for that).
   */
  const canOpenScreen = useCallback(
    (route: string, options?: { ignoreManager?: boolean }) => {
      const required = mine?.screens?.[route] ?? SCREEN_PERMISSIONS[route];
      if (!required) return isDataAdmin;
      if (!options?.ignoreManager || isDataAdmin) return required.some((key) => hasPermission(key));
      return required.some((key) => {
        const canonical = canonicalPermission(key);
        if (canonical.startsWith('permissions.')) return hasPermission(canonical);
        return grants.some((g) => g.source !== 'MANAGER' && (g.permission === key || canonicalPermission(g.permission) === canonical));
      });
    },
    [mine, hasPermission, isDataAdmin, grants],
  );

  const getScopedPermission = useCallback(
    (permName: string): ScopedPermission | null => {
      const key = canonicalPermission(permName);
      if (key.startsWith('permissions.') ? hasPermission(key) && isRoleAdmin : isDataAdmin) {
        return { permission: key, scope: 'GLOBAL', scope_id: null };
      }
      const matches = grants.filter((g) => canonicalPermission(g.permission) === key);
      return matches.find((g) => g.scope === 'GLOBAL') ?? matches[0] ?? null;
    },
    [grants, hasPermission, isRoleAdmin, isDataAdmin],
  );

  const refreshPermissions = useCallback(async () => {
    if (userId) await fetchAccess(userId);
  }, [userId]);

  return {
    scopedPermissions: grants,
    hasPermission,
    hasAnyPermission,
    canOpenScreen,
    isDataAdmin,
    isPermissionAdmin: isRoleAdmin,
    isRoleAdmin,
    hasReports: mine?.hasReports ?? false,
    getScopedPermission,
    loading,
    error: mine ? null : lastError,
    version: mine?.version ?? 0,
    refreshPermissions,
    invalidatePermissions: refreshPermissions,
  };
}
