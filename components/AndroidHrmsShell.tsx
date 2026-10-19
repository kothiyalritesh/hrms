import * as Notifications from 'expo-notifications';
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  AppState,
  BackHandler,
  Linking,
  Pressable,
  SafeAreaView,
  StatusBar,
  StyleSheet,
  Text,
  View,
} from "react-native";
import Constants from "expo-constants";
import NetInfo from "@react-native-community/netinfo";
import * as FileSystem from "expo-file-system/legacy";

import * as Sharing from "expo-sharing";
import * as Updates from "expo-updates";
import { WebView } from "react-native-webview";
import type { WebViewMessageEvent, WebViewNavigation } from "react-native-webview";
import AutomaticUpdates from "@/components/AutomaticUpdates";
import { supabase } from "@/lib/supabase";
import { locationTrackingCoordinator } from "@/services/location/LocationTrackingCoordinator";
import { stopNativeTracking } from "@/services/location/backgroundLocationTask";
import {
  deactivateCurrentDevicePushToken,
  handleNotificationResponse,
  initializeNotificationInfrastructure,
  isNotificationPermissionGranted,
  getNotificationStatus,
  requestNotificationPermission,
  registerDevicePushToken,
} from "@/services/location/notification.service";
import {
  bridgeEvent,
  bridgeResponse,
  NATIVE_BRIDGE_NAME,
  NATIVE_BRIDGE_VERSION,
  NativeBridgeRequest,
  parseNativeBridgeRequest,
} from "@/services/nativeBridge/protocol";

const HOSTED_BUILD_ID = String(
  Constants.expoConfig?.extra?.buildId ?? "current",
);
const HRMS_URL = `https://bop.in/HRMS/?build=${encodeURIComponent(HOSTED_BUILD_ID)}`;
const ALLOWED_ORIGIN = "https://bop.in";
const ALLOWED_PATH = "/HRMS";
const XLSX_MIME =
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

function isAllowedHrmsUrl(rawUrl: string) {
  try {
    const url = new URL(rawUrl);
    return (
      url.origin === ALLOWED_ORIGIN &&
      (url.pathname === ALLOWED_PATH || url.pathname.startsWith(`${ALLOWED_PATH}/`))
    );
  } catch {
    return false;
  }
}

