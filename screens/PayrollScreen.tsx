import React, { useState, useCallback } from "react";
import { StyleSheet, View, Pressable, RefreshControl, Alert, Platform } from "react-native";
import Feather from "@expo/vector-icons/Feather";
import { useFocusEffect } from "@react-navigation/native";
import { ScreenScrollView } from "@/components/ScreenScrollView";
import { PageHeader } from "@/components/PageHeader";
import { ThemedText } from "@/components/ThemedText";
import { formatDate } from "@/utils/format";
import { useTheme } from "@/hooks/useTheme";
import { Spacing, BorderRadius, Colors } from "@/constants/theme";
import Spacer from "@/components/Spacer";
import { PayrollStorage, PayrollRecord } from "@/utils/storage";

function formatCurrency(amount: number) {
  return new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(amount);
}

function PayrollCard({ record, isExpanded, onToggle }: { record: PayrollRecord; isExpanded: boolean; onToggle: () => void }) {
  const { theme } = useTheme();
  const statusColor =
    record.status === "paid"      ? Colors.light.success :
    record.status === "processed" ? Colors.light.info    : Colors.light.warning;

  return (
    <View style={[styles.card, { backgroundColor: theme.backgroundDefault }]}>
      <Pressable style={({ pressed }) => [styles.cardHeader, { opacity: pressed ? 0.8 : 1 }]} onPress={onToggle}>
        <View style={{ flex: 1 }}>
          <ThemedText type="body" style={{ fontWeight: "700", color: theme.text }}>
            {record.month} {record.year}
          </ThemedText>
          <View style={[styles.badge, { backgroundColor: statusColor + "20", marginTop: 3 }]}>
            <ThemedText type="caption" style={{ color: statusColor, fontWeight: "700", fontSize: 10 }}>
              {record.status.toUpperCase()}
            </ThemedText>
          </View>
        </View>
        <ThemedText type="h3" style={{ color: theme.primary, marginRight: Spacing.sm }}>
          {formatCurrency(record.netSalary)}
        </ThemedText>
        <Feather name={isExpanded ? "chevron-up" : "chevron-down"} size={18} color={theme.textSecondary} />
      </Pressable>

      {isExpanded && (
        <View style={[styles.details, { borderTopColor: theme.border }]}>
          {[
            { label: "Basic Salary", value: formatCurrency(record.basicSalary), color: theme.text },
            { label: "Allowances",   value: "+" + formatCurrency(record.allowances), color: Colors.light.success },
            { label: "Deductions",   value: "−" + formatCurrency(record.deductions), color: Colors.light.error },
          ].map((row) => (
            <View key={row.label} style={styles.detailRow}>
              <ThemedText type="small" style={{ color: theme.textSecondary }}>{row.label}</ThemedText>
              <ThemedText type="small" style={{ color: row.color, fontWeight: "600" }}>{row.value}</ThemedText>
            </View>
          ))}
          <View style={[styles.detailRow, styles.totalRow, { borderTopColor: theme.border }]}>
            <ThemedText type="body" style={{ fontWeight: "700" }}>Net Salary</ThemedText>
            <ThemedText type="body" style={{ fontWeight: "700", color: theme.primary }}>{formatCurrency(record.netSalary)}</ThemedText>
          </View>
          {record.paidOn && (
            <ThemedText type="caption" style={{ color: theme.textSecondary, textAlign: "center", marginTop: 6 }}>
              Paid on: {formatDate(record.paidOn)}
            </ThemedText>
          )}
          <Pressable
            style={({ pressed }) => [styles.downloadBtn, { backgroundColor: theme.primary, opacity: pressed ? 0.8 : 1 }]}
            onPress={() => Alert.alert("Download", `Salary slip for ${record.month} ${record.year} will be downloaded.`)}
          >
            <Feather name="download" size={15} color="#FFFFFF" />
            <ThemedText type="small" style={{ color: "#FFFFFF", fontWeight: "600" }}>Download Slip</ThemedText>
          </Pressable>
        </View>
      )}
    </View>
  );
}

