import React, { useCallback, useState } from "react";
import {
  ActivityIndicator,
  Linking,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  View,
} from "react-native";
import Feather from "@expo/vector-icons/Feather";
import { useFocusEffect, useNavigation } from "@react-navigation/native";
import { ScreenScrollView } from "@/components/ScreenScrollView";
import { ThemedText } from "@/components/ThemedText";
import { useLocationTracking } from "@/contexts/LocationTrackingContext";
import { useTheme } from "@/hooks/useTheme";
import { nativeBridge } from "@/services/nativeBridge/client";

type RowState = "ok" | "problem" | "neutral";

function StatusRow({
  label,
  allowed,
  allowedLabel = "Allowed",
  deniedLabel = "Not allowed",
  state,
  stateLabel,
}: {
  label: string;
  allowed: boolean;
  allowedLabel?: string;
  deniedLabel?: string;
  /** Overrides `allowed` (e.g. neutral "Not needed"). */
  state?: RowState;
  stateLabel?: string;
}) {
  const { theme } = useTheme();
  const resolved: RowState = state ?? (allowed ? "ok" : "problem");
  const palette =
    resolved === "ok"
      ? { bg: theme.successBg, fg: theme.successText, icon: "check" as const }
      : resolved === "problem"
        ? { bg: theme.errorBg, fg: theme.errorText, icon: "x" as const }
        : {
            bg: theme.backgroundSecondary,
            fg: theme.textSecondary,
            icon: "minus" as const,
          };
  return (
    <View style={[styles.statusRow, { borderBottomColor: theme.border }]}>
      <View style={[styles.statusIcon, { backgroundColor: palette.bg }]}>
        <Feather name={palette.icon} size={15} color={palette.fg} />
      </View>
      <ThemedText style={styles.statusLabel}>{label}</ThemedText>
      <ThemedText style={[styles.statusValue, { color: palette.fg }]}>
        {stateLabel ?? (resolved === "ok" ? allowedLabel : deniedLabel)}
      </ThemedText>
    </View>
  );
}

