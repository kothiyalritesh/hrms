import { Platform } from "react-native";
import { downloadBrowserBytes } from "@/utils/browserFileDownload";
import { parseHrmsTimestamp } from "@/utils/attendanceTimestamp";

const XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

export type SheetCell = string | number | boolean | null | undefined;

export interface ExportSheet {
  /** Excel limits sheet names to 31 characters. */
  name: string;
  /** Column headers, in order. */
  columns: string[];
  rows: SheetCell[][];
  /** Optional column widths in characters. */
  widths?: number[];
}

/**
 * Builds an .xlsx file and saves it: a normal download in the browser, the
 * Android Save/Share sheet inside the HRMS app (via the native bridge).
 */
export async function exportSheets(filename: string, sheets: ExportSheet[]) {
  const isNative = Platform.OS !== "web";
  if (!isNative && (typeof window === "undefined" || typeof document === "undefined")) {
    throw new Error("Downloads are available in the HRMS web app and the Android app.");
  }
  const XLSX: any = await import("xlsx");
  const workbook = XLSX.utils.book_new();
  for (const sheet of sheets) {
    const aoa = [sheet.columns, ...sheet.rows.map((r) => r.map((v) => (v === undefined ? null : v)))];
    const ws = XLSX.utils.aoa_to_sheet(aoa);
    ws["!cols"] = (sheet.widths ?? sheet.columns.map((c) => Math.max(10, Math.min(40, c.length + 2))))
      .map((wch) => ({ wch }));
    XLSX.utils.book_append_sheet(workbook, ws, sheet.name.slice(0, 31));
  }
  const name = filename.endsWith(".xlsx") ? filename : `${filename}.xlsx`;
  if (isNative) {
    // Built-in (non-WebView) app: no DOM download, so write to the cache and
    // open the system Save / Share sheet (same flow the old shell used).
    const base64: string = XLSX.write(workbook, { bookType: "xlsx", type: "base64", compression: true });
    await shareNativeBase64(base64, name, XLSX_MIME);
    return;
  }
  const bytes = XLSX.write(workbook, { bookType: "xlsx", type: "array", compression: true });
  await downloadBrowserBytes(bytes, name, XLSX_MIME);
}

async function shareNativeBase64(base64: string, filename: string, mimeType: string) {
  if (!base64) throw new Error("The generated download is empty.");
  const FileSystem: any = await import("expo-file-system/legacy");
  const Sharing: any = await import("expo-sharing");
  const directory: string | null = FileSystem.cacheDirectory;
  if (!directory) throw new Error("File storage is not available on this device.");
  const safeName = filename.replace(/[^\w.\-]+/g, "_");
  const uri = `${directory}${Date.now()}-${safeName}`;
  await FileSystem.writeAsStringAsync(uri, base64, { encoding: FileSystem.EncodingType.Base64 });
  if (!(await Sharing.isAvailableAsync())) {
    throw new Error("Sharing is not available on this device.");
  }
  await Sharing.shareAsync(uri, {
    mimeType,
    dialogTitle: `Save or share ${filename}`,
    UTI: "org.openxmlformats.spreadsheetml.sheet",
  });
}

const IST = "Asia/Kolkata";

/** Parses HRMS timestamps; values without a zone are IST wall clock, never UTC. */
function toDate(value: string): Date | null {
  try {
    return parseHrmsTimestamp(value);
  } catch {
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? null : d;
  }
}

/** "09 Oct 2026, 10:42 AM" in IST, or "" for empty values. */
export function formatIstDateTime(value: string | null | undefined): string {
  if (!value) return "";
  const d = toDate(value);
  if (!d) return String(value);
  return d.toLocaleString("en-IN", {
    timeZone: IST, day: "2-digit", month: "short", year: "numeric",
    hour: "2-digit", minute: "2-digit", hour12: true,
  });
}

/** "10:42 AM" in IST, or "" for empty values. */
export function formatIstTime(value: string | null | undefined): string {
  if (!value) return "";
  const d = toDate(value);
  if (!d) return String(value);
  return d.toLocaleTimeString("en-IN", { timeZone: IST, hour: "2-digit", minute: "2-digit", hour12: true });
}

/** Minutes after the late threshold (HH:MM, IST) for a check-in, never negative. */
export function minutesAfterIst(value: string | null | undefined, threshold: string): number {
  if (!value) return 0;
  const d = toDate(value);
  if (!d) return 0;
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: IST, hour: "numeric", minute: "numeric", hourCycle: "h23",
  }).formatToParts(d);
  const h = Number(parts.find((p) => p.type === "hour")?.value ?? 0);
  const m = Number(parts.find((p) => p.type === "minute")?.value ?? 0);
  const [th, tm] = threshold.split(":").map(Number);
  return Math.max(0, h * 60 + m - ((th || 0) * 60 + (tm || 0)));
}

export function formatMinutes(total: number | null | undefined): string {
  if (total == null || !Number.isFinite(total)) return "";
  const h = Math.floor(total / 60);
  const m = Math.round(total % 60);
  return h ? `${h}h ${m}m` : `${m}m`;
}
