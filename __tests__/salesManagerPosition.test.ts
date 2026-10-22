// @ts-nocheck -- source-contract checks run under Jest's Node environment.
import fs from "fs";
import path from "path";

const root = path.resolve(__dirname, "..");
const read = (relativePath: string) =>
  fs.readFileSync(path.join(root, relativePath), "utf8");

describe("Sales Manager position release contract", () => {
  test("database migration creates the role and enforces bounded direct reports", () => {
    const migration = read(
      "supabase/migrations/20260812000000_sales_manager_position.sql",
    );

    expect(migration).toContain("select 'Sales Manager'");
    expect(migration).toContain("validate_sales_manager_hierarchy");
    expect(migration).toContain(
      "('SALES_EXECUTIVE', 'TELECALLER', 'AGENT')",
    );
    expect(migration).toContain("deferrable initially deferred");
  });

  // 2026-10-20: tabs follow access instead of a role-name list. My Team shows
  // for anyone with people reporting to them (Sales Manager included), so no
  // role can hide it; the HR Panel follows the user's own grants.
  test("Sales Manager is not hidden: My Team follows the reporting line, not role names", () => {
    const navigation = read("navigation/MainTabNavigator.tsx");

    expect(navigation).not.toContain("SALES_ROLES");
    expect(navigation).toContain(
      "const showMyTeam = !isDataAdmin && (hasReports || hasTeamMembers || isEscalationMember);",
    );
    expect(navigation).toContain('.eq("reports_to", user.id)');
  });

  test("hierarchy UI identifies the position and valid direct reports", () => {
    const hierarchy = read("screens/admin/TeamHierarchyScreen.tsx");

    expect(hierarchy).toContain("role not allowed under Sales Manager");
    expect(hierarchy).toContain("canAssignReportingManager");
    expect(hierarchy).toContain("canReportToSalesManager");
  });
});
