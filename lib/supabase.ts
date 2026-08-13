import { createClient } from "@supabase/supabase-js";
import { persistentAuthStorage } from "@/utils/secureStorage";

const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error(
    "Missing EXPO_PUBLIC_SUPABASE_URL or EXPO_PUBLIC_SUPABASE_ANON_KEY",
  );
}

function assertValidSupabaseConfig(urlValue: string, keyValue: string) {
  let parsedUrl: URL;
  try {
    parsedUrl = new URL(urlValue);
  } catch {
    throw new Error("EXPO_PUBLIC_SUPABASE_URL is not a valid URL");
  }
  if (parsedUrl.protocol !== "https:") {
    throw new Error("EXPO_PUBLIC_SUPABASE_URL must use HTTPS");
  }

  // Supabase supports JWT anon keys and the newer sb_publishable_* keys.
  const isPublishableKey = /^sb_publishable_[A-Za-z0-9_-]+$/.test(keyValue);
  const jwtParts = keyValue.split(".");
  const isJwt = jwtParts.length === 3 && jwtParts.every(Boolean);
  if (/\s/.test(keyValue) || (!isPublishableKey && !isJwt)) {
    throw new Error("EXPO_PUBLIC_SUPABASE_ANON_KEY is malformed");
  }
}

assertValidSupabaseConfig(supabaseUrl, supabaseAnonKey);

// Keep Supabase's established key stable so application updates restore the
// session written by every previous build instead of asking for another OTP.
export const supabaseAuthStorageKey = `sb-${new URL(supabaseUrl).hostname.split(".")[0]}-auth-token`;

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    storage: persistentAuthStorage,
    storageKey: supabaseAuthStorageKey,
    autoRefreshToken: true,
    persistSession: true,
    // HRMS establishes its session through the protected phone/OTP exchange.
    // URL inspection can consume unrelated hosting parameters or briefly
    // replace a restored session during startup, so it is intentionally off.
    detectSessionInUrl: false,
  },
  realtime: { params: { eventsPerSecond: 10 } },
});
