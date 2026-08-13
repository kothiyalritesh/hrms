import { secureStorage } from "@/utils/secureStorage";
import { supabase } from "@/lib/supabase";
import * as Crypto from "expo-crypto";
import { Platform } from "react-native";
import releaseConfig from "@/release.config.json";

const STORAGE_KEY = "@hrms_redacted_operational_errors_v1";
const MAX_ENTRIES = 50;

type RedactedOperationalError = {
  category: string;
  code: string;
  correlationId: string;
  recordedAt: string;
};

export async function reportNonFatalError(
  category: string,
  error?: unknown,
): Promise<void> {
  const value = error as { code?: unknown; name?: unknown } | null;
  const correlationId = Crypto.randomUUID();
  const entry: RedactedOperationalError = {
    category: category.slice(0, 80),
    code: String(value?.code || value?.name || "UNKNOWN").slice(0, 80),
    correlationId,
    recordedAt: new Date().toISOString(),
  };
  try {
    // The release gate can report an error before authentication restoration
    // finishes. The central RPC is authenticated-only, so avoid a guaranteed
    // 401 and retain the redacted entry locally until a user session exists.
    const { data: authData } = await supabase.auth.getSession();
    if (authData.session?.access_token) {
      const { data, error: reportError } = await supabase.rpc(
        "rpc_record_client_operational_error",
        {
          p_category: entry.category,
          p_code: entry.code,
          p_build_id: releaseConfig.buildId,
          p_correlation_id: correlationId,
          p_client_platform: Platform.OS,
        },
      );
      const response = Array.isArray(data) ? data[0] : data;
      if (
        reportError ||
        response?.success !== true ||
        response?.correlation_id !== correlationId
      ) {
        throw reportError || new Error("CENTRAL_ERROR_REPORT_NOT_CONFIRMED");
      }
    }
  } catch {
    // The local redacted queue below remains the fallback while offline.
  }
  try {
    const raw = await secureStorage.getItem(STORAGE_KEY);
    const existing = raw ? JSON.parse(raw) : [];
    const entries = Array.isArray(existing) ? existing : [];
    await secureStorage.setItem(
      STORAGE_KEY,
      JSON.stringify([...entries.slice(-(MAX_ENTRIES - 1)), entry]),
    );
  } catch {
    // Diagnostics must never alter the outcome of an authoritative action.
  }
}
