import { Platform } from "react-native";
import * as FileSystem from "expo-file-system/legacy";
import * as Sharing from "expo-sharing";
import { downloadBrowserBytes } from "@/utils/browserFileDownload";

/**
 * Column headers read by the Team Hierarchy bulk importer
 * (TeamHierarchyScreen › handlePickFile). Keep in sync with its aliases:
 * "Emp Name" and "Designation" are required, plus Employee Number or
 * Employee Email, plus Manager Employee Number or Manager Email.
 * "Location" is parsed for preview only; the server import does not save it.
 */
export const HIERARCHY_IMPORT_HEADERS = [
  "Emp Name",
  "Employee Number",
  "Employee Email",
  "Manager Employee Number",
  "Manager Email",
  "Team",
  "Designation",
  "Contact",
  "Location",
] as const;

/** Rows whose Employee Number starts with this prefix are skipped by the importer. */
export const HIERARCHY_EXAMPLE_PREFIX = "EMP-EXAMPLE-";

export function isHierarchyExampleRow(employeeNumber: string): boolean {
  return employeeNumber.trim().toUpperCase().startsWith(HIERARCHY_EXAMPLE_PREFIX);
}

export const HIERARCHY_TEMPLATE_EXAMPLE_ROWS: string[][] = [
  [
    "EXAMPLE Manager - replace or delete this row",
    `${HIERARCHY_EXAMPLE_PREFIX}1`,
    "",
    "",
    "",
    "Example Team",
    "Associate Partner",
    "",
    "Example Office",
  ],
  [
    "EXAMPLE Agent - replace or delete this row",
    `${HIERARCHY_EXAMPLE_PREFIX}2`,
    "",
    `${HIERARCHY_EXAMPLE_PREFIX}1`,
    "",
    "Example Team",
    "Agent",
    "",
    "Example Office",
  ],
];

function csvCell(value: unknown): string {
  let text = value == null ? "" : String(value);
  // Spreadsheet formula injection guard (phone numbers like +91... stay as-is).
  if (/^[=@]/.test(text) || /^[+\-][^0-9]/.test(text)) text = `'${text}`;
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function toCsv(rows: unknown[][]): string {
  return rows.map((row) => row.map(csvCell).join(",")).join("\r\n") + "\r\n";
}

/**
 * Saves a UTF-8 CSV: a browser download on web (or the Android shell's
 * Save/Share bridge), and the native Save/Share sheet in the built-in app.
 */
export async function saveCsvFile(filename: string, csv: string): Promise<void> {
  const content = "﻿" + csv; // BOM so Excel opens UTF-8 names correctly
  if (Platform.OS === "web") {
    const bytes = new TextEncoder().encode(content);
    await downloadBrowserBytes(bytes, filename, "text/csv;charset=utf-8");
    return;
  }
  const directory = FileSystem.cacheDirectory;
  if (!directory) throw new Error("File storage is unavailable on this device.");
  const uri = `${directory}${Date.now()}-${filename}`;
  await FileSystem.writeAsStringAsync(uri, content, {
    encoding: FileSystem.EncodingType.UTF8,
  });
  if (!(await Sharing.isAvailableAsync())) {
    throw new Error("Sharing is not available on this device.");
  }
  await Sharing.shareAsync(uri, {
    mimeType: "text/csv",
    dialogTitle: `Save or share ${filename}`,
    UTI: "public.comma-separated-values-text",
  });
}
