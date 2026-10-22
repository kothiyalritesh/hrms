import React, { ReactNode } from "react";
import { usePermissions } from "@/hooks/usePermissions";
import { canonicalPermission } from "@/constants/permissionCatalog";

const hasPermissionKey = (granted: string, wanted: string) =>
  granted === wanted || canonicalPermission(granted) === canonicalPermission(wanted);

interface PermissionGateProps {
  permission: string;
  scopeId?: string;
  fallback?: ReactNode;
  children: ReactNode;
}

/**
 * Renders children only if the current user has the specified permission.
 * Optionally checks against a specific scope ID.
 */
export function PermissionGate({
  permission,
  scopeId,
  fallback = null,
  children,
}: PermissionGateProps) {
  const { hasPermission, scopedPermissions, isDataAdmin } = usePermissions();

  let isAllowed = false;

  if (scopeId) {
    // Full data access covers every scope; otherwise any grant of the key that
    // is company-wide or names this scope target. (Server checks still apply.)
    isAllowed =
      (isDataAdmin && !permission.startsWith("permissions.")) ||
      (hasPermission(permission) &&
        scopedPermissions.some(
          (g) => (g.scope === "GLOBAL" || g.scope_id === scopeId) && hasPermissionKey(g.permission, permission),
        ));
  } else {
    isAllowed = hasPermission(permission);
  }

  if (isAllowed) {
    return <>{children}</>;
  }

  return <>{fallback}</>;
}
