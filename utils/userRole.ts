const ROLE_ALIASES: Record<string, string> = {
  SUPER_ADMIN: "SYSTEM_ADMIN",
  SUPERADMIN: "SYSTEM_ADMIN",
  SYSTEMADMIN: "SYSTEM_ADMIN",
  SYS_ADMIN: "SYSTEM_ADMIN",
  ADMINISTRATOR: "ADMIN",
  HR_MANAGER: "HR",
  TELE_CALLER: "TELECALLER",
  TELI_CALLER: "TELECALLER",
  TELICALLER: "TELECALLER",
};

/**
 * Database role labels have historically used underscores, spaces, hyphens,
 * and a SUPER_ADMIN alias. Normalize them before any navigation or permission
 * decision so an administrator can never fall through to the employee shell.
 */
export function normalizeUserRole(value: unknown): string {
  const normalized = String(value ?? "")
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return ROLE_ALIASES[normalized] ?? normalized;
}

export function isSystemAdminRole(value: unknown): boolean {
  return normalizeUserRole(value) === "SYSTEM_ADMIN";
}

export function isAdminRole(value: unknown): boolean {
  return ["SYSTEM_ADMIN", "ADMIN"].includes(normalizeUserRole(value));
}

export function isHRRole(value: unknown): boolean {
  return ["HR", "HRD"].includes(normalizeUserRole(value));
}

export function canAccessHRPanelRole(value: unknown): boolean {
  return isAdminRole(value) || isHRRole(value);
}
