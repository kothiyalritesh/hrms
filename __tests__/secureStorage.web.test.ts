// @ts-nocheck -- browser storage adapter regression test.

function memoryStorage() {
  const values = new Map<string, string>();
  return {
    getItem: jest.fn((key: string) => values.get(key) ?? null),
    setItem: jest.fn((key: string, value: string) => values.set(key, value)),
    removeItem: jest.fn((key: string) => values.delete(key)),
    clear: jest.fn(() => values.clear()),
    key: jest.fn((index: number) => [...values.keys()][index] ?? null),
    get length() {
      return values.size;
    },
  };
}

describe("web persistent authentication storage", () => {
  beforeEach(() => {
    jest.resetModules();
  });

  it("does not delete a newly persisted Supabase session through AsyncStorage cleanup", async () => {
    const localStorage = memoryStorage();
    const sessionStorage = memoryStorage();
    global.window = { localStorage, sessionStorage };

    const asyncRemoveItem = jest.fn(async (key: string) => {
      localStorage.removeItem(key);
    });
    jest.doMock("react-native", () => ({ Platform: { OS: "web" } }));
    jest.doMock("@react-native-async-storage/async-storage", () => ({
      __esModule: true,
      default: { removeItem: asyncRemoveItem },
    }));
    jest.doMock("expo-secure-store", () => ({
      WHEN_UNLOCKED_THIS_DEVICE_ONLY: "WHEN_UNLOCKED_THIS_DEVICE_ONLY",
    }));

    const { persistentAuthStorage } = require("../utils/secureStorage");
    const key = "sb-project-auth-token";
    const session = JSON.stringify({
      access_token: "access",
      refresh_token: "refresh",
    });

    await persistentAuthStorage.setItem(key, session);
    expect(localStorage.getItem(key)).toBe(session);
    expect(asyncRemoveItem).not.toHaveBeenCalled();

    expect(await persistentAuthStorage.getItem(key)).toBe(session);
    expect(localStorage.getItem(key)).toBe(session);
    expect(asyncRemoveItem).not.toHaveBeenCalled();
  });

  it("moves an earlier tab session to durable browser storage without deleting it", async () => {
    const localStorage = memoryStorage();
    const sessionStorage = memoryStorage();
    global.window = { localStorage, sessionStorage };
    sessionStorage.setItem("auth-key", "saved-session");

    jest.doMock("react-native", () => ({ Platform: { OS: "web" } }));
    jest.doMock("@react-native-async-storage/async-storage", () => ({
      __esModule: true,
      default: { removeItem: jest.fn() },
    }));
    jest.doMock("expo-secure-store", () => ({}));

    const { persistentAuthStorage } = require("../utils/secureStorage");
    expect(await persistentAuthStorage.getItem("auth-key")).toBe(
      "saved-session",
    );
    expect(localStorage.getItem("auth-key")).toBe("saved-session");
    expect(sessionStorage.getItem("auth-key")).toBeNull();
  });
});
