import fs from "fs";
import path from "path";

const read = (relativePath: string) =>
  fs.readFileSync(path.resolve(__dirname, "..", relativePath), "utf8");

// Pure evaluator function matching the logic implemented in PermissionsContext
interface EvaluatorTarget {
  id: string;
  office_id?: string | null;
  department?: string | null;
  reports_to?: string | null;
}

interface EvaluatorPermission {
  permission: string;
  scope: "GLOBAL" | "OFFICE" | "DEPARTMENT" | "TEAM" | "SELF";
  office_id?: string | null;
  department?: string | null;
  team_lead_id?: string | null;
}

function evaluateAccess(
  userPermissions: EvaluatorPermission[],
  target: EvaluatorTarget,
  requestedPermission: string,
  currentUserId?: string
): boolean {
  const perms = userPermissions.filter((p) => p.permission === requestedPermission);
  if (perms.length === 0) return false;

  return perms.some((p) => {
    // Global scope with no extra dimensional restrictions matches all
    if (p.scope === "GLOBAL" && !p.office_id && !p.department && !p.team_lead_id) {
      return true;
    }

    // Office match (if restricted)
    if (p.office_id && p.office_id !== target.office_id) {
      return false;
    }

    // Department match (if restricted, case-insensitive)
    if (
      p.department &&
      p.department.trim().toLowerCase() !== (target.department ?? "").trim().toLowerCase()
    ) {
      return false;
    }

    // Team lead match (if restricted, target is leader or reports directly to leader)
    if (
      p.team_lead_id &&
      target.id !== p.team_lead_id &&
      target.reports_to !== p.team_lead_id
    ) {
      return false;
    }

    // Self scope
    if (p.scope === "SELF" && currentUserId && target.id !== currentUserId) {
      return false;
    }

    return true;
  });
}

