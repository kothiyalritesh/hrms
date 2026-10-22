const mockStore = new Map<string, string>();
const mockScheduled: any[] = [];
const mockDismissed: string[] = [];

jest.mock("react-native", () => ({ Platform: { OS: "android" }, Linking: { openURL: jest.fn() } }));
jest.mock("expo-constants", () => ({ __esModule: true, default: { expoConfig: { extra: {} } } }));
jest.mock("expo-crypto", () => ({ randomUUID: () => "uuid" }));
jest.mock("expo-device", () => ({ isDevice: true }));
const mockRpc = jest.fn();
jest.mock("@/lib/supabase", () => ({ supabase: { rpc: (...args: unknown[]) => mockRpc(...args), from: jest.fn() } }));
jest.mock("@/utils/secureStorage", () => ({
  secureStorage: {
    getItem: jest.fn(async (k: string) => mockStore.get(k) ?? null),
    setItem: jest.fn(async (k: string, v: string) => void mockStore.set(k, v)),
    removeItem: jest.fn(async (k: string) => void mockStore.delete(k)),
  },
}));
jest.mock("expo-notifications", () => ({
  setNotificationHandler: jest.fn(),
  getPermissionsAsync: jest.fn(async () => ({ granted: true })),
  scheduleNotificationAsync: jest.fn(async (req: any) => {
    mockScheduled.push(req);
    return `n${mockScheduled.length}`;
  }),
  dismissNotificationAsync: jest.fn(async (id: string) => void mockDismissed.push(id)),
  AndroidImportance: { MAX: 5, HIGH: 4, LOW: 2, DEFAULT: 3 },
  AndroidNotificationVisibility: { PUBLIC: 1 },
  AndroidNotificationPriority: { MAX: "max" },
}));

import { OFFICE_ALERT_CHANNEL_ID, handleOfficeRelation } from "@/services/location/notification.service";

const outside = { state: "OUTSIDE", distance_m: 420, radius_m: 200 };
const near = { state: "NEAR", distance_m: 260, radius_m: 200 };
const inside = { state: "INSIDE", distance_m: 30, radius_m: 200 };

describe("office exit alert (raised by the phone itself)", () => {
  beforeEach(() => {
    mockStore.clear();
    mockScheduled.length = 0;
    mockDismissed.length = 0;
    mockRpc.mockReset();
    mockRpc.mockResolvedValue({ data: null, error: null });
    jest.spyOn(Date, "now").mockReturnValue(1_000_000_000_000);
  });
  afterEach(() => jest.restoreAllMocks());

  test("leaving the office raises one loud alert on the office-alert channel", async () => {
    await handleOfficeRelation("att-1", inside);
    await handleOfficeRelation("att-1", outside);
    await handleOfficeRelation("att-1", outside);
    expect(mockScheduled).toHaveLength(1);
    expect(mockScheduled[0].trigger).toEqual({ channelId: OFFICE_ALERT_CHANNEL_ID });
    expect(mockScheduled[0].content.sound).toBe("default");
    expect(mockScheduled[0].content.body).toContain("420 m");
  });

  test("the edge band (NEAR) never alerts", async () => {
    await handleOfficeRelation("att-1", inside);
    await handleOfficeRelation("att-1", near);
    expect(mockScheduled).toHaveLength(0);
  });

  test("coming back removes the alert; a quick second exit within 20 min is silent", async () => {
    await handleOfficeRelation("att-1", outside);
    await handleOfficeRelation("att-1", inside);
    expect(mockDismissed).toEqual(["n1"]);
    (Date.now as jest.Mock).mockReturnValue(1_000_000_000_000 + 5 * 60_000);
    await handleOfficeRelation("att-1", outside);
    expect(mockScheduled).toHaveLength(1);
    await handleOfficeRelation("att-1", inside);
    (Date.now as jest.Mock).mockReturnValue(1_000_000_000_000 + 25 * 60_000);
    await handleOfficeRelation("att-1", outside);
    expect(mockScheduled).toHaveLength(2);
  });

  test("a new attendance starts fresh", async () => {
    await handleOfficeRelation("att-1", outside);
    await handleOfficeRelation("att-2", outside);
    expect(mockScheduled).toHaveLength(2);
  });

  test("after 10 minutes outside, the server's request for a reason rings once", async () => {
    const t0 = 1_000_000_000_000;
    await handleOfficeRelation("att-1", outside);
    (Date.now as jest.Mock).mockReturnValue(t0 + 5 * 60_000);
    await handleOfficeRelation("att-1", outside);
    expect(mockRpc).not.toHaveBeenCalled();

    mockRpc.mockResolvedValue({ data: { id: "ev-1", distance: 420 }, error: null });
    (Date.now as jest.Mock).mockReturnValue(t0 + 11 * 60_000);
    await handleOfficeRelation("att-1", outside);
    expect(mockRpc).toHaveBeenCalledWith("rpc_my_pending_geofence_reason");
    expect(mockScheduled).toHaveLength(2);
    expect(mockScheduled[1].content.title).toBe("Please tell us why you left the office");
    expect(mockScheduled[1].trigger).toEqual({ channelId: OFFICE_ALERT_CHANNEL_ID });

    (Date.now as jest.Mock).mockReturnValue(t0 + 12 * 60_000);
    await handleOfficeRelation("att-1", outside); // checked less than 3 min ago
    (Date.now as jest.Mock).mockReturnValue(t0 + 15 * 60_000);
    await handleOfficeRelation("att-1", outside); // same event again
    expect(mockRpc).toHaveBeenCalledTimes(2);
    expect(mockScheduled).toHaveLength(2);
  });
});

