import * as Notifications from 'expo-notifications';
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
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
import * as FileSystem from "expo-file-system/legacy";

import * as Sharing from "expo-sharing";
import * as Updates from "expo-updates";
import { WebView } from "react-native-webview";
import type { WebViewMessageEvent, WebViewNavigation } from "react-native-webview";
import AutomaticUpdates from "@/components/AutomaticUpdates";
import { supabase } from "@/lib/supabase";
import { locationTrackingCoordinator } from "@/services/location/LocationTrackingCoordinator";
import {
  isNotificationPermissionGranted,
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

  useEffect(() => {
    const startupTimer = setTimeout(() => {
      if (!loaded.current && !loadFailed.current) {
        onUseBundledApp(
          "The hosted HRMS took longer than 7 seconds. Opening the built-in HRMS.",
        );
      }
    }, 30_000);
    return () => clearTimeout(startupTimer);
  }, [onUseBundledApp, reloadKey]);

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
      void locationTrackingCoordinator.initialize({
        id: sessionUser.id,
        name: String(displayName),
      });
    });
    return () => {
      active = false;
    };
  }, []);

  const forwardNotificationResponse = useCallback(
    (response: Notifications.NotificationResponse) => {
      const identifier = response.notification.request.identifier;
      const key = `${identifier}:${response.actionIdentifier}`;
      if (handledNotificationActions.current.has(key)) return;
      handledNotificationActions.current.add(key);
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
          await locationTrackingCoordinator.initialize({
            id: data.user.id,
            name:
              typeof payload.userName === "string" && payload.userName.trim()
                ? payload.userName.trim().slice(0, 160)
                : "BOP employee",
          });
          return { authenticated: true, userId: data.user.id };
        }
        case "auth.clearSession":
          locationTrackingCoordinator.dispose();
          // FIXED: Removed supabase.auth.signOut({ scope: "local" }); 
          // The web app handles its own session. Native shouldn't nuke it here.
          return { authenticated: false };
        case "notifications.getPermission":
          return { granted: await isNotificationPermissionGranted() };
        case "notifications.register": {
          const { data } = await supabase.auth.getUser();
          if (!data.user) throw new Error("AUTH_SESSION_REQUIRED");
          const token = await registerDevicePushToken(data.user.id);
          return { registered: !!token };
        }
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
    [capabilities, shareBase64File],
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
    postEnvelope(bridgeEvent("bridge.ready", capabilities));
  }, [capabilities, postEnvelope]);

  const retry = () => {
    loaded.current = false;
    bridgeConnected.current = false;
    currentUrl.current = HRMS_URL;
    setLoadError(null);
    setReloadKey((value) => value + 1);
  };

  return (
    <SafeAreaView style={styles.safeArea}>
      <StatusBar barStyle="light-content" backgroundColor="#160D1E" />
      <AutomaticUpdates />
      {loadError ? (
        <View style={styles.errorPage}>
          <Text style={styles.errorTitle}>HRMS could not be loaded</Text>
          <Text style={styles.errorBody}>{loadError}</Text>
          <Pressable
            style={styles.fallbackButton}
            onPress={() => onUseBundledApp(loadError)}
          >
            <Text style={styles.retryText}>Open built-in HRMS</Text>
          </Pressable>
          <Pressable style={styles.retryButton} onPress={retry}>
            <Text style={styles.retryText}>Retry</Text>
          </Pressable>
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
            const reason =
              event.nativeEvent.description || "Check your internet connection.";
            setLoadError(reason);
            onUseBundledApp(reason);
          }}
          onHttpError={(event) => {
            loadFailed.current = true;
            const reason = `Server returned HTTP ${event.nativeEvent.statusCode}.`;
            setLoadError(reason);
            onUseBundledApp(reason);
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
  fallbackButton: {
    minWidth: 220,
    alignItems: "center",
    borderRadius: 10,
    backgroundColor: "#7E187A",
    paddingHorizontal: 20,
    paddingVertical: 13,
    marginBottom: 10,
  },
  retryText: { color: "#FFFFFF", fontWeight: "800", fontSize: 15 },
});


