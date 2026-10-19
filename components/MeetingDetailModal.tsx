import React, { useState, useEffect, useMemo, useRef } from "react";
import {
  Modal,
  View,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  ScrollView,
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
} from "react-native";
import Feather from "@expo/vector-icons/Feather";
import * as Crypto from "expo-crypto";
import { ThemedText } from "@/components/ThemedText";
import { useTheme } from "@/hooks/useTheme";
import { Colors } from "@/constants/theme";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { OfficeService } from "@/services/office.service";
import SitePickerModal, { SitePickerResult } from "@/components/SitePickerModal";

export type MeetingType = "client" | "channel_partner";

export interface ClientMeetingDetails {
  meetingType: "client";
  clientName: string;
  clientPhone: string;
  clientEmail: string;
  clientAddress: string;
  projectName: string;
  source: string;
  notes: string;
  activityType?: string;
  // predefined site data (set when user picks from dropdown)
  predefinedSiteId?: string;
  destinationCoords?: { latitude: number; longitude: number };
  checkinRadiusM?: number;
  googlePlaceId?: string;
  locationSource?: "GOOGLE_PLACE" | "MAP_PIN" | "CURRENT_LOCATION" | "PREDEFINED_SITE" | "MANUAL_COORDINATES";
  idempotencyKey?: string;
}

export interface ChannelPartnerDetails {
  meetingType: "channel_partner";
  cpName: string;
  cpPhone: string;
  cpEmail: string;
  cpCompany: string;
  cpAddress?: string;
  projectName: string;
  source: string;
  notes: string;
  activityType?: string;
  // predefined site data
  predefinedSiteId?: string;
  destinationCoords?: { latitude: number; longitude: number };
  checkinRadiusM?: number;
  googlePlaceId?: string;
  locationSource?: "GOOGLE_PLACE" | "MAP_PIN" | "CURRENT_LOCATION" | "PREDEFINED_SITE" | "MANUAL_COORDINATES";
  idempotencyKey?: string;
}

export type MeetingDetails = ClientMeetingDetails | ChannelPartnerDetails;

// Called when user picks "Going Home"
export type GoingHomeCallback = () => void;

interface Props {
  visible: boolean;
  activityType?: "site" | "meeting" | "office"; // if provided, skip step 1
  onSubmit: (details: MeetingDetails) => void;
  onCancel: () => void;
  onGoingHome?: GoingHomeCallback; // optional — if provided, show Going Home option
}

type Step = "activity" | "pick" | "client" | "cp" | "office" | "sitepicker";

const ACTIVITY_OPTIONS = [
  { value: "office",  icon: "🏢", label: "Office",     sub: "Working from office",              color: "#60045d", bg: "#F5EEF5", darkColor: "#E2A6E2" },
  { value: "site",    icon: "🏗️", label: "Site Visit", sub: "Visiting a project or property",   color: "#10B981", bg: "#F0FDF4", darkColor: "#34D399" },
  { value: "meeting", icon: "🤝", label: "Meeting",    sub: "Client or channel partner meeting", color: "#3B82F6", bg: "#EFF6FF", darkColor: "#7DB3FF" },
  { value: "others",  icon: "📌", label: "Other",      sub: "Any other location or activity",   color: "#F97316", bg: "#FFF7ED", darkColor: "#FDBA74" },
];

type ThemeColors = typeof Colors.light;

/** Light values are the original design; dark values come from the theme. */
function useFieldStyles() {
  const { theme, isDark } = useTheme();
  return useMemo(() => createFieldStyles(theme, isDark), [theme, isDark]);
}

function Field({ label, value, onChange, placeholder, keyboardType, required }: {
  label: string; value: string; onChange: (v: string) => void;
  placeholder?: string; keyboardType?: any; required?: boolean;
}) {
  const f = useFieldStyles();
  const { theme, isDark } = useTheme();
  return (
    <View style={f.wrap}>
      <ThemedText style={f.label}>{label}{required ? " *" : ""}</ThemedText>
      <TextInput
        style={f.input}
        value={value}
        onChangeText={onChange}
        placeholder={placeholder || label}
        placeholderTextColor={isDark ? theme.textSecondary : "#9CA3AF"}
        keyboardType={keyboardType || "default"}
        maxLength={255}
      />
    </View>
  );
}

