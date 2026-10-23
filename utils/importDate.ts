const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];

const iso = (y: number, m: number, d: number) => {
  const date = new Date(Date.UTC(y, m - 1, d));
  if (date.getUTCFullYear() !== y || date.getUTCMonth() !== m - 1 || date.getUTCDate() !== d) return undefined;
  return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
};

const fullYear = (y: string) => {
  const n = Number(y);
  if (y.length === 4) return n;
  // 2-digit years: 00-49 → 2000s, 50-99 → 1900s
  return n < 50 ? 2000 + n : 1900 + n;
};

/**
 * A date cell from an employee CSV as YYYY-MM-DD. Accepts 2026-10-15,
 * 15/10/2026, 15-10-2026, 15.10.26, 15-Oct-2026, 15 October 2026 and Excel
 * serial numbers (46310). Day comes before month, as written in India.
 * Returns null for an empty cell and undefined when it cannot be read.
 */
export function parseImportDate(raw: string | null | undefined): string | null | undefined {
  const text = String(raw ?? "").trim();
  if (!text) return null;
  let m = text.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (m) return iso(Number(m[1]), Number(m[2]), Number(m[3]));
  m = text.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2}|\d{4})$/);
  if (m) return iso(fullYear(m[3]), Number(m[2]), Number(m[1]));
  m = text.match(/^(\d{1,2})[\s/.-]+([a-z]{3,9})[\s/.,-]+(\d{2}|\d{4})$/i);
  if (m) {
    const month = MONTHS.indexOf(m[2].slice(0, 3).toLowerCase());
    return month < 0 ? undefined : iso(fullYear(m[3]), month + 1, Number(m[1]));
  }
  if (/^\d{5}$/.test(text)) {
    // Excel day number (1900 date system)
    const date = new Date(Date.UTC(1899, 11, 30) + Number(text) * 86_400_000);
    return iso(date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate());
  }
  return undefined;
}

/** "M", "male", "F", "Female" → MALE / FEMALE; null when empty, undefined when unknown. */
export function parseImportGender(raw: string | null | undefined): "MALE" | "FEMALE" | null | undefined {
  const text = String(raw ?? "").trim().toLowerCase();
  if (!text) return null;
  if (text === "m" || text === "male") return "MALE";
  if (text === "f" || text === "female") return "FEMALE";
  return undefined;
}
