export type AttendanceReportFilters = {
  office: string;
  team: string;
  head: string;
  role: string;
  status: string;
  source: string;
  search: string;
};

export type AttendanceReportSection =
  | "Overview"
  | "Daily Records"
  | "Exceptions"
  | "Field Visits"
  | "Reconciliation"
  | "Exports";

export type ParsedAttendanceReportQuery = {
  start?: string;
  end?: string;
  filters: Partial<AttendanceReportFilters>;
  section?: AttendanceReportSection;
  interpretation: string[];
  warnings: string[];
};

const MONTHS: Record<string, number> = {
  jan: 1,
  january: 1,
  feb: 2,
  february: 2,
  mar: 3,
  march: 3,
  apr: 4,
  april: 4,
  may: 5,
  jun: 6,
  june: 6,
  jul: 7,
  july: 7,
  aug: 8,
  august: 8,
  sep: 9,
  sept: 9,
  september: 9,
  oct: 10,
  october: 10,
  nov: 11,
  november: 11,
  dec: 12,
  december: 12,
};

const pad = (value: number) => String(value).padStart(2, "0");

function isoDate(year: number, month: number, day: number) {
  const candidate = new Date(Date.UTC(year, month - 1, day));
  if (
    candidate.getUTCFullYear() !== year ||
    candidate.getUTCMonth() + 1 !== month ||
    candidate.getUTCDate() !== day
  ) {
    return undefined;
  }
  return `${year}-${pad(month)}-${pad(day)}`;
}

function normalizeYear(raw: string | undefined, fallback: number) {
  if (!raw) return fallback;
  const value = Number(raw);
  return value < 100 ? 2000 + value : value;
}

function extractDates(query: string, businessDate: string) {
  const dates: string[] = [];
  const occupied = new Set<string>();
  const fallbackYear = Number(businessDate.slice(0, 4));

  for (const match of query.matchAll(/\b(20\d{2})-(\d{2})-(\d{2})\b/g)) {
    const parsed = isoDate(
      Number(match[1]),
      Number(match[2]),
      Number(match[3]),
    );
    if (parsed && !occupied.has(parsed)) {
      dates.push(parsed);
      occupied.add(parsed);
    }
  }

  const namedDate =
    /\b(\d{1,2})(?:st|nd|rd|th)?(?:\s*[-/]\s*|\s+)(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)(?:\s*[-/,]?\s*(\d{2,4}))?\b/gi;
  for (const match of query.matchAll(namedDate)) {
    const parsed = isoDate(
      normalizeYear(match[3], fallbackYear),
      MONTHS[match[2].toLowerCase()],
      Number(match[1]),
    );
    if (parsed && !occupied.has(parsed)) {
      dates.push(parsed);
      occupied.add(parsed);
    }
  }
  return dates;
}

function titleCase(value: string) {
  return value
    .trim()
    .replace(/\s+/g, " ")
    .split(" ")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
    .join(" ");
}

function scopedLabel(query: string, suffix: "team" | "office") {
  const suffixMatch = new RegExp(`\\s+${suffix}\\b`, "i").exec(query);
  if (!suffixMatch) return undefined;
  const prefix = query.slice(0, suffixMatch.index);
  const segments = prefix
    .split(
      /\b(?:for|from|of|in|the|show|give|get|report|reports|attendance|custom|employee|employees)\b/i,
    )
    .map((value) => value.trim())
    .filter(Boolean);
  const cleaned = segments.at(-1)?.split(/\s+/).slice(-4).join(" ").trim();
  return cleaned ? titleCase(cleaned) : undefined;
}

function monthRange(businessDate: string, previous = false) {
  const [year, month] = businessDate.split("-").map(Number);
  const anchor = new Date(Date.UTC(year, month - 1 - (previous ? 1 : 0), 1));
  const start = `${anchor.getUTCFullYear()}-${pad(anchor.getUTCMonth() + 1)}-01`;
  const last = new Date(
    Date.UTC(anchor.getUTCFullYear(), anchor.getUTCMonth() + 1, 0),
  );
  const naturalEnd = `${last.getUTCFullYear()}-${pad(last.getUTCMonth() + 1)}-${pad(last.getUTCDate())}`;
  return {
    start,
    end: previous || naturalEnd < businessDate ? naturalEnd : businessDate,
  };
}

