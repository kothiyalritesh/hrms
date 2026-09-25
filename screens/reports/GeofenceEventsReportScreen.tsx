import React, { useState, useEffect } from "react";
import { View, Text, StyleSheet, FlatList, TouchableOpacity, ActivityIndicator } from "react-native";
import { supabase } from "@/lib/supabase";
import { MaterialIcons } from "@expo/vector-icons";
import { Colors } from "@/constants/theme";

export default function GeofenceEventsReportScreen() {
  const [data, setData] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchData();
  }, []);

  const fetchData = async () => {
    setLoading(true);
    const endDate = new Date();
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - 30); // Default last 30 days

    const { data: reportData, error } = await supabase.rpc("rpc_geofence_report", {
      p_start_date: startDate.toISOString().split("T")[0],
      p_end_date: endDate.toISOString().split("T")[0],
      p_user_id: null,
      p_status: null,
      p_review_status: null,
    });

    if (error) {
      console.error("Geofence report fetch error:", error);
    } else {
      setData(reportData || []);
    }
    setLoading(false);
  };

  const renderItem = ({ item }: { item: any }) => (
    <View style={styles.card}>
      <View style={styles.cardHeader}>
        <Text style={styles.name}>{item.employee_name}</Text>
        <Text style={styles.statusBadge}>{item.status}</Text>
      </View>
      <Text style={styles.detailText}>
        <Text style={{ fontWeight: "600" }}>Type:</Text> {item.event_type} | <Text style={{ fontWeight: "600" }}>Distance:</Text> {Math.round(item.calculated_distance_m || 0)}m
      </Text>
      <Text style={styles.detailText}>
        <Text style={{ fontWeight: "600" }}>Detected:</Text> {new Date(item.detected_at).toLocaleString()}
      </Text>
      {item.submitted_reason && (
        <View style={styles.reasonBox}>
          <Text style={styles.reasonLabel}>Employee Reason:</Text>
          <Text style={styles.reasonText}>{item.submitted_reason}</Text>
          {item.review_status && (
            <Text style={styles.reviewText}>
              Review: {item.review_status} {item.reviewed_by_name ? "by " + item.reviewed_by_name : ""}
            </Text>
          )}
        </View>
      )}
    </View>
  );

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>Geofence Violations & Audit Trail</Text>
        <TouchableOpacity style={styles.exportBtn} onPress={() => { /* TODO: Export CSV */ }}>
          <MaterialIcons name="file-download" size={20} color="#fff" />
          <Text style={styles.exportBtnText}>Export CSV</Text>
        </TouchableOpacity>
      </View>
      
      {loading ? (
        <ActivityIndicator size="large" color={Colors.light.primary} style={{ marginTop: 20 }} />
      ) : data.length === 0 ? (
        <View style={styles.emptyContainer}>
          <Text style={styles.emptyText}>No geofence events found for this period.</Text>
        </View>
      ) : (
        <FlatList
          data={data}
          keyExtractor={(item) => item.event_id}
          renderItem={renderItem}
          contentContainerStyle={styles.listContent}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.light.backgroundDefault },
  header: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", padding: 16, backgroundColor: "#fff", borderBottomWidth: 1, borderColor: "#e0e0e0" },
  title: { fontSize: 18, fontWeight: "600", color: Colors.light.text },
  exportBtn: { flexDirection: "row", backgroundColor: Colors.light.primary, paddingHorizontal: 12, paddingVertical: 8, borderRadius: 6, alignItems: "center" },
  exportBtnText: { color: "#fff", marginLeft: 4, fontWeight: "500" },
  listContent: { padding: 16 },
  card: { backgroundColor: "#fff", borderRadius: 8, padding: 16, marginBottom: 12, shadowColor: "#000", shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.1, shadowRadius: 2, elevation: 2 },
  cardHeader: { flexDirection: "row", justifyContent: "space-between", marginBottom: 8 },
  name: { fontSize: 16, fontWeight: "700" },
  statusBadge: { backgroundColor: "#ffeb3b", color: "#f57f17", paddingHorizontal: 8, paddingVertical: 2, borderRadius: 12, fontSize: 12, fontWeight: "600", overflow: "hidden" },
  detailText: { fontSize: 14, color: "#555", marginBottom: 4 },
  reasonBox: { marginTop: 12, backgroundColor: "#f9f9f9", padding: 10, borderRadius: 6, borderLeftWidth: 3, borderLeftColor: Colors.light.primary },
  reasonLabel: { fontSize: 12, fontWeight: "600", color: "#777", marginBottom: 2 },
  reasonText: { fontSize: 14, fontStyle: "italic", color: "#333" },
  reviewText: { fontSize: 12, fontWeight: "600", color: Colors.light.success, marginTop: 6 },
  emptyContainer: { flex: 1, justifyContent: "center", alignItems: "center" },
  emptyText: { color: "#888", fontSize: 16 }
});