const mockStore = new Map<string, string>();
jest.mock("@react-native-async-storage/async-storage", () => ({
  __esModule: true,
  default: {
    getItem: jest.fn(async (key: string) => mockStore.get(key) ?? null),
    setItem: jest.fn(async (key: string, value: string) => {
      mockStore.set(key, value);
    }),
    removeItem: jest.fn(async (key: string) => {
      mockStore.delete(key);
    }),
  },
}));
let mockUuid = 0;
jest.mock("expo-crypto", () => ({ randomUUID: () => `uuid-${++mockUuid}` }));
let mockOnline = true;
jest.mock("@/lib/network/NetworkManager", () => {
  const actual = jest.requireActual("@/lib/network/NetworkManager");
  return {
    NetworkManager: {
      isConnected: async () => mockOnline,
      classifyError: (error: any) => actual.NetworkManager.classifyError(error),
    },
  };
});

const OUTBOX_KEY = "@hrms_durable_outbox_entries_v1";

function freshOutbox() {
  let outbox: typeof import("@/services/outbox/DurableWriteOutbox").DurableWriteOutbox;
  jest.isolateModules(() => {
    outbox = require("@/services/outbox/DurableWriteOutbox").DurableWriteOutbox;
  });
  return outbox!;
}

const flush = async () => {
  for (let i = 0; i < 20; i += 1) await Promise.resolve();
};

beforeEach(() => {
  mockStore.clear();
  mockOnline = true;
  mockUuid = 0;
});

describe("DurableWriteOutbox lifecycle (offline attendance)", () => {
  it("queues while offline, then sends check-in before the dependent check-out", async () => {
    mockOnline = false;
    const outbox = freshOutbox();
    const sent: string[] = [];
    outbox.registerHandler("ATTENDANCE_CHECKIN", async (item) => {
      sent.push(`in:${item.idempotencyKey}`);
      return { success: true };
    });
    outbox.registerHandler("ATTENDANCE_CHECKOUT", async (item) => {
      sent.push(`out:${item.idempotencyKey}`);
      return { success: true };
    });
    // check-out enqueued FIRST in priority order would win without dependsOn
    await outbox.enqueue("ATTENDANCE_CHECKIN", { n: 1 }, { idempotencyKey: "op-in", userId: "u1" });
    await outbox.enqueue("ATTENDANCE_CHECKOUT", { n: 2 }, { idempotencyKey: "op-out", userId: "u1", dependsOnKey: "op-in" });
    await flush();
    expect(sent).toEqual([]);
    expect((await outbox.getQueue()).map((i) => i.status)).toEqual(["PENDING", "PENDING"]);

    mockOnline = true;
    await outbox.drain();
    expect(sent).toEqual(["in:op-in", "out:op-out"]);
    expect((await outbox.getQueue()).every((i) => i.status === "SYNCED")).toBe(true);
  });

  it("does not create a second item for the same operation id", async () => {
    mockOnline = false;
    const outbox = freshOutbox();
    await outbox.enqueue("ATTENDANCE_CHECKIN", { n: 1 }, { idempotencyKey: "same" });
    await outbox.enqueue("ATTENDANCE_CHECKIN", { n: 1 }, { idempotencyKey: "same" });
    expect(await outbox.getQueue()).toHaveLength(1);
  });

  it("resends an item that was in flight when the app was killed", async () => {
    mockStore.set(
      OUTBOX_KEY,
      JSON.stringify([
        {
          id: "x", operationType: "ATTENDANCE_CHECKIN", priority: 1, payload: {}, idempotencyKey: "k1",
          status: "PROCESSING", attempts: 1, maxRetries: 10, createdAt: Date.now(),
        },
      ]),
    );
    const outbox = freshOutbox();
    const handler = jest.fn(async () => ({ success: true }));
    outbox.registerHandler("ATTENDANCE_CHECKIN", handler);
    await outbox.drain();
    expect(handler).toHaveBeenCalledTimes(1);
    expect((await outbox.getQueue())[0].status).toBe("SYNCED");
  });

  it("dead-letters a server rejection and the check-out that depended on it", async () => {
    const outbox = freshOutbox();
    mockOnline = false;
    outbox.registerHandler("ATTENDANCE_CHECKIN", async () => {
      throw Object.assign(new Error("Outside office radius"), { terminal: true });
    });
    const checkout = jest.fn(async () => ({ success: true }));
    outbox.registerHandler("ATTENDANCE_CHECKOUT", checkout);
    await outbox.enqueue("ATTENDANCE_CHECKIN", {}, { idempotencyKey: "in" });
    await outbox.enqueue("ATTENDANCE_CHECKOUT", {}, { idempotencyKey: "out", dependsOnKey: "in" });
    mockOnline = true;
    await outbox.drain();
    await outbox.drain();
    const queue = await outbox.getQueue();
    expect(queue.map((i) => i.status)).toEqual(["DEAD_LETTER", "DEAD_LETTER"]);
    expect(queue[0].lastError).toMatch(/Outside office radius/);
    expect(checkout).not.toHaveBeenCalled();
  });

  it("keeps an action after an expired session (auth error) and retries it", async () => {
    const outbox = freshOutbox();
    let calls = 0;
    outbox.registerHandler("ATTENDANCE_CHECKIN", async () => {
      calls += 1;
      if (calls === 1) throw Object.assign(new Error("JWT expired"), { status: 401 });
      return { success: true };
    });
    await outbox.enqueue("ATTENDANCE_CHECKIN", {}, { idempotencyKey: "a" });
    await flush();
    let item = (await outbox.getQueue())[0];
    expect(item.status).toBe("FAILED");
    item.nextRetryAt = 0;
    await outbox.drain();
    item = (await outbox.getQueue())[0];
    expect(item.status).toBe("SYNCED");
  });

  it("does not spin when an item has no handler", async () => {
    const outbox = freshOutbox();
    await outbox.enqueue("UNKNOWN_KIND", {}, { idempotencyKey: "z" });
    await expect(Promise.race([
      outbox.drain().then(() => "done"),
      new Promise((resolve) => setTimeout(() => resolve("hung"), 1_000)),
    ])).resolves.toBe("done");
    expect((await outbox.getQueue())[0].status).toBe("PENDING");
  });

  it("notifies subscribers on every change", async () => {
    const outbox = freshOutbox();
    mockOnline = false;
    const listener = jest.fn();
    const unsubscribe = outbox.subscribe(listener);
    await outbox.enqueue("ATTENDANCE_CHECKIN", {}, { idempotencyKey: "s" });
    expect(listener).toHaveBeenCalled();
    unsubscribe();
  });
});
