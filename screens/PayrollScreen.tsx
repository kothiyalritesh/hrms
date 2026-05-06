import React, { useState, useCallback } from "react";
import {
  StyleSheet,
  View,
  Pressable,
  RefreshControl,
  Alert,
} from "react-native";
import { Feather } from "@expo/vector-icons";
import { useFocusEffect } from "@react-navigation/native";
import { ScreenScrollView } from "@/components/ScreenScrollView";
import { ThemedText } from "@/components/ThemedText";
import { useTheme } from "@/hooks/useTheme";
import { useAuth } from "@/contexts/AuthContext";
import { Spacing, BorderRadius, Colors } from "@/constants/theme";
import Spacer from "@/components/Spacer";
import { PayrollService } from "@/services/payroll.service";

const MONTHS = ["January","February","March","April","May","June","July","August","September","October","November","December"];

interface PayrollRecord {
  id: string;
  month: string;
  year: number;
  basic_salary: number;
  allowances: number;
  deductions: number;
  net_salary: number;
  status: "pending" | "processed" | "paid";
  paid_on?: string;
}

interface PayrollCardProps {
  record: PayrollRecord;
  isExpanded: boolean;
  onToggle: () => void;
}

function PayrollCard({ record, isExpanded, onToggle }: PayrollCardProps) {
  const { theme } = useTheme();

  const statusColor =
    record.status === "paid"
      ? Colors.light.success
      : record.status === "processed"
        ? Colors.light.info
        : Colors.light.warning;

  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat("en-IN", {
      style: "currency",
      currency: "INR",
      maximumFractionDigits: 0,
    }).format(amount);
  };

  const handleDownload = () => {
    Alert.alert(
      "Download Salary Slip",
      `Salary slip for ${record.month} ${record.year} will be downloaded.`,
      [{ text: "OK" }],
    );
  };

  return (
    <View
      style={[styles.payrollCard, { backgroundColor: theme.backgroundDefault }]}
    >
      <Pressable
        style={({ pressed }) => [
          styles.payrollHeader,
          { opacity: pressed ? 0.8 : 1 },
        ]}
        onPress={onToggle}
      >
        <View style={styles.payrollTitle}>
          <ThemedText type="body" style={styles.monthText}>
            {record.month} {record.year}
          </ThemedText>
          <View
            style={[
              styles.statusBadge,
              { backgroundColor: statusColor + "20" },
            ]}
          >
            <ThemedText
              type="caption"
              style={{ color: statusColor, fontWeight: "600" }}
            >
              {record.status.toUpperCase()}
            </ThemedText>
          </View>
        </View>
        <View style={styles.payrollRight}>
          <ThemedText type="h4" style={{ color: theme.primary }}>
            {formatCurrency(record.net_salary)}
          </ThemedText>
          <Feather
            name={isExpanded ? "chevron-up" : "chevron-down"}
            size={20}
            color={theme.textSecondary}
          />
        </View>
      </Pressable>

      {isExpanded ? (
        <View style={[styles.payrollDetails, { borderTopColor: theme.border }]}>
          <View style={styles.detailRow}>
            <ThemedText type="small" style={{ color: theme.textSecondary }}>
              Basic Salary
            </ThemedText>
            <ThemedText type="small">
              {formatCurrency(record.basic_salary)}
            </ThemedText>
          </View>
          <View style={styles.detailRow}>
            <ThemedText type="small" style={{ color: theme.textSecondary }}>
              Allowances
            </ThemedText>
            <ThemedText type="small" style={{ color: Colors.light.success }}>
              +{formatCurrency(record.allowances)}
            </ThemedText>
          </View>
          <View style={styles.detailRow}>
            <ThemedText type="small" style={{ color: theme.textSecondary }}>
              Deductions
            </ThemedText>
            <ThemedText type="small" style={{ color: Colors.light.error }}>
              -{formatCurrency(record.deductions)}
            </ThemedText>
          </View>
          <View
            style={[
              styles.detailRow,
              styles.totalRow,
              { borderTopColor: theme.border },
            ]}
          >
            <ThemedText type="body" style={{ fontWeight: "600" }}>
              Net Salary
            </ThemedText>
            <ThemedText
              type="body"
              style={{ fontWeight: "600", color: theme.primary }}
            >
              {formatCurrency(record.net_salary)}
            </ThemedText>
          </View>

          {record.paid_on ? (
            <ThemedText
              type="caption"
              style={[styles.paidDate, { color: theme.textSecondary }]}
            >
              Paid on: {new Date(record.paid_on).toLocaleDateString()}
            </ThemedText>
          ) : null}

          <Pressable
            style={({ pressed }) => [
              styles.downloadBtn,
              { backgroundColor: theme.primary, opacity: pressed ? 0.8 : 1 },
            ]}
            onPress={handleDownload}
          >
            <Feather name="download" size={16} color="#FFFFFF" />
            <ThemedText
              type="small"
              style={{ color: "#FFFFFF", fontWeight: "500" }}
            >
              Download Slip
            </ThemedText>
          </Pressable>
        </View>
      ) : null}
    </View>
  );
}

