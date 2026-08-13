import React, { useState, useEffect } from "react";
import {
  View,
  StyleSheet,
  Alert,
  TouchableOpacity,
  TextInput,
  ActivityIndicator,
  ScrollView,
} from "react-native";
import { useNavigation } from "@react-navigation/native";
import * as Location from "expo-location";
import { ThemedView } from "@/components/ThemedView";
import { ThemedText } from "@/components/ThemedText";
import { Button } from "@/components/Button";
import Spacer from "@/components/Spacer";
import { ActivityService } from "@/services/activity.service";
import { AttendanceService } from "@/services/attendance.service";
import { FieldVisitService } from "@/services/field-visit.service";
import { OfficeService } from "@/services/office.service";
import { useAuth } from "@/contexts/AuthContext";
import { ActivityAnalysis } from "@/services/activity-analysis.service";
import MeetingDetailModal, { MeetingDetails } from "@/components/MeetingDetailModal";
import { useScreenInsets } from "@/hooks/useScreenInsets";

type LocationType = "office" | "site" | "meeting" | "others";

interface ActivityForm {
  locationType: LocationType;
  locationName: string;
  notes: string;
  destination?: string;
}

const ACTIVITY_COLORS: Record<string, string> = {
  SITE_VISIT: "#10B981",
  CLIENT_MEETING: "#3B82F6",
  CHANNEL_PARTNER_MEETING: "#8B5CF6",
  INTERNAL_MEETING: "#F59E0B",
  TRAVEL: "#EF4444",
  OFFICE_WORK: "#6B7280",
  OTHER: "#9CA3AF",
};

const LOCATION_OPTIONS: { value: LocationType; label: string; icon: string; description: string }[] = [
  { value: "office",  label: "Office",     icon: "🏢", description: "Working from office" },
  { value: "site",    label: "Site Visit", icon: "🏗️", description: "Project site visit" },
  { value: "meeting", label: "Meeting",    icon: "🤝", description: "Client or business meeting" },
  { value: "others",  label: "Home",       icon: "🏠", description: "Going home or end of day" },
];