export default function PayrollScreen() {
  const { theme } = useTheme();
  const [records,    setRecords]    = useState<PayrollRecord[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const loadData = useCallback(async () => {
    const all = await PayrollStorage.getAll();
    setRecords(all);
    if (all.length > 0 && !expandedId) setExpandedId(all[0].id);
  }, []);

  useFocusEffect(useCallback(() => { loadData(); }, [loadData]));
  const onRefresh = async () => { setRefreshing(true); await loadData(); setRefreshing(false); };

  const cur = records[0];
  const ytd = records.reduce((s, r) => s + r.netSalary, 0);

  return (
    <View style={{ flex: 1, backgroundColor: theme.backgroundRoot }}>
      <PageHeader title="Payroll" subtitle="Salary & earnings overview" />

      <ScreenScrollView
        noPaddingTop
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={theme.primary} />}
        contentContainerStyle={styles.content}
      >
        <Spacer height={Spacing.lg} />

        <View style={[styles.summaryBanner, { backgroundColor: theme.primary }]}>
          <View style={styles.summaryItem}>
            <ThemedText type="caption" style={{ color: "rgba(255,255,255,0.7)" }}>Current Month</ThemedText>
            <ThemedText type="h2" style={{ color: "#FFFFFF", fontWeight: "800" }}>
              {cur ? formatCurrency(cur.netSalary) : "—"}
            </ThemedText>
          </View>
          <View style={[styles.summaryDivider, { backgroundColor: "rgba(255,255,255,0.25)" }]} />
          <View style={styles.summaryItem}>
            <ThemedText type="caption" style={{ color: "rgba(255,255,255,0.7)" }}>YTD Earnings</ThemedText>
            <ThemedText type="h2" style={{ color: "#FFFFFF", fontWeight: "800" }}>{formatCurrency(ytd)}</ThemedText>
          </View>
        </View>

        <Spacer height={Spacing.lg} />

        <View style={styles.miniRow}>
          <View style={[styles.miniCard, { backgroundColor: Colors.light.successBg }]}>
            <Feather name="trending-up" size={18} color={Colors.light.successText} />
            <ThemedText type="caption" style={{ color: Colors.light.successText, marginTop: 4 }}>Allowances</ThemedText>
            <ThemedText type="small" style={{ color: Colors.light.successText, fontWeight: "700" }}>
              {formatCurrency(cur?.allowances || 0)}
            </ThemedText>
          </View>
          <View style={[styles.miniCard, { backgroundColor: Colors.light.errorBg }]}>
            <Feather name="trending-down" size={18} color={Colors.light.errorText} />
            <ThemedText type="caption" style={{ color: Colors.light.errorText, marginTop: 4 }}>Deductions</ThemedText>
            <ThemedText type="small" style={{ color: Colors.light.errorText, fontWeight: "700" }}>
              {formatCurrency(cur?.deductions || 0)}
            </ThemedText>
          </View>
        </View>

        <Spacer height={Spacing.xl} />
        <ThemedText type="h3" style={{ color: theme.text, fontWeight: "700" }}>Salary History</ThemedText>
        <Spacer height={Spacing.md} />

        {records.length > 0
          ? <View style={styles.list}>
              {records.map((r) => (
                <PayrollCard
                  key={r.id} record={r}
                  isExpanded={expandedId === r.id}
                  onToggle={() => setExpandedId(expandedId === r.id ? null : r.id)}
                />
              ))}
            </View>
          : <View style={[styles.empty, { backgroundColor: theme.backgroundDefault }]}>
              <Feather name="dollar-sign" size={44} color={theme.textSecondary} />
              <Spacer height={Spacing.md} />
              <ThemedText type="body" style={{ color: theme.textSecondary, textAlign: "center" }}>No payroll records available</ThemedText>
            </View>
        }
        <Spacer height={Spacing["2xl"]} />
      </ScreenScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  content:       { paddingHorizontal: Spacing.lg },
  summaryBanner: { borderRadius: 16, padding: Spacing.xl, flexDirection: "row", alignItems: "center" },
  summaryItem:   { flex: 1, alignItems: "center" },
  summaryDivider:{ width: 1, height: 48, marginHorizontal: Spacing.md },
  miniRow:       { flexDirection: "row", gap: Spacing.md },
  miniCard:      { flex: 1, padding: Spacing.lg, borderRadius: 14, alignItems: "center", gap: 2 },
  list:          { gap: Spacing.sm },
  card: {
    borderRadius: 14, overflow: "hidden",
    ...(Platform.OS === "web"
      ? { boxShadow: "0 2px 8px rgba(109,27,109,0.07)" }
      : { shadowColor: "#6D1B6D", shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.07, shadowRadius: 8, elevation: 2 }),
  },
  cardHeader: { flexDirection: "row", alignItems: "center", padding: Spacing.lg },
  badge:      { alignSelf: "flex-start", paddingHorizontal: 7, paddingVertical: 2, borderRadius: 5 },
  details:    { padding: Spacing.lg, paddingTop: Spacing.md, borderTopWidth: 1 },
  detailRow:  { flexDirection: "row", justifyContent: "space-between", paddingVertical: 6 },
  totalRow:   { marginTop: Spacing.sm, paddingTop: Spacing.md, borderTopWidth: 1 },
  downloadBtn:{
    flexDirection: "row", alignItems: "center", justifyContent: "center",
    gap: Spacing.sm, marginTop: Spacing.md, padding: Spacing.md, borderRadius: 10,
  },
  empty: { alignItems: "center", padding: Spacing["3xl"], borderRadius: 14 },
});
