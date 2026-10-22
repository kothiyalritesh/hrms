import React, { useCallback, useEffect, useRef, useState } from "react";
import { AppState, Linking, Platform, Pressable, StyleSheet, View } from "react-native";
import Feather from "@expo/vector-icons/Feather";
import { ThemedText } from "@/components/ThemedText";
import { BorderRadius, Spacing } from "@/constants/theme";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/lib/supabase";
import { nativeBridge } from "@/services/nativeBridge/client";
import { getNotificationStatus, registerDevicePushToken, requestNotificationPermission } from "@/services/location/notification.service";

/*
 * Phone notifications are delivered by the Android app (push, with the
 * channel's sound and vibration). This file covers the two gaps around that:
 *   - NotificationHealthBanner: tells the user when HRMS notifications are off
 *     or muted on their phone, with a one-tap fix.
 *   - BrowserNotificationWatcher: in a normal browser (no app), shows a system
 *     notification with a sound for new HRMS notifications while HRMS is open.
 *     Browsers cannot receive HRMS alerts while every HRMS tab is closed.
 */

const POLL_MS = 45_000;
const isBrowser = () =>
  Platform.OS === "web" && typeof window !== "undefined" && typeof document !== "undefined";

function readStore(key: string): string | null {
  try { return window.localStorage.getItem(key); } catch { return null; }
}
function writeStore(key: string, value: string) {
  try { window.localStorage.setItem(key, value); } catch { /* storage unavailable */ }
}

/** Short two-tone alert. Browsers may block it until the page has been tapped once. */
function playAlertSound() {
  try {
    const Ctx = (window as any).AudioContext || (window as any).webkitAudioContext;
    if (!Ctx) return;
    const ctx = new Ctx();
    const tone = (freq: number, start: number, length: number) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "sine";
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0.0001, ctx.currentTime + start);
      gain.gain.exponentialRampToValueAtTime(0.25, ctx.currentTime + start + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + start + length);
      osc.connect(gain).connect(ctx.destination);
      osc.start(ctx.currentTime + start);
      osc.stop(ctx.currentTime + start + length + 0.05);
    };
    tone(880, 0, 0.18);
    tone(1175, 0.22, 0.25);
    window.setTimeout(() => void ctx.close().catch(() => undefined), 1200);
  } catch {
    // sound is best effort
  }
}

function targetUrl(deepLink: string | null | undefined) {
  const base = window.location.pathname.startsWith("/HRMS") ? "/HRMS/" : "/";
  if (deepLink && deepLink.startsWith("/")) return deepLink;
  return `${base}notifications`;
}

async function showSystemNotification(n: { id: string | number; title: string | null; message: string | null; deep_link?: string | null }) {
  const title = n.title || "HRMS";
  const options: NotificationOptions & { vibrate?: number[]; renotify?: boolean } = {
    body: n.message || "",
    tag: `hrms-${n.id}`,
    icon: `${window.location.pathname.startsWith("/HRMS") ? "/HRMS/" : "/"}icon.png`,
    data: { url: targetUrl(n.deep_link) },
    vibrate: [250, 120, 250],
    requireInteraction: false,
  };
  try {
    const registration = "serviceWorker" in navigator ? await navigator.serviceWorker.getRegistration() : undefined;
    if (registration?.showNotification) {
      await registration.showNotification(title, options);
    } else {
      const shown = new Notification(title, options);
      shown.onclick = () => { window.focus(); window.location.assign(targetUrl(n.deep_link)); };
    }
  } catch {
    // e.g. permission revoked meanwhile
  }
  try { navigator.vibrate?.([250, 120, 250]); } catch { /* not supported */ }
  playAlertSound();
}

