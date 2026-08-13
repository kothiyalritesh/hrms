import type { Destination } from "@/services/location/types";
import { getBusinessDateIST } from "@/utils/attendanceTimestamp";

/**
 * Returns the calendar date used by field visits and tracking in India.
 * The optional date makes day-boundary behaviour deterministic in tests.
 */
export function getTrackingDateIST(date: Date = new Date()): string {
  return getBusinessDateIST(date);
}

export function isDestinationForToday(
  destination: Destination | null | undefined,
  date: Date = new Date(),
): destination is Destination {
  return destination?.visitDate === getTrackingDateIST(date);
}