function cleanFileName(value: unknown) {
  const name = typeof value === "string" ? value : "BOP-HRMS-report.xlsx";
  return (
    name
      .replace(/[\\/:*?"<>|\u0000-\u001f]/g, "_")
      .replace(/^\.+/, "")
      .slice(0, 160) || "BOP-HRMS-report.xlsx"
  );
}

/** exp claim (seconds) of a Supabase access token, or 0 if unreadable. */
function accessTokenExpiry(token: string) {
  try {
    const part = token.split(".")[1] ?? "";
    const json = globalThis.atob(part.replace(/-/g, "+").replace(/_/g, "/"));
    return Number(JSON.parse(json)?.exp) || 0;
  } catch {
    return 0;
  }
}

function sessionForPage(session: any) {
  if (!session?.access_token || !session?.refresh_token) return null;
  return {
    access_token: session.access_token,
    refresh_token: session.refresh_token,
    expires_at: session.expires_at,
    expires_in: session.expires_in,
    token_type: session.token_type,
    user: session.user,
  };
}

function errorDetails(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  const code = /^[A-Z0-9_]+(?=:|$)/.exec(message)?.[0] ?? "NATIVE_OPERATION_FAILED";
  return { code, message };
}

const BRIDGE_BOOTSTRAP = `
(function () {
  Object.defineProperty(window, "__BOP_NATIVE_SHELL__", {
    value: Object.freeze({
      bridge: \"bop.hrms.native\",
      version: 1,
      platform: "android"
    }),
    writable: false,
    configurable: false
  });
  window.dispatchEvent(new CustomEvent("bop-native-ready", {
    detail: window.__BOP_NATIVE_SHELL__
  }));
})();
true;
`;

type AndroidHrmsShellProps = {
  onUseBundledApp: (reason: string) => void;
};

export default function AndroidHrmsShell({
  onUseBundledApp,
}: AndroidHrmsShellProps) {
  const webViewRef = useRef<WebView>(null);
  const currentUrl = useRef(HRMS_URL);
  const loaded = useRef(false);
  const loadFailed = useRef(false);
  const bridgeConnected = useRef(false);
  const pendingEvents = useRef<string[]>([]);
  const handledNotificationActions = useRef(new Set<string>());
  const [canGoBack, setCanGoBack] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  // Slow connection: the page keeps loading underneath; only a hint is shown.
  const [slowLoad, setSlowLoad] = useState(false);

  useEffect(() => {
    // A slow network is not an outage. Before, the still-loading page was
    // thrown away after 30 s and replaced by an error page, so on a weak
    // connection HRMS could never finish opening. Now loading continues and a
    // small "still loading" bar offers Retry / the built-in app.
    setSlowLoad(false);
    const startupTimer = setTimeout(() => {
      if (!loaded.current && !loadFailed.current) setSlowLoad(true);
    }, 25_000);
    return () => clearTimeout(startupTimer);
  }, [reloadKey]);

  // Notification channels must exist before any push arrives, including
  // before the user signs in (Android otherwise files them under "Misc").
  useEffect(() => {
    void initializeNotificationInfrastructure().catch(() => undefined);
  }, []);

  const postEnvelope = useCallback((envelope: object) => {
    const serialized = JSON.stringify(envelope);
    const isResponse =
      (envelope as { type?: string }).type === "bridge.response";
    if (!loaded.current || (!isResponse && !bridgeConnected.current)) {
      pendingEvents.current.push(serialized);
      return;
    }
    webViewRef.current?.postMessage(serialized);
  }, []);

  const flushPendingEvents = useCallback(() => {
    if (!loaded.current || !bridgeConnected.current) return;
    for (const event of pendingEvents.current.splice(0)) {
      webViewRef.current?.postMessage(event);
    }
  }, []);

  useEffect(() => {
    let active = true;
    // Restore the native Supabase session before the web page finishes loading.
    // This keeps push registration and an already-running location service alive
    // even if Android recreates the activity while the WebView is still loading.
    void supabase.auth.getSession().then(({ data }) => {
      if (!active || !data.session?.user) return;
      const sessionUser = data.session.user;
      const displayName =
        sessionUser.user_metadata?.name ??
        sessionUser.user_metadata?.full_name ??
        "BOP employee";
      void locationTrackingCoordinator
        .initialize(
          { id: sessionUser.id, name: String(displayName) },
          { handleNotificationResponses: false },
        )
        // App opened after a reboot / force-stop: resume tracking for an open
        // attendance (and apply new tracking options) without waiting for the page.
        .then(() => locationTrackingCoordinator.restoreIfRequired())
        .then(() => locationTrackingCoordinator.syncOfflineLocations())
        .catch(() => undefined);
    });
    return () => {
      active = false;
    };
  }, []);

  // The shell refreshes the shared session while the page sleeps (background
  // tracking). Hand every refreshed session to the page so it never refreshes
  // with an already-used token (that revoked the session: random logouts).
  useEffect(() => {
    const { data } = supabase.auth.onAuthStateChange((event, session) => {
      if (event !== "TOKEN_REFRESHED") return;
      const pageSession = sessionForPage(session);
      if (pageSession) postEnvelope(bridgeEvent("auth.sessionChanged", { session: pageSession }));
    });
    return () => data.subscription.unsubscribe();
  }, [postEnvelope]);

  const forwardNotificationResponse = useCallback(
    (response: Notifications.NotificationResponse) => {
      const identifier = response.notification.request.identifier;
      const key = `${identifier}:${response.actionIdentifier}`;
      if (handledNotificationActions.current.has(key)) return;
      handledNotificationActions.current.add(key);
      const data = (response.notification.request.content.data ?? {}) as Record<string, unknown>;
      if (response.actionIdentifier === "NAVIGATE") {
        // opens Google Maps directly; nothing to show in HRMS
        void handleNotificationResponse(response).catch(() => undefined);
        void Notifications.clearLastNotificationResponseAsync().catch(() => undefined);
        return;
      }
      if (response.actionIdentifier === "GOT_IT" && typeof data.eventId === "string") {
        const eventId = data.eventId;
        void supabase.auth.getUser().then(({ data: auth }) => {
          if (auth.user?.id) {
            void supabase.rpc("rpc_acknowledge_event", { p_event_id: eventId, p_user_id: auth.user.id });
          }
        });
      }
      postEnvelope(
        bridgeEvent("notification.opened", {
          actionIdentifier: response.actionIdentifier,
          data: response.notification.request.content.data,
        }),
      );
      void Notifications.clearLastNotificationResponseAsync().catch(
        () => undefined,
      );
    },
    [postEnvelope],
  );

  useEffect(() => {
    const received = Notifications.addNotificationReceivedListener((notification) => {
      postEnvelope(
        bridgeEvent("notification.received", {
          request: notification.request.content,
        }),
      );
    });
    const opened = Notifications.addNotificationResponseReceivedListener(
      forwardNotificationResponse,
    );
    void Notifications.getLastNotificationResponseAsync().then((response) => {
      if (response) forwardNotificationResponse(response);
    });
    return () => {
      received.remove();
      opened.remove();
    };
  }, [forwardNotificationResponse, postEnvelope]);

  useEffect(() => {
    const subscription = BackHandler.addEventListener("hardwareBackPress", () => {
      if (!canGoBack) return false;
      webViewRef.current?.goBack();
      return true;
    });
    return () => subscription.remove();
  }, [canGoBack]);

  const capabilities = useMemo(
    () => ({
      bridgeVersion: NATIVE_BRIDGE_VERSION,
      platform: "android",
      appVersion: Constants.expoConfig?.version ?? null,
      buildId: Constants.expoConfig?.extra?.buildId ?? null,
      runtimeVersion: Updates.runtimeVersion ?? null,
      notifications: true,
      fcmTransport: true,
      foregroundLocationService: true,
      backgroundLocation: true,
      preciseLocation: true,
      cameraCapture: true,
      fileUpload: true,
      nativeFileShare: true,
      deepLinks: true,
      easUpdate: Updates.isEnabled,
    }),
    [],
  );

  const shareBase64File = useCallback(async (payload: Record<string, unknown>) => {
    const base64 = payload.base64;
    if (typeof base64 !== "string" || !base64.length) {
      throw new Error("FILE_DATA_REQUIRED");
    }
    if (base64.length > 35 * 1024 * 1024) throw new Error("FILE_TOO_LARGE");
    const filename = cleanFileName(payload.filename);
    const mimeType =
      typeof payload.mimeType === "string" && payload.mimeType.length < 150
        ? payload.mimeType
        : XLSX_MIME;
    const directory = FileSystem.cacheDirectory;
    if (!directory) throw new Error("FILE_CACHE_UNAVAILABLE");
    const uri = `${directory}${Date.now()}-${filename}`;
    await FileSystem.writeAsStringAsync(uri, base64, {
      encoding: FileSystem.EncodingType.Base64,
    });
    if (!(await Sharing.isAvailableAsync())) throw new Error("FILE_SHARE_UNAVAILABLE");
    await Sharing.shareAsync(uri, {
      mimeType,
      dialogTitle: `Save or share ${filename}`,
      UTI: "org.openxmlformats.spreadsheetml.sheet",
    });
    return { filename, shared: true };
  }, []);

  const execute = useCallback(
    async (request: NativeBridgeRequest) => {
      const payload = request.payload ?? {};
      switch (request.type) {
        case "bridge.ping":
          return { pong: true, bridgeVersion: NATIVE_BRIDGE_VERSION };
        case "device.getCapabilities":
          return capabilities;
        case "auth.syncSession": {
          const accessToken = payload.accessToken;
          const refreshToken = payload.refreshToken;
          if (
            typeof accessToken !== "string" ||
            typeof refreshToken !== "string" ||
            accessToken.length < 20 ||
            refreshToken.length < 10
          ) throw new Error("AUTH_SESSION_REQUIRED");
          // If the shell already holds a newer session for the same user (it
          // refreshed while the page was asleep), keep it and give it to the
          // page instead of going back to the page's older token.
          const { data: current } = await supabase.auth.getSession();
          const currentSession = current.session;
          if (
            currentSession &&
            currentSession.refresh_token !== refreshToken &&
            (typeof payload.userId !== "string" || currentSession.user.id === payload.userId) &&
            Number(currentSession.expires_at ?? 0) > accessTokenExpiry(accessToken)
          ) {
            postEnvelope(bridgeEvent("auth.sessionChanged", { session: sessionForPage(currentSession) }));
            await locationTrackingCoordinator.initialize(
              {
                id: currentSession.user.id,
                name:
                  typeof payload.userName === "string" && payload.userName.trim()
                    ? payload.userName.trim().slice(0, 160)
                    : "BOP employee",
              },
              { handleNotificationResponses: false },
            );
            return { authenticated: true, userId: currentSession.user.id, kept: "native" };
          }
          const { data, error } = await supabase.auth.setSession({
            access_token: accessToken,
            refresh_token: refreshToken,
          });
          if (error || !data.user) throw error ?? new Error("AUTH_SESSION_INVALID");
          const expectedUserId = payload.userId;
          if (typeof expectedUserId === "string" && expectedUserId !== data.user.id) {
            await supabase.auth.signOut({ scope: "local" });
            throw new Error("AUTH_USER_MISMATCH");
          }
          await locationTrackingCoordinator.initialize(
            {
              id: data.user.id,
              name:
                typeof payload.userName === "string" && payload.userName.trim()
                  ? payload.userName.trim().slice(0, 160)
                  : "BOP employee",
            },
            { handleNotificationResponses: false },
          );
          return { authenticated: true, userId: data.user.id };
        }
        case "auth.getSession": {
          // getSession refreshes an expired session; the shell is the one
          // place that refreshes while the page is asleep.
          const { data } = await supabase.auth.getSession();
          return { session: sessionForPage(data.session) };
        }
        case "auth.clearSession":
          // Signed out: this device must stop sending locations. Queued points
          // stay (they carry their own attendance id) and are sent after the
          // next sign-in; a new sign-in restores tracking via tracking.restore.
          await stopNativeTracking().catch(() => undefined);
          locationTrackingCoordinator.dispose();
          // FIXED: Removed supabase.auth.signOut({ scope: "local" }); 
          // The web app handles its own session. Native shouldn't nuke it here.
          return { authenticated: false };
        case "notifications.getPermission":
          return { granted: await isNotificationPermissionGranted() };
        case "notifications.getStatus":
          return await getNotificationStatus();
        case "notifications.register": {
          const { data } = await supabase.auth.getUser();
          if (!data.user) throw new Error("AUTH_SESSION_REQUIRED");
          // Ask for notification permission at sign-in (Android 13+ needs it
          // before anything can appear in the notification panel). Before,
          // it was only asked when location tracking started, so people who
          // never started tracking received no phone notifications at all.
          const granted = await requestNotificationPermission().catch(() => false);
          const token = granted ? await registerDevicePushToken(data.user.id).catch(() => null) : null;
          return { registered: !!token, granted };
        }
        case "notifications.unregister":
          // called by the page on logout, while the session is still valid
          await deactivateCurrentDevicePushToken();
          return { unregistered: true };
        case "tracking.getStatus":
          return locationTrackingCoordinator.refreshHealth();
        case "tracking.requestPermissions":
          return locationTrackingCoordinator.requestRequiredPermissions({
            backgroundEducationAccepted: payload.backgroundEducationAccepted === true,
          });
        case "tracking.restore":
          return { restored: await locationTrackingCoordinator.restoreIfRequired() };
        case "tracking.start": {
          if (typeof payload.attendanceId !== "string") {
            throw new Error("ATTENDANCE_ID_REQUIRED");
          }
          return {
            started: await locationTrackingCoordinator.startForAttendance(
              payload.attendanceId,
            ),
          };
        }
        case "tracking.stop": {
          if (typeof payload.attendanceId !== "string") {
            throw new Error("ATTENDANCE_ID_REQUIRED");
          }
          return {
            stopped: await locationTrackingCoordinator.stopForAttendance(
              payload.attendanceId,
              typeof payload.reason === "string" ? payload.reason : "WEB_CHECKOUT",
            ),
          };
        }
        case "app.openSettings":
          await Linking.openSettings();
          return { opened: true };
        case "app.checkForUpdate": {
          if (!Updates.isEnabled) return { enabled: false, available: false };
          const result = await Updates.checkForUpdateAsync();
          if (!result.isAvailable) return { enabled: true, available: false };
          await Updates.fetchUpdateAsync();
          return { enabled: true, available: true, downloaded: true };
        }
        case "file.shareBase64":
          return shareBase64File(payload);
      }
    },
    [capabilities, shareBase64File, postEnvelope],
  );

  const onMessage = useCallback(
    async (event: WebViewMessageEvent) => {
      let request: NativeBridgeRequest | null = null;
      try {
        if (!isAllowedHrmsUrl(currentUrl.current)) throw new Error("UNTRUSTED_ORIGIN");
        request = parseNativeBridgeRequest(event.nativeEvent.data);
        bridgeConnected.current = true;
        flushPendingEvents();
        const result = await execute(request);
        postEnvelope(bridgeResponse(request.id, true, result));
      } catch (error) {
        const fallbackId = request?.id ?? "invalid-request";
        postEnvelope(bridgeResponse(fallbackId, false, undefined, errorDetails(error)));
      }
    },
    [execute, flushPendingEvents, postEnvelope],
  );

  const onNavigationStateChange = useCallback((state: WebViewNavigation) => {
    currentUrl.current = state.url;
    setCanGoBack(state.canGoBack);
  }, []);

  const allowNavigation = useCallback((request: { url: string }) => {
    const url = request.url;
    if (url === "about:blank" || isAllowedHrmsUrl(url)) return true;
    if (/^(https?:|tel:|mailto:|geo:|market:|re-hrms:)/i.test(url)) {
      void Linking.openURL(url).catch(() => undefined);
    }
    return false;
  }, []);

  const flushReady = useCallback(() => {
    if (loadFailed.current) return;
    loaded.current = true;
    setSlowLoad(false);
    postEnvelope(bridgeEvent("bridge.ready", capabilities));
  }, [capabilities, postEnvelope]);

  const retry = useCallback(() => {
    loaded.current = false;
    loadFailed.current = false;
    bridgeConnected.current = false;
    currentUrl.current = HRMS_URL;
    setLoadError(null);
    setSlowLoad(false);
    setReloadKey((value) => value + 1);
  }, []);

  // Recover automatically when the connection comes back or the user returns
  // to the app while the error page is showing.
  useEffect(() => {
    if (!loadError) return;
    // NetInfo reports the current state immediately; only an offline ->
    // online transition should trigger a reload (no retry loop on HTTP 500).
    let wasOffline: boolean | null = null;
    const unsubscribeNet = NetInfo.addEventListener((state) => {
      const online = !!state.isConnected && state.isInternetReachable !== false;
      if (wasOffline === true && online) retry();
      wasOffline = !online;
    });
    const appState = AppState.addEventListener("change", (state) => {
      if (state === "active") retry();
    });
    return () => {
      unsubscribeNet();
      appState.remove();
    };
  }, [loadError, retry]);

  return (
    <SafeAreaView style={styles.safeArea}>
      <StatusBar barStyle="light-content" backgroundColor="#160D1E" />
      <AutomaticUpdates />
      {loadError ? (
        <View style={styles.errorPage}>
          <Text style={styles.errorTitle}>HRMS could not be loaded</Text>
          <Text style={styles.errorBody}>{loadError}</Text>
          <Pressable style={styles.retryButton} onPress={retry}>
            <Text style={styles.retryText}>Retry</Text>
          </Pressable>
          <Pressable
            style={styles.fallbackButton}
            onPress={() => onUseBundledApp(loadError)}
          >
            <Text style={styles.retryText}>Open built-in HRMS</Text>
          </Pressable>
          <Text style={styles.errorHint}>Retries automatically when you are back online.</Text>
        </View>
      ) : (
        <WebView
          key={reloadKey}
          ref={webViewRef}
          source={{ uri: HRMS_URL }}
          style={styles.webView}
          originWhitelist={["https://*", "tel:*", "mailto:*", "geo:*", "re-hrms:*"]}
          injectedJavaScriptBeforeContentLoaded={BRIDGE_BOOTSTRAP}
          onMessage={onMessage}
          onNavigationStateChange={onNavigationStateChange}
          onShouldStartLoadWithRequest={allowNavigation}
          onLoadStart={() => {
            loaded.current = false;
            bridgeConnected.current = false;
            loadFailed.current = false;
            setLoadError(null);
          }}
          onLoadEnd={flushReady}
          onError={(event) => {
            loadFailed.current = true;
            setLoadError(
              event.nativeEvent.description
                ? `${event.nativeEvent.description}. Check your internet connection.`
                : "Check your internet connection.",
            );
          }}
          onHttpError={(event) => {
            // only the main document matters; a failing image must not kill HRMS
            if (!isAllowedHrmsUrl(event.nativeEvent.url ?? "")) return;
            if (event.nativeEvent.statusCode < 500 && loaded.current) return;
            loadFailed.current = true;
            setLoadError(`The HRMS server returned an error (HTTP ${event.nativeEvent.statusCode}). Please try again.`);
          }}
          onRenderProcessGone={() => {
            // Android killed the page renderer (low memory). Without this the
            // user is left on a blank screen until the app is force-closed.
            retry();
          }}
          onOpenWindow={(event) => {
            const target = event.nativeEvent.targetUrl;
            if (isAllowedHrmsUrl(target)) webViewRef.current?.injectJavaScript(
              `window.location.assign(decodeURIComponent("${encodeURIComponent(target)}")); true;`,
            );
            else void Linking.openURL(target).catch(() => undefined);
          }}
          onFileDownload={(event) => {
            void Linking.openURL(event.nativeEvent.downloadUrl).catch(() => undefined);
          }}
          startInLoadingState
          renderLoading={() => (
            <View style={styles.loadingPage}>
              <ActivityIndicator size="large" color="#A12A9B" />
              <Text style={styles.loadingText}>Opening BOP HRMS…</Text>
            </View>
          )}
          javaScriptEnabled
          domStorageEnabled
          cacheEnabled={true}
          cacheMode="LOAD_DEFAULT"
          sharedCookiesEnabled
          thirdPartyCookiesEnabled={false}
          pullToRefreshEnabled
          allowsBackForwardNavigationGestures={false}
          allowFileAccess
          mediaPlaybackRequiresUserAction
          geolocationEnabled
          setSupportMultipleWindows={false}
          applicationNameForUserAgent="BOP-HRMS-Android/1"
        />
      )}
      {!loadError && slowLoad ? (
        <View style={styles.slowBar}>
          <ActivityIndicator size="small" color="#FFFFFF" />
          <Text style={styles.slowText}>Slow connection — HRMS is still loading…</Text>
          <Pressable onPress={retry} style={styles.slowButton} accessibilityRole="button">
            <Text style={styles.slowButtonText}>Retry</Text>
          </Pressable>
          <Pressable
            onPress={() => onUseBundledApp("Slow connection")}
            style={styles.slowButton}
            accessibilityRole="button"
          >
            <Text style={styles.slowButtonText}>Built-in</Text>
          </Pressable>
        </View>
      ) : null}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: "#160D1E" },
  webView: { flex: 1, backgroundColor: "#160D1E" },
  loadingPage: {
    position: "absolute",
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    alignItems: "center",
    justifyContent: "center",
    gap: 14,
    backgroundColor: "#160D1E",
  },
  loadingText: { color: "#FFFFFF", fontSize: 15, fontWeight: "600" },
  errorPage: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: 28,
    backgroundColor: "#160D1E",
  },
  errorTitle: { color: "#FFFFFF", fontSize: 21, fontWeight: "800" },
  errorBody: {
    marginTop: 10,
    color: "#D1C4D6",
    fontSize: 14,
    lineHeight: 21,
    textAlign: "center",
  },
  retryButton: {
    marginTop: 22,
    minWidth: 130,
    alignItems: "center",
    borderRadius: 10,
    paddingHorizontal: 22,
    paddingVertical: 12,
    backgroundColor: "#A12A9B",
  },
  slowBar: {
    position: "absolute",
    left: 12,
    right: 12,
    bottom: 24,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    backgroundColor: "rgba(22,13,30,0.94)",
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  slowText: { flex: 1, color: "#FFFFFF", fontSize: 13 },
  slowButton: { backgroundColor: "#A12A9B", borderRadius: 8, paddingHorizontal: 10, paddingVertical: 6 },
  slowButtonText: { color: "#FFFFFF", fontWeight: "700", fontSize: 12 },
  fallbackButton: {
    minWidth: 220,
    alignItems: "center",
    borderRadius: 10,
    backgroundColor: "transparent",
    borderWidth: 1,
    borderColor: "#7E187A",
    paddingHorizontal: 20,
    paddingVertical: 13,
    marginTop: 12,
  },
  errorHint: { marginTop: 16, color: "#9D8FA6", fontSize: 12, textAlign: "center" },
  retryText: { color: "#FFFFFF", fontWeight: "800", fontSize: 15 },
});