describe("Multi-Dimensional Scoped Permissions Matrix", () => {
  const office136 = "office-noida-136-uuid";
  const office63 = "office-sector-63-uuid";
  const sauravMaviId = "user-saurav-mavi-uuid";
  const otherLeadId = "user-other-lead-uuid";

  describe("User Scenarios Requested by User", () => {
    test("User A scenario: can see Office 136 + Saurav Mavi's sales team only", () => {
      const userAPermissions: EvaluatorPermission[] = [
        {
          permission: "employees.view",
          scope: "GLOBAL",
          office_id: office136,
          department: "Sales",
          team_lead_id: sauravMaviId,
        },
      ];

      // 1. Target in Saurav's sales team at 136 office -> GRANTED
      const salesRepUnderSaurav: EvaluatorTarget = {
        id: "emp-1",
        office_id: office136,
        department: "Sales",
        reports_to: sauravMaviId,
      };
      expect(evaluateAccess(userAPermissions, salesRepUnderSaurav, "employees.view")).toBe(true);

      // 2. Saurav Mavi himself at 136 office -> GRANTED
      const sauravHimself: EvaluatorTarget = {
        id: sauravMaviId,
        office_id: office136,
        department: "Sales",
        reports_to: null,
      };
      expect(evaluateAccess(userAPermissions, sauravHimself, "employees.view")).toBe(true);

      // 3. Member of Saurav's team but wrong office (Sector 63) -> DENIED
      const repWrongOffice: EvaluatorTarget = {
        id: "emp-2",
        office_id: office63,
        department: "Sales",
        reports_to: sauravMaviId,
      };
      expect(evaluateAccess(userAPermissions, repWrongOffice, "employees.view")).toBe(false);

      // 4. In office 136, but different department (Marketing) -> DENIED
      const marketingAt136: EvaluatorTarget = {
        id: "emp-3",
        office_id: office136,
        department: "Marketing",
        reports_to: sauravMaviId,
      };
      expect(evaluateAccess(userAPermissions, marketingAt136, "employees.view")).toBe(false);

      // 5. In office 136, Sales department, but different team lead -> DENIED
      const repOtherTeam: EvaluatorTarget = {
        id: "emp-4",
        office_id: office136,
        department: "Sales",
        reports_to: otherLeadId,
      };
      expect(evaluateAccess(userAPermissions, repOtherTeam, "employees.view")).toBe(false);
    });

    test("User B scenario: can see 136 office ALL information across all departments & teams", () => {
      const userBPermissions: EvaluatorPermission[] = [
        {
          permission: "employees.view",
          scope: "OFFICE",
          office_id: office136,
          department: null,
          team_lead_id: null,
        },
      ];

      // 1. Sales rep at 136 -> GRANTED
      expect(
        evaluateAccess(
          userBPermissions,
          { id: "emp-1", office_id: office136, department: "Sales", reports_to: sauravMaviId },
          "employees.view"
        )
      ).toBe(true);

      // 2. Marketing rep at 136 -> GRANTED
      expect(
        evaluateAccess(
          userBPermissions,
          { id: "emp-2", office_id: office136, department: "Marketing", reports_to: otherLeadId },
          "employees.view"
        )
      ).toBe(true);

      // 3. HR manager at 136 -> GRANTED
      expect(
        evaluateAccess(
          userBPermissions,
          { id: "emp-3", office_id: office136, department: "HR", reports_to: null },
          "employees.view"
        )
      ).toBe(true);

      // 4. Employee at Sector 63 office -> DENIED
      expect(
        evaluateAccess(
          userBPermissions,
          { id: "emp-4", office_id: office63, department: "Sales", reports_to: sauravMaviId },
          "employees.view"
        )
      ).toBe(false);
    });

    test("Department-wide access across all offices", () => {
      const deptPermissions: EvaluatorPermission[] = [
        {
          permission: "leads.view",
          scope: "DEPARTMENT",
          office_id: null,
          department: "Sales",
          team_lead_id: null,
        },
      ];

      // Sales at office 136 -> GRANTED
      expect(
        evaluateAccess(deptPermissions, { id: "1", office_id: office136, department: "Sales" }, "leads.view")
      ).toBe(true);

      // Sales at office 63 -> GRANTED
      expect(
        evaluateAccess(deptPermissions, { id: "2", office_id: office63, department: "Sales" }, "leads.view")
      ).toBe(true);

      // Operations at office 136 -> DENIED
      expect(
        evaluateAccess(deptPermissions, { id: "3", office_id: office136, department: "Operations" }, "leads.view")
      ).toBe(false);
    });

    test("Global administrator access: unrestricted across all dimensions", () => {
      const globalPermissions: EvaluatorPermission[] = [
        {
          permission: "*",
          scope: "GLOBAL",
        },
      ];

      expect(
        evaluateAccess(globalPermissions, { id: "1", office_id: office136, department: "Sales" }, "*")
      ).toBe(true);
      expect(
        evaluateAccess(globalPermissions, { id: "2", office_id: office63, department: "Finance" }, "*")
      ).toBe(true);
    });
  });

  describe("SQL Schema & Migration Consistency", () => {
    const migrationSql = read("supabase/migrations/20260909010000_multidimensional_permission_scopes.sql");
    const deploySql = read("supabase/deploy_all_20260908_enhancements.sql");

    test("migration script adds office_id, department, team_lead_id, team_name columns", () => {
      expect(migrationSql).toContain("add column if not exists office_id uuid");
      expect(migrationSql).toContain("add column if not exists department text");
      expect(migrationSql).toContain("add column if not exists team_lead_id uuid");
      expect(migrationSql).toContain("add column if not exists team_name text");
    });

    test("migration script implements recursive team hierarchy evaluation in can_access_user_data", () => {
      expect(migrationSql).toContain("with recursive sub_team");
      expect(migrationSql).toContain("p_target_user_id");
      expect(migrationSql).toContain("can_access_user_data");
    });

    test("migration script updates admin_grant_permission signature with 8 parameters", () => {
      expect(migrationSql).toContain("p_office_id");
      expect(migrationSql).toContain("p_department");
      expect(migrationSql).toContain("p_team_lead_id");
      expect(migrationSql).toContain("p_team_name");
      expect(migrationSql).toContain("p_user_id");
      expect(migrationSql).toContain("p_permission");
    });

    // Disposition 2026-10-19: production is deployed from the ordered
    // supabase/migrations folder. The 2026-09-08 "deploy_all" bundle predates
    // this migration and later replacements; re-running it would roll newer
    // functions back, so it is marked historical instead of regenerated.
    test("the multidimensional permissions migration ships in the ordered migrations folder", () => {
      const migrations = fs.readdirSync(path.resolve(__dirname, "..", "supabase", "migrations"));
      expect(migrations).toContain("20260909010000_multidimensional_permission_scopes.sql");
      expect(deploySql).toContain("HISTORICAL BUNDLE - DO NOT RUN");
    });
  });

  describe("Permissions Manager Admin & System Admin Visibility Enforcement", () => {
    const adminDashboardTsx = read("screens/admin/AdminDashboardScreen.tsx");
    const adminStackTsx = read("navigation/AdminStackNavigator.tsx");
    const permissionsManagerTsx = read("screens/admin/PermissionsManagerScreen.tsx");
    const permissionCatalogTs = read("constants/permissionCatalog.ts");

    // Disposition 2026-10-19: since the permission engine v2
    // (20261007100000) the Permissions Manager is opened by the
    // permissions.view / permissions.assign keys (admins hold them; others only
    // by explicit grant), checked by the route guard and by the server.
    test("AdminDashboardScreen shows Permissions Manager only to holders of its permission", () => {
      expect(adminDashboardTsx).toContain('canOpenScreen("PermissionsManager") && (<ActionCard');
      expect(adminDashboardTsx).toContain('label="Permissions Manager"');
      expect(permissionCatalogTs).toContain('PermissionsManager: ["permissions.view", "permissions.assign"]');
    });

    test("AdminStackNavigator guards the PermissionsManager route with its permission", () => {
      expect(adminStackTsx).toContain(
        'lazyScreen(() => import("@/screens/admin/PermissionsManagerScreen"), SCREEN_PERMISSIONS.PermissionsManager)',
      );
      expect(adminStackTsx).toContain("return permission ? withPermissionGuard(DeferredScreen, permission) : DeferredScreen;");
      expect(adminStackTsx).toContain('name="PermissionsManager"');
    });

    test("PermissionsManagerScreen contains defensive access guard and fallback UI for non-admins", () => {
      expect(permissionsManagerTsx).toContain("if (!canView)");
      expect(permissionsManagerTsx).toContain("Access restricted");
      expect(permissionsManagerTsx).toContain("Administrators and System Administrators");
    });
  });
});
