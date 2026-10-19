import React, { useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Pressable,
  StyleSheet,
  View,
} from "react-native";
import Feather from "@expo/vector-icons/Feather";
import { PageHeader } from "@/components/PageHeader";
import { DateInput } from "@/components/DateInput";
import { ScreenScrollView } from "@/components/ScreenScrollView";
import { ThemedText } from "@/components/ThemedText";
import { useTheme } from "@/hooks/useTheme";
import { type ConfirmedBiometricSync } from "@/utils/biometricSyncResult";
import { BusinessClockService } from "@/services/business-clock.service";
import {
  biometricSyncService,
  type PendingBiometricSync,
} from "@/services/biometric-sync-secure.service";

export function SmartOfficeSecureSyncScreen() {
  const { theme } = useTheme();
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [businessDate, setBusinessDate] = useState("");
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<ConfirmedBiometricSync | null>(null);
  const [pendingRequest, setPendingRequest] =
    useState<PendingBiometricSync | null>(null);

  React.useEffect(() => {
    void Promise.all([
      BusinessClockService.getDate(true),
      biometricSyncService.recoverPendingRequest(),
    ])
      .then(([date, recovered]) => {
        setBusinessDate(date);
        setPendingRequest(recovered.pending);
        setResult(recovered.result);
        setFromDate(date);
        setToDate(date);
      })
      .catch((error) => {
        Alert.alert("Secure sync unavailable", error.message);
      });
  }, []);

  const run = async (range?: { fromDate: string; toDate: string }) => {
    setRunning(true);
    setResult(null);
    try {
      const confirmed = await biometricSyncService.runRange(
        range?.fromDate ?? fromDate,
        range?.toDate ?? toDate,
        businessDate,
      );
      setResult(confirmed);
      setPendingRequest(null);
    } catch (error: any) {
      setPendingRequest(await biometricSyncService.getPendingRequest());
      Alert.alert("Biometric sync failed", error?.message || String(error));
    } finally {
      setRunning(false);
    }
  };

  const discardPending = () => {
    if (!pendingRequest) return;
    Alert.alert(
      "Clear the unfinished sync?",
      `The sync for ${pendingRequest.fromDate} to ${pendingRequest.toDate} never reported a result. ` +
        "Each sync is applied completely or not at all, and running the same dates again only skips punches already imported, so clearing it is safe.",
      [
        { text: "Keep", style: "cancel" },
        {
          text: "Clear",
          style: "destructive",
          onPress: async () => {
            await biometricSyncService.discardPendingRequest();
            setPendingRequest(null);
          },
        },
      ],
    );
  };

  return (
    <View style={[styles.root, { backgroundColor: theme.backgroundRoot }]}>
      <PageHeader title="SmartOffice Biometric Sync" />
      <ScreenScrollView contentContainerStyle={styles.content}>
        {pendingRequest ? (
          <View style={[styles.card, styles.pending]}>
            <View style={styles.titleRow}>
              <Feather name="alert-triangle" size={18} color="#B45309" />
              <ThemedText style={styles.pendingTitle}>Unfinished sync</ThemedText>
            </View>
            <ThemedText style={styles.pendingText}>
              The sync for {pendingRequest.fromDate} to {pendingRequest.toDate} did not report a
              result (usually a timeout). Retry it, or clear it to sync other dates.
            </ThemedText>
            <View style={styles.pendingActions}>
              <Pressable
                disabled={running}
                onPress={() => void run({ fromDate: pendingRequest.fromDate, toDate: pendingRequest.toDate })}
                style={[styles.smallButton, { backgroundColor: theme.primary, opacity: running ? 0.6 : 1 }]}
              >
                <ThemedText style={styles.buttonText}>Retry {pendingRequest.fromDate}</ThemedText>
              </Pressable>
              <Pressable
                disabled={running}
                onPress={discardPending}
                style={[styles.smallButton, styles.outlineButton]}
              >
                <ThemedText style={{ color: "#B45309", fontWeight: "700" }}>Clear</ThemedText>
              </Pressable>
            </View>
          </View>
        ) : null}

        <View
          style={[styles.card, { backgroundColor: theme.backgroundDefault }]}
        >
          <View style={styles.titleRow}>
            <Feather name="shield" size={20} color={theme.primary} />
            <ThemedText type="h3">Protected transactional import</ThemedText>
          </View>
          <ThemedText style={{ color: theme.textSecondary }}>
            Logs are validated and applied as one database batch. A failed batch
            is rolled back automatically and every successful batch retains a
            rollback identifier.
          </ThemedText>
          <ThemedText type="small">From date</ThemedText>
          <DateInput
            value={fromDate}
            max={businessDate || undefined}
            onChange={(value) => {
              setFromDate(value);
              if (toDate && value > toDate) setToDate(value);
              setResult(null);
            }}
            style={[
              styles.input,
              { color: theme.text, borderColor: theme.border },
            ]}
          />
          <ThemedText type="small">To date (maximum 31 days)</ThemedText>
          <DateInput
            value={toDate}
            min={fromDate || undefined}
            max={businessDate || undefined}
            onChange={(value) => {
              setToDate(value);
              setResult(null);
            }}
            style={[
              styles.input,
              { color: theme.text, borderColor: theme.border },
            ]}
          />
          <Pressable
            onPress={() => void run()}
            disabled={running || !fromDate || !toDate || !businessDate}
            style={[
              styles.button,
              {
                backgroundColor: theme.primary,
                opacity:
                  running || !fromDate || !toDate || !businessDate ? 0.6 : 1,
              },
            ]}
          >
            {running ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <ThemedText style={styles.buttonText}>
                Run protected sync
              </ThemedText>
            )}
          </Pressable>
        </View>

        {result ? (
          <View
            style={[styles.card, { backgroundColor: theme.backgroundDefault }]}
          >
            <ThemedText type="h3">
              {result.transactionStatus === "COMMITTED"
                ? "Batch completed"
                : "No database changes"}
            </ThemedText>
            <ThemedText selectable>
              Request ID: {result.clientRequestId}
            </ThemedText>
            <ThemedText selectable>
              Batch: {result.importBatchId || "None"}
            </ThemedText>
            <ThemedText selectable>
              Rollback ID: {result.rollbackId || "None"}
            </ThemedText>
            <ThemedText>
              Confirmed range: {result.fromDate} to {result.toDate}
            </ThemedText>
            <ThemedText>Fetched punches: {result.fetchedPunches}</ThemedText>
            <ThemedText>
              Submitted punches: {result.submittedPunches}
            </ThemedText>
            <ThemedText>Inserted punches: {result.insertedPunches}</ThemedText>
            <ThemedText>
              Duplicate punches: {result.duplicatePunches}
            </ThemedText>
            <ThemedText>Rejected punches: {result.rejectedPunches}</ThemedText>
            <ThemedText>
              Matched employee-days: {result.matchedEmployees}
            </ThemedText>
            <ThemedText>
              Unmatched codes: {result.unmatchedEmployeeCodes}
            </ThemedText>
            <ThemedText>New check-ins: {result.checkedIn}</ThemedText>
            <ThemedText>New checkouts: {result.checkedOut}</ThemedText>
            <ThemedText>
              Summaries updated: {result.summariesUpdated}
            </ThemedText>
          </View>
        ) : null}
      </ScreenScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  content: { padding: 16, gap: 16 },
  card: { borderRadius: 16, padding: 18, gap: 12 },
  titleRow: { flexDirection: "row", alignItems: "center", gap: 10 },
  input: { borderWidth: 1, borderRadius: 10, padding: 12 },
  button: {
    minHeight: 48,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
  },
  buttonText: { color: "#fff", fontWeight: "700" },
  pending: { backgroundColor: "#FEF3C7", borderWidth: 1, borderColor: "#FCD34D" },
  pendingTitle: { color: "#92400E", fontWeight: "800" },
  pendingText: { color: "#78350F", lineHeight: 20 },
  pendingActions: { flexDirection: "row", flexWrap: "wrap", gap: 10 },
  smallButton: { minHeight: 42, paddingHorizontal: 16, borderRadius: 10, alignItems: "center", justifyContent: "center" },
  outlineButton: { borderWidth: 1, borderColor: "#B45309", backgroundColor: "transparent" },
});
