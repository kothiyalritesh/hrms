import { sortOfflinePings } from "@/services/location/offline";
import { OfflineLocationPing } from "@/services/location/types";

function queued(id: string, capturedAt: string): OfflineLocationPing {
  return {
    config: {
      attendanceId: "attendance-1",
      trackingSessionId: "session-1",
      fieldVisitId: null,
    },
    qualityStatus: "RELIABLE",
    location: {
      clientEventId: id,
      latitude: 28.6,
      longitude: 77.2,
      accuracy: 10,
      altitude: null,
      heading: null,
      speed: null,
      mocked: false,
      capturedAt,
    },
  };
}

test("offline pings synchronize in captured-time order", () => {
  const sorted = sortOfflinePings([
    queued("third", "2026-07-23T03:00:00.000Z"),
    queued("first", "2026-07-23T01:00:00.000Z"),
    queued("second", "2026-07-23T02:00:00.000Z"),
  ]);
  expect(sorted.map((item) => item.location.clientEventId)).toEqual([
    "first",
    "second",
    "third",
  ]);
});
