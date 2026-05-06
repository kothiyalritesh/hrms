import React, { useState, useEffect } from "react";
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
import { Feather } from "@expo/vector-icons";
import { ThemedText } from "@/components/ThemedText";
import { BorderRadius } from "@/constants/theme";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { OfficeService } from "@/services/office.service";

export type MeetingType = "client" | "channel_partner";

export interface ClientMeetingDetails {
  meetingType: "client";
  clientName: string;
  clientPhone: string;
  clientEmail: string;
  clientAddress: string;
  projectName: string;
  notes: string;
  activityType?: string;
}

export interface ChannelPartnerDetails {
  meetingType: "channel_partner";
  cpName: string;
  cpPhone: string;
  cpEmail: string;
  cpCompany: string;
  cpAddress?: string;
  projectName: string;
  notes: string;
  activityType?: string;
}

export type MeetingDetails = ClientMeetingDetails | ChannelPartnerDetails;

// Called when user picks "Going Home"
export type GoingHomeCallback = () => void;

interface Props {
  visible: boolean;
  activityType?: "site" | "meeting"; // if provided, skip step 1
  onSubmit: (details: MeetingDetails) => void;
  onCancel: () => void;
  onGoingHome?: GoingHomeCallback; // optional — if provided, show Going Home option
}

type Step = "activity" | "pick" | "client" | "cp" | "office";

const ACTIVITY_OPTIONS = [
  { value: "office",  icon: "🏢", label: "Office",     sub: "Working from office",              color: "#60045d", bg: "#F5EEF5" },
  { value: "site",    icon: "🏗️", label: "Site Visit", sub: "Visiting a project or property",   color: "#10B981", bg: "#F0FDF4" },
  { value: "meeting", icon: "🤝", label: "Meeting",    sub: "Client or channel partner meeting", color: "#3B82F6", bg: "#EFF6FF" },
];

function Field({ label, value, onChange, placeholder, keyboardType, required }: {
  label: string; value: string; onChange: (v: string) => void;
  placeholder?: string; keyboardType?: any; required?: boolean;
}) {
  return (
    <View style={f.wrap}>
      <ThemedText style={f.label}>{label}{required ? " *" : ""}</ThemedText>
      <TextInput
        style={f.input}
        value={value}
        onChangeText={onChange}
        placeholder={placeholder || label}
        placeholderTextColor="#9CA3AF"
        keyboardType={keyboardType || "default"}
        maxLength={255}
      />
    </View>
  );
}

const f = StyleSheet.create({
  wrap: { marginBottom: 14 },
  label: { fontSize: 13, fontWeight: "600", color: "#374151", marginBottom: 6 },
  input: {
    borderWidth: 1.5, borderColor: "#E5E7EB", borderRadius: 8,
    padding: 11, fontSize: 14, color: "#111827", backgroundColor: "#F9FAFB",
  },
});

