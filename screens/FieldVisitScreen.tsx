import React, { useState, useCallback } from "react";
import {
  View, StyleSheet, ScrollView, TouchableOpacity,
  Alert, RefreshControl, ActivityIndicator, Platform,
} from "react-native";
import { useFocusEffect } from "@react-navigation/native";
import { Feather } from "@expo/vector-icons";
import { ThemedView } from "@/components/ThemedView";
import { ThemedText } from "@/components/ThemedText";
import Spacer from "@/components/Spacer";
import { FieldVisitService, FieldVisit } from "@/services/field-visit.service";
import { AttendanceService } from "@/services/attendance.service";
import { AttendanceStorage } from "@/utils/storage";
import { useAuth } from "@/contexts/AuthContext";
import MeetingDetailModal, { MeetingDetails } from "@/components/MeetingDetailModal";
import CheckoutNotesModal, { NextAction } from "@/components/CheckoutNotesModal";
import VisitDetailModal from "@/components/VisitDetailModal";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { getCurrentGPS } from "@/utils/gps";

function haversineM(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371000;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLon / 2) ** 2;
  return Math.round(R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)));
}

function fmt(iso?: string) {
  if (!iso) return "—";
  return new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: true });
}

const STATUS_CONFIG = {
  PENDING:    { color: "#F59E0B", bg: "#FEF3C7", label: "En Route",    icon: "navigation" as const },
  CHECKED_IN: { color: "#3B82F6", bg: "#DBEAFE", label: "At Location", icon: "map-pin" as const },
  COMPLETED:  { color: "#10B981", bg: "#D1FAE5", label: "Completed",   icon: "check-circle" as const },
  MISSED:     { color: "#EF4444", bg: "#FEE2E2", label: "Missed",      icon: "x-circle" as const },
};

// Cross-platform alert with proper title
function showAlert(title: string, msg: string) {
  if (Platform.OS === "web" && typeof window !== "undefined") window.alert(`${title}\n\n${msg}`);
  else Alert.alert(title, msg);
}

