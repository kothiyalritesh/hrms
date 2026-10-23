import fs from "fs";
import path from "path";
import { parseImportDate, parseImportGender } from "@/utils/importDate";

const read = (relativePath: string) =>
  fs.readFileSync(path.resolve(__dirname, "..", relativePath), "utf8").replace(/\r\n/g, "\n");

describe("employee import reads dates the way HR writes them", () => {
  test.each([
    ["2026-10-15", "2026-10-15"],
    ["15/10/2026", "2026-10-15"],
    ["5-1-2025", "2025-01-05"],
    ["15.10.26", "2026-10-15"],
    ["15-Oct-2026", "2026-10-15"],
    ["15 October 2026", "2026-10-15"],
    ["46310", "2026-10-15"],
    ["", null],
  ])("%s -> %s", (raw, expected) => {
    expect(parseImportDate(raw)).toBe(expected);
  });

  test("impossible or unreadable dates are rejected, not guessed", () => {
    expect(parseImportDate("31/02/2026")).toBeUndefined();
    expect(parseImportDate("next monday")).toBeUndefined();
  });

  test("gender", () => {
    expect(parseImportGender("F")).toBe("FEMALE");
    expect(parseImportGender("male")).toBe("MALE");
    expect(parseImportGender(" ")).toBeNull();
    expect(parseImportGender("x")).toBeUndefined();
  });

  test("the import sends every template column; the server saves them", () => {
    const screen = read("screens/admin/UserManagementScreen.tsx");
    expect(screen).toContain('date_of_joining: dateOf(row.joining_date, "joining date"),');
    expect(screen).toContain('date_of_birth: dateOf(row.date_of_birth, "date of birth"),');
    const sql = read("supabase/migrations/20261023120000_employee_import_all_columns.sql");
    expect(sql).toContain("'date_of_joining', nullif(btrim(v_row->>'date_of_joining'), '')");
    expect(sql).toContain("jsonb_build_object('email', email, 'employee_number', employee_number, 'gender', gender)");
  });
});
