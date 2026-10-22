import { useCallback, useEffect, useRef, useState } from "react";
import { Platform, Pressable, StyleSheet, Text, View } from "react-native";
import Constants from "expo-constants";
import { webBasePath } from "@/utils/webRouting";
import { nativeBridge } from "@/services/nativeBridge/client";

/**
 * One update notice per production release (web browsers AND the Android app,
 * which renders this same hosted web build inside its WebView).
 *
 * Source of truth: <base>/version.json, written by export_web.ps1 on every build
 * and uploaded together with dist. The running bundle knows its own buildId
 * (Constants.expoConfig.extra.buildId). If they differ, a new release is live.
 *
 *  - Shown once per release. "Later" hides it for that release for good; the
 *    next cold start loads the new release anyway (index.html is no-store).
 *  - "Update now" clears this app's service worker + caches, then reloads once.
 *  - Mandatory releases (version.json "mandatory": true) cannot be dismissed.
 *  - Checked on start and on resume (max once per 5 min). No background polling.
 *  - If version.json is unreachable, nothing happens: the current version keeps
 *    working.
 */

const RUNNING_BUILD_ID = String(Constants.expoConfig?.extra?.buildId ?? "");
const DISMISSED_KEY = "hrms.update.dismissedBuild";
const APPLIED_KEY = "hrms.update.appliedBuild";
const NATIVE_DISMISSED_KEY = "hrms.update.nativeDismissed";
const CHECK_THROTTLE_MS = 5 * 60_000;
const FETCH_TIMEOUT_MS = 8_000;

type ReleaseManifest = {
  buildId: string;
  builtAt?: string;
  mandatory?: boolean;
  message?: string;
  minAndroidAppVersion?: string;
  androidDownloadUrl?: string;
};

function storageGet(storage: "local" | "session", key: string): string | null {
  try {
    return (storage === "local" ? window.localStorage : window.sessionStorage).getItem(key);
  } catch {
    return null;
  }
}

function storageSet(storage: "local" | "session", key: string, value: string) {
  try {
    (storage === "local" ? window.localStorage : window.sessionStorage).setItem(key, value);
  } catch {
    // private mode / blocked storage: the notice may simply reappear next start
  }
}

function applicationRoot(): URL {
  const underBase = webBasePath !== "/" && window.location.pathname.startsWith(webBasePath);
  return new URL(underBase ? webBasePath : "/", window.location.origin);
}

/** -1 if a < b, 0 if equal, 1 if a > b ("1.2.0" style versions). */
function compareVersions(a: string, b: string): number {
  const pa = a.split(".").map((n) => parseInt(n, 10) || 0);
  const pb = b.split(".").map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i += 1) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d !== 0) return d < 0 ? -1 : 1;
  }
  return 0;
}

