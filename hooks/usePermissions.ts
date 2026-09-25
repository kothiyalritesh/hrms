/**
 * usePermissions.ts
 * Fine-grained backend-controlled permission system.
 *
 * Permissions are fetched from get_my_permissions() RPC on login, then cached
 * in PermissionsContext (see contexts/PermissionsContext.tsx).
 *
 * Usage:
 *   const { hasPermission } = usePermissions();
 *   if (!hasPermission("view_site_visit_observer")) return null;
 */

import { useContext } from "react";
import { PermissionsContext } from "@/contexts/PermissionsContext";

export { PERMISSIONS } from "@/contexts/PermissionsContext";
export type { PermissionKey } from "@/contexts/PermissionsContext";

/**
 * Returns the current user permissions context.
 * Must be used inside PermissionsProvider.
 */
export function usePermissions() {
  return useContext(PermissionsContext);
}

/** Admin: grant a permission to a user (ADMIN or SYSTEM_ADMIN only). */
export { adminGrantPermission, adminRevokePermission, adminListAllPermissions } from "@/contexts/PermissionsContext";
