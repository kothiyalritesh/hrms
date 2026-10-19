import { useState, useEffect, useCallback } from 'react';
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
}

// Module-level cache — cleared on user change or explicit invalidation
let cachedPermissions: ScopedPermission[] | null = null;
let lastFetchUserId: string | null = null;
let fetchPromise: Promise<ScopedPermission[]> | null = null;

/** Call this after any grant/revoke so the next render re-fetches. */
export function invalidatePermissionsCache() {
  cachedPermissions = null;
  fetchPromise = null;
}

export function usePermissions() {
  const { user } = useAuth();

  // If the user changed, clear the stale cache immediately
  if (user?.id && user.id !== lastFetchUserId) {
    cachedPermissions = null;
    fetchPromise = null;
  }

  const initialData =
    user?.id && user.id === lastFetchUserId && cachedPermissions
      ? cachedPermissions
      : [];
  const [scopedPermissions, setScopedPermissions] = useState<ScopedPermission[]>(initialData);
  const [loading, setLoading] = useState(!initialData.length);

  const loadPermissions = useCallback(async (forceRefresh = false) => {
    if (!user?.id) {
      setLoading(false);
      return;
    }

    if (!forceRefresh && cachedPermissions && lastFetchUserId === user.id) {
      setScopedPermissions(cachedPermissions);
      setLoading(false);
      return;
    }

    if (!fetchPromise || forceRefresh) {
      fetchPromise = (async () => {
        try {
          const { data, error } = await supabase.rpc('get_my_permissions');
          let parsedData = data;
          if (typeof data === 'string') {
            try { parsedData = JSON.parse(data); } catch (_) {}
          }
          if (!error && Array.isArray(parsedData)) {
            cachedPermissions = parsedData as ScopedPermission[];
            lastFetchUserId = user.id;
            return cachedPermissions;
          }
        } catch (err) {
          console.warn('[usePermissions] Error loading permissions', err);
        }
        return [];
      })();
    }

    const result = await fetchPromise;
    setScopedPermissions(result);
    setLoading(false);
  }, [user?.id]);

  useEffect(() => {
    void loadPermissions();
  }, [loadPermissions]);

  // Re-fetch when the app comes back to the foreground (picks up revokes)
  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') void loadPermissions(true);
    });
    return () => sub.remove();
  }, [loadPermissions]);

  const role = String(user?.role ?? '').toUpperCase();
  const isPermissionAdmin = PERMISSION_ADMIN_ROLES.includes(role);
  const isDataAdmin = DATA_ADMIN_ROLES.includes(role);

  // Same rules as the server (public.hrms_has_permission): data admins hold
  // every permission except permission management; everyone else needs an
  // active grant of the key or one of its legacy aliases.
  const hasPermission = useCallback((permName: string): boolean => {
    const key = canonicalPermission(permName);
    if (isPermissionAdmin) return true;
    if (isDataAdmin && !key.startsWith('permissions.')) return true;
    return scopedPermissions.some(p => canonicalPermission(p.permission) === key);
  }, [scopedPermissions, isPermissionAdmin, isDataAdmin]);

  const hasAnyPermission = useCallback(
    (keys: string[]) => keys.some((key) => hasPermission(key)),
    [hasPermission],
  );

  /** Whether an HR-panel screen (route name) may be opened. */
  const canOpenScreen = useCallback(
    (route: string) => {
      const required = SCREEN_PERMISSIONS[route];
      return required ? required.some((key) => hasPermission(key)) : isDataAdmin;
    },
    [hasPermission, isDataAdmin],
  );

  const getScopedPermission = useCallback((permName: string): ScopedPermission | null => {
    const key = canonicalPermission(permName);
    if (isPermissionAdmin || (isDataAdmin && !key.startsWith('permissions.'))) {
      return { permission: key, scope: 'GLOBAL', scope_id: null };
    }
    return scopedPermissions.find(p => canonicalPermission(p.permission) === key) ?? null;
  }, [scopedPermissions, isPermissionAdmin, isDataAdmin]);

  const invalidatePermissions = useCallback(() => {
    invalidatePermissionsCache();
    void loadPermissions(true);
  }, [loadPermissions]);

  return {
    scopedPermissions,
    hasPermission,
    hasAnyPermission,
    canOpenScreen,
    isDataAdmin,
    isPermissionAdmin,
    getScopedPermission,
    loading,
    refreshPermissions: () => loadPermissions(true),
    invalidatePermissions,
  };
}