async function fetchManifest(): Promise<ReleaseManifest | null> {
  const controller = typeof AbortController !== "undefined" ? new AbortController() : null;
  const timer = setTimeout(() => controller?.abort(), FETCH_TIMEOUT_MS);
  try {
    const url = new URL("version.json", applicationRoot());
    url.searchParams.set("ts", String(Date.now()));
    const response = await fetch(url.href, {
      cache: "no-store",
      credentials: "omit",
      signal: controller?.signal,
    });
    if (!response.ok) return null;
    const contentType = response.headers.get("content-type") || "";
    if (contentType.includes("text/html")) return null; // hosting fallback, not the manifest
    const body = await response.json();
    if (!body || typeof body.buildId !== "string" || !body.buildId.trim()) return null;
    return body as ReleaseManifest;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

async function clearWebCaches() {
  const root = applicationRoot().href;
  const tasks: Promise<unknown>[] = [];
  if ("serviceWorker" in navigator) {
    tasks.push(
      navigator.serviceWorker.getRegistrations().then((registrations) =>
        Promise.all(
          registrations
            .filter((registration) => registration.scope.startsWith(root))
            .map((registration) => registration.unregister()),
        ),
      ),
    );
  }
  if ("caches" in window) {
    tasks.push(
      window.caches.keys().then((keys) =>
        Promise.all(keys.filter((key) => key.startsWith("bop-hrms-")).map((key) => window.caches.delete(key))),
      ),
    );
  }
  await Promise.allSettled(tasks);
}

export default function ReleaseUpdateNotice() {
  const [release, setRelease] = useState<ReleaseManifest | null>(null);
  const [nativeUpdate, setNativeUpdate] = useState<ReleaseManifest | null>(null);
  const [applying, setApplying] = useState(false);
  const lastCheck = useRef(0);

  const check = useCallback(async (force = false) => {
    if (!force && Date.now() - lastCheck.current < CHECK_THROTTLE_MS) return;
    lastCheck.current = Date.now();

    const remote = await fetchManifest();
    if (!remote) return;

    // Native app too old for this web release (a new APK is required).
    if (remote.minAndroidAppVersion && nativeBridge.isAvailable()) {
      try {
        const caps: any = await nativeBridge.request("device.getCapabilities", undefined, 5_000);
        const appVersion = String(caps?.appVersion ?? "");
        if (
          appVersion &&
          compareVersions(appVersion, remote.minAndroidAppVersion) < 0 &&
          storageGet("local", NATIVE_DISMISSED_KEY) !== remote.minAndroidAppVersion
        ) {
          setNativeUpdate(remote);
        }
      } catch {
        // older shells without the command: ignore
      }
    }

    if (!RUNNING_BUILD_ID || remote.buildId === RUNNING_BUILD_ID) {
      setRelease(null);
      return;
    }
    // Already reloaded for this release in this tab but still running the old
    // bundle (stale proxy/CDN): don't loop, don't nag.
    if (storageGet("session", APPLIED_KEY) === remote.buildId && !remote.mandatory) {
      storageSet("local", DISMISSED_KEY, remote.buildId);
      return;
    }
    if (!remote.mandatory && storageGet("local", DISMISSED_KEY) === remote.buildId) return;
    setRelease(remote);
  }, []);

  useEffect(() => {
    if (Platform.OS !== "web" || typeof window === "undefined" || __DEV__) return;
    const startTimer = setTimeout(() => void check(true), 3_000);
    const onVisible = () => {
      if (document.visibilityState === "visible") void check();
    };
    const onOnline = () => void check();
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("online", onOnline);
    return () => {
      clearTimeout(startTimer);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("online", onOnline);
    };
  }, [check]);

  const applyUpdate = useCallback(async () => {
    if (!release || applying) return;
    setApplying(true);
    storageSet("session", APPLIED_KEY, release.buildId);
    storageSet("local", DISMISSED_KEY, release.buildId);
    await clearWebCaches();
    const target = new URL(window.location.href);
    target.searchParams.set("v", release.buildId); // bypass any intermediate cache of index.html
    window.location.replace(target.href);
  }, [release, applying]);

  const dismiss = useCallback(() => {
    if (!release || release.mandatory) return;
    storageSet("local", DISMISSED_KEY, release.buildId);
    setRelease(null);
  }, [release]);

  if (Platform.OS !== "web") return null;

  if (nativeUpdate && !release) {
    return (
      <View style={styles.banner}>
        <Text style={styles.text}>
          A new version of the HRMS app is required for some features. Please install the latest app.
        </Text>
        {nativeUpdate.androidDownloadUrl ? (
          <Pressable
            style={styles.primary}
            onPress={() => window.open(nativeUpdate.androidDownloadUrl, "_blank")}
          >
            <Text style={styles.primaryText}>Download</Text>
          </Pressable>
        ) : null}
        <Pressable
          style={styles.secondary}
          onPress={() => {
            storageSet("local", NATIVE_DISMISSED_KEY, String(nativeUpdate.minAndroidAppVersion));
            setNativeUpdate(null);
          }}
        >
          <Text style={styles.secondaryText}>Later</Text>
        </Pressable>
      </View>
    );
  }

  if (!release) return null;

  return (
    <View style={styles.banner}>
      <Text style={styles.text}>
        {release.message ||
          (release.mandatory
            ? "A required HRMS update is ready. Save your work, then update."
            : "A new HRMS version is available. Save your work, then update.")}
      </Text>
      <Pressable style={styles.primary} onPress={() => void applyUpdate()} disabled={applying}>
        <Text style={styles.primaryText}>{applying ? "Updating..." : "Update now"}</Text>
      </Pressable>
      {release.mandatory ? null : (
        <Pressable style={styles.secondary} onPress={dismiss}>
          <Text style={styles.secondaryText}>Later</Text>
        </Pressable>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  banner: {
    position: "absolute",
    left: 12,
    right: 12,
    bottom: 12,
    zIndex: 1000,
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    gap: 8,
    padding: 12,
    borderRadius: 12,
    backgroundColor: "#1F2937",
  },
  text: { flex: 1, minWidth: 180, color: "#FFFFFF", fontSize: 13, fontWeight: "600" },
  primary: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 8, backgroundColor: "#7C3AED" },
  primaryText: { color: "#FFFFFF", fontWeight: "700", fontSize: 13 },
  secondary: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: 8 },
  secondaryText: { color: "#D1D5DB", fontWeight: "600", fontSize: 13 },
});
