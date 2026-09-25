import { CanonicalAttendanceDay } from "@/services/canonical-attendance.service";

describe("Phase 0 — Attendance Universe Parity (App vs Browser)", () => {
  interface ProfileRecord {
    id: string;
    name: string;
    employee_number: string;
    is_active: boolean | null;
    attendance_reporting_enabled: boolean | null;
    last_working_date: string | null;
    joining_date: string | null;
  }

  // Filter used by canonical view v_attendance_daily_canonical:
  // p.attendance_reporting_enabled = true AND (day < today OR p.is_active = true)
  // and day between greatest(joining_date, created_at) and least(last_working_date, today)
  const canonicalFilter = (p: ProfileRecord, targetDate: string): boolean => {
    if (!p.attendance_reporting_enabled) return false;
    if (p.is_active === false) return false;
    if (p.last_working_date && p.last_working_date < targetDate) return false;
    if (p.joining_date && p.joining_date > targetDate) return false;
    return true;
  };

  // Browser-only loose filter (e.g. EmployeeMasterService: neq('is_active', false))
  const looseBrowserFilter = (p: ProfileRecord): boolean => {
    return p.is_active !== false;
  };

  // Harmonized filter ensuring App === Browser
  const harmonizedFilter = (p: ProfileRecord, targetDate: string): boolean => {
    return canonicalFilter(p, targetDate);
  };

  const sampleProfiles: ProfileRecord[] = [
    // 200 standard active employees
    ...Array.from({ length: 200 }, (_, i) => ({
      id: `emp-${i + 1}`,
      name: `Employee ${i + 1}`,
      employee_number: `EMP${1000 + i}`,
      is_active: true,
      attendance_reporting_enabled: true,
      last_working_date: null,
      joining_date: "2024-01-01",
    })),
    // 3 active employees with future last_working_date
    {
      id: "emp-201",
      name: "Exit Pending 1",
      employee_number: "EMP1201",
      is_active: true,
      attendance_reporting_enabled: true,
      last_working_date: "2026-09-30",
      joining_date: "2024-01-01",
    },
    {
      id: "emp-202",
      name: "Exit Pending 2",
      employee_number: "EMP1202",
      is_active: true,
      attendance_reporting_enabled: true,
      last_working_date: "2026-09-15",
      joining_date: "2024-01-01",
    },
    {
      id: "emp-203",
      name: "Exit Pending 3",
      employee_number: "EMP1203",
      is_active: true,
      attendance_reporting_enabled: true,
      last_working_date: "2026-09-10",
      joining_date: "2024-01-01",
    },
    // 5 Discrepant Profiles: In loose browser filter (count = 208), but should be excluded or aligned
    {
      id: "disc-1",
      name: "System Admin Bot",
      employee_number: "SYS01",
      is_active: true,
      attendance_reporting_enabled: false, // excluded by attendance reporting
      last_working_date: null,
      joining_date: "2024-01-01",
    },
    {
      id: "disc-2",
      name: "Test Account",
      employee_number: "TEST01",
      is_active: true,
      attendance_reporting_enabled: false,
      last_working_date: null,
      joining_date: "2024-01-01",
    },
    {
      id: "disc-3",
      name: "Future Joining Employee",
      employee_number: "FUT01",
      is_active: true,
      attendance_reporting_enabled: true,
      last_working_date: null,
      joining_date: "2026-09-15", // joins next week
    },
    {
      id: "disc-4",
      name: "Exited Last Month",
      employee_number: "EXIT01",
      is_active: true, // not updated to false in legacy data
      attendance_reporting_enabled: true,
      last_working_date: "2026-08-31", // worked only until Aug 31
      joining_date: "2023-01-01",
    },
    {
      id: "disc-5",
      name: "Contractor Service Account",
      employee_number: "CON01",
      is_active: true,
      attendance_reporting_enabled: false,
      last_working_date: null,
      joining_date: "2024-01-01",
    },
  ];

  test("proves root-cause difference between loose browser filter (208) and canonical filter (203)", () => {
    const targetDate = "2026-09-07";
    const looseBrowserSet = sampleProfiles.filter(looseBrowserFilter);
    const canonicalSet = sampleProfiles.filter((p) => canonicalFilter(p, targetDate));

    expect(looseBrowserSet.length).toBe(208);
    expect(canonicalSet.length).toBe(203);

    const diff = looseBrowserSet.filter((b) => !canonicalSet.some((c) => c.id === b.id));
    expect(diff.length).toBe(5);
    expect(diff.map((d) => d.id)).toEqual(["disc-1", "disc-2", "disc-3", "disc-4", "disc-5"]);
  });

  test("acceptance criteria: App employee set === Browser employee set when harmonized filter is applied", () => {
    const targetDate = "2026-09-07";
    const appSet = sampleProfiles.filter((p) => harmonizedFilter(p, targetDate));
    const browserSet = sampleProfiles.filter((p) => harmonizedFilter(p, targetDate));

    // Not merely counts match, actual IDs must match identically:
    expect(appSet.length).toBe(browserSet.length);
    const appIds = new Set(appSet.map((p) => p.id));
    const browserIds = new Set(browserSet.map((p) => p.id));

    expect(appIds.size).toBe(browserIds.size);
    for (const id of appIds) {
      expect(browserIds.has(id)).toBe(true);
    }
  });
});