export default function ActivityLoggingScreen() {
  const navigation = useNavigation();
  const { user } = useAuth();
  const { paddingBottom } = useScreenInsets();

  const [loading, setLoading] = useState(false);
  const [gpsLocation, setGpsLocation] = useState<{ latitude: number; longitude: number } | null>(null);
  const [savedResult, setSavedResult] = useState<ActivityAnalysis | null>(null);
  const [showMeetingModal, setShowMeetingModal] = useState(false);
  const [meetingDetails, setMeetingDetails] = useState<MeetingDetails | null>(null);
  const [checkedIn, setCheckedIn] = useState(false);
  const [checkedOut, setCheckedOut] = useState(false);
  const [checkinTime, setCheckinTime] = useState<string | null>(null);
  const [checkoutTime, setCheckoutTime] = useState<string | null>(null);
  const [offices, setOffices] = useState<{ id: string; name: string }[]>([]);
  const [form, setForm] = useState<ActivityForm>({
    locationType: "office",
    locationName: "",
    notes: "",
    destination: "",
  });

  useEffect(() => {
    getGPS();
    loadAttendance();
    loadOffices();
  }, []);

  const loadOffices = async () => {
    try {
      const data = await OfficeService.getAllOffices();
      setOffices((data || []).map((o: any) => ({ id: o.id, name: o.name })));
    } catch (error) {
      console.warn("Unable to load today's attendance", error);
    }
  };

  const getGPS = async () => {
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status === "granted") {
        const loc = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
        setGpsLocation({ latitude: loc.coords.latitude, longitude: loc.coords.longitude });
      }
    } catch (error) {
      console.warn("Unable to request activity location permission", error);
    }
  };

  const loadAttendance = async () => {
    if (!user?.id) return;
    try {
      const { data } = await AttendanceService.getToday(user.id);
      if (data) {
        setCheckedIn(!!data.checkin_time);
        setCheckedOut(!!data.checkout_time);
        setCheckinTime(data.checkin_time ?? null);
        setCheckoutTime(data.checkout_time ?? null);
      }
    } catch (error) {
      console.warn("Unable to capture the initial activity location", error);
    }
  };

  const handleTypeSelect = (value: LocationType) => {
    setMeetingDetails(null);
    setForm({ locationType: value, locationName: "", notes: "", destination: "" });
    if (value === "site" || value === "meeting") setShowMeetingModal(true);
  };

  const handleMeetingSubmit = (details: MeetingDetails) => {
    setMeetingDetails(details);
    setShowMeetingModal(false);
    const name = details.meetingType === "client" ? details.clientName : details.cpCompany;
    const notes = details.meetingType === "client"
      ? `Client: ${details.clientName}. Project: ${details.projectName}. ${details.notes}`.trim()
      : `Channel Partner: ${details.cpName} (${details.cpCompany}). Project: ${details.projectName}. ${details.notes}`.trim();
    setForm((prev) => ({ ...prev, locationName: name, notes }));
  };

  const handleSubmit = async () => {
    if (!form.locationName.trim() || !form.notes.trim()) {
      Alert.alert("Required", "Please fill in location and notes.");
      return;
    }
    if (!checkedIn) {
      Alert.alert("Not Checked In", "You must check in first.",
        [{ text: "Go to Dashboard", onPress: () => navigation.navigate("HomeTab" as never) }, { text: "Cancel", style: "cancel" }]
      );
      return;
    }
    setLoading(true);
    try {
      let coords = gpsLocation;
      try {
        const loc = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
        coords = { latitude: loc.coords.latitude, longitude: loc.coords.longitude };
        setGpsLocation(coords);
      } catch {
        // Preserve GPS-unavailable as null. Never manufacture 0,0 coordinates.
      }

      const { data, error } = await ActivityService.createActivity({
        user_id: user!.id,
        locationType: form.locationType,
        locationName: form.locationName.trim(),
        notes: form.notes.trim(),
        destination: form.destination?.trim() || undefined,
        gps_coordinates: coords,
        timestamp: new Date().toISOString(),
        meetingDetails: meetingDetails || undefined,
      });
      if (error) throw error;

      if ((form.locationType === "site" || form.locationType === "meeting") && data?.id) {
        await FieldVisitService.createVisit({
          userId: user!.id,
          activityLogId: data.id,
          visitType: form.locationType,
          locationName: form.locationName.trim(),
          destinationCoords: (meetingDetails as any)?.destinationCoords || undefined,
          checkinRadiusM: (meetingDetails as any)?.checkinRadiusM ?? 100,
          predefinedSiteId: (meetingDetails as any)?.predefinedSiteId,
          meetingType: meetingDetails?.meetingType,
          contactName: meetingDetails?.meetingType === "client" ? (meetingDetails as any).clientName : (meetingDetails as any)?.cpName,
          contactPhone: meetingDetails?.meetingType === "client" ? (meetingDetails as any).clientPhone : (meetingDetails as any)?.cpPhone,
          companyName: meetingDetails?.meetingType === "client" ? (meetingDetails as any).clientName : (meetingDetails as any)?.cpCompany,
          projectName: (meetingDetails as any)?.projectName,
          notes: form.notes.trim(),
        });
      }

      // AUTO-CHECKOUT REMOVED: logging a "going home" activity no longer
      // checks the user out of attendance. Checkout happens ONLY when the
      // user presses the Check Out button on the Attendance screen.
      setSavedResult(data as any);
    } catch (err: any) {
      Alert.alert("Error", err.message || "Failed to save.");
    } finally {
      setLoading(false);
    }
  };

  // ── Success screen ────────────────────────────────────────────────────────
  if (savedResult) {
    const color = ACTIVITY_COLORS[savedResult.activity_type] || "#9CA3AF";
    return (
      <ThemedView style={s.container}>
        <ScrollView
          contentContainerStyle={{ padding: 24, paddingBottom }}
          showsVerticalScrollIndicator={false}
        >
          <ThemedText style={s.successEmoji}>✅</ThemedText>
          <ThemedText style={s.successTitle}>Activity Logged!</ThemedText>
          <ThemedText style={s.successSub}>{savedResult.summary}</ThemedText>
          <Spacer height={24} />
          <View style={s.resultCard}>
            <View style={[s.typeBadge, { backgroundColor: color }]}>
              <ThemedText style={s.typeBadgeText}>{savedResult.activity_type.replace(/_/g, " ")}</ThemedText>
            </View>
            <Spacer height={14} />
            <Row label="Confidence" value={`${savedResult.confidence_score}%`} color={color} />
            {savedResult.meeting_purpose ? <Row label="Purpose" value={savedResult.meeting_purpose} /> : null}
            {(savedResult.client_name || savedResult.company_name)
              ? <Row label="Company" value={savedResult.client_name || savedResult.company_name} /> : null}
            <Row label="Billable" value={savedResult.is_billable_activity ? "Yes ✓" : "No"} color={savedResult.is_billable_activity ? "#10B981" : "#9CA3AF"} />
          </View>
          <Spacer height={24} />
          <Button onPress={() => { setSavedResult(null); setMeetingDetails(null); setForm({ locationType: "office", locationName: "", notes: "", destination: "" }); }} variant="primary">
            Log Another Activity
          </Button>
          <Spacer height={12} />
          <Button onPress={() => navigation.goBack()} variant="outline">Back to Dashboard</Button>
        </ScrollView>
      </ThemedView>
    );
  }

  // ── Main form ─────────────────────────────────────────────────────────────
  return (
    <ThemedView style={s.container}>
      <MeetingDetailModal
        visible={showMeetingModal}
        activityType={form.locationType as "site" | "meeting"}
        onSubmit={handleMeetingSubmit}
        onCancel={() => { setShowMeetingModal(false); setForm((p) => ({ ...p, locationType: "office" })); }}
      />

      <ScrollView
        style={s.scroll}
        contentContainerStyle={{ padding: 20, paddingBottom }}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        <ThemedText style={s.title}>Log Activity</ThemedText>
        <ThemedText style={s.subtitle}>Fill your activity — checkout happens on submit</ThemedText>

        <Spacer height={14} />

        {/* Status banner */}
        {!checkedIn ? (
          <TouchableOpacity style={s.bannerRed} onPress={() => navigation.navigate("HomeTab" as never)}>
            <ThemedText style={s.bannerText}>⚠️ Not checked in. Tap to go to Attendance first.</ThemedText>
          </TouchableOpacity>
        ) : checkedOut ? (
          <View style={s.bannerDayDone}>
            <ThemedText style={s.bannerDayDoneEmoji}>🏠</ThemedText>
            <View style={{ flex: 1 }}>
              <ThemedText style={s.bannerDayDoneTitle}>You've gone home for the day</ThemedText>
              <ThemedText style={s.bannerDayDoneSub}>
                Checked out at {checkoutTime ? new Date(checkoutTime).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "—"}. No more activities can be logged.
              </ThemedText>
            </View>
          </View>
        ) : (
          <View style={s.bannerBlue}>
            <ThemedText style={s.bannerText}>
              🏢 Checked in at {checkinTime ? new Date(checkinTime).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "—"}.
              {" "}Log your activity below. Use the Attendance screen to check out.
            </ThemedText>
          </View>
        )}

        <Spacer height={18} />

        {/* Hide entire form once user has gone home */}
        {checkedOut ? null : (<>

        <ThemedText style={s.label}>Activity Type *</ThemedText>
        <View style={s.typeGrid}>
          {LOCATION_OPTIONS.map((opt) => {
            const selected = form.locationType === opt.value;
            const needsForm = opt.value === "site" || opt.value === "meeting";
            const filled = selected && needsForm && !!meetingDetails;
            return (
              <TouchableOpacity
                key={opt.value}
                style={[s.typeCard, selected && s.typeCardSelected]}
                onPress={() => handleTypeSelect(opt.value)}
              >
                <ThemedText style={s.typeIcon}>{opt.icon}</ThemedText>
                <ThemedText style={[s.typeLabel, selected && s.typeLabelSelected]}>{opt.label}</ThemedText>
                {needsForm && (
                  <View style={[s.badge, filled ? s.badgeFilled : s.badgeRequired]}>
                    <ThemedText style={[s.badgeText, filled ? s.badgeFilledText : s.badgeRequiredText]}>
                      {filled ? "✓ Filled" : "Form"}
                    </ThemedText>
                  </View>
                )}
              </TouchableOpacity>
            );
          })}
        </View>

        {(form.locationType === "site" || form.locationType === "meeting") && !meetingDetails && (
          <TouchableOpacity style={s.fillPrompt} onPress={() => setShowMeetingModal(true)}>
            <ThemedText style={s.fillPromptText}>
              👆 Tap to fill {form.locationType === "site" ? "site visit" : "meeting"} details
            </ThemedText>
          </TouchableOpacity>
        )}

        <Spacer height={18} />

        {/* Office dropdown when type=office, free text otherwise */}
        {form.locationType === "office" ? (
          <>
            <ThemedText style={s.label}>Select Office *</ThemedText>
            {offices.length === 0 ? (
              <View style={[s.input, { justifyContent: "center" }]}>
                <ThemedText style={{ color: "#9CA3AF", fontSize: 14 }}>Loading offices...</ThemedText>
              </View>
            ) : (
              <View style={s.officeList}>
                {offices.map((office) => {
                  const selected = form.locationName === office.name;
                  return (
                    <TouchableOpacity
                      key={office.id}
                      style={[s.officeOption, selected && s.officeOptionSelected]}
                      onPress={() => setForm({ ...form, locationName: office.name })}
                    >
                      <ThemedText style={s.officeOptionIcon}>🏢</ThemedText>
                      <ThemedText style={[s.officeOptionText, selected && s.officeOptionTextSelected]}>
                        {office.name}
                      </ThemedText>
                      {selected && <ThemedText style={s.officeOptionCheck}>✓</ThemedText>}
                    </TouchableOpacity>
                  );
                })}
              </View>
            )}
          </>
        ) : (
          <>
            <ThemedText style={s.label}>Location / Company Name *</ThemedText>
            <TextInput
              style={s.input}
              placeholder="e.g., ABC Builders Ltd, Project Site Alpha"
              placeholderTextColor="#9CA3AF"
              value={form.locationName}
              onChangeText={(t) => setForm({ ...form, locationName: t })}
              maxLength={255}
            />
          </>
        )}

        <Spacer height={14} />

        <ThemedText style={s.label}>Activity Notes *</ThemedText>
        <TextInput
          style={[s.input, s.notesInput]}
          placeholder="Describe what you did, who you met, outcomes..."
          placeholderTextColor="#9CA3AF"
          value={form.notes}
          onChangeText={(t) => setForm({ ...form, notes: t })}
          multiline
          numberOfLines={4}
          maxLength={1000}
          textAlignVertical="top"
        />

        {form.locationType === "others" && (
          <>
            <Spacer height={14} />
            <ThemedText style={s.label}>Notes for Going Home</ThemedText>
            <TextInput
              style={s.input}
              placeholder="Any notes before heading home..."
              placeholderTextColor="#9CA3AF"
              value={form.destination}
              onChangeText={(t) => setForm({ ...form, destination: t })}
              maxLength={255}
            />
          </>
        )}

        <Spacer height={10} />
        <View style={s.gpsRow}>
          <ThemedText style={s.gpsText}>📍 GPS: {gpsLocation ? "Captured" : "Not available"}</ThemedText>
          {!gpsLocation && (
            <TouchableOpacity onPress={getGPS}>
              <ThemedText style={s.gpsRetry}>Retry</ThemedText>
            </TouchableOpacity>
          )}
        </View>

        {/* Submit button — inside scroll, always reachable */}
        <Spacer height={24} />
        <TouchableOpacity
          style={[s.submitBtn, (!checkedIn || loading) && s.submitBtnDisabled]}
          onPress={handleSubmit}
          disabled={!checkedIn || loading}
          activeOpacity={0.85}
        >
          {loading
            ? <ActivityIndicator color="#fff" size="small" />
            : <ThemedText style={s.submitBtnText}>
                {"💾 Save Activity Log"}
              </ThemedText>
          }
        </TouchableOpacity>

        </>)}
      </ScrollView>
    </ThemedView>
  );
}

