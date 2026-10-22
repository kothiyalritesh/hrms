/**
 * "Tell us why you left the office" requests. A tapped office alert (local or
 * push), an in-app notification or a link asks for the reason form; the
 * OfficeExitReasonHost (mounted once at the app root) shows it. A request made
 * before the host is mounted (cold start from a notification) is kept until it
 * subscribes.
 */
type Listener = (eventId: string | null) => void;

const listeners = new Set<Listener>();
let pending: { eventId: string | null } | null = null;

export const OFFICE_EXIT_NOTIFICATION_TYPES = new Set([
  "office_exit",
  "geofence_reason_required",
]);

export function requestOfficeExitPrompt(eventId?: string | null) {
  const id = typeof eventId === "string" && eventId.trim() ? eventId.trim() : null;
  if (listeners.size === 0) {
    pending = { eventId: id };
    return;
  }
  listeners.forEach((listener) => listener(id));
}

export function subscribeOfficeExitPrompt(listener: Listener) {
  listeners.add(listener);
  if (pending) {
    const { eventId } = pending;
    pending = null;
    listener(eventId);
  }
  return () => {
    listeners.delete(listener);
  };
}

/** Event id carried by a notification: data.geofenceEventId or ?geofenceEvent= in its link. */
export function officeExitEventIdFrom(data: Record<string, unknown> | null | undefined): string | null {
  if (!data) return null;
  const direct = data.geofenceEventId;
  if (typeof direct === "string" && direct.trim()) return direct.trim();
  const link = typeof data.deepLink === "string" ? data.deepLink : typeof data.deep_link === "string" ? data.deep_link : "";
  const match = /[?&]geofenceEvent=([0-9a-f-]{36})/i.exec(link);
  return match ? match[1] : null;
}

/** True for notifications that ask the employee to explain an office exit. */
export function isOfficeExitNotification(data: Record<string, unknown> | null | undefined): boolean {
  if (!data) return false;
  if (OFFICE_EXIT_NOTIFICATION_TYPES.has(String(data.type ?? ""))) return true;
  const link = typeof data.deepLink === "string" ? data.deepLink : typeof data.deep_link === "string" ? data.deep_link : "";
  return /[?&]geofenceEvent=/i.test(link);
}
