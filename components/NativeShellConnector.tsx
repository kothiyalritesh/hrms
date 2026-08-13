import { useCallback, useEffect } from "react";
import { Platform } from "react-native";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/lib/supabase";
import { nativeBridge } from "@/services/nativeBridge/client";

function openNotificationTarget(payload: unknown) {
  if (typeof window === "undefined" || !payload || typeof payload !== "object") return;
  const event = payload as { data?: Record<string, unknown> };
  const deepLink = event.data?.deepLink;
  if (typeof deepLink !== "string") return;
  try {
    const target = new URL(deepLink, window.location.origin);
    if (target.origin === window.location.origin && target.pathname.startsWith("/HRMS")) {
      window.location.assign(target.href);
      return;
    }
    if (target.protocol === "re-hrms:") {
      const route = `${target.host}${target.pathname}`.replace(/^\/+/, "");
      window.location.assign(`/HRMS/${route}${target.search}`);
    }
  } catch {
    // Ignore malformed notification routes; the notification is still shown.
  }
}

/**
 * Runs only in the hosted web HRMS. It hands the authenticated browser session
 * to the trusted Android shell and keeps the two runtimes reconciled without
 * exposing a privileged service key or any server-side secret.
 */
export default function NativeShellConnector() {
  const { user } = useAuth();

  const sync = useCallback(async () => {
    if (Platform.OS !== "web" || !user?.id || !nativeBridge.isAvailable()) return;
    const { data } = await supabase.auth.getSession();
    const session = data.session;
    if (!session) return;
    await nativeBridge.request("auth.syncSession", {
      accessToken: session.access_token,
      refreshToken: session.refresh_token,
      userId: user.id,
      userName: user.name,
    });
    await Promise.allSettled([
      nativeBridge.request("notifications.register"),
      nativeBridge.request("tracking.restore"),
    ]);
  }, [user]);

  useEffect(() => {
    if (Platform.OS !== "web") return;
    void sync();
    const removeReady = nativeBridge.on("bridge.ready", () => void sync());
    const removeNotification = nativeBridge.on(
      "notification.opened",
      openNotificationTarget,
    );
    const { data } = supabase.auth.onAuthStateChange((event) => {
      if (!nativeBridge.isAvailable()) return;
      if (event === "SIGNED_OUT") {
        void nativeBridge.request("auth.clearSession").catch(() => undefined);
      } else if (event === "TOKEN_REFRESHED" || event === "SIGNED_IN") {
        void sync();
      }
    });
    return () => {
      removeReady();
      removeNotification();
      data.subscription.unsubscribe();
    };
  }, [sync]);

  return null;
}
