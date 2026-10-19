import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { View, StyleSheet, FlatList } from "react-native";
import { supabase } from "@/lib/supabase";
import { ThemedText } from "@/components/ThemedText";
import { useTheme } from "@/hooks/useTheme";
import { BorderRadius, Spacing } from "@/constants/theme";
import { addBusinessDays, formatBusinessDate, getBusinessDateIST } from "@/utils/businessDate";
import { exportSheets, formatIstDateTime } from "@/utils/exportWorkbook";
import {
  ReportChip,
  ReportChipRow,
  ReportFilterBar,
  ReportIconButton,
  ReportMeta,
  ReportNotice,
  ReportSearch,
  ReportState,
} from "@/components/reports/ReportUI";

const PRESETS = [
  { label: "Last 7 days", days: 7 },
  { label: "Last 30 days", days: 30 },
  { label: "Last 90 days", days: 90 },
];

function distanceOf(item: any): number | null {
  const v = item.distance_from_reference ?? item.calculated_distance_m;
  return v == null ? null : Math.round(Number(v));
}

export default function GeofenceEventsReportScreen() {
  const { theme } = useTheme();
  const today = getBusinessDateIST();
  const [days, setDays] = useState(30);
  const [data, setData] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [exporting, setExporting] = useState(false);
  const startDate = addBusinessDays(today, -(days - 1));
  const requestId = useRef(0);

  const fetchData = useCallback(async () => {
    const id = ++requestId.current;
    setLoading(true);
    setError(null);
    const { data: reportData, error: rpcError } = await supabase.rpc("rpc_geofence_report", {
      p_start_date: startDate,
      p_end_date: today,
      p_user_id: null,
      p_status: null,
      p_review_status: null,
    });
    if (id !== requestId.current) return;
    if (rpcError) {
      setData([]);
      setError(/PERMISSION_REQUIRED|42501/i.test(rpcError.message)
        ? "You do not have permission to view geofence events."
        : rpcError.message);
    } else {
      setData(Array.isArray(reportData) ? reportData : []);
    }
    setLoading(false);
  }, [startDate, today]);

  useEffect(() => { void fetchData(); }, [fetchData]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return data;
    return data.filter((r) =>
      String(r.employee_name ?? "").toLowerCase().includes(q)
      || String(r.office_name ?? "").toLowerCase().includes(q)
      || String(r.event_type ?? "").toLowerCase().includes(q));
  }, [data, search]);

  const exportExcel = async () => {
    if (exporting || filtered.length === 0) return;
    setExporting(true);
    setNotice(null);
    try {
      await exportSheets(`geofence_events_${startDate}_to_${today}.xlsx`, [{
        name: "Geofence events",
        columns: ["Detected at", "Employee No", "Employee", "Event", "Office", "Distance (m)", "Latitude", "Longitude", "Status", "Reason given", "Review", "Reviewed by"],
        widths: [20, 12, 24, 16, 20, 11, 11, 11, 12, 36, 12, 22],
        rows: filtered.map((r) => [
          formatIstDateTime(r.detected_at), r.employee_id ?? "", r.employee_name ?? "",
          String(r.event_type ?? "").replace(/_/g, " "), r.office_name ?? "", distanceOf(r) ?? "",
          r.latitude ?? "", r.longitude ?? "", r.status ?? "",
          r.submitted_reason ?? "", r.review_status ?? "", r.reviewed_by_name ?? "",
        ]),
      }]);
    } catch (e: any) {
      // Shown as a notice so a failed export never hides the loaded events.
      setNotice(`Export failed: ${e?.message || "please try again."}`);
    } finally {
      setExporting(false);
    }
  };

  const renderItem = ({ item }: { item: any }) => {
    const distance = distanceOf(item);
    return (
      <View style={[styles.card, { backgroundColor: theme.backgroundDefault, borderColor: theme.border }]}>
        <View style={styles.cardHeader}>
          <ThemedText style={styles.name} numberOfLines={1}>{item.employee_name || "Unknown employee"}</ThemedText>
          {item.status ? (
            <View style={[styles.badge, { backgroundColor: theme.warningBg }]}>
              <ThemedText type="caption" style={{ color: theme.warningText, fontWeight: "700" }}>
                {String(item.status).replace(/_/g, " ")}
              </ThemedText>
            </View>
          ) : null}
        </View>
        <ThemedText type="caption" style={{ color: theme.textSecondary }}>
          {String(item.event_type ?? "").replace(/_/g, " ")}
          {item.office_name ? ` · ${item.office_name}` : ""}
          {distance != null ? ` · ${distance} m from boundary point` : ""}
        </ThemedText>
        <ThemedText type="caption" style={{ color: theme.textSecondary, marginTop: 2 }}>
          {formatIstDateTime(item.detected_at)} IST
        </ThemedText>
        {item.submitted_reason ? (
          <View style={[styles.reasonBox, { backgroundColor: theme.backgroundSecondary, borderLeftColor: theme.primary }]}>
            <ThemedText type="caption" style={{ color: theme.textSecondary, fontWeight: "600" }}>Employee reason</ThemedText>
            <ThemedText type="small">{item.submitted_reason}</ThemedText>
            {item.review_status ? (
              <ThemedText type="caption" style={{ color: theme.success, fontWeight: "600", marginTop: 4 }}>
                Review: {item.review_status}{item.reviewed_by_name ? ` by ${item.reviewed_by_name}` : ""}
              </ThemedText>
            ) : null}
          </View>
        ) : null}
      </View>
    );
  };

  return (
    <View style={[styles.container, { backgroundColor: theme.backgroundRoot }]}>
      <ReportFilterBar>
        <ReportChipRow>
          {PRESETS.map((p) => (
            <ReportChip key={p.days} label={p.label} active={days === p.days} onPress={() => setDays(p.days)} />
          ))}
        </ReportChipRow>
        <ReportSearch value={search} onChangeText={setSearch} placeholder="Search employee, office or event" />
        <View style={styles.actionRow}>
          <View style={{ flex: 1, minWidth: 0 }}>
            <ReportMeta>
              {formatBusinessDate(startDate)} – {formatBusinessDate(today)}
              {!loading && !error ? ` · ${filtered.length} event${filtered.length === 1 ? "" : "s"}` : ""}
            </ReportMeta>
          </View>
          <ReportIconButton icon="refresh-cw" label="Refresh" tone="neutral" onPress={() => void fetchData()} disabled={loading} />
          <ReportIconButton
            icon="download"
            label="Excel"
            onPress={exportExcel}
            busy={exporting}
            disabled={filtered.length === 0}
          />
        </View>
        {notice ? <ReportNotice kind="error" text={notice} onDismiss={() => setNotice(null)} /> : null}
      </ReportFilterBar>

      {loading ? (
        <ReportState kind="loading" title="Loading geofence events…" />
      ) : error ? (
        <ReportState kind="error" title="Could not load geofence events" message={error} onRetry={() => void fetchData()} />
      ) : filtered.length === 0 ? (
        <ReportState
          kind="empty"
          icon="map"
          title={search.trim() ? "No matching events" : "No geofence events"}
          message={search.trim() ? "Try a different search." : "No geofence events were recorded in this period."}
        />
      ) : (
        <FlatList
          data={filtered}
          keyExtractor={(item, index) => String(item.event_id ?? index) + (item.reason_id ?? "")}
          renderItem={renderItem}
          contentContainerStyle={styles.listContent}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  actionRow: { flexDirection: "row", alignItems: "center", gap: Spacing.sm },
  listContent: { padding: Spacing.md, paddingBottom: 80 },
  card: { borderRadius: BorderRadius.md, borderWidth: 1, padding: Spacing.md, marginBottom: Spacing.sm },
  cardHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: Spacing.sm, marginBottom: 4 },
  name: { fontWeight: "700", flex: 1 },
  badge: { paddingHorizontal: 8, paddingVertical: 2, borderRadius: 12 },
  reasonBox: { marginTop: Spacing.sm, padding: 10, borderRadius: 6, borderLeftWidth: 3 },
});