function createFieldStyles(t: ThemeColors, dark: boolean) {
  return StyleSheet.create({
    wrap: { marginBottom: 14 },
    label: { fontSize: 13, fontWeight: "600", color: dark ? t.text : "#374151", marginBottom: 6 },
    input: {
      borderWidth: 1.5, borderColor: dark ? t.border : "#E5E7EB", borderRadius: 8,
      padding: 11, fontSize: 14, color: dark ? t.text : "#111827", backgroundColor: dark ? t.backgroundSecondary : "#F9FAFB",
    },
  });
}

export default function MeetingDetailModal({ visible, activityType, onSubmit, onCancel, onGoingHome }: Props) {
  const insets = useSafeAreaInsets();
  const { theme, isDark } = useTheme();
  const f = useFieldStyles();
  const s = useMemo(() => createStyles(theme, isDark), [theme, isDark]);
  const accent = isDark ? "#E2A6E2" : "#60045d";
  const muted = isDark ? theme.textSecondary : "#6B7280";
  const faint = isDark ? theme.textSecondary : "#9CA3AF";
  const [step, setStep] = useState<Step>(activityType ? "pick" : "activity");
  const [selectedActivity, setSelectedActivity] = useState<string>(activityType || "");
  const [sitePickerVisible, setSitePickerVisible] = useState(false);
  const [sitePickerVisitType, setSitePickerVisitType] = useState<"site" | "meeting">("site");

  // Offices from backend
  const [offices, setOffices] = useState<{ id: string; name: string }[]>([]);
  const [selectedOffice, setSelectedOffice] = useState("");
  const [officeNotes, setOfficeNotes] = useState("");
  const [officeLoading, setOfficeLoading] = useState(false);

  // Only reset when modal truly opens for the first time (not when sitepicker
  // temporarily hides the main modal — that would wipe pendingSiteResult + step)
  const [wasVisible, setWasVisible] = useState(false);
  const submitInFlightRef = useRef(false);
  const idempotencyKeyRef = useRef<string | null>(null);
  useEffect(() => {
    if (visible && !wasVisible) {
      setWasVisible(true);
      submitInFlightRef.current = false;
      idempotencyKeyRef.current = Crypto.randomUUID();
      // Fresh open — reset everything
      setStep(activityType === "office" ? "office" : "activity");
      setSelectedActivity(activityType || "");
      setSelectedOffice(""); setOfficeNotes("");
      setPendingSiteResult(null);
      if (activityType === "site" || activityType === "meeting") {
        setSitePickerVisitType(activityType);
        setSitePickerVisible(true);
      }
    }
    // Track the OUTER visible prop, not mainModalVisible, so the sitepicker
    // toggling mainModalVisible doesn't trigger a spurious reset.
    if (!sitePickerVisible) setWasVisible(visible);
  }, [visible, sitePickerVisible, activityType, wasVisible]);

  const [pendingSiteResult, setPendingSiteResult] = useState<SitePickerResult | null>(null);

  // Load offices when office step is shown
  useEffect(() => {
    if (step === "office" && offices.length === 0) {
      setOfficeLoading(true);
      OfficeService.getAllOffices()
        .then((data) => setOffices((data || []).map((o: any) => ({ id: o.id, name: o.name }))))
        .catch((error) => console.warn("Unable to load offices", error))
        .finally(() => setOfficeLoading(false));
    }
  }, [step, offices.length]);

  // Client form state
  const [clientName, setClientName] = useState("");
  const [clientPhone, setClientPhone] = useState("");
  const [clientEmail, setClientEmail] = useState("");
  const [clientHouseNo, setClientHouseNo] = useState("");
  const [clientStreet, setClientStreet] = useState("");
  const [clientLocality, setClientLocality] = useState("");
  const [clientCity, setClientCity] = useState("");
  const [clientState, setClientState] = useState("");
  const [clientPincode, setClientPincode] = useState("");
  const [clientProject, setClientProject] = useState("");
  const [clientNotes, setClientNotes] = useState("");

  // Meeting location address carried forward from the location step (editable).
  const [meetingAddress, setMeetingAddress] = useState("");

  // CP form state
  const [cpName, setCpName] = useState("");
  const [cpPhone, setCpPhone] = useState("");
  const [cpEmail, setCpEmail] = useState("");
  const [cpCompany, setCpCompany] = useState("");
  const [cpHouseNo, setCpHouseNo] = useState("");
  const [cpStreet, setCpStreet] = useState("");
  const [cpLocality, setCpLocality] = useState("");
  const [cpCity, setCpCity] = useState("");
  const [cpState, setCpState] = useState("");
  const [cpPincode, setCpPincode] = useState("");
  const [cpProject, setCpProject] = useState("");
  const [cpNotes, setCpNotes] = useState("");

  const [loading, setLoading] = useState(false);

  const reset = () => {
    setStep(activityType ? "pick" : "activity");
    setSelectedActivity(activityType || "");
    setSelectedOffice(""); setOfficeNotes("");
    setClientName(""); setClientPhone(""); setClientEmail("");
    setClientHouseNo(""); setClientStreet(""); setClientLocality(""); setClientCity(""); setClientState(""); setClientPincode("");
    setClientProject(""); setClientNotes("");
    setCpName(""); setCpPhone(""); setCpEmail(""); setCpCompany("");
    setCpHouseNo(""); setCpStreet(""); setCpLocality(""); setCpCity(""); setCpState(""); setCpPincode("");
    setCpProject(""); setCpNotes("");
    setMeetingAddress("");
  };

  const handleCancel = () => { reset(); onCancel(); };

  // Ignores a second tap while a submit is in flight; one key per modal open.
  const claimSubmit = (): string | null => {
    if (submitInFlightRef.current) return null;
    submitInFlightRef.current = true;
    const key = idempotencyKeyRef.current ?? Crypto.randomUUID();
    idempotencyKeyRef.current = null;
    return key;
  };

  const handleActivityPick = (value: string) => {
    if (value === "home") { reset(); onGoingHome?.(); return; }
    setSelectedActivity(value);
    if (value === "office") {
      setStep("office");
    } else if (value === "site") {
      setSitePickerVisitType("site");
      setSitePickerVisible(true);
    } else if (value === "meeting") {
      setSitePickerVisitType("meeting");
      setSitePickerVisible(true);
    } else if (value === "others") {
      setSitePickerVisitType("site");
      setSitePickerVisible(true);
    } else {
      const idempotencyKey = claimSubmit();
      if (!idempotencyKey) return;
      onSubmit({ meetingType: "client", clientName: "Others", clientPhone: "", clientEmail: "", clientAddress: "", projectName: "", source: "", notes: "", activityType: value, idempotencyKey });
      reset();
    }
  };

  // Called when SitePickerModal confirms a location
  const handleSitePickerConfirm = (result: SitePickerResult) => {
    setSitePickerVisible(false);
    if (selectedActivity === "site" || selectedActivity === "others") {
      // Site visit / Other — no contact details needed, submit directly
      const idempotencyKey = claimSubmit();
      if (!idempotencyKey) return;
      onSubmit({
        idempotencyKey,
        meetingType: "client",
        clientName: result.locationName,
        clientPhone: "",
        clientEmail: "",
        clientAddress: result.locationAddress || "",
        projectName: result.projectName || "",
        source: "",
        notes: result.notes,
        activityType: selectedActivity,
        predefinedSiteId: result.predefinedSite?.id,
        destinationCoords: result.destinationCoords,
        checkinRadiusM: result.checkinRadiusM,
        googlePlaceId: result.googlePlaceId,
        locationSource: result.locationSource,
      });
      reset();
    } else {
      // Meeting — store site result in state, then collect contact details.
      // Carry forward what the user already entered on the location step
      // (project, notes, location) so the contact form doesn't ask again.
      // Values stay editable in the contact form.
      setPendingSiteResult(result);
      const project = (result.projectName || "").trim();
      const notes = (result.notes || "").trim();
      if (project) { setClientProject(project); setCpProject(project); }
      if (notes) { setClientNotes(notes); setCpNotes(notes); }
      setMeetingAddress((result.locationAddress || result.locationName || "").trim());
      // When the user is only changing the location from the contact form, stay there.
      if (step !== "client" && step !== "cp") setStep("pick");
    }
  };

  // Re-open the location picker from the contact form to change the meeting location.
  const handleChangeMeetingLocation = () => {
    setSitePickerVisitType("meeting");
    setSitePickerVisible(true);
  };

  const handleSitePickerCancel = () => {
    setSitePickerVisible(false);
    // Cancelling a location *change* keeps the existing meeting flow intact.
    if (pendingSiteResult && (step === "client" || step === "cp")) return;
    setSelectedActivity("");
  };

  const resolveMeetingAddress = (manual: string) =>
    pendingSiteResult
      ? meetingAddress.trim() || pendingSiteResult.locationAddress || pendingSiteResult.locationName || ""
      : manual;

  const handleSubmitOffice = () => {
    if (!selectedOffice) { Alert.alert("Required", "Please select an office."); return; }
    const idempotencyKey = claimSubmit();
    if (!idempotencyKey) return;
    onSubmit({
      idempotencyKey,
      meetingType: "client",
      clientName: selectedOffice,
      clientPhone: "", clientEmail: "", clientAddress: "", projectName: "", source: "",
      notes: officeNotes.trim(),
      activityType: "office",
    });
    reset();
  };

  const buildAddress = (houseNo: string, street: string, locality: string, city: string, state: string, pincode: string) =>
    [houseNo, street, locality, city, state, pincode].filter(Boolean).join(", ");

  const handleSubmitClient = () => {
    if (!clientName.trim()) { Alert.alert("Required", "Client name is required."); return; }
    if (!clientPhone.trim()) { Alert.alert("Required", "Client phone is required."); return; }
    if (!clientProject.trim()) { Alert.alert("Required", "Project name is required."); return; }
    const idempotencyKey = claimSubmit();
    if (!idempotencyKey) return;
    setLoading(true);
    setTimeout(() => {
      setLoading(false);
      onSubmit({
        idempotencyKey,
        meetingType: "client",
        clientName: clientName.trim(),
        clientPhone: clientPhone.trim(),
        clientEmail: clientEmail.trim(),
        clientAddress: resolveMeetingAddress(
          buildAddress(clientHouseNo, clientStreet, clientLocality, clientCity, clientState, clientPincode)),
        projectName: clientProject.trim() || pendingSiteResult?.projectName || "",
        // Lead source is not collected in this flow (column is optional server-side).
        source: "",
        notes: clientNotes.trim(), // pre-filled from the location step; user may edit/clear
        activityType: selectedActivity,
        predefinedSiteId: pendingSiteResult?.predefinedSite?.id,
        destinationCoords: pendingSiteResult?.destinationCoords,
        checkinRadiusM: pendingSiteResult?.checkinRadiusM,
        googlePlaceId: pendingSiteResult?.googlePlaceId,
        locationSource: pendingSiteResult?.locationSource,
      });
      reset();
    }, 100);
  };

  const handleSubmitCP = () => {
    if (!cpName.trim()) { Alert.alert("Required", "Contact name is required."); return; }
    if (!cpPhone.trim()) { Alert.alert("Required", "Phone number is required."); return; }
    if (!cpCompany.trim()) { Alert.alert("Required", "Company name is required."); return; }
    const idempotencyKey = claimSubmit();
    if (!idempotencyKey) return;
    setLoading(true);
    setTimeout(() => {
      setLoading(false);
      onSubmit({
        idempotencyKey,
        meetingType: "channel_partner",
        cpName: cpName.trim(),
        cpPhone: cpPhone.trim(),
        cpEmail: cpEmail.trim(),
        cpCompany: cpCompany.trim(),
        cpAddress: resolveMeetingAddress(
          buildAddress(cpHouseNo, cpStreet, cpLocality, cpCity, cpState, cpPincode)),
        projectName: cpProject.trim() || pendingSiteResult?.projectName || "",
        source: "",
        notes: cpNotes.trim(),
        activityType: selectedActivity,
        predefinedSiteId: pendingSiteResult?.predefinedSite?.id,
        destinationCoords: pendingSiteResult?.destinationCoords,
        checkinRadiusM: pendingSiteResult?.checkinRadiusM,
        googlePlaceId: pendingSiteResult?.googlePlaceId,
        locationSource: pendingSiteResult?.locationSource,
      });
      reset();
    }, 100);
  };

  const titleMap: Record<Step, string> = {
    activity: "Where are you going?",
    office: "🏢 Select Office",
    sitepicker: "📍 Select Location",
    pick: "Who is this with?",
    client: "🤝 Client Details",
    cp: "🏘️ Channel Partner Details",
  };

  const showBack = step !== "activity" && !activityType;
  const backStep = (): Step => {
    if (step === "office") return "activity";
    if (step === "pick") return "activity";
    if (step === "cp" || step === "client") return "pick";
    return "activity";
  };

  // Main modal should be hidden while site picker is open so it doesn't sit on top
  const mainModalVisible = visible && !sitePickerVisible;

  // Location chosen on the previous step, shown pre-filled (address editable,
  // coordinates/geofence kept from the picker so nothing is re-geocoded).
  const renderSelectedLocation = () => {
    if (!pendingSiteResult) return null;
    const coords = pendingSiteResult.destinationCoords;
    return (
      <View style={f.wrap}>
        <ThemedText style={f.label}>Meeting Location</ThemedText>
        <View style={s.locCard}>
          <Feather name="map-pin" size={16} color={accent} style={{ marginTop: 2 }} />
          <View style={{ flex: 1 }}>
            <ThemedText style={s.locName} numberOfLines={2}>{pendingSiteResult.locationName}</ThemedText>
            {coords ? (
              <ThemedText style={s.locMeta}>
                {coords.latitude.toFixed(5)}, {coords.longitude.toFixed(5)} · {pendingSiteResult.checkinRadiusM} m radius
              </ThemedText>
            ) : null}
          </View>
          <TouchableOpacity onPress={handleChangeMeetingLocation} style={s.locChangeBtn}>
            <ThemedText style={s.locChangeText}>Change</ThemedText>
          </TouchableOpacity>
        </View>
        <TextInput
          style={[f.input, { marginTop: 8 }]}
          value={meetingAddress}
          onChangeText={setMeetingAddress}
          placeholder="Address"
          placeholderTextColor={faint}
          maxLength={255}
        />
      </View>
    );
  };

  return (
    <>
    <Modal visible={mainModalVisible} animationType="slide" transparent presentationStyle="overFullScreen">
      <KeyboardAvoidingView style={s.overlay} behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <View style={[s.sheet, { paddingBottom: Math.max(insets.bottom, 16) }]}>
          {/* Header */}
          <View style={s.header}>
            <View style={s.handle} />
            <View style={s.headerRow}>
              {showBack ? (
                <TouchableOpacity onPress={() => setStep(backStep())} style={s.backBtn}>
                  <Feather name="arrow-left" size={14} color={accent} />
                  <ThemedText style={s.backBtnText}>Back</ThemedText>
                </TouchableOpacity>
              ) : <View style={{ width: 60 }} />}
              <ThemedText style={s.title}>{titleMap[step]}</ThemedText>
              <TouchableOpacity onPress={handleCancel} style={s.closeBtn}>
                <Feather name="x" size={20} color={muted} />
              </TouchableOpacity>
            </View>
          </View>

          <ScrollView style={s.body} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">

            {/* ── Step 1: Activity type ── */}
            {step === "activity" && (
              <View style={s.pickContainer}>
                {ACTIVITY_OPTIONS.map((opt) => {
                  const optColor = isDark ? opt.darkColor : opt.color;
                  return (
                  <TouchableOpacity
                    key={opt.value}
                    style={[s.pickCard, { backgroundColor: isDark ? optColor + "1A" : opt.bg, borderColor: optColor + "50" }]}
                    onPress={() => handleActivityPick(opt.value)}
                  >
                    <View style={[s.pickIcon, { backgroundColor: optColor + (isDark ? "26" : "20") }]}>
                      <ThemedText style={s.pickIconText}>{opt.icon}</ThemedText>
                    </View>
                    <View style={s.pickCardText}>
                      <ThemedText style={[s.pickCardTitle, { color: optColor }]}>{opt.label}</ThemedText>
                      <ThemedText style={s.pickCardSub}>{opt.sub}</ThemedText>
                    </View>
                    <Feather name="chevron-right" size={18} color={optColor} />
                  </TouchableOpacity>
                  );
                })}
                {/* Going Home */}
                {onGoingHome && (
                  <TouchableOpacity
                    style={[s.pickCard, { backgroundColor: isDark ? "#34D3991A" : "#F0FDF4", borderColor: isDark ? "#34D39950" : "#10B98150" }]}
                    onPress={() => { reset(); onGoingHome(); }}
                  >
                    <View style={[s.pickIcon, { backgroundColor: isDark ? "#34D39926" : "#DCFCE7" }]}>
                      <ThemedText style={s.pickIconText}>🏠</ThemedText>
                    </View>
                    <View style={s.pickCardText}>
                      <ThemedText style={[s.pickCardTitle, { color: isDark ? "#34D399" : "#16A34A" }]}>Going Home</ThemedText>
                      <ThemedText style={s.pickCardSub}>Done for the day — complete attendance</ThemedText>
                    </View>
                    <Feather name="chevron-right" size={18} color={isDark ? "#34D399" : "#10B981"} />
                  </TouchableOpacity>
                )}
              </View>
            )}

            {/* ── Step 2: Office selector ── */}
            {step === "office" && (
              <View style={s.formContainer}>
                <ThemedText style={[f.label, { marginBottom: 10 }]}>Select Office *</ThemedText>
                {officeLoading ? (
                  <ActivityIndicator color={accent} style={{ marginVertical: 20 }} />
                ) : offices.length === 0 ? (
                  <ThemedText style={{ color: faint, fontSize: 13, textAlign: "center", marginVertical: 16 }}>No offices found</ThemedText>
                ) : (
                  <View style={{ gap: 8, marginBottom: 16 }}>
                    {offices.map((office) => {
                      const selected = selectedOffice === office.name;
                      return (
                        <TouchableOpacity
                          key={office.id}
                          style={[s.officeOption, selected && s.officeOptionSelected]}
                          onPress={() => setSelectedOffice(office.name)}
                        >
                          <ThemedText style={s.officeOptionIcon}>🏢</ThemedText>
                          <ThemedText style={[s.officeOptionText, selected && s.officeOptionTextSelected]}>{office.name}</ThemedText>
                          {selected && <Feather name="check-circle" size={18} color={accent} />}
                        </TouchableOpacity>
                      );
                    })}
                  </View>
                )}
                <View style={f.wrap}>
                  <ThemedText style={f.label}>Notes (optional)</ThemedText>
                  <TextInput
                    style={[f.input, { height: 90, textAlignVertical: "top" }]}
                    value={officeNotes}
                    onChangeText={setOfficeNotes}
                    placeholder="What are you working on at the office?"
                    placeholderTextColor={faint}
                    multiline
                    maxLength={500}
                  />
                </View>
                <TouchableOpacity style={s.submitBtn} onPress={handleSubmitOffice}>
                  <ThemedText style={s.submitBtnText}>Confirm Office ✓</ThemedText>
                </TouchableOpacity>
              </View>
            )}

            {/* ── Step 3: Client or CP picker ── */}
            {step === "pick" && (
              <View style={s.pickContainer}>
                <TouchableOpacity style={s.pickCard} onPress={() => setStep("client")}>
                  <View style={[s.pickIcon, { backgroundColor: isDark ? "#7DB3FF26" : "#EFF6FF" }]}>
                    <ThemedText style={s.pickIconText}>👤</ThemedText>
                  </View>
                  <View style={s.pickCardText}>
                    <ThemedText style={s.pickCardTitle}>Client</ThemedText>
                    <ThemedText style={s.pickCardSub}>Direct buyer, investor or prospect</ThemedText>
                  </View>
                  <Feather name="chevron-right" size={18} color={faint} />
                </TouchableOpacity>

                <TouchableOpacity style={s.pickCard} onPress={() => setStep("cp")}>
                  <View style={[s.pickIcon, { backgroundColor: isDark ? "#B9A2FF26" : "#F5F3FF" }]}>
                    <ThemedText style={s.pickIconText}>🏘️</ThemedText>
                  </View>
                  <View style={s.pickCardText}>
                    <ThemedText style={s.pickCardTitle}>Channel Partner</ThemedText>
                    <ThemedText style={s.pickCardSub}>Broker, dealer or referral partner</ThemedText>
                  </View>
                  <Feather name="chevron-right" size={18} color={faint} />
                </TouchableOpacity>
              </View>
            )}

            {/* ── Step 3a: Client form ── */}
            {step === "client" && (
              <View style={s.formContainer}>
                <Field label="Client Name" value={clientName} onChange={setClientName} placeholder="Full name" required />
                <Field label="Phone Number" value={clientPhone} onChange={setClientPhone} placeholder="+91 XXXXX XXXXX" keyboardType="phone-pad" required />
                <Field label="Email Address" value={clientEmail} onChange={setClientEmail} placeholder="client@email.com" keyboardType="email-address" />
                {pendingSiteResult ? renderSelectedLocation() : (
                  <>
                    <ThemedText style={[f.label, { marginBottom: 4, marginTop: 4 }]}>Meeting Location / Address</ThemedText>
                    <View style={s.addrGrid}>
                      <View style={s.addrHalf}><Field label="House / Flat No." value={clientHouseNo} onChange={setClientHouseNo} placeholder="e.g. 12B" /></View>
                      <View style={s.addrHalf}><Field label="Building Name" value={clientStreet} onChange={setClientStreet} placeholder="e.g. Sunrise Apts" /></View>
                    </View>
                    <Field label="Street / Road" value={clientLocality} onChange={setClientLocality} placeholder="e.g. MG Road" />
                    <Field label="Locality / Area" value={clientCity} onChange={setClientCity} placeholder="e.g. Bandra West" />
                    <View style={s.addrGrid}>
                      <View style={s.addrHalf}><Field label="City" value={clientState} onChange={setClientState} placeholder="e.g. Mumbai" /></View>
                      <View style={s.addrHalf}><Field label="State" value={clientPincode} onChange={setClientPincode} placeholder="e.g. Maharashtra" /></View>
                    </View>
                  </>
                )}
                <Field label="Project Name" value={clientProject} onChange={setClientProject} placeholder="Which project discussed?" required />
                <View style={f.wrap}>
                  <ThemedText style={f.label}>Meeting Notes</ThemedText>
                  <TextInput
                    style={[f.input, { height: 90, textAlignVertical: "top" }]}
                    value={clientNotes}
                    onChangeText={setClientNotes}
                    placeholder="Purpose, outcome, next steps..."
                    placeholderTextColor={faint}
                    multiline
                    maxLength={1000}
                  />
                </View>
                <TouchableOpacity style={[s.submitBtn, loading && { opacity: 0.7 }]} onPress={handleSubmitClient} disabled={loading}>
                  {loading ? <ActivityIndicator color="#fff" size="small" /> : <ThemedText style={s.submitBtnText}>Save Client Meeting ✓</ThemedText>}
                </TouchableOpacity>
              </View>
            )}

            {/* ── Step 3b: Channel Partner form ── */}
            {step === "cp" && (
              <View style={s.formContainer}>
                <Field label="Contact Name" value={cpName} onChange={setCpName} placeholder="Partner's name" required />
                <Field label="Phone Number" value={cpPhone} onChange={setCpPhone} placeholder="+91 XXXXX XXXXX" keyboardType="phone-pad" required />
                <Field label="Email Address" value={cpEmail} onChange={setCpEmail} placeholder="partner@company.com" keyboardType="email-address" />
                <Field label="Company Name" value={cpCompany} onChange={setCpCompany} placeholder="Brokerage or agency name" required />
                {pendingSiteResult ? renderSelectedLocation() : (
                  <>
                    <ThemedText style={[f.label, { marginBottom: 4, marginTop: 4 }]}>Meeting Location / Address</ThemedText>
                    <View style={s.addrGrid}>
                      <View style={s.addrHalf}><Field label="House / Flat No." value={cpHouseNo} onChange={setCpHouseNo} placeholder="e.g. 12B" /></View>
                      <View style={s.addrHalf}><Field label="Building Name" value={cpStreet} onChange={setCpStreet} placeholder="e.g. Sunrise Apts" /></View>
                    </View>
                    <Field label="Street / Road" value={cpLocality} onChange={setCpLocality} placeholder="e.g. MG Road" />
                    <Field label="Locality / Area" value={cpCity} onChange={setCpCity} placeholder="e.g. Bandra West" />
                    <View style={s.addrGrid}>
                      <View style={s.addrHalf}><Field label="City" value={cpState} onChange={setCpState} placeholder="e.g. Mumbai" /></View>
                      <View style={s.addrHalf}><Field label="State" value={cpPincode} onChange={setCpPincode} placeholder="e.g. Maharashtra" /></View>
                    </View>
                  </>
                )}
                <Field label="Project Name" value={cpProject} onChange={setCpProject} placeholder="Which project discussed?" />
                <View style={f.wrap}>
                  <ThemedText style={f.label}>Meeting Notes</ThemedText>
                  <TextInput
                    style={[f.input, { height: 90, textAlignVertical: "top" }]}
                    value={cpNotes}
                    onChangeText={setCpNotes}
                    placeholder="Purpose, outcome, next steps..."
                    placeholderTextColor={faint}
                    multiline
                    maxLength={1000}
                  />
                </View>
                <TouchableOpacity style={[s.submitBtn, { backgroundColor: "#7C3AED" }, loading && { opacity: 0.7 }]} onPress={handleSubmitCP} disabled={loading}>
                  {loading ? <ActivityIndicator color="#fff" size="small" /> : <ThemedText style={s.submitBtnText}>Save Channel Partner Meeting ✓</ThemedText>}
                </TouchableOpacity>
              </View>
            )}

            <View style={{ height: 40 }} />
          </ScrollView>
        </View>
      </KeyboardAvoidingView>
    </Modal>
    <SitePickerModal
      visible={sitePickerVisible}
      visitType={sitePickerVisitType}
      visitTypeLabel={selectedActivity === "others" ? "📌 Other Location" : undefined}
      onConfirm={handleSitePickerConfirm}
      onCancel={handleSitePickerCancel}
    />
    </>
  );
}

