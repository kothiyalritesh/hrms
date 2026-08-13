import React, { useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Pressable,
  StyleSheet,
  TextInput,
  View,
} from "react-native";
import Feather from "@expo/vector-icons/Feather";
import { PageHeader } from "@/components/PageHeader";
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
        setFromDate(recovered.pending?.fromDate || date);
        setToDate(recovered.pending?.toDate || date);
      })
      .catch((error) => {
        Alert.alert("Secure sync unavailable", error.message);
      });
  }, []);

  const run = async () => {
    setRunning(true);
    setResult(null);
    try {
      const confirmed = await biometricSyncService.runRange(
        fromDate,
        toDate,
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

  return (
    <View style={[styles.root, { backgroundColor: theme.backgroundRoot }]}>
      <PageHeader title="SmartOffice Biometric Sync" />
      <ScreenScrollView contentContainerStyle={styles.content}>
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
          <ThemedText type="small">From date (YYYY-MM-DD)</ThemedText>
          <TextInput
            value={fromDate}
            onChangeText={(value) => {
              setFromDate(value);
              setResult(null);
            }}
            style={[
              styles.input,
              { color: theme.text, borderColor: theme.border },
            ]}
          />
          <ThemedText type="small">To date (maximum 31 days)</ThemedText>
          <TextInput
            value={toDate}
            onChangeText={(value) => {
              setToDate(value);
              setResult(null);
            }}
            style={[
              styles.input,
              { color: theme.text, borderColor: theme.border },
            ]}
          />
          <Pressable
            onPress={run}
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
                {pendingRequest ? "Retry protected sync" : "Run protected sync"}
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
});