export default function FieldVisitScreen() {
  const { user } = useAuth();
  const insets = useSafeAreaInsets();
  const [visits, setVisits] = useState<FieldVisit[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [isCheckedOut, setIsCheckedOut] = useState(false);
  const [showNextModal, setShowNextModal] = useState(false);
  const [lastGps, setLastGps] = useState<{ latitude: number; longitude: number } | null>(null);
  const [showNotesModal, setShowNotesModal] = useState(false);
  const [checkingOutVisit, setCheckingOutVisit] = useState<FieldVisit | null>(null);
  const [notesLoading, setNotesLoading] = useState(false);
  const [detailVisit, setDetailVisit] = useState<FieldVisit | null>(null);

  const loadVisits = async () => {
    if (!user?.id) return;
    const { data } = await FieldVisitService.getTodayVisits(user.id);
    setVisits(data);
    const { data: att } = await AttendanceService.getToday(user.id);
    setIsCheckedOut(!!att?.checkout_time);
    setLoading(false);
  };

  useFocusEffect(useCallback(() => { setLoading(true); loadVisits(); }, [user?.id]));

  const onRefresh = async () => { setRefreshing(true); await loadVisits(); setRefreshing(false); };
  const getGPS = () => getCurrentGPS();

  // ── Check In — captures GPS at arrival, no proximity enforcement ────────────
  const handleCheckIn = async (visit: FieldVisit) => {
    setActionLoading(visit.id);
    try {
      const gps = await getGPS();
      const location = gps ?? { latitude: 0, longitude: 0 };
      const { error } = await FieldVisitService.checkIn(visit.id, location);
      if (error) throw error;
      await loadVisits();
      const coordStr = gps ? ` · 📍 ${gps.latitude.toFixed(5)}, ${gps.longitude.toFixed(5)}` : "";
      showAlert("✅ Checked In", `At ${visit.location_name} · ${fmt(new Date().toISOString())}${coordStr}`);
    } catch (e: any) {
      showAlert("Error", e.message || "Failed to check in.");
    } finally {
      setActionLoading(null);
    }
  };

  const handleCheckOutPress = (visit: FieldVisit) => {
    setCheckingOutVisit(visit);
    setShowNotesModal(true);
  };

  const handleNotesConfirm = async (notes: string, next: NextAction) => {
    if (!checkingOutVisit || !user?.id) return;
    setNotesLoading(true);
    try {
      const gps = await getGPS();
      const coords = gps ?? { latitude: 0, longitude: 0 };
      setLastGps(coords);
      const { error } = await FieldVisitService.checkOut(checkingOutVisit.id, coords, notes);
      if (error) throw error;
      await loadVisits();
      setShowNotesModal(false);
      setCheckingOutVisit(null);
      if (next === "going_home") setTimeout(() => handleGoingHome(coords), 300);
      else setTimeout(() => setShowNextModal(true), 400);
    } catch (e: any) {
      Alert.alert("Error", e.message || "Failed to check out.");
    } finally {
      setNotesLoading(false);
    }
  };

  const handleGoingHome = async (coords: { latitude: number; longitude: number }) => {
    if (!user?.id) return;
    try {
      const now = new Date().toISOString();
      await AttendanceService.checkOut({ userId: user.id, location: coords });
      try { const rec = await AttendanceStorage.getTodayRecord(); if (rec) await AttendanceStorage.update(rec.id, { checkOut: now }); } catch {}
      try {
        const { ActivityService } = await import("@/services/activity.service");
        await ActivityService.createActivity({ user_id: user.id, locationType: "others", locationName: "Home", notes: "End of day.", gps_coordinates: coords, timestamp: now });
      } catch {}
      showAlert("✅ Day Complete!", `Checked out at ${fmt(now)}. Have a great evening!`);
    } catch (e: any) { Alert.alert("Error", e.message || "Failed."); }
  };

  // Derive "from" context: the last checked-in/completed visit, or "Office" if none
  const getFromContext = (): { name: string; coords: { latitude: number; longitude: number } | null } => {
    const lastActive = [...visits].reverse().find(v => v.status === "CHECKED_IN" || v.status === "COMPLETED");
    if (lastActive) {
      return {
        name: lastActive.location_name,
        coords: lastActive.checkout_location ?? lastActive.checkin_location ?? lastGps,
      };
    }
    return { name: "Office (Check-in)", coords: lastGps };
  };

  const handleNextStopSubmit = async (details: MeetingDetails) => {
    setShowNextModal(false);
    if (!user?.id) return;
    const actType = (details as any).activityType || "meeting";
    const coords = lastGps ?? { latitude: 0, longitude: 0 };
    const from = getFromContext();

    if (actType === "office") {
      try {
        const { OfficeService } = await import("@/services/office.service");
        const { supabase } = await import("@/lib/supabase");
        const offices = await OfficeService.getAllOffices();
        const { data: profile } = await supabase.from("profiles").select("office_id").eq("id", user.id).single();
        const office = offices?.find((o: any) => o.id === profile?.office_id) || offices?.[0];
        if (office?.latitude != null && office?.longitude != null) {
          const gps = await getGPS();
          if (!gps) { showAlert("Location Required", "Enable GPS to verify you are at the office."); return; }
          const dist = haversineM(gps.latitude, gps.longitude, office.latitude, office.longitude);
          if (dist > office.attendance_radius) {
            showAlert("Not at Office", `You are ${dist}m away from ${office.name}. Must be within ${office.attendance_radius}m.`);
            return;
          }
        }
        await FieldVisitService.createVisit({
          userId: user.id,
          visitType: "office",
          locationName: office?.name || "Office",
          notes: details.notes,
          fromLocationName: from.name,
          fromCoords: from.coords ?? undefined,
        });
        await loadVisits();
        showAlert("✅ Back at Office", `Verified and logged at ${office?.name || "Office"}.`);
      } catch (e: any) { Alert.alert("Error", e.message || "Failed."); }
      return;
    }

    try {
      const name = details.meetingType === "client" ? details.clientName : details.cpCompany;
      const address = details.meetingType === "client" ? (details as any).clientAddress : (details as any).cpAddress;
      const notes = details.meetingType === "client"
        ? `Client: ${details.clientName}. Project: ${details.projectName}. ${details.notes}`.trim()
        : `Channel Partner: ${details.cpName} (${details.cpCompany}). Project: ${details.projectName}. ${details.notes}`.trim();

      await FieldVisitService.createVisit({
        userId: user.id,
        visitType: actType as "site" | "meeting" | "office" | "others",
        locationName: name,
        locationAddress: address || undefined,
        meetingType: details.meetingType,
        contactName: details.meetingType === "client" ? (details as any).clientName : (details as any).cpName,
        contactPhone: details.meetingType === "client" ? (details as any).clientPhone : (details as any).cpPhone,
        companyName: details.meetingType === "client" ? (details as any).clientName : (details as any).cpCompany,
        projectName: (details as any).projectName,
        notes,
        fromLocationName: from.name,
        fromCoords: from.coords ?? undefined,
      });

      try {
        const { data: todayAtt } = await (await import("@/services/attendance.service")).AttendanceService.getToday(user.id);
        if (todayAtt?.checkin_time && !todayAtt?.checkout_time) {
          await AttendanceService.checkOut({ userId: user.id, location: coords });
          const rec = await AttendanceStorage.getTodayRecord();
          if (rec) await AttendanceStorage.update(rec.id, { checkOut: new Date().toISOString() });
        }
      } catch {}

      await loadVisits();
      showAlert("✅ On Your Way!", `${name} added. Check in when you arrive.`);
    } catch (e: any) { Alert.alert("Error", e.message || "Failed to add next stop."); }
  };

  const handleMarkMissed = (visit: FieldVisit) => {
    const ok = Platform.OS === "web" ? window.confirm(`Mark visit to ${visit.location_name} as missed?`) : false;
    if (Platform.OS === "web") {
      if (ok) FieldVisitService.markMissed(visit.id).then(() => loadVisits());
    } else {
      Alert.alert("Mark as Missed?", `Mark visit to ${visit.location_name} as missed?`, [
        { text: "Cancel", style: "cancel" },
        { text: "Mark Missed", style: "destructive", onPress: async () => { await FieldVisitService.markMissed(visit.id); await loadVisits(); } },
      ]);
    }
  };

  const pending = visits.filter((v) => v.status === "PENDING");
  const active = visits.filter((v) => v.status === "CHECKED_IN");
  const completed = visits.filter((v) => v.status === "COMPLETED");
  const missed = visits.filter((v) => v.status === "MISSED");
  const hasActiveVisit = active.length > 0;

  if (loading) return <ThemedView style={s.container}><ActivityIndicator color="#60045d" style={{ marginTop: 60 }} /></ThemedView>;

  return (
    <ThemedView style={s.container}>
      <MeetingDetailModal visible={showNextModal} onSubmit={handleNextStopSubmit} onCancel={() => setShowNextModal(false)}
        onGoingHome={() => { setShowNextModal(false); handleGoingHome(lastGps ?? { latitude: 0, longitude: 0 }); }} />
      <CheckoutNotesModal visible={showNotesModal} locationName={checkingOutVisit?.location_name || ""} onConfirm={handleNotesConfirm} loading={notesLoading} />
      <VisitDetailModal visit={detailVisit} onClose={() => setDetailVisit(null)} />

      <ScrollView style={s.scroll} contentContainerStyle={{ paddingTop: insets.top + 16, paddingBottom: insets.bottom + 80 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#60045d" />} showsVerticalScrollIndicator={false}>

        <View style={s.summaryRow}>
          {[{ label: "En Route", count: pending.length, color: "#F59E0B" }, { label: "Active", count: active.length, color: "#3B82F6" },
            { label: "Done", count: completed.length, color: "#10B981" }, { label: "Missed", count: missed.length, color: "#EF4444" }].map((item) => (
            <View key={item.label} style={s.summaryItem}>
              <ThemedText style={[s.summaryCount, { color: item.color }]}>{item.count}</ThemedText>
              <ThemedText style={s.summaryLabel}>{item.label}</ThemedText>
            </View>
          ))}
        </View>

        <Spacer height={16} />

        {visits.length === 0 ? (
          <View style={s.emptyState}>
            <ThemedText style={s.emptyEmoji}>📍</ThemedText>
            <ThemedText style={s.emptyTitle}>No field visits today</ThemedText>
            <ThemedText style={s.emptySub}>Tap below to log where you're going.</ThemedText>
            <Spacer height={20} />
            {!isCheckedOut && (
              <TouchableOpacity style={s.addFirstBtn} onPress={() => setShowNextModal(true)}>
                <Feather name="plus" size={16} color="#fff" />
                <ThemedText style={s.addFirstBtnText}>Log Where I'm Going</ThemedText>
              </TouchableOpacity>
            )}
          </View>
        ) : (
          <>
            {!hasActiveVisit && !isCheckedOut && (
              <TouchableOpacity style={s.addNextBtn} onPress={() => setShowNextModal(true)}>
                <Feather name="plus" size={15} color="#60045d" />
                <ThemedText style={s.addNextBtnText}>Add Next Stop</ThemedText>
              </TouchableOpacity>
            )}
            {isCheckedOut && (
              <View style={s.dayDoneBanner}>
                <ThemedText style={s.dayDoneText}>🏠 You've gone home. No more stops can be added for today.</ThemedText>
              </View>
            )}

            {visits.map((visit) => {
              const cfg = STATUS_CONFIG[visit.status];
              const isActioning = actionLoading === visit.id;
              const typeLabel = visit.visit_type === "site" ? "🏗️ Site" : "🤝 Meeting";
              const meetingLabel = visit.meeting_type === "client" ? "👤 Client" : visit.meeting_type === "channel_partner" ? "🏘️ Channel Partner" : "";
              const hasCheckinGps = !!(visit.checkin_location?.latitude);
              const locationAddress = (visit as any).location_address as string | undefined;

              return (
                <TouchableOpacity key={visit.id} style={s.card} onPress={() => setDetailVisit(visit)} activeOpacity={0.85}>
                  <View style={s.cardTitleRow}>
                    <ThemedText style={s.cardTitle} numberOfLines={1}>{visit.location_name}</ThemedText>
                    <View style={[s.statusBadge, { backgroundColor: cfg.bg }]}>
                      <Feather name={cfg.icon} size={11} color={cfg.color} />
                      <ThemedText style={[s.statusText, { color: cfg.color }]}>{cfg.label}</ThemedText>
                    </View>
                  </View>

                  {(visit as any).from_location_name ? (
                    <View style={s.journeyRow}>
                      <ThemedText style={s.journeyFrom} numberOfLines={1}>📍 {(visit as any).from_location_name}</ThemedText>
                      <Feather name="arrow-right" size={12} color="#9CA3AF" />
                      <ThemedText style={s.journeyTo} numberOfLines={1}>{visit.location_name}</ThemedText>
                    </View>
                  ) : null}

                  <View style={s.cardMeta}>
                    <ThemedText style={s.metaText}>{typeLabel}</ThemedText>
                    {meetingLabel ? <ThemedText style={s.metaText}> · {meetingLabel}</ThemedText> : null}
                    {hasCheckinGps && <ThemedText style={[s.metaText, { color: "#10B981" }]}> · 📍 GPS Logged</ThemedText>}
                  </View>

                  {locationAddress ? <ThemedText style={s.addressText} numberOfLines={2}>📌 {locationAddress}</ThemedText> : null}

                  {visit.contact_name ? <ThemedText style={s.contactText}>👤 {visit.contact_name}{visit.contact_phone ? ` · ${visit.contact_phone}` : ""}</ThemedText> : null}
                  {visit.project_name ? <ThemedText style={s.projectText}>🏗️ {visit.project_name}</ThemedText> : null}

                  {(visit.checkin_time || visit.checkout_time) ? (
                    <View style={s.timesRow}>
                      {visit.checkin_time ? <View style={s.timeItem}><Feather name="log-in" size={11} color="#10B981" /><ThemedText style={s.timeText}>Arrived: {fmt(visit.checkin_time)}</ThemedText></View> : null}
                      {visit.checkout_time ? <View style={s.timeItem}><Feather name="log-out" size={11} color="#EF4444" /><ThemedText style={s.timeText}>Left: {fmt(visit.checkout_time)}</ThemedText></View> : null}
                    </View>
                  ) : null}

                  {(visit as any).checkout_notes ? (
                    <View style={s.notesBox}>
                      <ThemedText style={s.notesLabel}>📝 Meeting Notes</ThemedText>
                      <ThemedText style={s.notesText}>{(visit as any).checkout_notes}</ThemedText>
                    </View>
                  ) : null}

                  {visit.status === "PENDING" && (
                    <View style={s.actions}>
                      <TouchableOpacity style={[s.actionBtn, s.actionBtnPrimary]} onPress={(e) => { e.stopPropagation?.(); handleCheckIn(visit); }} disabled={isActioning}>
                        {isActioning ? <ActivityIndicator color="#fff" size="small" /> : <><Feather name="map-pin" size={14} color="#fff" /><ThemedText style={s.actionBtnText}>I've Arrived — Check In</ThemedText></>}
                      </TouchableOpacity>
                      <TouchableOpacity style={[s.actionBtn, s.actionBtnGhost]} onPress={(e) => { e.stopPropagation?.(); handleMarkMissed(visit); }} disabled={isActioning}>
                        <ThemedText style={s.actionBtnGhostText}>Mark Missed</ThemedText>
                      </TouchableOpacity>
                    </View>
                  )}

                  {visit.status === "CHECKED_IN" && (
                    <TouchableOpacity style={[s.actionBtn, s.actionBtnDanger, { marginTop: 12 }]} onPress={(e) => { e.stopPropagation?.(); handleCheckOutPress(visit); }} disabled={isActioning}>
                      {isActioning ? <ActivityIndicator color="#fff" size="small" /> : <><Feather name="log-out" size={14} color="#fff" /><ThemedText style={s.actionBtnText}>Check Out & Add Notes</ThemedText></>}
                    </TouchableOpacity>
                  )}
                </TouchableOpacity>
              );
            })}
          </>
        )}
        <Spacer height={40} />
      </ScrollView>
    </ThemedView>
  );
}

const s = StyleSheet.create({
  journeyRow: { flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 4, flexWrap: "wrap" },
  journeyFrom: { fontSize: 11, color: "#6B7280", flex: 1 },
  journeyTo: { fontSize: 11, color: "#60045d", fontWeight: "700", flex: 1 },
  container: { flex: 1 },
  scroll: { flex: 1, padding: 16 },
  summaryRow: { flexDirection: "row", backgroundColor: "#fff", borderRadius: 12, padding: 14, borderWidth: 1, borderColor: "#E5E7EB" },
  summaryItem: { flex: 1, alignItems: "center" },
  summaryCount: { fontSize: 20, fontWeight: "800" },
  summaryLabel: { fontSize: 10, color: "#9CA3AF", marginTop: 2 },
  emptyState: { alignItems: "center", paddingTop: 50 },
  emptyEmoji: { fontSize: 48 },
  emptyTitle: { fontSize: 17, fontWeight: "700", marginTop: 10, color: "#111" },
  emptySub: { fontSize: 13, color: "#6B7280", textAlign: "center", marginTop: 6, lineHeight: 20 },
  addFirstBtn: { flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: "#60045d", paddingHorizontal: 20, paddingVertical: 12, borderRadius: 10 },
  addFirstBtnText: { color: "#fff", fontWeight: "700", fontSize: 14 },
  addNextBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, borderWidth: 1.5, borderColor: "#60045d", borderRadius: 10, paddingVertical: 10, marginBottom: 12, backgroundColor: "#F5EEF5" },
  addNextBtnText: { color: "#60045d", fontWeight: "700", fontSize: 14 },
  dayDoneBanner: { backgroundColor: "#F0FDF4", borderWidth: 1.5, borderColor: "#10B981", borderRadius: 10, padding: 14, marginBottom: 12, alignItems: "center" },
  dayDoneText: { fontSize: 13, color: "#065F46", fontWeight: "600", textAlign: "center" },
  card: { backgroundColor: "#fff", borderRadius: 14, padding: 14, marginBottom: 12, borderWidth: 1, borderColor: "#E5E7EB" },
  cardTitleRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 4 },
  cardTitle: { fontSize: 15, fontWeight: "700", color: "#111", flex: 1, marginRight: 8 },
  statusBadge: { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 8, paddingVertical: 3, borderRadius: 20 },
  statusText: { fontSize: 11, fontWeight: "700" },
  cardMeta: { flexDirection: "row", flexWrap: "wrap" },
  metaText: { fontSize: 12, color: "#6B7280" },
  contactText: { fontSize: 12, color: "#374151", marginTop: 3 },
  addressText: { fontSize: 12, color: "#6B7280", marginTop: 3, lineHeight: 17 },
  projectText: { fontSize: 12, color: "#60045d", marginTop: 3, fontWeight: "600" },
  timesRow: { flexDirection: "row", gap: 14, marginTop: 10, paddingTop: 10, borderTopWidth: 1, borderTopColor: "#F3F4F6" },
  timeItem: { flexDirection: "row", alignItems: "center", gap: 4 },
  timeText: { fontSize: 12, color: "#374151", fontWeight: "600" },
  notesBox: { backgroundColor: "#F0F9FF", borderRadius: 8, padding: 10, marginTop: 8, borderLeftWidth: 3, borderLeftColor: "#3B82F6" },
  notesLabel: { fontSize: 11, fontWeight: "700", color: "#1E40AF", marginBottom: 4 },
  notesText: { fontSize: 13, color: "#1E3A8A", lineHeight: 18 },
  actions: { marginTop: 12, gap: 8 },
  actionBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, paddingVertical: 12, borderRadius: 10 },
  actionBtnPrimary: { backgroundColor: "#60045d" },
  actionBtnDanger: { backgroundColor: "#EF4444" },
  actionBtnGhost: { borderWidth: 1.5, borderColor: "#E5E7EB" },
  actionBtnText: { color: "#fff", fontWeight: "700", fontSize: 14 },
  actionBtnGhostText: { color: "#6B7280", fontWeight: "600", fontSize: 13 },
});
