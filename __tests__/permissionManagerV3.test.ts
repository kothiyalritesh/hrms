import fs from "fs";
import path from "path";

jest.mock("@/lib/supabase", () => ({ supabase: { rpc: jest.fn() } }));

import { impliedBy, minimalSelection, sourceLabel, type Capability } from "@/services/permissions.service";

const read = (relativePath: string) =>
  fs.readFileSync(path.resolve(__dirname, "..", relativePath), "utf8").replace(/\r\n/g, "\n");

const cap = (key: string, implies: string[] = [], level: Capability["level"] = "VIEW"): Capability => ({
  key, label: key, level, risk: "LOW", scoped: true, grants: [key], implies, sort: 0,
});

// Same shape as the server catalog (permission_capabilities).
const byKey = new Map<string, Capability>(
  [
    cap("attendance.view"),
    cap("regularization.view"),
    cap("attendance.correct", ["attendance.view", "regularization.view"], "MANAGE"),
    cap("attendance.requests.approve", ["regularization.view", "attendance.view"], "APPROVE"),
    cap("leave.view"),
    cap("leave.approve", ["leave.view"], "APPROVE"),
    cap("tracking.view"), // since the 2026-10-20 review: includes no other module
    cap("field_visits.view"),
  ].map((c) => [c.key, c]),
);

describe("Permission Manager v3: levels and merged toggles", () => {
  test("Approve and Manage include their View", () => {
    expect([...impliedBy(["leave.approve"], byKey)]).toEqual(["leave.view"]);
    expect([...impliedBy(["attendance.correct"], byKey)].sort()).toEqual(["attendance.view", "regularization.view"]);
  });

  test("only the capabilities not already included are sent", () => {
    expect(minimalSelection(["leave.view", "leave.approve", "tracking.view", "attendance.correct", "attendance.view"], byKey).sort()).toEqual([
      "attendance.correct",
      "leave.approve",
      "tracking.view",
    ]);
  });

  test("source labels name where access comes from", () => {
    expect(sourceLabel("USER")).toBe("Direct");
    expect(sourceLabel("MANAGER")).toBe("Manager (reporting tree)");
    expect(sourceLabel("ROLE:HR")).toBe("Role template · HR");
  });
});

describe("Permission Manager v3: server rules ship with the app", () => {
  const sql = read("supabase/migrations/20261020100000_permission_capabilities_and_hierarchy.sql");

  test("merged toggles are single capabilities", () => {
    expect(sql).toContain("ARRAY['attendance.regularize','attendance.backdate_correct']");
    expect(sql).toContain("ARRAY['regularization.approve','attendance.backdate_approve']");
    expect(sql).toContain("ARRAY['live_tracking.view','activity_analysis.view'], '{}'");
  });

  test("delegates are capped at their own access and scope", () => {
    expect(sql).toContain("CREATE OR REPLACE FUNCTION public.hrms_grant_ceiling_error(");
    expect(sql).toContain("'OUTSIDE_YOUR_ACCESS'");
    expect(sql).toContain("'TARGET_OUTSIDE_YOUR_SCOPE'");
  });

  test("grants are written only through RPCs; approvals only through approval RPCs", () => {
    expect(sql).toContain("DROP POLICY IF EXISTS hrms_user_permissions_admin_write ON public.user_permissions;");
    expect(sql).toContain("REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.user_permissions FROM PUBLIC, authenticated, anon;");
    expect(sql).toContain("REVIEW_FIELDS_LOCKED");
    expect(sql).toContain("assigned_by = auth.uid()");
  });

  test("managers get their whole reporting tree through an editable template", () => {
    expect(sql).toContain("'@MANAGER'");
    expect(sql).toContain("CREATE OR REPLACE FUNCTION public.hrms_reviewable_user_ids()");
  });

  test("HR / HRD full access is a switch with a pre-filled template", () => {
    expect(sql).toContain("CREATE TABLE IF NOT EXISTS public.hrms_role_access");
    expect(sql).toContain("CREATE OR REPLACE FUNCTION public.rpc_admin_set_role_full_access(");
  });
});

describe("Permission Manager v3: screens follow the same keys as the server", () => {
  test("bulk changes are reviewed (dry run) before they are applied", () => {
    const people = read("screens/admin/permissions/PeoplePanel.tsx");
    expect(people).toContain("PermissionsApi.setAccessBulk(selectedIds, grants(), expiry.value, reason.trim() || null, dryRun)");
    expect(people).toContain("onPress={() => void run(true)}");
  });

  test("leave screen: view opens it, comp-off needs leave.balance.manage", () => {
    const leave = read("screens/admin/LeaveManagementScreen.tsx");
    expect(leave).toContain('const canView = hasPermission("leave.view");');
    expect(leave).toContain('const canCompOff = hasPermission("leave.balance.manage");');
  });

  test("birthdays are saved through the server, not by direct profile updates", () => {
    const birthdays = read("screens/admin/EmployeeBirthdayManagementScreen.tsx");
    expect(birthdays).not.toMatch(/from\("profiles"\)\.update/);
    expect(birthdays).toContain("PermissionsApi.setBirthday(");
  });

  test("tabs follow access, not role names", () => {
    const tabs = read("navigation/MainTabNavigator.tsx");
    expect(tabs).not.toContain("SALES_ROLES");
    expect(tabs).toContain("const canSeeAdmin = isDataAdmin || hasAnyAdminPermission;");
  });
});

describe("Birthdays are visible only to people allowed to see them", () => {
  const sql = read("supabase/migrations/20261021100000_birthday_visibility_and_alerts.sql");

  test("the birthday view filters by the View birthdays scope and hides the birth year", () => {
    expect(sql).toContain("p.id IN (SELECT public.authorized_user_ids('birthdays.view'))");
    expect(sql).not.toMatch(/SELECT user_id, name, office_id,\s*date_of_birth/);
  });

  test("a daily job notifies full-access roles and birthday viewers", () => {
    expect(sql).toContain("cron.schedule('hrms-birthday-notifications', '30 3 * * *'");
    expect(sql).toContain("WHERE g.permission = 'birthdays.view'");
  });

  test("home shows Birthdays only with the permission", () => {
    const home = read("screens/DashboardScreen.tsx");
    expect(home).toContain('const canSeeBirthdays = canOpenScreen("UpcomingBirthdays");');
    expect(read("constants/permissionCatalog.ts")).toContain('UpcomingBirthdays: ["birthdays.view", "birthdays.manage"]');
  });
});