export default function PayrollScreen() {
  const { theme } = useTheme();
  const { user } = useAuth();
  const [records, setRecords] = useState<PayrollRecord[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const loadData = useCallback(async () => {
    if (!user?.id) return;
    const data = await PayrollService.getUserPayslips(user.id);
    if (data.length > 0) {
      const mapped = data.map((p: any) => ({
        id: p.id,
        month: MONTHS[p.month - 1],
        year: p.year,
        basic_salary: p.basic,
        allowances: p.hra + p.special_allowance + p.transport_allowance + p.medical_allowance,
        deductions: p.total_deductions,
        net_salary: p.net_salary,
        status: p.status,
        paid_on: p.paid_on,
      }));
      setRecords(mapped);
      setExpandedId(mapped[0].id); // always open latest
    }
  }, [user?.id]);

  useFocusEffect(useCallback(() => { loadData(); }, [loadData]));

  const onRefresh = async () => {
    setRefreshing(true);
    await loadData();
    setRefreshing(false);
  };

  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat("en-IN", {
      style: "currency",
      currency: "INR",
      maximumFractionDigits: 0,
    }).format(amount);
  };

  const currentMonthRecord = records[0];
  const totalEarnings = records.reduce((sum, r) => sum + r.net_salary, 0);

  return (
    <ScreenScrollView
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          onRefresh={onRefresh}
          tintColor={theme.primary}
        />
      }
    >
      <View style={[styles.summaryCard, { backgroundColor: theme.primary }]}>
        <View style={styles.summaryRow}>
          <View style={styles.summaryItem}>
            <ThemedText
              type="caption"
              style={{ color: "#FFFFFF", opacity: 0.8 }}
            >
              Current Month
            </ThemedText>
            <ThemedText type="h2" style={{ color: "#FFFFFF" }}>
              {currentMonthRecord
                ? formatCurrency(currentMonthRecord.net_salary)
                : "--"}
            </ThemedText>
          </View>
          <View
            style={[
              styles.summaryDivider,
              { backgroundColor: "rgba(255,255,255,0.3)" },
            ]}
          />
          <View style={styles.summaryItem}>
            <ThemedText
              type="caption"
              style={{ color: "#FFFFFF", opacity: 0.8 }}
            >
              YTD Earnings
            </ThemedText>
            <ThemedText type="h2" style={{ color: "#FFFFFF" }}>
              {formatCurrency(totalEarnings)}
            </ThemedText>
          </View>
        </View>
      </View>

      <Spacer height={Spacing.xl} />

      <View style={styles.statsRow}>
        <View
          style={[styles.statCard, { backgroundColor: Colors.light.successBg }]}
        >
          <Feather
            name="trending-up"
            size={20}
            color={Colors.light.successText}
          />
          <ThemedText
            type="caption"
            style={{ color: Colors.light.successText }}
          >
            Allowances
          </ThemedText>
          <ThemedText
            type="body"
            style={{ color: Colors.light.successText, fontWeight: "600" }}
          >
            {formatCurrency(currentMonthRecord?.allowances || 0)}
          </ThemedText>
        </View>
        <View
          style={[styles.statCard, { backgroundColor: Colors.light.errorBg }]}
        >
          <Feather
            name="trending-down"
            size={20}
            color={Colors.light.errorText}
          />
          <ThemedText type="caption" style={{ color: Colors.light.errorText }}>
            Deductions
          </ThemedText>
          <ThemedText
            type="body"
            style={{ color: Colors.light.errorText, fontWeight: "600" }}
          >
            {formatCurrency(currentMonthRecord?.deductions || 0)}
          </ThemedText>
        </View>
      </View>

      <Spacer height={Spacing.xl} />

      <ThemedText type="h3">Salary History</ThemedText>
      <Spacer height={Spacing.md} />

      {records.length > 0 ? (
        <View style={styles.recordsList}>
          {records.map((record) => (
            <PayrollCard
              key={record.id}
              record={record}
              isExpanded={expandedId === record.id}
              onToggle={() =>
                setExpandedId(expandedId === record.id ? null : record.id)
              }
            />
          ))}
        </View>
      ) : (
        <View
          style={[
            styles.emptyState,
            { backgroundColor: theme.backgroundDefault },
          ]}
        >
          <Feather name="dollar-sign" size={48} color={theme.textSecondary} />
          <Spacer height={Spacing.md} />
          <ThemedText
            type="body"
            style={{ color: theme.textSecondary, textAlign: "center" }}
          >
            No payroll records available
          </ThemedText>
        </View>
      )}

      <Spacer height={Spacing["2xl"]} />
    </ScreenScrollView>
  );
}

