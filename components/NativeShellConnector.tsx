import { useCallback, useEffect, useRef } from "react";
import { Platform } from "react-native";
import { useAuth } from "@/contexts/AuthContext";
import { supabase, supabaseAuthStorageKey } from "@/lib/supabase";
import { adoptNativeSession } from "@/lib/shellAuthStorage";
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
  // refresh token last handed to (or received from) the shell: avoids echoing
  // the same session back and forth
  const lastSynced = useRef<string | null>(null);

  const sync = useCallback(async (force = false) => {
    if (Platform.OS !== "web" || !user?.id || !nativeBridge.isAvailable()) return;
    const { data } = await supabase.auth.getSession();
    const session = data.session;
    if (!session) return;
    if (!force && lastSynced.current === session.refresh_token) return;
    lastSynced.current = session.refresh_token;
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
    void sync(true);
    const removeReady = nativeBridge.on("bridge.ready", () => void sync(true));
    // The shell refreshed the shared session (e.g. during background tracking):
    // adopt it so the page never refreshes with an already-used token.
    const removeSessionChanged = nativeBridge.on("auth.sessionChanged", (payload) => {
      const pushed = (payload as { session?: any } | null)?.session;
      void adoptNativeSession(supabaseAuthStorageKey, pushed).then(async (adopted) => {
        if (!adopted || !pushed?.access_token || !pushed?.refresh_token) return;
        lastSynced.current = pushed.refresh_token;
        await supabase.auth
          .setSession({ access_token: pushed.access_token, refresh_token: pushed.refresh_token })
          .catch(() => undefined);
      });
    });
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
      removeSessionChanged();
      removeNotification();
      data.subscription.unsubscribe();
    };
  }, [sync]);

  return null;
}
