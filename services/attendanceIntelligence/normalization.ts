import { getBusinessDateIST } from "@/utils/businessDate";
import { DEFAULT_LATE_CHECKIN_TIME } from "@/constants/attendancePolicy";
﻿/**
 * ATTENDANCE INTELLIGENCE PLATFORM — DATA CLEANING & NORMALIZATION ENGINE
 * Preserves raw input values while computing deterministic canonical representations.
 */

export function cleanStr(val: any): string {
  if (val === null || val === undefined) return "";
  return String(val).trim().replace(/\s+/g, " ");
}

export function toTitleCase(val: string): string {
  const cleaned = cleanStr(val);
  if (!cleaned) return "";
  return cleaned
    .toLowerCase()
    .split(" ")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

export function normalizeNameKey(name: string): string {
  const cleaned = cleanStr(name);
  return cleaned.replace(/[^A-Za-z0-9 ]+/g, "").toUpperCase().trim();
}

export function normalizeTeamHead(rawHead: string | null | undefined): string {
  if (!rawHead || !cleanStr(rawHead)) return "General Operations";
  const cleaned = cleanStr(rawHead);
  const lower = cleaned.toLowerCase();

  // Explicit known aliases
  if (lower === "gv" || lower === "sales gv" || lower === "gv team") return "Sales GV";
  if (lower === "ankit mavi" || lower === "ankit") return "Ankit Mavi";
  if (lower === "gaurav mavi") return "Gaurav Mavi";
  if (lower === "ankush kadyan") return "Ankush Kadyan";
  if (lower === "sachin mavi") return "Sachin Mavi";
  if (lower === "vishal joshi") return "Vishal Joshi";
  if (lower === "vishal pandey") return "Vishal Pandey";
  if (lower === "sumit bansal") return "Sumit Bansal";
  if (lower === "navneet kumar") return "Navneet Kumar";
  if (lower === "sanjeev kumar thakur" || lower === "sanjeev thakur") return "Sanjeev Kumar Thakur";

  return toTitleCase(cleaned);
}

export function normalizeOfficeName(rawOffice: string | null | undefined): string {
  if (!rawOffice || !cleanStr(rawOffice)) return "Unassigned Office";
  const cleaned = cleanStr(rawOffice);
  const lower = cleaned.toLowerCase();

  if (lower.includes("136") || lower.includes("noida 136")) return "Noida 136";
  if (lower.includes("63") || lower.includes("sector 63")) return "Sector 63";
  if (lower.includes("lucknow")) return "Lucknow Office";
  if (lower.includes("gurugram") || lower.includes("gurgaon")) return "Gurugram";
  if (lower.includes("bop")) return "BOP Head Office";

  return toTitleCase(cleaned);
}

export function normalizeDepartmentName(rawDept: string | null | undefined, rawTeamHead?: string): string {
  if (!rawDept || !cleanStr(rawDept)) {
    if (rawTeamHead) return normalizeTeamHead(rawTeamHead) + " Team";
    return "General Operations";
  }
  return toTitleCase(cleanStr(rawDept));
}

// ── TIME & DURATION PARSING ──────────────────────────────────────────────────

export interface ParsedTime {
  hours: number;
  minutes: number;
  seconds: number;
  total_seconds: number;
  formatted_24h: string; // HH:MM:SS
  formatted_12h: string; // hh:mm AM/PM
}

export function parseTimeStr(timeVal: any): ParsedTime | null {
  if (!timeVal) return null;
  const s = cleanStr(timeVal);
  if (!s) return null;

  // Check 12h or 24h patterns
  const match = s.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?(?:\s*(AM|PM|am|pm))?$/);
  if (!match) return null;

  let h = parseInt(match[1], 10);
  const m = parseInt(match[2], 10);
  const sec = match[3] ? parseInt(match[3], 10) : 0;
  const ampm = match[4] ? match[4].toUpperCase() : null;

  if (ampm === "PM" && h < 12) h += 12;
  if (ampm === "AM" && h === 12) h = 0;

  if (h < 0 || h > 23 || m < 0 || m > 59 || sec < 0 || sec > 59) return null;

  const totalSec = h * 3600 + m * 60 + sec;
  const h24Str = `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
  const h12 = h % 12 || 12;
  const suffix = h >= 12 ? "PM" : "AM";
  const h12Str = `${h12}:${String(m).padStart(2, "0")} ${suffix}`;

  return {
    hours: h,
    minutes: m,
    seconds: sec,
    total_seconds: totalSec,
    formatted_24h: h24Str,
    formatted_12h: h12Str,
  };
}

export function calculateWorkDuration(
  inTime: string | null | undefined,
  outTime: string | null | undefined,
  validate2359 = true,
): {
  worked_minutes: number | null;
  worked_hours: number | null;
  status: "VALID" | "MISSING_OUT" | "INVALID_DURATION" | "NEGATIVE_DURATION" | "ANOMALY" | "ZERO";
} {
  if (!inTime) return { worked_minutes: null, worked_hours: null, status: "MISSING_OUT" };
  if (!outTime) return { worked_minutes: null, worked_hours: null, status: "MISSING_OUT" };

  const parsedIn = parseTimeStr(inTime);
  const parsedOut = parseTimeStr(outTime);

  if (!parsedIn || !parsedOut) {
    return { worked_minutes: null, worked_hours: null, status: "INVALID_DURATION" };
  }

  // Filter auto-checkout placeholders if configured
  if (validate2359) {
    if (parsedOut.formatted_24h.startsWith("23:59") || parsedOut.formatted_24h === "00:00:00") {
      return { worked_minutes: null, worked_hours: null, status: "MISSING_OUT" };
    }
  }

  const diffSeconds = parsedOut.total_seconds - parsedIn.total_seconds;
  if (diffSeconds < 0) {
    return { worked_minutes: null, worked_hours: null, status: "NEGATIVE_DURATION" };
  }

  const minutes = Math.round(diffSeconds / 60);
  const hours = Number((diffSeconds / 3600).toFixed(2));

  if (hours > 16.0) {
    return { worked_minutes: minutes, worked_hours: hours, status: "ANOMALY" };
  }

  return {
    worked_minutes: minutes,
    worked_hours: hours,
    status: "VALID",
  };
}

export function evaluateLateArrival(
  inTime: string | null | undefined,
  shiftStart = DEFAULT_LATE_CHECKIN_TIME,
  graceMinutes = 0,
): { is_late: boolean; late_minutes: number } {
  if (!inTime) return { is_late: false, late_minutes: 0 };
  const parsedIn = parseTimeStr(inTime);
  const parsedShift = parseTimeStr(shiftStart);

  if (!parsedIn || !parsedShift) return { is_late: false, late_minutes: 0 };

  const thresholdSeconds = parsedShift.total_seconds + graceMinutes * 60;
  if (parsedIn.total_seconds >= thresholdSeconds) {
    const diffSec = parsedIn.total_seconds - parsedShift.total_seconds;
    const lateMins = Math.ceil(diffSec / 60);
    return { is_late: true, late_minutes: Math.max(0, lateMins) };
  }

  return { is_late: false, late_minutes: 0 };
}

export function generateDateRange(startDate: string, endDate: string): string[] {
  const dates: string[] = [];
  const curr = new Date(startDate + "T00:00:00Z");
  const end = new Date(endDate + "T00:00:00Z");

  while (curr <= end) {
    dates.push(getBusinessDateIST(curr));
    curr.setUTCDate(curr.getUTCDate() + 1);
  }
  return dates;
}

export function formatDateLabel(isoDate: string): string {
  const dt = new Date(isoDate + "T00:00:00Z");
  const day = String(dt.getUTCDate()).padStart(2, "0");
  const monthNames = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const mon = monthNames[dt.getUTCMonth()];
  return `${day}-${mon}`;
}