export function BrowserNotificationWatcher() {
  const { user } = useAuth();
  const running = useRef(false);

  useEffect(() => {
    if (!isBrowser() || !user?.id || nativeBridge.isAvailable()) return;
    if (typeof Notification === "undefined") return;
    const key = `@hrms_web_notified_since_${user.id}`;
    // First run on this browser: start from now, never replay old notifications.
    if (!readStore(key)) writeStore(key, new Date().toISOString());

    const poll = async () => {
      if (running.current || Notification.permission !== "granted") return;
      running.current = true;
      try {
        const since = readStore(key) || new Date().toISOString();
        const { data, error } = await supabase
          .from("notifications")
          .select("id,title,message,deep_link,created_at")
          .eq("user_id", user.id)
          .gt("created_at", since)
          .order("created_at", { ascending: true })
          .limit(5);
        if (error || !data?.length) return;
        for (const n of data as any[]) await showSystemNotification(n);
        writeStore(key, (data as any[])[data.length - 1].created_at);
      } finally {
        running.current = false;
      }
    };
    void poll();
    const timer = window.setInterval(() => void poll(), POLL_MS);
    const onVisible = () => { if (document.visibilityState === "visible") void poll(); };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [user?.id]);

  return null;
}

type BannerState =
  | { kind: "ok" }
  | { kind: "phone_off"; canAskAgain: boolean }
  | { kind: "phone_muted"; channels: string[] }
  | { kind: "browser_ask" }
  | { kind: "browser_blocked" };

export function NotificationHealthBanner() {
  const { user } = useAuth();
  const [state, setState] = useState<BannerState>({ kind: "ok" });
  const [busy, setBusy] = useState(false);
  const dismissKey = user?.id ? `@hrms_notif_banner_dismissed_${user.id}` : null;

  const check = useCallback(async () => {
    if (!user?.id) return;
    if (Platform.OS !== "web") {
      const status = await getNotificationStatus().catch(() => null);
      if (!status) return;
      if (!status.granted) setState({ kind: "phone_off", canAskAgain: status.canAskAgain });
      else if (status.mutedChannels.length) setState({ kind: "phone_muted", channels: status.mutedChannels });
      else setState({ kind: "ok" });
      return;
    }
    if (!isBrowser()) return;
    if (nativeBridge.isAvailable()) {
      try {
        const status = await nativeBridge.request<{ granted: boolean; canAskAgain?: boolean; mutedChannels?: string[] }>(
          "notifications.getStatus", undefined, 5_000);
        if (!status.granted) setState({ kind: "phone_off", canAskAgain: status.canAskAgain !== false });
        else if (status.mutedChannels?.length) setState({ kind: "phone_muted", channels: status.mutedChannels });
        else setState({ kind: "ok" });
      } catch {
        // Older app versions only know getPermission.
        const old = await nativeBridge
          .request<{ granted: boolean }>("notifications.getPermission", undefined, 5_000)
          .catch(() => ({ granted: true }));
        setState(old.granted ? { kind: "ok" } : { kind: "phone_off", canAskAgain: true });
      }
      return;
    }
    if (typeof Notification === "undefined") return setState({ kind: "ok" });
    if (dismissKey && readStore(dismissKey) === "1") return setState({ kind: "ok" });
    if (Notification.permission === "default") setState({ kind: "browser_ask" });
    else if (Notification.permission === "denied") setState({ kind: "browser_blocked" });
    else setState({ kind: "ok" });
  }, [user?.id, dismissKey]);

  useEffect(() => {
    void check();
    if (Platform.OS !== "web") {
      const sub = AppState.addEventListener("change", (s) => { if (s === "active") void check(); });
      return () => sub.remove();
    }
    if (!isBrowser()) return;
    const onVisible = () => { if (document.visibilityState === "visible") void check(); };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [check]);

  const act = async () => {
    if (busy) return;
    setBusy(true);
    try {
      if (Platform.OS !== "web") {
        const granted = state.kind === "phone_off" && state.canAskAgain
          ? await requestNotificationPermission().catch(() => false)
          : false;
        if (granted && user?.id) {
          // Register this phone right away so pushes start without a restart.
          await registerDevicePushToken(user.id).catch(() => undefined);
        }
        if (!granted) await Linking.openSettings().catch(() => undefined);
      } else if (state.kind === "phone_off") {
        const result = state.canAskAgain
          ? await nativeBridge.request<{ granted?: boolean }>("notifications.register", undefined, 60_000).catch(() => ({ granted: false }))
          : { granted: false };
        if (!result.granted) await nativeBridge.request("app.openSettings").catch(() => undefined);
      } else if (state.kind === "phone_muted") {
        await nativeBridge.request("app.openSettings").catch(() => undefined);
      } else if (state.kind === "browser_ask") {
        await Notification.requestPermission();
      }
    } finally {
      setBusy(false);
      void check();
    }
  };

  if (state.kind === "ok") return null;

  const text =
    state.kind === "phone_off"
      ? "Notifications are off for HRMS on this phone, so alerts won't appear in your notification panel."
      : state.kind === "phone_muted"
        ? `Some HRMS alerts are muted in phone settings: ${state.channels.join(", ")}. Turn on sound for them.`
        : state.kind === "browser_ask"
          ? "Get a desktop alert with sound when a new HRMS notification arrives (while HRMS is open)."
          : "Notifications are blocked for HRMS in this browser. Allow them in the site settings (lock icon in the address bar).";
  const button =
    state.kind === "phone_off" ? "Turn on"
      : state.kind === "phone_muted" ? "Open settings"
        : state.kind === "browser_ask" ? "Allow" : null;
  const urgent = state.kind === "phone_off" || state.kind === "phone_muted";

  return (
    <View style={[styles.banner, { backgroundColor: urgent ? "#FEF3C7" : "#EEF2FF", borderColor: urgent ? "#F59E0B" : "#A5B4FC" }]}>
      <Feather name="bell-off" size={18} color={urgent ? "#92400E" : "#3730A3"} />
      <ThemedText type="caption" style={[styles.text, { color: urgent ? "#92400E" : "#3730A3" }]}>{text}</ThemedText>
      {button ? (
        <Pressable onPress={act} disabled={busy} style={[styles.button, { backgroundColor: urgent ? "#B45309" : "#4F46E5", opacity: busy ? 0.6 : 1 }]}>
          <ThemedText type="caption" style={{ color: "#fff", fontWeight: "700" }}>{button}</ThemedText>
        </Pressable>
      ) : null}
      {!urgent ? (
        <Pressable
          onPress={() => { if (dismissKey) writeStore(dismissKey, "1"); setState({ kind: "ok" }); }}
          hitSlop={8}
          accessibilityLabel="Dismiss"
        >
          <Feather name="x" size={16} color="#3730A3" />
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  banner: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.sm,
    borderWidth: 1,
    borderRadius: BorderRadius.md,
    padding: Spacing.sm,
    marginBottom: Spacing.sm,
  },
  text: { flex: 1, fontWeight: "600" },
  button: { paddingHorizontal: Spacing.md, paddingVertical: 6, borderRadius: BorderRadius.sm },
});