function createStyles(t: ThemeColors, dark: boolean) {
  return StyleSheet.create({
  overlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.55)", justifyContent: "flex-end" },
  sheet: { backgroundColor: dark ? t.backgroundDefault : "#FFFFFF", borderTopLeftRadius: 24, borderTopRightRadius: 24, maxHeight: "92%" },
  header: { padding: 20, paddingBottom: 12, borderBottomWidth: 1, borderBottomColor: dark ? t.border : "#F3F4F6" },
  handle: { width: 40, height: 4, borderRadius: 2, backgroundColor: dark ? t.border : "#E5E7EB", alignSelf: "center", marginBottom: 14 },
  headerRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  backBtn: { flexDirection: "row", alignItems: "center", gap: 4, width: 60 },
  backBtnText: { fontSize: 13, color: dark ? "#E2A6E2" : "#60045d", fontWeight: "600" },
  title: { flex: 1, fontSize: 17, fontWeight: "800", color: dark ? t.text : "#111827", textAlign: "center" },
  closeBtn: { padding: 4, width: 60, alignItems: "flex-end" },
  body: { paddingHorizontal: 20 },
  pickContainer: { paddingTop: 16, gap: 10 },
  pickCard: {
    flexDirection: "row", alignItems: "center",
    backgroundColor: dark ? t.backgroundSecondary : "#F9FAFB", borderWidth: 1.5, borderColor: dark ? t.border : "#E5E7EB",
    borderRadius: 14, padding: 16, gap: 14,
  },
  pickIcon: { width: 48, height: 48, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  pickIconText: { fontSize: 22 },
  pickCardText: { flex: 1 },
  pickCardTitle: { fontSize: 15, fontWeight: "700", color: dark ? t.text : "#111827" },
  pickCardSub: { fontSize: 12, color: dark ? t.textSecondary : "#6B7280", marginTop: 2 },
  formContainer: { paddingTop: 20 },
  addrGrid: { flexDirection: "row", gap: 10 },
  addrHalf: { flex: 1 },
  locCard: {
    flexDirection: "row", alignItems: "flex-start", gap: 10,
    padding: 12, borderRadius: 10, borderWidth: 1.5,
    borderColor: dark ? "#A838A8" : "#E9D5E8", backgroundColor: dark ? "#A838A81F" : "#F5EEF5",
  },
  locName: { fontSize: 14, fontWeight: "700", color: dark ? t.text : "#111827" },
  locMeta: { fontSize: 11, color: dark ? t.textSecondary : "#6B7280", marginTop: 2 },
  locChangeBtn: { paddingHorizontal: 6, paddingVertical: 2 },
  locChangeText: { fontSize: 13, fontWeight: "700", color: dark ? "#E2A6E2" : "#60045d" },
  officeOption: {
    flexDirection: "row", alignItems: "center", gap: 10,
    padding: 14, borderRadius: 10,
    borderWidth: 1.5, borderColor: dark ? t.border : "#E5E7EB", backgroundColor: dark ? t.backgroundSecondary : "#F9FAFB",
  },
  officeOptionSelected: { borderColor: dark ? "#A838A8" : "#60045d", backgroundColor: dark ? "#A838A82E" : "#F5EEF5" },
  officeOptionIcon: { fontSize: 18 },
  officeOptionText: { flex: 1, fontSize: 14, fontWeight: "500", color: dark ? t.text : "#374151" },
  officeOptionTextSelected: { color: dark ? "#E2A6E2" : "#60045d", fontWeight: "700" },
  submitBtn: { backgroundColor: "#60045d", borderRadius: 10, paddingVertical: 14, alignItems: "center", marginTop: 8 },
  submitBtnText: { color: "#FFFFFF", fontWeight: "700", fontSize: 15 },
  });
}