export default function MeetingDetailModal({ visible, activityType, onSubmit, onCancel, onGoingHome }: Props) {
  const insets = useSafeAreaInsets();
  const [step, setStep] = useState<Step>(activityType ? "pick" : "activity");
  const [selectedActivity, setSelectedActivity] = useState<string>(activityType || "");

  // Offices from backend
  const [offices, setOffices] = useState<{ id: string; name: string }[]>([]);
  const [selectedOffice, setSelectedOffice] = useState("");
  const [officeNotes, setOfficeNotes] = useState("");
  const [officeLoading, setOfficeLoading] = useState(false);

  useEffect(() => {
    if (visible) {
      setStep(activityType ? "pick" : "activity");
      setSelectedActivity(activityType || "");
      setSelectedOffice("");
      setOfficeNotes("");
    }
  }, [visible, activityType]);

  // Load offices when office step is shown
  useEffect(() => {
    if (step === "office" && offices.length === 0) {
      setOfficeLoading(true);
      OfficeService.getAllOffices()
        .then((data) => setOffices((data || []).map((o: any) => ({ id: o.id, name: o.name }))))
        .catch(() => {})
        .finally(() => setOfficeLoading(false));
    }
  }, [step]);

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
  };

  const handleCancel = () => { reset(); onCancel(); };

  const handleActivityPick = (value: string) => {
    if (value === "home") { reset(); onGoingHome?.(); return; }
    setSelectedActivity(value);
    if (value === "office") {
      setStep("office");
    } else if (value === "site" || value === "meeting") {
      setStep("pick");
    } else {
      onSubmit({ meetingType: "client", clientName: "Others", clientPhone: "", clientEmail: "", clientAddress: "", projectName: "", notes: "", activityType: value });
      reset();
    }
  };

  const handleSubmitOffice = () => {
    if (!selectedOffice) { Alert.alert("Required", "Please select an office."); return; }
    onSubmit({
      meetingType: "client",
      clientName: selectedOffice,
      clientPhone: "", clientEmail: "", clientAddress: "", projectName: "",
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
    setLoading(true);
    setTimeout(() => {
      setLoading(false);
      onSubmit({
        meetingType: "client",
        clientName: clientName.trim(),
        clientPhone: clientPhone.trim(),
        clientEmail: clientEmail.trim(),
        clientAddress: buildAddress(clientHouseNo, clientStreet, clientLocality, clientCity, clientState, clientPincode),
        projectName: clientProject.trim(),
        notes: clientNotes.trim(),
        activityType: selectedActivity,
      });
      reset();
    }, 100);
  };

  const handleSubmitCP = () => {
    if (!cpName.trim()) { Alert.alert("Required", "Contact name is required."); return; }
    if (!cpPhone.trim()) { Alert.alert("Required", "Phone number is required."); return; }
    if (!cpCompany.trim()) { Alert.alert("Required", "Company name is required."); return; }
    setLoading(true);
    setTimeout(() => {
      setLoading(false);
      onSubmit({
        meetingType: "channel_partner",
        cpName: cpName.trim(),
        cpPhone: cpPhone.trim(),
        cpEmail: cpEmail.trim(),
        cpCompany: cpCompany.trim(),
        cpAddress: buildAddress(cpHouseNo, cpStreet, cpLocality, cpCity, cpState, cpPincode),
        projectName: cpProject.trim(),
        notes: cpNotes.trim(),
        activityType: selectedActivity,
      });
      reset();
    }, 100);
  };

  const titleMap: Record<Step, string> = {
    activity: "Where are you going?",
    office: "🏢 Select Office",
    pick: "Who is this with?",
    client: "🤝 Client Details",
    cp: "🏘️ Channel Partner Details",
  };

  const showBack = step !== "activity" && !activityType;
  const backStep = (): Step => {
    if (step === "office") return "activity";
    if (step === "cp" || step === "client") return "pick";
    return "activity";
  };

  return (
    <Modal visible={visible} animationType="slide" transparent presentationStyle="overFullScreen">
      <KeyboardAvoidingView style={s.overlay} behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <View style={[s.sheet, { paddingBottom: Math.max(insets.bottom, 16) }]}>
          {/* Header */}
          <View style={s.header}>
            <View style={s.handle} />
            <View style={s.headerRow}>
              {showBack ? (
                <TouchableOpacity onPress={() => setStep(backStep())} style={s.backBtn}>
                  <Feather name="arrow-left" size={14} color="#60045d" />
                  <ThemedText style={s.backBtnText}>Back</ThemedText>
                </TouchableOpacity>
              ) : <View style={{ width: 60 }} />}
              <ThemedText style={s.title}>{titleMap[step]}</ThemedText>
              <TouchableOpacity onPress={handleCancel} style={s.closeBtn}>
                <Feather name="x" size={20} color="#6B7280" />
              </TouchableOpacity>
            </View>
          </View>

          <ScrollView style={s.body} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">

            {/* ── Step 1: Activity type ── */}
            {step === "activity" && (
              <View style={s.pickContainer}>
                {ACTIVITY_OPTIONS.map((opt) => (
                  <TouchableOpacity
                    key={opt.value}
                    style={[s.pickCard, { backgroundColor: opt.bg, borderColor: opt.color + "50" }]}
                    onPress={() => handleActivityPick(opt.value)}
                  >
                    <View style={[s.pickIcon, { backgroundColor: opt.color + "20" }]}>
                      <ThemedText style={s.pickIconText}>{opt.icon}</ThemedText>
                    </View>
                    <View style={s.pickCardText}>
                      <ThemedText style={[s.pickCardTitle, { color: opt.color }]}>{opt.label}</ThemedText>
                      <ThemedText style={s.pickCardSub}>{opt.sub}</ThemedText>
                    </View>
                    <Feather name="chevron-right" size={18} color={opt.color} />
                  </TouchableOpacity>
                ))}
                {/* Going Home */}
                {onGoingHome && (
                  <TouchableOpacity
                    style={[s.pickCard, { backgroundColor: "#F0FDF4", borderColor: "#10B98150" }]}
                    onPress={() => { reset(); onGoingHome(); }}
                  >
                    <View style={[s.pickIcon, { backgroundColor: "#DCFCE7" }]}>
                      <ThemedText style={s.pickIconText}>🏠</ThemedText>
                    </View>
                    <View style={s.pickCardText}>
                      <ThemedText style={[s.pickCardTitle, { color: "#16A34A" }]}>Going Home</ThemedText>
                      <ThemedText style={s.pickCardSub}>Done for the day — complete attendance</ThemedText>
                    </View>
                    <Feather name="chevron-right" size={18} color="#10B981" />
                  </TouchableOpacity>
                )}
              </View>
            )}

            {/* ── Step 2: Office selector ── */}
            {step === "office" && (
              <View style={s.formContainer}>
                <ThemedText style={[f.label, { marginBottom: 10 }]}>Select Office *</ThemedText>
                {officeLoading ? (
                  <ActivityIndicator color="#60045d" style={{ marginVertical: 20 }} />
                ) : offices.length === 0 ? (
                  <ThemedText style={{ color: "#9CA3AF", fontSize: 13, textAlign: "center", marginVertical: 16 }}>No offices found</ThemedText>
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
                          {selected && <Feather name="check-circle" size={18} color="#60045d" />}
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
                    placeholderTextColor="#9CA3AF"
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
                  <View style={[s.pickIcon, { backgroundColor: "#EFF6FF" }]}>
                    <ThemedText style={s.pickIconText}>👤</ThemedText>
                  </View>
                  <View style={s.pickCardText}>
                    <ThemedText style={s.pickCardTitle}>Client</ThemedText>
                    <ThemedText style={s.pickCardSub}>Direct buyer, investor or prospect</ThemedText>
                  </View>
                  <Feather name="chevron-right" size={18} color="#9CA3AF" />
                </TouchableOpacity>

                <TouchableOpacity style={s.pickCard} onPress={() => setStep("cp")}>
                  <View style={[s.pickIcon, { backgroundColor: "#F5F3FF" }]}>
                    <ThemedText style={s.pickIconText}>🏘️</ThemedText>
                  </View>
                  <View style={s.pickCardText}>
                    <ThemedText style={s.pickCardTitle}>Channel Partner</ThemedText>
                    <ThemedText style={s.pickCardSub}>Broker, dealer or referral partner</ThemedText>
                  </View>
                  <Feather name="chevron-right" size={18} color="#9CA3AF" />
                </TouchableOpacity>
              </View>
            )}

            {/* ── Step 3a: Client form ── */}
            {step === "client" && (
              <View style={s.formContainer}>
                <Field label="Client Name" value={clientName} onChange={setClientName} placeholder="Full name" required />
                <Field label="Phone Number" value={clientPhone} onChange={setClientPhone} placeholder="+91 XXXXX XXXXX" keyboardType="phone-pad" required />
                <Field label="Email Address" value={clientEmail} onChange={setClientEmail} placeholder="client@email.com" keyboardType="email-address" />
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
                <Field label="Project Name" value={clientProject} onChange={setClientProject} placeholder="Which project discussed?" required />
                <View style={f.wrap}>
                  <ThemedText style={f.label}>Meeting Notes</ThemedText>
                  <TextInput
                    style={[f.input, { height: 90, textAlignVertical: "top" }]}
                    value={clientNotes}
                    onChangeText={setClientNotes}
                    placeholder="Purpose, outcome, next steps..."
                    placeholderTextColor="#9CA3AF"
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
                <Field label="Project Name" value={cpProject} onChange={setCpProject} placeholder="Which project discussed?" />
                <View style={f.wrap}>
                  <ThemedText style={f.label}>Meeting Notes</ThemedText>
                  <TextInput
                    style={[f.input, { height: 90, textAlignVertical: "top" }]}
                    value={cpNotes}
                    onChangeText={setCpNotes}
                    placeholder="Purpose, outcome, next steps..."
                    placeholderTextColor="#9CA3AF"
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
  );
}

const s = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.55)", justifyContent: "flex-end" },
  sheet: { backgroundColor: "#FFFFFF", borderTopLeftRadius: 24, borderTopRightRadius: 24, maxHeight: "92%" },
  header: { padding: 20, paddingBottom: 12, borderBottomWidth: 1, borderBottomColor: "#F3F4F6" },
  handle: { width: 40, height: 4, borderRadius: 2, backgroundColor: "#E5E7EB", alignSelf: "center", marginBottom: 14 },
  headerRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  backBtn: { flexDirection: "row", alignItems: "center", gap: 4, width: 60 },
  backBtnText: { fontSize: 13, color: "#60045d", fontWeight: "600" },
  title: { flex: 1, fontSize: 17, fontWeight: "800", color: "#111827", textAlign: "center" },
  closeBtn: { padding: 4, width: 60, alignItems: "flex-end" },
  body: { paddingHorizontal: 20 },
  pickContainer: { paddingTop: 16, gap: 10 },
  pickCard: {
    flexDirection: "row", alignItems: "center",
    backgroundColor: "#F9FAFB", borderWidth: 1.5, borderColor: "#E5E7EB",
    borderRadius: 14, padding: 16, gap: 14,
  },
  pickIcon: { width: 48, height: 48, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  pickIconText: { fontSize: 22 },
  pickCardText: { flex: 1 },
  pickCardTitle: { fontSize: 15, fontWeight: "700", color: "#111827" },
  pickCardSub: { fontSize: 12, color: "#6B7280", marginTop: 2 },
  formContainer: { paddingTop: 20 },
  addrGrid: { flexDirection: "row", gap: 10 },
  addrHalf: { flex: 1 },
  officeOption: {
    flexDirection: "row", alignItems: "center", gap: 10,
    padding: 14, borderRadius: 10,
    borderWidth: 1.5, borderColor: "#E5E7EB", backgroundColor: "#F9FAFB",
  },
  officeOptionSelected: { borderColor: "#60045d", backgroundColor: "#F5EEF5" },
  officeOptionIcon: { fontSize: 18 },
  officeOptionText: { flex: 1, fontSize: 14, fontWeight: "500", color: "#374151" },
  officeOptionTextSelected: { color: "#60045d", fontWeight: "700" },
  submitBtn: { backgroundColor: "#60045d", borderRadius: 10, paddingVertical: 14, alignItems: "center", marginTop: 8 },
  submitBtnText: { color: "#FFFFFF", fontWeight: "700", fontSize: 15 },
});
