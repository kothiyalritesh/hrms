import { Platform } from "react-native";
import { persistentAuthStorage } from "@/utils/secureStorage";
import { nativeBridge } from "@/services/nativeBridge/client";

/**
 * Inside the Android app the web page and the native shell hold the SAME
 * Supabase session (the page hands it to the shell for push + background
 * tracking). Supabase rotates the refresh token on every refresh, so when the
 * shell refreshed in the background (tracking uploads while the page slept),
 * the page later refreshed with its old, already-used token. Supabase treats
 * that as token reuse and revokes the session: the "random logout".
 *
 * This storage wrapper is used by the web Supabase client. Whenever the stored
 * session is close to expiry (exactly when supabase-js would refresh it), it
 * first asks the shell for its current session and adopts it if it is newer.
 * Sessions pushed by the shell ("auth.sessionChanged") are adopted the same
 * way. Outside the Android app, or with an older app that does not support
 * these commands, it behaves exactly like the normal storage.
 */

const NEAR_EXPIRY_MS = 5 * 60_000;
const NATIVE_ASK_TTL_MS = 15_000;

type StoredSession = {
  access_token?: string;
  refresh_token?: string;
  expires_at?: number;
  user?: { id?: string };
};

function parse(value: string | null): StoredSession | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value);
    // older supabase-js versions wrapped the session
    const session = parsed?.currentSession ?? parsed;
    return session && typeof session === "object" ? session : null;
  } catch {
    return null;
  }
}

function isNewerForSameUser(candidate: StoredSession | null, current: StoredSession | null) {
  return (
    !!candidate?.access_token &&
    !!candidate.refresh_token &&
    !!current?.user?.id &&
    candidate.user?.id === current.user.id &&
    Number(candidate.expires_at ?? 0) > Number(current.expires_at ?? 0)
  );
}

let nativeAsk: { at: number; promise: Promise<StoredSession | null> } | null = null;

function askNativeSession(): Promise<StoredSession | null> {
  if (nativeAsk && Date.now() - nativeAsk.at < NATIVE_ASK_TTL_MS) return nativeAsk.promise;
  const promise = nativeBridge
    .request<{ session?: StoredSession | null }>("auth.getSession", undefined, 4_000)
    .then((result) => result?.session ?? null)
    .catch(() => null); // older app / bridge not ready: keep the page's own session
  nativeAsk = { at: Date.now(), promise };
  return promise;
}

function inShell() {
  return Platform.OS === "web" && nativeBridge.isAvailable();
}

export function createShellAwareAuthStorage(storageKey: string) {
  return {
    async getItem(key: string) {
      const local = await persistentAuthStorage.getItem(key);
      if (key !== storageKey || !inShell()) return local;
      const current = parse(local);
      // Signed out on the page: never resurrect a session from the shell.
      if (!current?.refresh_token) return local;
      const expiresAtMs = Number(current.expires_at ?? 0) * 1000;
      if (expiresAtMs - Date.now() > NEAR_EXPIRY_MS) return local;
      const native = await askNativeSession();
      if (isNewerForSameUser(native, current)) {
        const value = JSON.stringify(native);
        await persistentAuthStorage.setItem(key, value);
        return value;
      }
      return local;
    },
    setItem(key: string, value: string) {
      return persistentAuthStorage.setItem(key, value);
    },
    removeItem(key: string) {
      return persistentAuthStorage.removeItem(key);
    },
  };
}

/**
 * Adopts a session pushed by the shell when it is newer than the stored one.
 * Returns true when the stored session was replaced.
 */
export async function adoptNativeSession(storageKey: string, pushed: unknown) {
  if (!inShell()) return false;
  const candidate = (pushed && typeof pushed === "object" ? pushed : null) as StoredSession | null;
  const current = parse(await persistentAuthStorage.getItem(storageKey));
  if (!isNewerForSameUser(candidate, current)) return false;
  await persistentAuthStorage.setItem(storageKey, JSON.stringify(candidate));
  nativeAsk = null;
  return true;
}