export function parseAttendanceReportQuery(
  rawQuery: string,
  businessDate: string,
): ParsedAttendanceReportQuery {
  const query = rawQuery.trim().toLowerCase();
  const result: ParsedAttendanceReportQuery = {
    filters: {},
    interpretation: [],
    warnings: [],
  };
  if (!query) {
    result.warnings.push("Enter a report request.");
    return result;
  }

  const dates = extractDates(query, businessDate);
  if (dates.length >= 2) {
    [result.start, result.end] =
      dates[0] <= dates[1] ? [dates[0], dates[1]] : [dates[1], dates[0]];
  } else if (dates.length === 1) {
    result.start = dates[0];
    result.end = dates[0];
  } else if (/\blast month\b/.test(query)) {
    Object.assign(result, monthRange(businessDate, true));
  } else if (/\bthis month\b/.test(query)) {
    Object.assign(result, monthRange(businessDate));
  } else if (/\byesterday\b/.test(query)) {
    const date = new Date(`${businessDate}T00:00:00Z`);
    date.setUTCDate(date.getUTCDate() - 1);
    result.start = result.end = date.toISOString().slice(0, 10);
  } else if (/\btoday\b/.test(query)) {
    result.start = result.end = businessDate;
  }

  if (result.start && result.end) {
    result.interpretation.push(`${result.start} to ${result.end}`);
  } else {
    result.warnings.push(
      "No date was recognised; the current report period will be used.",
    );
  }

  const team = scopedLabel(query, "team");
  const office = scopedLabel(query, "office");
  if (team) {
    result.filters.team = team;
    result.interpretation.push(`${team} team`);
  }
  if (office) {
    result.filters.office = office;
    result.interpretation.push(`${office} office`);
  }

  const head = query.match(
    /\b(?:reporting to|under|managed by|team head)\s+([a-z][a-z .'-]{1,50}?)(?=\s+(?:from|between|who|with|during|in|on|this|last|today|yesterday)\b|$)/i,
  )?.[1];
  if (head) {
    result.filters.head = titleCase(head);
    result.interpretation.push(`reporting to ${titleCase(head)}`);
  }

  const roleRules: Array<[RegExp, string]> = [
    [/\bsales managers?\b/, "Sales Manager"],
    [/\bteam heads?\b/, "Team Head"],
    [/\bbusiness heads?\b/, "Business Head"],
    [/\btelecallers?\b/, "Telecaller"],
    [/\b(?:bde|business development executives?)\b/, "BDE"],
    [/\b(?:bdm|business development managers?)\b/, "BDM"],
  ];
  for (const [pattern, role] of roleRules) {
    if (pattern.test(query)) {
      result.filters.role = role;
      result.interpretation.push(`${role} role`);
      break;
    }
  }

  const statusRules: Array<[RegExp, string, AttendanceReportSection]> = [
    [/\b(?:late|latecomers?|came late)\b/, "LATE", "Exceptions"],
    [/\b(?:absent|absentees?)\b/, "ABSENT", "Exceptions"],
    [
      /\b(?:no|missing|forgot(?:ten)?)\s+checkout\b/,
      "NO_CHECKOUT",
      "Exceptions",
    ],
    [/\b(?:field visit|site visit)s?\b/, "FIELD_VISIT", "Field Visits"],
    [
      /\b(?:suspicious|fraud|mock(?:ed)? gps)\b/,
      "SUSPICIOUS_GPS",
      "Exceptions",
    ],
    [
      /\b(?:configuration|setup)\s+(?:issue|required)\b/,
      "CONFIG_REQUIRED",
      "Exceptions",
    ],
    [
      /\b(?:data|attendance|biometric)\s+(?:not synced|missing sync|sync issue)\b/,
      "DATA_NOT_SYNCED",
      "Exceptions",
    ],
    [
      /\b(?:mapping|required mapping|unmapped)\b/,
      "MAPPING_REQUIRED",
      "Exceptions",
    ],
    [/\b(?:on leave|leave)\b/, "ON_LEAVE", "Daily Records"],
    [/\bholidays?\b/, "HOLIDAY", "Daily Records"],
    [/\bweekly offs?\b/, "WEEKLY_OFF", "Daily Records"],
    [/\b(?:present|checked in)\b/, "PRESENT", "Daily Records"],
  ];
  for (const [pattern, status, section] of statusRules) {
    if (pattern.test(query)) {
      result.filters.status = status;
      result.section = section;
      result.interpretation.push(status.replaceAll("_", " ").toLowerCase());
      break;
    }
  }

  if (/\bbiometric\b/.test(query)) {
    result.filters.source = "BIOMETRIC";
    result.interpretation.push("biometric source");
  } else if (/\bapp(?:lication)?\b/.test(query)) {
    result.filters.source = "APP";
    result.interpretation.push("app source");
  }
  if (/\b(?:multiple sources|reconciliation)\b/.test(query)) {
    result.filters.source = "MULTIPLE";
    result.section = "Reconciliation";
    result.interpretation.push("multiple attendance sources");
  }

  const employee = query.match(
    /\b(?:employee|person|staff)\s+(?:named\s+)?([a-z][a-z .'-]{1,50}?)(?=\s+(?:from|between|who|with|during|in|on)\b|$)/i,
  )?.[1];
  if (employee) {
    result.filters.search = titleCase(employee);
    result.interpretation.push(`employee matching “${titleCase(employee)}”`);
  }

  if (!result.interpretation.length) {
    result.warnings.push("No supported filter was recognised.");
  }
  return result;
}
