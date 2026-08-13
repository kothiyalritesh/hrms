import {
  canAccessHRPanelRole,
  isAdminRole,
  isSystemAdminRole,
  normalizeUserRole,
} from "@/utils/userRole";

describe("user role normalization", () => {
  test.each([
    "SYSTEM_ADMIN",
    "system admin",
    "System-Admin",
    "SUPER_ADMIN",
    "super admin",
    "sys_admin",
  ])("maps %s to the authoritative system-admin role", (role) => {
    expect(normalizeUserRole(role)).toBe("SYSTEM_ADMIN");
    expect(isSystemAdminRole(role)).toBe(true);
    expect(isAdminRole(role)).toBe(true);
    expect(canAccessHRPanelRole(role)).toBe(true);
  });

  it("does not grant the HR panel to an employee role", () => {
    expect(normalizeUserRole("Agent")).toBe("AGENT");
    expect(canAccessHRPanelRole("Agent")).toBe(false);
  });
});
