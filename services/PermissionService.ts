import { supabase } from "@/lib/supabase";
import AsyncStorage from "@react-native-async-storage/async-storage";

export type PermissionScopeType = "ALL" | "TEAM" | "SELF" | "DEPARTMENT" | "OFFICE" | "PROJECT" | "CUSTOM";

export interface EffectivePermission {
  permission: string;
  scope_type: PermissionScopeType;
  scope_id: string | null;
  effect: "ALLOW" | "DENY";
  source: "ROLE" | "USER_OVERRIDE";
}

export interface PermissionCache {
  is_system_admin: boolean;
  permissions: EffectivePermission[];
}

let cachedPermissions: PermissionCache | null = null;
const CACHE_KEY = "@hrms_permissions_v1";

export const PermissionService = {
  async restoreFromCache(): Promise<void> {
    if (cachedPermissions) return;
    try {
      const stored = await AsyncStorage.getItem(CACHE_KEY);
      if (stored) {
        cachedPermissions = JSON.parse(stored);
      }
    } catch (e) {}
  },

  async loadEffectivePermissions(userId: string): Promise<PermissionCache> {
    const { data, error } = await supabase.rpc("get_effective_permissions", { p_user_id: userId });
    
    if (error) {
      console.error("Failed to load permissions:", error);
      cachedPermissions = cachedPermissions || { is_system_admin: false, permissions: [] };
      return cachedPermissions;
    }

    cachedPermissions = data as PermissionCache;
    AsyncStorage.setItem(CACHE_KEY, JSON.stringify(cachedPermissions)).catch(() => {});
    return cachedPermissions;
  },

  clearCache() {
    cachedPermissions = null;
    AsyncStorage.removeItem(CACHE_KEY).catch(() => {});
  },

  hasPermission(permissionKey: string, scopeType: PermissionScopeType = "ALL", scopeId: string | null = null): boolean {
    if (!cachedPermissions) return false;
    if (cachedPermissions.is_system_admin) return true;

    const match = cachedPermissions.permissions.find(
      (p) => p.permission === permissionKey && 
             p.scope_type === scopeType && 
             p.scope_id === scopeId && 
             p.effect === "ALLOW"
    );
    return !!match;
  },

  async verifyServerSide(permissionKey: string, targetResourceId: string | null = null): Promise<boolean> {
    const { data: hasPerm, error } = await supabase.rpc("has_permission", {
      p_user_id: (await supabase.auth.getUser()).data.user?.id,
      p_permission_key: permissionKey,
      p_target_resource_id: targetResourceId
    });

    if (error || !hasPerm) return false;
    return true;
  }
};