const styles = StyleSheet.create({
  summaryCard: {
    padding: Spacing.xl,
    borderRadius: BorderRadius.lg,
  },
  summaryRow: {
    flexDirection: "row",
  },
  summaryItem: {
    flex: 1,
    alignItems: "center",
  },
  summaryDivider: {
    width: 1,
    marginHorizontal: Spacing.lg,
  },
  statsRow: {
    flexDirection: "row",
    gap: Spacing.md,
  },
  statCard: {
    flex: 1,
    padding: Spacing.lg,
    borderRadius: BorderRadius.md,
    alignItems: "center",
    gap: Spacing.xs,
  },
  recordsList: {
    gap: Spacing.md,
  },
  payrollCard: {
    borderRadius: BorderRadius.md,
    overflow: "hidden",
  },
  payrollHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    padding: Spacing.lg,
  },
  payrollTitle: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.sm,
  },
  monthText: {
    fontWeight: "600",
  },
  statusBadge: {
    paddingHorizontal: Spacing.sm,
    paddingVertical: 2,
    borderRadius: BorderRadius.xs,
  },
  payrollRight: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.sm,
  },
  payrollDetails: {
    padding: Spacing.lg,
    paddingTop: Spacing.md,
    borderTopWidth: 1,
  },
  detailRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    paddingVertical: Spacing.sm,
  },
  totalRow: {
    marginTop: Spacing.sm,
    paddingTop: Spacing.md,
    borderTopWidth: 1,
  },
  paidDate: {
    marginTop: Spacing.sm,
    textAlign: "center",
  },
  downloadBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: Spacing.sm,
    marginTop: Spacing.lg,
    padding: Spacing.md,
    borderRadius: BorderRadius.sm,
  },
  emptyState: {
    alignItems: "center",
    padding: Spacing["3xl"],
    borderRadius: BorderRadius.md,
  },
});
