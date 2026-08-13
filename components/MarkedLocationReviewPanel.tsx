import React, { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Image,
  Linking,
  Modal,
  Platform,
  ScrollView,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import Feather from "@expo/vector-icons/Feather";
import { Picker } from "@react-native-picker/picker";
import { ThemedText } from "@/components/ThemedText";
import LocationComparisonMap from "@/components/LocationComparisonMap";
import { supabase } from "@/lib/supabase";
import { firstRpcRow } from "@/utils/supabaseRpc";
import {
  CurrentLocationVisitService,
  VerificationStatus,
} from "@/services/current-location-visit.service";
import { BusinessClockService } from "@/services/business-clock.service";
import { businessMonthRange } from "@/utils/businessDate";

const statuses = [
  "ALL",
  "PENDING",
  "APPROVED",
  "REJECTED",
  "NEEDS_INFORMATION",
  "FLAGGED",
];
const reasons = [
  "ALL",
  "Visiting a different project site",
  "Client meeting",
  "Channel partner meeting",
  "Property inspection",
  "Event duty",
  "Temporary office location",
  "The saved site pin appears incorrect",
  "Site location is not available in the predefined list",
  "Other official work",
];
const fmtDistance = (n: number) =>
  n >= 1000 ? `${(n / 1000).toFixed(1)} km` : `${Math.round(n)} m`;
const showError = (message: string) =>
  Platform.OS === "web"
    ? window.alert(message)
    : Alert.alert("Unable to continue", message);

export default function MarkedLocationReviewPanel() {
  const [rows, setRows] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState("PENDING");
  const [reason, setReason] = useState("ALL");
  const [photo, setPhoto] = useState("ALL");
  const [employee, setEmployee] = useState("");
  const [team, setTeam] = useState("");
  const [office, setOffice] = useState("");
  const [selectedSite, setSelectedSite] = useState("");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [selected, setSelected] = useState<any>(null);
  const load = useCallback(async () => {
    if (!fromDate || !toDate) return;
    setLoading(true);
    let query = supabase
      .from("field_visits")
      .select(
        "*, profiles:user_id(name,employee_number,role,office_id,reports_to,team,office:office_id(name)), selected_site:selected_site_id(id,site_label,address,project_name,latitude,longitude,checkin_radius_m)",
      )
      .in("location_match_status", [
        "CURRENT_LOCATION_MARKED",
        "LOW_ACCURACY",
        "MOCK_LOCATION_FLAGGED",
      ])
      .gte("date", fromDate)
      .lte("date", toDate)
      .order("submitted_at", { ascending: false });
    if (status !== "ALL") query = query.eq("verification_status", status);
    if (reason !== "ALL") query = query.eq("location_mismatch_reason", reason);
    if (photo !== "ALL")
      query = query.eq("evidence_photo_added", photo === "ADDED");
    const { data } = await query;
    const term = (value: string) => value.trim().toLocaleLowerCase();
    setRows(
      (data || []).filter(
        (row: any) =>
          (!term(employee) ||
            String(row.profiles?.name || "")
              .toLocaleLowerCase()
              .includes(term(employee))) &&
          (!term(team) ||
            String(row.profiles?.team || "")
              .toLocaleLowerCase()
              .includes(term(team))) &&
          (!term(office) ||
            String(row.profiles?.office?.name || "")
              .toLocaleLowerCase()
              .includes(term(office))) &&
          (!term(selectedSite) ||
            String(row.selected_site?.site_label || "")
              .toLocaleLowerCase()
              .includes(term(selectedSite))),
      ),
    );
    setLoading(false);
  }, [
    status,
    reason,
    photo,
    employee,
    team,
    office,
    selectedSite,
    fromDate,
    toDate,
  ]);
  useEffect(() => {
    let active = true;
    void BusinessClockService.getDate(true)
      .then((date) => {
        if (!active) return;
        setFromDate(businessMonthRange(date).start);
        setToDate(date);
      })
      .catch((error) => {
        if (active) showError(String(error?.message || error));
      });
    return () => {
      active = false;
    };
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  return (
    <View>
      <View style={s.filters}>
        <ThemedText style={s.sectionTitle}>Current Locations Marked</ThemedText>
        <TextInput
          style={s.input}
          value={employee}
          onChangeText={setEmployee}
          placeholder="Filter employee"
          placeholderTextColor="#9CA3AF"
        />
        <View style={s.filterRow}>
          <TextInput
            style={[s.input, { flex: 1 }]}
            value={team}
            onChangeText={setTeam}
            placeholder="Team"
            placeholderTextColor="#9CA3AF"
          />
          <TextInput
            style={[s.input, { flex: 1 }]}
            value={office}
            onChangeText={setOffice}
            placeholder="Office"
            placeholderTextColor="#9CA3AF"
          />
        </View>
        <TextInput
          style={s.input}
          value={selectedSite}
          onChangeText={setSelectedSite}
          placeholder="Selected site"
          placeholderTextColor="#9CA3AF"
        />
        <View style={s.filterRow}>
          <TextInput
            style={[s.input, { flex: 1 }]}
            value={fromDate}
            onChangeText={setFromDate}
            placeholder="From YYYY-MM-DD"
            placeholderTextColor="#9CA3AF"
          />
          <TextInput
            style={[s.input, { flex: 1 }]}
            value={toDate}
            onChangeText={setToDate}
            placeholder="To YYYY-MM-DD"
            placeholderTextColor="#9CA3AF"
          />
        </View>
        <View style={s.filterRow}>
          <View style={{ flex: 1 }}>
            <Picker selectedValue={status} onValueChange={setStatus}>
              {statuses.map((v) => (
                <Picker.Item key={v} label={v.replace("_", " ")} value={v} />
              ))}
            </Picker>
          </View>
          <View style={{ flex: 1 }}>
            <Picker selectedValue={photo} onValueChange={setPhoto}>
              <Picker.Item label="All photos" value="ALL" />
              <Picker.Item label="Photo added" value="ADDED" />
              <Picker.Item label="No photo" value="NONE" />
            </Picker>
          </View>
        </View>
        <Picker selectedValue={reason} onValueChange={setReason}>
          {reasons.map((v) => (
            <Picker.Item
              key={v}
              label={v === "ALL" ? "All mismatch reasons" : v}
              value={v}
            />
          ))}
        </Picker>
      </View>
      {loading ? (
        <ActivityIndicator color="#60045d" style={{ margin: 30 }} />
      ) : rows.length === 0 ? (
        <ThemedText style={s.empty}>
          No marked current-location requests match these filters.
        </ThemedText>
      ) : (
        rows.map((row) => (
          <TouchableOpacity
            key={row.id}
            style={s.card}
            onPress={() => setSelected(row)}
          >
            <View style={s.between}>
              <View>
                <ThemedText style={s.name}>{row.profiles?.name}</ThemedText>
                <ThemedText style={s.muted}>
                  {row.profiles?.employee_number || ""}
                </ThemedText>
              </View>
              <Status value={row.verification_status} />
            </View>
            <ThemedText style={s.location}>
              {row.actual_location_name}
            </ThemedText>
            <ThemedText style={s.muted}>
              Selected: {row.selected_site?.site_label || "Unknown"} ·{" "}
              {fmtDistance(row.selected_site_distance_metres)}
            </ThemedText>
            <View style={s.between}>
              <ThemedText style={s.muted}>
                Accuracy ±{Math.round(row.actual_location_accuracy_metres)} m
              </ThemedText>
              <ThemedText style={row.evidence_photo_added ? s.good : s.muted}>
                {row.evidence_photo_added
                  ? "Photo added"
                  : "No photo evidence provided"}
              </ThemedText>
            </View>
          </TouchableOpacity>
        ))
      )}
      <ReviewModal
        visit={selected}
        onClose={() => setSelected(null)}
        onUpdated={load}
      />
    </View>
  );
}

function ReviewModal({
  visit,
  onClose,
  onUpdated,
}: {
  visit: any;
  onClose: () => void;
  onUpdated: () => void;
}) {
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const [photoUrl, setPhotoUrl] = useState<string | null>(null);
  const [siteReview, setSiteReview] = useState(false);
  const [sameSiteCount, setSameSiteCount] = useState(0);
  const [siteLat, setSiteLat] = useState("");
  const [siteLon, setSiteLon] = useState("");
  const [siteRadius, setSiteRadius] = useState("");
  useEffect(() => {
    setNotes(visit?.reviewer_notes || "");
    setPhotoUrl(null);
    setSiteReview(false);
    setSiteLat(String(visit?.selected_site_latitude ?? ""));
    setSiteLon(String(visit?.selected_site_longitude ?? ""));
    setSiteRadius(String(visit?.selected_site_radius_metres ?? ""));
    if (visit?.evidence_photo_path)
      CurrentLocationVisitService.getSignedEvidenceUrl(
        visit.evidence_photo_path,
      ).then(({ data }) => setPhotoUrl(data?.signedUrl || null));
    if (visit?.selected_site_id)
      supabase
        .from("field_visits")
        .select("id", { count: "exact", head: true })
        .eq("selected_site_id", visit.selected_site_id)
        .in("location_match_status", [
          "CURRENT_LOCATION_MARKED",
          "LOW_ACCURACY",
          "MOCK_LOCATION_FLAGGED",
        ])
        .then((result: { count: number | null }) =>
          setSameSiteCount(Math.max(0, (result.count || 0) - 1)),
        );
  }, [
    visit?.id,
    visit?.reviewer_notes,
    visit?.selected_site_latitude,
    visit?.selected_site_longitude,
    visit?.selected_site_radius_metres,
    visit?.evidence_photo_path,
    visit?.selected_site_id,
  ]);
  if (!visit) return null;
  const act = async (decision: Exclude<VerificationStatus, "PENDING">) => {
    if (decision !== "APPROVED" && !notes.trim()) {
      showError("Reviewer notes are required.");
      return;
    }
    setBusy(true);
    const { error } = await CurrentLocationVisitService.review(
      visit.id,
      decision,
      notes,
    );
    setBusy(false);
    if (error) {
      showError(error.message);
      return;
    }
    onUpdated();
    onClose();
  };
  const saveSiteReview = async (keepExisting: boolean) => {
    if (!notes.trim()) {
      showError("Add site-review notes first.");
      return;
    }
    setBusy(true);
    const { data, error } = await supabase.rpc("rpc_review_predefined_site_location_v2", {
      p_field_visit_id: visit.id,
      p_new_latitude: Number(siteLat),
      p_new_longitude: Number(siteLon),
      p_new_radius_metres: Number(siteRadius),
      p_notes: notes.trim(),
      p_keep_existing: keepExisting,
    });
    setBusy(false);
    if (error) {
      showError(error.message);
      return;
    }
    const response = firstRpcRow<any>(data);
    if (
      response?.success !== true ||
      response?.field_visit_id !== visit.id
    ) {
      showError("The server did not confirm the site-location review.");
      return;
    }
    setSiteReview(false);
    onUpdated();
  };
  return (
    <Modal visible animationType="slide" onRequestClose={onClose}>
      <View style={s.modalHeader}>
        <TouchableOpacity onPress={onClose}>
          <Feather name="x" size={22} />
        </TouchableOpacity>
        <ThemedText style={s.title}>Marked Location Review</ThemedText>
        <View style={{ width: 22 }} />
      </View>
      <ScrollView contentContainerStyle={s.modalBody}>
        <View style={s.card}>
          <ThemedText style={s.name}>
            {visit.profiles?.name} · {visit.profiles?.employee_number || ""}
          </ThemedText>
          <Info label="Team" value={visit.profiles?.team || "—"} />
          <Info label="Office" value={visit.profiles?.office?.name || "—"} />
          <Info
            label="Selected predefined site"
            value={visit.selected_site?.site_label || "—"}
          />
          <Info
            label="Selected-site address"
            value={visit.selected_site?.address || "—"}
          />
          <Info
            label="Actual marked location"
            value={visit.actual_location_name}
          />
          <Info
            label="Detected address"
            value={visit.actual_location_address || "Address not detected"}
          />
          <Info
            label="Distance / allowed"
            value={`${fmtDistance(visit.selected_site_distance_metres)} / ${visit.selected_site_radius_metres} m`}
          />
          <Info
            label="GPS accuracy"
            value={`±${Math.round(visit.actual_location_accuracy_metres)} m`}
          />
          <Info
            label="Captured / submitted"
            value={`${new Date(visit.actual_location_captured_at).toLocaleString()} / ${new Date(visit.submitted_at).toLocaleString()}`}
          />
          <Info
            label="Mismatch reason"
            value={visit.location_mismatch_reason}
          />
          <Info
            label="Explanation"
            value={visit.location_mismatch_explanation || "—"}
          />
          <Info label="Visit purpose" value={visit.visit_purpose} />
          <Info
            label="Client/project/company"
            value={visit.client_project_company_name || "—"}
          />
          <Info
            label="Expected duration"
            value={`${visit.expected_duration_minutes} minutes`}
          />
          <Info
            label="Additional notes"
            value={visit.additional_notes || "—"}
          />
          <Info
            label="Mock-location indicator"
            value={visit.mocked_location_detected ? "FLAGGED" : "Not detected"}
          />
          <Info label="Risk score" value={String(visit.location_risk_score)} />
          <Info label="Verification status" value={visit.verification_status} />
          <Info
            label="Other mismatches at this site"
            value={String(sameSiteCount)}
          />
        </View>
        <LocationComparisonMap
          selected={{
            latitude: visit.selected_site_latitude,
            longitude: visit.selected_site_longitude,
            name: visit.selected_site?.site_label || "Selected site",
          }}
          actual={{
            latitude: visit.actual_latitude,
            longitude: visit.actual_longitude,
            name: visit.actual_location_name,
          }}
          radiusMetres={visit.selected_site_radius_metres}
        />
        <View style={s.card}>
          <ThemedText style={s.sectionTitle}>PHOTO EVIDENCE</ThemedText>
          {photoUrl ? (
            <Image source={{ uri: photoUrl }} style={s.photo} />
          ) : (
            <ThemedText style={s.muted}>No photo evidence provided</ThemedText>
          )}
        </View>
        {visit.location_mismatch_reason ===
          "The saved site pin appears incorrect" && (
          <>
            <TouchableOpacity
              style={s.siteReview}
              onPress={() => setSiteReview((v) => !v)}
            >
              <Feather name="map-pin" size={16} color="#92400E" />
              <ThemedText style={{ color: "#92400E", fontWeight: "700" }}>
                Review Predefined Site Location
              </ThemedText>
            </TouchableOpacity>
            {siteReview && (
              <View style={s.card}>
                <ThemedText style={s.muted}>
                  Compare employee evidence before changing the trusted site. A
                  change is never applied automatically.
                </ThemedText>
                <TextInput
                  style={s.input}
                  value={siteLat}
                  onChangeText={setSiteLat}
                  keyboardType="decimal-pad"
                  placeholder="Latitude"
                />
                <TextInput
                  style={s.input}
                  value={siteLon}
                  onChangeText={setSiteLon}
                  keyboardType="decimal-pad"
                  placeholder="Longitude"
                />
                <TextInput
                  style={s.input}
                  value={siteRadius}
                  onChangeText={setSiteRadius}
                  keyboardType="number-pad"
                  placeholder="Radius in metres"
                />
                <TouchableOpacity
                  style={s.siteReview}
                  onPress={() =>
                    Linking.openURL(
                      `https://www.google.com/maps/search/?api=1&query=${visit.selected_site_latitude},${visit.selected_site_longitude}`,
                    )
                  }
                >
                  <ThemedText style={{ color: "#92400E", fontWeight: "700" }}>
                    Open Saved Pin in Maps
                  </ThemedText>
                </TouchableOpacity>
                <View style={s.filterRow}>
                  <TouchableOpacity
                    style={[s.action, { flex: 1, backgroundColor: "#6B7280" }]}
                    disabled={busy}
                    onPress={() => saveSiteReview(true)}
                  >
                    <ThemedText style={s.actionText}>
                      Keep Existing Pin
                    </ThemedText>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[s.action, { flex: 1, backgroundColor: "#60045d" }]}
                    disabled={busy}
                    onPress={() => saveSiteReview(false)}
                  >
                    <ThemedText style={s.actionText}>
                      Update Site Pin
                    </ThemedText>
                  </TouchableOpacity>
                </View>
              </View>
            )}
          </>
        )}
        <ThemedText style={s.sectionTitle}>REVIEWER NOTES</ThemedText>
        <TextInput
          style={[s.input, { minHeight: 90, textAlignVertical: "top" }]}
          value={notes}
          onChangeText={setNotes}
          multiline
          placeholder="Required for reject, flag, or request information"
          placeholderTextColor="#9CA3AF"
        />
        <View style={s.actions}>
          {[
            ["Approve", "APPROVED", "#059669"],
            ["Reject", "REJECTED", "#DC2626"],
            ["Request Information", "NEEDS_INFORMATION", "#D97706"],
            ["Flag", "FLAGGED", "#7C3AED"],
          ].map(([label, value, color]) => (
            <TouchableOpacity
              key={value}
              disabled={busy}
              style={[s.action, { backgroundColor: color }]}
              onPress={() => act(value as any)}
            >
              {busy ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <ThemedText style={s.actionText}>{label}</ThemedText>
              )}
            </TouchableOpacity>
          ))}
        </View>
      </ScrollView>
    </Modal>
  );
}
function Info({ label, value }: { label: string; value: string }) {
  return (
    <View style={s.info}>
      <ThemedText style={s.infoLabel}>{label}</ThemedText>
      <ThemedText style={s.infoValue}>{value}</ThemedText>
    </View>
  );
}
function Status({ value }: { value: string }) {
  const color =
    value === "APPROVED"
      ? "#059669"
      : value === "REJECTED"
        ? "#DC2626"
        : value === "FLAGGED"
          ? "#7C3AED"
          : "#D97706";
  return (
    <View style={[s.status, { backgroundColor: `${color}18` }]}>
      <ThemedText style={{ color, fontSize: 11, fontWeight: "800" }}>
        {value.replace("_", " ")}
      </ThemedText>
    </View>
  );
}
const s = StyleSheet.create({
  filters: {
    backgroundColor: "#fff",
    borderRadius: 12,
    padding: 14,
    marginBottom: 12,
  },
  sectionTitle: {
    fontSize: 12,
    fontWeight: "800",
    color: "#60045d",
    marginBottom: 8,
  },
  filterRow: { flexDirection: "row", gap: 8 },
  input: {
    borderWidth: 1.5,
    borderColor: "#E5E7EB",
    borderRadius: 9,
    padding: 11,
    color: "#111827",
    backgroundColor: "#F9FAFB",
  },
  empty: { textAlign: "center", color: "#9CA3AF", padding: 30 },
  card: {
    backgroundColor: "#fff",
    borderRadius: 12,
    padding: 14,
    marginBottom: 10,
    gap: 7,
  },
  between: { flexDirection: "row", justifyContent: "space-between", gap: 8 },
  name: { fontSize: 15, fontWeight: "800", color: "#111827" },
  muted: { fontSize: 12, color: "#6B7280" },
  good: { fontSize: 12, color: "#059669", fontWeight: "700" },
  location: { fontSize: 14, fontWeight: "700", color: "#60045d" },
  status: { borderRadius: 10, paddingHorizontal: 8, paddingVertical: 4 },
  modalHeader: {
    paddingTop: Platform.OS === "ios" ? 58 : 20,
    padding: 18,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    borderBottomWidth: 1,
    borderBottomColor: "#E5E7EB",
  },
  title: { fontSize: 18, fontWeight: "800" },
  modalBody: { padding: 16, paddingBottom: 50, backgroundColor: "#F7F7FA" },
  info: {
    flexDirection: "row",
    gap: 10,
    paddingVertical: 7,
    borderBottomWidth: 1,
    borderBottomColor: "#F3F4F6",
  },
  infoLabel: { width: 135, fontSize: 12, color: "#6B7280" },
  infoValue: { flex: 1, fontSize: 12, fontWeight: "600", color: "#111827" },
  photo: { width: "100%", height: 260, borderRadius: 10 },
  siteReview: {
    flexDirection: "row",
    gap: 8,
    alignItems: "center",
    justifyContent: "center",
    padding: 14,
    borderRadius: 10,
    backgroundColor: "#FEF3C7",
    marginBottom: 12,
  },
  actions: { gap: 8, marginTop: 12 },
  action: { padding: 13, borderRadius: 10, alignItems: "center" },
  actionText: { color: "#fff", fontWeight: "800" },
});
