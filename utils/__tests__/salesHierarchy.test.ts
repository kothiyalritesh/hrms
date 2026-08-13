import {
  canAssignReportingManager,
  canReportToSalesManager,
  isSalesManagerRole,
  SALES_MANAGER_DIRECT_REPORT_ROLES,
} from "@/utils/salesHierarchy";

describe("Sales Manager hierarchy", () => {
  test("recognizes normalized Sales Manager labels", () => {
    expect(isSalesManagerRole("Sales Manager")).toBe(true);
    expect(isSalesManagerRole("sales-manager")).toBe(true);
    expect(isSalesManagerRole("SALES_EXECUTIVE")).toBe(false);
  });

  test.each([
    "Sales Executive",
    "SALES_EXECUTIVE",
    "Tele Caller",
    "Teli Caller",
    "Telicaller",
    "TELECALLER",
    "Agent",
  ])("allows %s below a Sales Manager", (role) => {
    expect(canReportToSalesManager(role)).toBe(true);
    expect(canAssignReportingManager(role, "Sales Manager")).toBe(true);
  });

  test.each(["BDM", "Team Head", "Associate Partner", "Sales Manager"])(
    "does not allow %s as a direct Sales Manager report",
    (role) => {
      expect(canReportToSalesManager(role)).toBe(false);
      expect(canAssignReportingManager(role, "SALES_MANAGER")).toBe(false);
    },
  );

  test("does not change existing non-Sales-Manager hierarchy rules", () => {
    expect(canAssignReportingManager("BDM", "Associate Partner")).toBe(true);
    expect(canAssignReportingManager("Sales Executive", "Team Head")).toBe(true);
  });

  test("keeps the direct-report contract explicit", () => {
    expect(SALES_MANAGER_DIRECT_REPORT_ROLES).toEqual([
      "SALES_EXECUTIVE",
      "TELECALLER",
      "AGENT",
    ]);
  });
});
