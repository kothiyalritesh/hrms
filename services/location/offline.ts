import { OfflineLocationPing } from "@/services/location/types";

export function sortOfflinePings(items: OfflineLocationPing[]) {
  return [...items].sort(
    (first, second) =>
      Date.parse(first.location.capturedAt) -
      Date.parse(second.location.capturedAt),
  );
}