export default function LocationTrackingSetupScreen() {
  const { theme } = useTheme();
  const navigation = useNavigation<any>();
  const {
    health,
    refresh,
    recheck,
    requestRequiredPermissions,
    requiresBackgroundPermissionEducation,
  } = useLocationTracking();
  const [loading, setLoading] = useState(false);
  const [showEducation, setShowEducation] = useState(false);

  // Re-check on every focus: returning from the Settings app (or a
  // notification) must show the current state, not the one from before.
  useFocusEffect(
    useCallback(() => {
      void refresh().catch(() => undefined);
    }, [refresh]),
  );

  const requestAccess = async () => {
    setLoading(true);
    try {
      const checked = await requestRequiredPermissions(false);
      if (
        requiresBackgroundPermissionEducation &&
        !checked.backgroundLocationGranted &&
        checked.foregroundLocationGranted
      ) {
        setShowEducation(true);
      }
    } finally {
      setLoading(false);
    }
  };

  const continueToBackgroundSettings = async () => {
    setShowEducation(false);
    setLoading(true);
    try {
      await requestRequiredPermissions(true);
    } finally {
      setLoading(false);
    }
  };

  const retry = async () => {
    setLoading(true);
    try {
      // Also restarts the tracking service when it should be running.
      await recheck();
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      <ScreenScrollView contentContainerStyle={styles.container}>
        <View
          style={[
            styles.hero,
            {
              backgroundColor: theme.primary + "12",
              borderColor: theme.primary + "35",
            },
          ]}
        >
          <View style={[styles.heroIcon, { backgroundColor: theme.primary }]}>
            <Feather name="navigation" size={24} color="#FFFFFF" />
          </View>
          <View style={styles.heroCopy}>
            <ThemedText style={styles.title}>
              Attendance location permissions
            </ThemedText>
            <ThemedText style={[styles.description, { color: theme.textSecondary }]}>
              {Platform.OS === "web"
                ? "The web panel reads tracking produced by the installed Android application. Browser location is used only for an explicit check-in or checkout action."
                : "BOP HRMS shares location only while an HRMS attendance record is checked in. Confirmed checkout stops the native service."}
            </ThemedText>
          </View>
        </View>

        {Platform.OS === "web" ? (
          <View
            style={[
              styles.webNotice,
              { backgroundColor: theme.infoBg, borderColor: theme.info },
            ]}
          >
            <ThemedText style={[styles.webNoticeTitle, { color: theme.infoText }]}>
              Install the Android application for live tracking
            </ThemedText>
            <ThemedText style={[styles.webNoticeText, { color: theme.infoText }]}>
              A browser or PWA cannot provide reliable continuous background
              tracking. The installed Android app runs the attendance-bound
              foreground service, queues offline pings and retries on reconnect.
            </ThemedText>
          </View>
        ) : null}

        <View
          style={[
            styles.card,
            { backgroundColor: theme.backgroundDefault, borderColor: theme.border },
          ]}
        >
          {Platform.OS === "web" ? (
            <>
              <StatusRow
                label="Browser geolocation"
                allowed={health.platformSupported}
                allowedLabel="Available"
                deniedLabel="Unavailable"
              />
              <StatusRow
                label="Location permission"
                allowed={health.foregroundLocationGranted}
              />
              <StatusRow
                label="Foreground attendance tracking"
                allowed={health.trackingActive}
                allowedLabel="Active"
                deniedLabel="Inactive"
              />
              <StatusRow
                label="Background tracking"
                allowed={false}
                deniedLabel="Not supported"
              />
            </>
          ) : (
            <>
              <StatusRow
                label="Precise location"
                allowed={health.preciseLocationGranted}
              />
              <StatusRow
                label="Background location"
                allowed={health.backgroundLocationGranted}
              />
              <StatusRow
                label="GPS / location services"
                allowed={health.locationServicesEnabled}
                allowedLabel="On"
                deniedLabel="Off"
              />
              <StatusRow
                label="Background tracking service"
                allowed={health.nativeTaskActive}
                allowedLabel="Active"
                deniedLabel="Inactive"
                {...(!health.trackingExpected && !health.nativeTaskActive
                  ? {
                      state: "neutral" as const,
                      stateLabel: "Not needed (not checked in)",
                    }
                  : {})}
              />
            </>
          )}
        </View>

        {Platform.OS !== "web" ? (
          <>
            <ThemedText
              style={[styles.sectionLabel, { color: theme.textSecondary }]}
            >
              Optional: alerts
            </ThemedText>
            <View
              style={[
                styles.card,
                {
                  backgroundColor: theme.backgroundDefault,
                  borderColor: theme.border,
                },
              ]}
            >
              <StatusRow
                label="Notifications"
                allowed={health.notificationsGranted}
                {...(health.notificationsGranted
                  ? {}
                  : { state: "neutral" as const, stateLabel: "Off" })}
              />
              {!health.notificationsGranted ? (
                <ThemedText
                  style={[styles.optionalHint, { color: theme.textSecondary }]}
                >
                  Not required for location tracking. Turn on to get
                  attendance and visit alerts.
                </ThemedText>
              ) : null}
            </View>
          </>
        ) : null}

        <View
          style={[
            styles.card,
            { backgroundColor: theme.backgroundDefault, borderColor: theme.border },
          ]}
        >
          <ThemedText style={[styles.detailLabel, { color: theme.textSecondary }]}>
            Active attendance
          </ThemedText>
          <ThemedText style={styles.detailValue}>
            {health.activeAttendanceId ?? "No open attendance"}
          </ThemedText>
          <ThemedText style={[styles.detailLabel, { color: theme.textSecondary }]}>
            Current destination
          </ThemedText>
          <ThemedText style={styles.detailValue}>
            {health.activeDestinationName ?? "No active destination"}
          </ThemedText>
          <ThemedText style={[styles.detailLabel, { color: theme.textSecondary }]}>
            Journey status
          </ThemedText>
          <ThemedText style={styles.detailValue}>
            {health.journeyStatus.replaceAll("_", " ")}
          </ThemedText>
          <ThemedText style={[styles.detailLabel, { color: theme.textSecondary }]}>
            Last location update
          </ThemedText>
          <ThemedText style={styles.detailValue}>
            {health.lastLocationAt
              ? new Date(health.lastLocationAt).toLocaleString("en-IN")
              : Platform.OS === "web"
                ? "No browser location received yet"
                : "No native update received yet"}
          </ThemedText>
          <ThemedText style={[styles.detailLabel, { color: theme.textSecondary }]}>
            Last precise-fix accuracy
          </ThemedText>
          <ThemedText style={styles.detailValue}>
            {health.lastAccuracyM == null
              ? "—"
              : `±${Math.round(health.lastAccuracyM)} m`}
          </ThemedText>
        </View>

        {health.warning ? (
          <View
            style={[
              styles.warning,
              { backgroundColor: theme.warningBg, borderColor: theme.warning },
            ]}
          >
            <Feather name="alert-triangle" size={18} color={theme.warningText} />
            <ThemedText style={[styles.warningText, { color: theme.warningText }]}>
              {health.warning}
            </ThemedText>
          </View>
        ) : null}

        <Pressable
          style={[styles.primaryButton, { backgroundColor: theme.primary }]}
          onPress={requestAccess}
          disabled={loading}
        >
          {loading ? (
            <ActivityIndicator color="#FFFFFF" />
          ) : (
            <>
              <Feather
                name={Platform.OS === "web" ? "crosshair" : "shield"}
                size={18}
                color="#FFFFFF"
              />
              <ThemedText style={styles.primaryButtonText}>
                {Platform.OS === "web"
                  ? "Enable Browser Location"
                  : "Enable Required Access"}
              </ThemedText>
            </>
          )}
        </Pressable>
        <Pressable
          style={[styles.secondaryButton, { borderColor: theme.primary }]}
          onPress={retry}
          disabled={loading}
        >
          <Feather name="refresh-cw" size={17} color={theme.primary} />
          <ThemedText style={[styles.secondaryButtonText, { color: theme.primary }]}>
            Retry Permission Check
          </ThemedText>
        </Pressable>
        {Platform.OS !== "web" ? (
          <Pressable
            style={[styles.secondaryButton, { borderColor: theme.primary }]}
            onPress={() => {
              if (nativeBridge.isAvailable()) {
                void nativeBridge.request("app.openSettings");
              } else {
                void Linking.openSettings();
              }
            }}
          >
            <Feather name="settings" size={17} color={theme.primary} />
            <ThemedText style={[styles.secondaryButtonText, { color: theme.primary }]}>
              Open App Settings
            </ThemedText>
          </Pressable>
        ) : null}
        <Pressable
          style={styles.homeButton}
          accessibilityRole="button"
          onPress={() => {
            if (navigation.canGoBack()) navigation.goBack();
            else navigation.navigate("Dashboard");
          }}
        >
          <Feather name="arrow-left" size={17} color={theme.textSecondary} />
          <ThemedText style={[styles.homeButtonText, { color: theme.textSecondary }]}>
            {navigation.canGoBack() ? "Back" : "Back to Home"}
          </ThemedText>
        </Pressable>
      </ScreenScrollView>

      <Modal visible={showEducation} transparent animationType="fade">
        <View style={styles.modalBackdrop}>
          <View
            style={[
              styles.modalCard,
              { backgroundColor: theme.backgroundDefault },
            ]}
          >
            <View
              style={[
                styles.modalIcon,
                { backgroundColor: theme.primary + "18" },
              ]}
            >
              <Feather name="map-pin" size={25} color={theme.primary} />
            </View>
            <ThemedText style={styles.modalTitle}>
              Allow background location
            </ThemedText>
            <ThemedText style={[styles.modalText, { color: theme.textSecondary }]}>
              Android requires this setting so attendance tracking and
              destination arrival checks can continue while the app is minimized
              or the screen is locked.
            </ThemedText>
            <View
              style={[
                styles.optionCallout,
                { backgroundColor: theme.primary + "18" },
              ]}
            >
              <ThemedText style={[styles.optionCaption, { color: theme.textSecondary }]}>
                On the next Settings page, choose:
              </ThemedText>
              <ThemedText style={[styles.optionLabel, { color: theme.primary }]}>
                “Allow all the time”
              </ThemedText>
            </View>
            <ThemedText style={[styles.modalFinePrint, { color: theme.textSecondary }]}>
              You may decline and continue using HRMS. Tracking will remain
              inactive and the app will show a warning; office attendance will
              not be silently altered.
            </ThemedText>
            <Pressable
              style={[styles.primaryButton, { backgroundColor: theme.primary }]}
              onPress={continueToBackgroundSettings}
            >
              <ThemedText style={styles.primaryButtonText}>
                Continue to Settings
              </ThemedText>
            </Pressable>
            <Pressable
              style={styles.declineButton}
              onPress={() => setShowEducation(false)}
            >
              <ThemedText style={[styles.declineText, { color: theme.textSecondary }]}>
                Not Now
              </ThemedText>
            </Pressable>
          </View>
        </View>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  container: { padding: 16, paddingBottom: 40, gap: 14 },
  hero: {
    flexDirection: "row",
    padding: 16,
    borderRadius: 16,
    borderWidth: 1,
    gap: 12,
  },
  heroIcon: {
    width: 46,
    height: 46,
    borderRadius: 23,
    alignItems: "center",
    justifyContent: "center",
  },
  heroCopy: { flex: 1 },
  title: { fontSize: 20, fontWeight: "800", marginBottom: 5 },
  description: { fontSize: 13, lineHeight: 19 },
  sectionLabel: {
    fontSize: 12,
    fontWeight: "700",
    textTransform: "uppercase",
    marginBottom: -6,
    marginLeft: 4,
  },
  optionalHint: { fontSize: 12, lineHeight: 17, paddingVertical: 9 },
  card: {
    borderRadius: 14,
    paddingHorizontal: 15,
    paddingVertical: 5,
    borderWidth: StyleSheet.hairlineWidth,
  },
  statusRow: {
    flexDirection: "row",
    alignItems: "center",
    minHeight: 48,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  statusIcon: {
    width: 26,
    height: 26,
    borderRadius: 13,
    alignItems: "center",
    justifyContent: "center",
    marginRight: 10,
  },
  statusLabel: { flex: 1, fontSize: 14, fontWeight: "600" },
  statusValue: { fontSize: 12, fontWeight: "800" },
  detailLabel: {
    fontSize: 11,
    fontWeight: "700",
    marginTop: 11,
    textTransform: "uppercase",
  },
  detailValue: { fontSize: 14, marginTop: 3, marginBottom: 7 },
  warning: {
    flexDirection: "row",
    gap: 10,
    borderRadius: 12,
    padding: 13,
    borderWidth: 1,
  },
  warningText: { flex: 1, fontSize: 13, lineHeight: 18 },
  primaryButton: {
    minHeight: 50,
    borderRadius: 12,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 9,
    paddingHorizontal: 16,
  },
  primaryButtonText: { color: "#FFFFFF", fontWeight: "800", fontSize: 14 },
  secondaryButton: {
    minHeight: 48,
    borderRadius: 12,
    borderWidth: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 9,
  },
  secondaryButtonText: { fontWeight: "700" },
  webNotice: {
    padding: 14,
    borderRadius: 12,
    borderWidth: 1,
  },
  webNoticeTitle: { fontWeight: "800", marginBottom: 4 },
  webNoticeText: { fontSize: 13, lineHeight: 18 },
  modalBackdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.55)",
    justifyContent: "center",
    padding: 22,
  },
  modalCard: { borderRadius: 18, padding: 20 },
  modalIcon: {
    width: 48,
    height: 48,
    borderRadius: 24,
    alignItems: "center",
    justifyContent: "center",
    alignSelf: "center",
    marginBottom: 12,
  },
  modalTitle: {
    fontSize: 19,
    fontWeight: "800",
    textAlign: "center",
    marginBottom: 9,
  },
  modalText: { fontSize: 14, lineHeight: 20 },
  optionCallout: {
    padding: 13,
    borderRadius: 11,
    marginVertical: 14,
    alignItems: "center",
  },
  optionCaption: { fontSize: 12 },
  optionLabel: {
    fontSize: 17,
    fontWeight: "900",
    marginTop: 3,
  },
  modalFinePrint: {
    fontSize: 12,
    lineHeight: 17,
    marginBottom: 15,
  },
  homeButton: {
    minHeight: 46,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
  },
  homeButtonText: { fontWeight: "700" },
  declineButton: { alignItems: "center", paddingTop: 15 },
  declineText: { fontWeight: "700" },
});
