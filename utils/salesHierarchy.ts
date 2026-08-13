import { normalizeUserRole } from "@/utils/userRole";

export const SALES_MANAGER_ROLE = "SALES_MANAGER";

export const SALES_MANAGER_DIRECT_REPORT_ROLES = [
  "SALES_EXECUTIVE",
  "TELECALLER",
  "AGENT",
] as const;

const SALES_MANAGER_DIRECT_REPORT_SET = new Set<string>(
  SALES_MANAGER_DIRECT_REPORT_ROLES,
);

export function isSalesManagerRole(role: unknown): boolean {
  return normalizeUserRole(role) === SALES_MANAGER_ROLE;
}

export function canReportToSalesManager(role: unknown): boolean {
  return SALES_MANAGER_DIRECT_REPORT_SET.has(normalizeUserRole(role));
}

/**
 * Sales Manager is a deliberately bounded position: only Sales Executives,
 * Telecallers and Agents can be direct reports. Other existing reporting
 * relationships remain valid and continue to use the general hierarchy.
 */
export function canAssignReportingManager(
  subordinateRole: unknown,
  managerRole: unknown,
): boolean {
  return !isSalesManagerRole(managerRole) || canReportToSalesManager(subordinateRole);
}

export function salesManagerDirectReportLabel(): string {
  return "Sales Executives, Telecallers and Agents";
}
