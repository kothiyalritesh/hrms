import { Platform } from "react-native";
import * as Crypto from "expo-crypto";
import * as Device from "expo-device";
import Constants from "expo-constants";
import { supabase } from "@/lib/supabase";
import { persistentAuthStorage } from "@/utils/secureStorage";
import { firstRpcRow } from "@/utils/supabaseRpc";
import { fetchAllPages } from "@/utils/supabasePagination";

const DEVICE_IDENTIFIER_KEY = "hrms.auth.device-identifier.v1";

export interface UserDeviceSession {
  id: string;
  device_identifier: string;
  device_name: string | null;
  platform: string;
  app_version: string | null;
  last_active_at: string;
  created_at: string;
  revoked_at: string | null;
  is_active: boolean;
}

async function identifier() {
  const stored = await persistentAuthStorage.getItem(DEVICE_IDENTIFIER_KEY);
  if (stored) return stored;
  const created = Crypto.randomUUID();
  await persistentAuthStorage.setItem(DEVICE_IDENTIFIER_KEY, created);
  return created;
}

export const DeviceSessionService = {
  async registerCurrent(): Promise<{
    success: boolean;
    revoked: boolean;
    session?: UserDeviceSession;
  }> {
    const deviceIdentifier = await identifier();
    const { data, error } = await supabase.rpc("rpc_register_device_session", {
      p_device_identifier: deviceIdentifier,
      p_device_name:
        Device.deviceName ||
        `${Device.manufacturer || "Unknown"} ${Device.modelName || "device"}`,
      p_platform: Platform.OS,
      p_app_version: Constants.expoConfig?.version || "unknown",
      p_push_token: null,
    });
    if (error) throw error;
    const result = firstRpcRow<any>(data);
    return {
      success: result?.success === true,
      revoked: result?.error === "DEVICE_SESSION_REVOKED",
      session: result?.session,
    };
  },

  async listMine(): Promise<{
    currentIdentifier: string;
    sessions: UserDeviceSession[];
  }> {
    const currentIdentifier = await identifier();
    const { data, error } = await fetchAllPages<UserDeviceSession>((from, to) =>
      supabase
        .from("user_device_sessions")
        .select(
          "id,device_identifier,device_name,platform,app_version,last_active_at,created_at,revoked_at,is_active",
        )
        .order("last_active_at", { ascending: false })
        .order("id")
        .range(from, to),
    );
    if (error) throw error;
    return { currentIdentifier, sessions: (data || []) as UserDeviceSession[] };
  },

  async revoke(sessionId: string) {
    const { data, error } = await supabase.rpc("rpc_revoke_device_session", {
      p_session_id: sessionId,
    });
    if (error) throw error;
    const result = firstRpcRow<any>(data);
    if (result?.success !== true) {
      throw new Error(result?.message || "Device session revocation failed.");
    }
  },

  async closeCurrent() {
    const deviceIdentifier = await identifier();
    const { error } = await supabase.rpc("rpc_close_device_session", {
      p_device_identifier: deviceIdentifier,
    });
    if (error) throw error;
  },
};
