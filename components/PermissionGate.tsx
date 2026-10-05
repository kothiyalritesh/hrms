import React, { ReactNode } from "react";
import { usePermissions } from "@/hooks/usePermissions";

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
  const { hasPermission, getScopedPermission } = usePermissions();

  let isAllowed = false;

  if (scopeId) {
    const scope = getScopedPermission(permission);
    if (scope && (scope.scope === "GLOBAL" || scope.scope_id === scopeId)) {
      isAllowed = true;
    }
    // Also check the master bypass for ADMIN/SYSTEM_ADMIN
    if (hasPermission("SYSTEM_ADMIN")) {
      isAllowed = true;
    }
  } else {
    isAllowed = hasPermission(permission);
  }

  if (isAllowed) {
    return <>{children}</>;
  }

  return <>{fallback}</>;
}
