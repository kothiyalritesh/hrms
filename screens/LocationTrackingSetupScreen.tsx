import React, { useEffect, useState } from "react";
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
import { ScreenScrollView } from "@/components/ScreenScrollView";
import { ThemedText } from "@/components/ThemedText";
import { useLocationTracking } from "@/contexts/LocationTrackingContext";
import { useTheme } from "@/hooks/useTheme";
import { nativeBridge } from "@/services/nativeBridge/client";

function StatusRow({
  label,
  allowed,
  allowedLabel = "Allowed",
  deniedLabel = "Not allowed",
}: {
  label: string;
  allowed: boolean;
  allowedLabel?: string;
  deniedLabel?: string;
}) {
  return (
    <View style={styles.statusRow}>
      <View
        style={[
          styles.statusIcon,
          { backgroundColor: allowed ? "#D1FAE5" : "#FEE2E2" },
        ]}
      >
        <Feather
          name={allowed ? "check" : "x"}
          size={15}
          color={allowed ? "#047857" : "#B91C1C"}
        />
      </View>
      <ThemedText style={styles.statusLabel}>{label}</ThemedText>
      <ThemedText
        style={[styles.statusValue, { color: allowed ? "#047857" : "#B91C1C" }]}
      >
        {allowed ? allowedLabel : deniedLabel}
      </ThemedText>
    </View>
  );
}

export default function LocationTrackingSetupScreen() {
  const { theme } = useTheme();
  const {
    health,
    refresh,
    requestRequiredPermissions,
    requiresBackgroundPermissionEducation,
  } = useLocationTracking();
  const [loading, setLoading] = useState(false);
  const [showEducation, setShowEducation] = useState(false);

  useEffect(() => {
    void refresh();
  }, [refresh]);

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
      await refresh();
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
            <ThemedText style={styles.description}>
              {Platform.OS === "web"
                ? "The web panel reads tracking produced by the installed Android application. Browser location is used only for an explicit check-in or checkout action."
                : "BOP HRMS shares location only while an HRMS attendance record is checked in. Confirmed checkout stops the native service."}
            </ThemedText>
          </View>
        </View>

        {Platform.OS === "web" ? (
          <View style={styles.webNotice}>
            <ThemedText style={styles.webNoticeTitle}>
              Install the Android application for live tracking
            </ThemedText>
            <ThemedText style={styles.webNoticeText}>
              A browser or PWA cannot provide reliable continuous background
              tracking. The installed Android app runs the attendance-bound
              foreground service, queues offline pings and retries on reconnect.
            </ThemedText>
          </View>
        ) : null}

        <View
          style={[styles.card, { backgroundColor: theme.backgroundDefault }]}
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
                label="Notifications"
                allowed={health.notificationsGranted}
              />
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
              />
            </>
          )}
        </View>

        <View
          style={[styles.card, { backgroundColor: theme.backgroundDefault }]}
        >
          <ThemedText style={styles.detailLabel}>Active attendance</ThemedText>
          <ThemedText style={styles.detailValue}>
            {health.activeAttendanceId ?? "No open attendance"}
          </ThemedText>
          <ThemedText style={styles.detailLabel}>
            Current destination
          </ThemedText>
          <ThemedText style={styles.detailValue}>
            {health.activeDestinationName ?? "No active destination"}
          </ThemedText>
          <ThemedText style={styles.detailLabel}>Journey status</ThemedText>
          <ThemedText style={styles.detailValue}>
            {health.journeyStatus.replaceAll("_", " ")}
          </ThemedText>
          <ThemedText style={styles.detailLabel}>
            Last successful update
          </ThemedText>
          <ThemedText style={styles.detailValue}>
            {health.lastLocationAt
              ? new Date(health.lastLocationAt).toLocaleString("en-IN")
              : Platform.OS === "web"
                ? "No browser location received yet"
                : "No native update received yet"}
          </ThemedText>
          <ThemedText style={styles.detailLabel}>Last accuracy</ThemedText>
          <ThemedText style={styles.detailValue}>
            {health.lastAccuracyM == null
              ? "—"
              : `±${Math.round(health.lastAccuracyM)} m`}
          </ThemedText>
        </View>

        {health.warning ? (
          <View style={styles.warning}>
            <Feather name="alert-triangle" size={18} color="#92400E" />
            <ThemedText style={styles.warningText}>{health.warning}</ThemedText>
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
          style={styles.secondaryButton}
          onPress={retry}
          disabled={loading}
        >
          <Feather name="refresh-cw" size={17} color="#6D1B6D" />
          <ThemedText style={styles.secondaryButtonText}>
            Retry Permission Check
          </ThemedText>
        </Pressable>
        {Platform.OS !== "web" ? (
          <Pressable
            style={styles.secondaryButton}
            onPress={() => {
              if (nativeBridge.isAvailable()) {
                void nativeBridge.request("app.openSettings");
              } else {
                void Linking.openSettings();
              }
            }}
          >
            <Feather name="settings" size={17} color="#6D1B6D" />
            <ThemedText style={styles.secondaryButtonText}>
              Open App Settings
            </ThemedText>
          </Pressable>
        ) : null}
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
            <ThemedText style={styles.modalText}>
              Android requires this setting so attendance tracking and
              destination arrival checks can continue while the app is minimized
              or the screen is locked.
            </ThemedText>
            <View style={styles.optionCallout}>
              <ThemedText style={styles.optionCaption}>
                On the next Settings page, choose:
              </ThemedText>
              <ThemedText style={styles.optionLabel}>
                “Allow all the time”
              </ThemedText>
            </View>
            <ThemedText style={styles.modalFinePrint}>
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
              <ThemedText style={styles.declineText}>Not Now</ThemedText>
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
  description: { fontSize: 13, lineHeight: 19, color: "#6B7280" },
  card: {
    borderRadius: 14,
    paddingHorizontal: 15,
    paddingVertical: 5,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "#D1D5DB",
  },
  statusRow: {
    flexDirection: "row",
    alignItems: "center",
    minHeight: 48,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: "#E5E7EB",
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
    color: "#6B7280",
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
    backgroundColor: "#FEF3C7",
    borderWidth: 1,
    borderColor: "#FCD34D",
  },
  warningText: { flex: 1, color: "#92400E", fontSize: 13, lineHeight: 18 },
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
    borderColor: "#6D1B6D",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 9,
  },
  secondaryButtonText: { color: "#6D1B6D", fontWeight: "700" },
  webNotice: {
    padding: 14,
    borderRadius: 12,
    backgroundColor: "#EFF6FF",
    borderColor: "#93C5FD",
    borderWidth: 1,
  },
  webNoticeTitle: { color: "#1D4ED8", fontWeight: "800", marginBottom: 4 },
  webNoticeText: { color: "#1E40AF", fontSize: 13, lineHeight: 18 },
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
  modalText: { fontSize: 14, lineHeight: 20, color: "#4B5563" },
  optionCallout: {
    backgroundColor: "#F5EEF5",
    padding: 13,
    borderRadius: 11,
    marginVertical: 14,
    alignItems: "center",
  },
  optionCaption: { fontSize: 12, color: "#6B7280" },
  optionLabel: {
    color: "#6D1B6D",
    fontSize: 17,
    fontWeight: "900",
    marginTop: 3,
  },
  modalFinePrint: {
    fontSize: 12,
    lineHeight: 17,
    color: "#6B7280",
    marginBottom: 15,
  },
  declineButton: { alignItems: "center", paddingTop: 15 },
  declineText: { color: "#6B7280", fontWeight: "700" },
});
