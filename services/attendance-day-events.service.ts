import { supabase } from "@/lib/supabase";

/**
 * One employee-day as a time-ordered story from every source (server:
 * rpc_attendance_day_events). Used by Attendance Control, the Timeline and
 * the Excel export so they never disagree.
 */
export type DayEvent = {
  at: string;
  type: string;
  title: string;
  place: string | null;
  source: string;
  verified: boolean;
  detail: string | null;
};

export type DayEventMap = Record<string, DayEvent[]>;

export const dayKey = (userId: string, date: string) => `${userId}_${date}`;

/** Ranges up to this many days are loaded with the list; longer ones per card. */
export const PREFETCH_MAX_DAYS = 7;

export function daysBetween(from: string, to: string) {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
}

export async function fetchDayEvents(from: string, to: string, userIds?: string[]): Promise<DayEventMap> {
  const { data, error } = await supabase.rpc("rpc_attendance_day_events", {
    p_from: from,
    p_to: to,
    p_user_ids: userIds && userIds.length ? userIds : null,
  });
  if (error) throw error;
  const map: DayEventMap = {};
  for (const row of (Array.isArray(data) ? data : []) as { user_id: string; date: string; events: DayEvent[] }[]) {
    map[dayKey(row.user_id, row.date)] = row.events ?? [];
  }
  return map;
}

export type DaySource = "App" | "Bio" | "Site" | "Event";

export function daySources(events: DayEvent[]): DaySource[] {
  const out = new Set<DaySource>();
  for (const e of events) {
    if (e.type === "APP_CHECK_IN" || (e.type === "CHECK_IN" && e.source.startsWith("APP"))) out.add("App");
    if (e.type === "BIO_PUNCH" || (e.type === "CHECK_IN" && e.source === "BIOMETRIC")) out.add("Bio");
    if (e.type.startsWith("SITE_") || (e.type === "CHECK_IN" && e.source === "FIELD_VISIT")) out.add("Site");
    if (e.type.startsWith("EVENT_")) out.add("Event");
  }
  return (["App", "Bio", "Site", "Event"] as DaySource[]).filter((s) => out.has(s));
}

export type CurrentPlace = { text: string; at: string; confirmed: boolean };

/**
 * The latest place the evidence establishes, with its time. Never invents a
 * place: after leaving a site without a later place event, or a punch from an
 * unlinked machine, it says so.
 */
export function currentPlace(events: DayEvent[]): CurrentPlace | null {
  let place: CurrentPlace | null = null;
  for (const e of events) {
    switch (e.type) {
      case "CHECK_IN":
      case "APP_CHECK_IN":
      case "OFFICE_RETURN":
        if (e.place) place = { text: e.place, at: e.at, confirmed: true };
        break;
      case "SITE_IN":
        place = { text: `Site: ${e.place ?? "site"}`, at: e.at, confirmed: true };
        break;
      case "SITE_LEFT":
        place = { text: `Left ${e.place ?? "the site"}`, at: e.at, confirmed: false };
        break;
      case "SITE_OUT":
        place = { text: `Left ${e.place ?? "the site"}`, at: e.at, confirmed: false };
        break;
      case "BIO_PUNCH":
        place = { text: e.verified ? (e.place ?? "Office") : "Biometric machine (office not linked)", at: e.at, confirmed: e.verified };
        break;
      case "OFFICE_EXIT":
        place = { text: `Outside ${e.place ?? "the office"}`, at: e.at, confirmed: true };
        break;
      case "EVENT_IN":
        place = { text: `Event: ${e.place ?? "event"}`, at: e.at, confirmed: true };
        break;
      case "CHECK_OUT":
        place = { text: "Checked out", at: e.at, confirmed: true };
        break;
      default:
        break;
    }
  }
  return place;
}

/** Things HR should look at for this day. */
export function dayProblems(events: DayEvent[]): string[] {
  const problems: string[] = [];
  const gaps = events.filter((e) => e.type === "GPS_GAP");
  if (gaps.length) problems.push(gaps.map((g) => g.title).join(", "));
  if (events.some((e) => e.type === "BIO_PUNCH" && !e.verified)) problems.push("Biometric machine not linked to an office");
  const openLeft = events.filter((e) => e.type === "SITE_LEFT").filter(
    (left) => !events.some((e) => e.type === "SITE_OUT" && e.place === left.place && e.at >= left.at),
  );
  if (openLeft.length) problems.push(`Left ${openLeft[openLeft.length - 1].place ?? "a site"} without checking out`);
  const exits = events.filter((e) => e.type === "OFFICE_EXIT").length;
  const returns = events.filter((e) => e.type === "OFFICE_RETURN").length;
  if (exits > returns) problems.push("Left the office area, not back yet");
  return problems;
}

/** Events that tell the day at a glance (the card strip). */
export function keyEvents(events: DayEvent[]): DayEvent[] {
  const important = new Set(["CHECK_IN", "APP_CHECK_IN", "SITE_IN", "SITE_OUT", "SITE_LEFT", "OFFICE_EXIT", "OFFICE_RETURN", "EVENT_IN", "CHECK_OUT"]);
  const out: DayEvent[] = [];
  let lastPunchPlace: string | null = null;
  for (const e of events) {
    if (e.type === "BIO_PUNCH") {
      // one chip per change of machine/office, not every punch
      if (e.place !== lastPunchPlace) out.push(e);
      lastPunchPlace = e.place;
    } else if (important.has(e.type)) {
      out.push(e);
    }
  }
  return out;
}

export const EVENT_STYLE: Record<string, { icon: string; color: string; short: string }> = {
  CHECK_IN: { icon: "log-in", color: "#059669", short: "In" },
  APP_CHECK_IN: { icon: "smartphone", color: "#0EA5E9", short: "App" },
  CHECK_OUT: { icon: "log-out", color: "#DC2626", short: "Out" },
  BIO_PUNCH: { icon: "cpu", color: "#7C3AED", short: "Bio" },
  SITE_IN: { icon: "map-pin", color: "#8B5CF6", short: "Site in" },
  SITE_LEFT: { icon: "navigation", color: "#D97706", short: "Left site" },
  SITE_OUT: { icon: "flag", color: "#8B5CF6", short: "Site out" },
  OFFICE_EXIT: { icon: "log-out", color: "#DC2626", short: "Left office" },
  OFFICE_RETURN: { icon: "home", color: "#059669", short: "Back" },
  EXIT_REASON: { icon: "message-square", color: "#64748B", short: "Reason" },
  EVENT_IN: { icon: "calendar", color: "#2563EB", short: "Event" },
  EVENT_OUT: { icon: "calendar", color: "#2563EB", short: "Event out" },
  REGULARIZED: { icon: "edit-3", color: "#6D1B6D", short: "Corrected" },
  GPS_GAP: { icon: "wifi-off", color: "#D97706", short: "No GPS" },
};