describe("tapping an office alert opens the reason form", () => {
  const { handleNotificationResponse } = jest.requireActual("@/services/location/notification.service") as typeof import("@/services/location/notification.service");
  const { subscribeOfficeExitPrompt, officeExitEventIdFrom } = jest.requireActual("@/services/location/officeExitPrompt") as typeof import("@/services/location/officeExitPrompt");
  const tap = (id: string, data: Record<string, unknown>) =>
    ({ actionIdentifier: "expo.modules.notifications.actions.DEFAULT", notification: { request: { identifier: id, content: { data } } } }) as any;

  beforeEach(() => mockStore.clear());

  test("local exit alert, local reminder and server push all open the form", async () => {
    const opened: (string | null)[] = [];
    const stop = subscribeOfficeExitPrompt((eventId) => opened.push(eventId));
    await handleNotificationResponse(tap("a", { type: "office_exit", deepLink: "re-hrms://" }));
    await handleNotificationResponse(tap("b", { type: "geofence_reason_required", geofenceEventId: "11111111-1111-1111-1111-111111111111" }));
    await handleNotificationResponse(tap("c", { type: "geofence_reason_required", deepLink: "/HRMS/?geofenceEvent=22222222-2222-2222-2222-222222222222" }));
    stop();
    expect(opened).toEqual([null, "11111111-1111-1111-1111-111111111111", "22222222-2222-2222-2222-222222222222"]);
  });

  test("the same tap replayed on the next app start does not reopen it", async () => {
    const opened: (string | null)[] = [];
    const stop = subscribeOfficeExitPrompt((eventId) => opened.push(eventId));
    await handleNotificationResponse(tap("same", { type: "office_exit" }));
    await handleNotificationResponse(tap("same", { type: "office_exit" }));
    stop();
    expect(opened).toHaveLength(1);
  });

  test("a tap before the form host is mounted is kept (cold start)", async () => {
    await handleNotificationResponse(tap("cold", { type: "office_exit" }));
    const opened: (string | null)[] = [];
    const stop = subscribeOfficeExitPrompt((eventId) => opened.push(eventId));
    stop();
    expect(opened).toEqual([null]);
  });

  test("event id comes from the data or the link", () => {
    expect(officeExitEventIdFrom({ deep_link: "/HRMS/?geofenceEvent=33333333-3333-3333-3333-333333333333" })).toBe(
      "33333333-3333-3333-3333-333333333333",
    );
    expect(officeExitEventIdFrom({ type: "office_exit" })).toBeNull();
  });
});