function Row({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <View style={s.row}>
      <ThemedText style={s.rowLabel}>{label}</ThemedText>
      <ThemedText style={[s.rowValue, color ? { color } : {}]}>{value}</ThemedText>
    </View>
  );
}

const s = StyleSheet.create({
  container: { flex: 1 },
  scroll: { flex: 1 },
  title: { fontSize: 20, fontWeight: "800", textAlign: "center" },
  subtitle: { fontSize: 12, color: "#6B7280", textAlign: "center", marginTop: 3 },
  label: { fontSize: 14, fontWeight: "600", marginBottom: 8 },
  bannerRed: { backgroundColor: "#FDEAEB", borderLeftWidth: 4, borderLeftColor: "#C8252D", padding: 12, borderRadius: 8 },
  bannerGreen: { backgroundColor: "#E4F4EE", borderLeftWidth: 4, borderLeftColor: "#12966E", padding: 12, borderRadius: 8 },
  bannerBlue: { backgroundColor: "#E3EEFB", borderLeftWidth: 4, borderLeftColor: "#1A5FD4", padding: 12, borderRadius: 8 },
  bannerText: { fontSize: 13, lineHeight: 18 },
  bannerDayDone: { backgroundColor: "#E4F4EE", borderWidth: 1.5, borderColor: "#12966E", borderRadius: 12, padding: 16, flexDirection: "row", alignItems: "center", gap: 12 },
  bannerDayDoneEmoji: { fontSize: 32 },
  bannerDayDoneTitle: { fontSize: 15, fontWeight: "700", color: "#0A7354" },
  bannerDayDoneSub: { fontSize: 12, color: "#0A7354", marginTop: 3, lineHeight: 17 },
  typeGrid: { flexDirection: "row", flexWrap: "wrap", gap: 10 },
  typeCard: {
    width: "47%", padding: 12, borderRadius: 12,
    borderWidth: 2, borderColor: "#E2D5EA", backgroundColor: "#F5F0F8",
    alignItems: "center", gap: 4,
  },
  typeCardSelected: { borderColor: "#6D1B6D", backgroundColor: "#EDE0F0" },
  typeIcon: { fontSize: 24 },
  typeLabel: { fontSize: 13, fontWeight: "600", textAlign: "center" },
  typeLabelSelected: { color: "#6D1B6D" },
  badge: { paddingHorizontal: 8, paddingVertical: 2, borderRadius: 10 },
  badgeFilled: { backgroundColor: "#E4F4EE" },
  badgeRequired: { backgroundColor: "#FEF3C7" },
  badgeText: { fontSize: 11, fontWeight: "700" },
  badgeFilledText: { color: "#0A7354" },
  badgeRequiredText: { color: "#92400E" },
  fillPrompt: {
    marginTop: 8, backgroundColor: "#E3EEFB",
    borderWidth: 1.5, borderColor: "#1A5FD4", borderRadius: 10,
    padding: 12, alignItems: "center",
  },
  fillPromptText: { fontSize: 13, color: "#1A5FD4", fontWeight: "600", textAlign: "center" },
  input: {
    borderWidth: 1.5, borderColor: "#E2D5EA", borderRadius: 10,
    padding: 12, fontSize: 14, backgroundColor: "#F5F0F8",
  },
  notesInput: { height: 100, textAlignVertical: "top" },
  gpsRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  gpsText: { fontSize: 12, color: "#6B6478" },
  gpsRetry: { fontSize: 12, color: "#6D1B6D", fontWeight: "600" },
  officeList: { gap: 8 },
  officeOption: {
    flexDirection: "row", alignItems: "center", gap: 10,
    padding: 14, borderRadius: 10,
    borderWidth: 1.5, borderColor: "#E2D5EA", backgroundColor: "#F5F0F8",
  },
  officeOptionSelected: { borderColor: "#6D1B6D", backgroundColor: "#EDE0F0" },
  officeOptionIcon: { fontSize: 18 },
  officeOptionText: { flex: 1, fontSize: 14, fontWeight: "500" },
  officeOptionTextSelected: { color: "#6D1B6D", fontWeight: "700" },
  officeOptionCheck: { fontSize: 16, color: "#6D1B6D", fontWeight: "700" },
  submitBtn: {
    backgroundColor: "#6D1B6D",
    borderRadius: 12, height: 54,
    alignItems: "center", justifyContent: "center",
  },
  submitBtnDisabled: { opacity: 0.45 },
  submitBtnText: { color: "#fff", fontWeight: "700", fontSize: 15 },
  successEmoji: { fontSize: 56, textAlign: "center", marginTop: 20 },
  successTitle: { fontSize: 22, fontWeight: "800", textAlign: "center", marginTop: 12 },
  successSub: { fontSize: 14, textAlign: "center", marginTop: 6, lineHeight: 20 },
  resultCard: { width: "100%", borderRadius: 14, padding: 18, borderWidth: 1, borderColor: "#E2D5EA" },
  typeBadge: { alignSelf: "flex-start", paddingHorizontal: 12, paddingVertical: 5, borderRadius: 20 },
  typeBadgeText: { color: "#fff", fontWeight: "700", fontSize: 12 },
  row: { flexDirection: "row", justifyContent: "space-between", paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: "#EDE5F2" },
  rowLabel: { fontSize: 13, color: "#6B6478" },
  rowValue: { fontSize: 13, fontWeight: "600" },
});
