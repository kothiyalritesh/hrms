import React, { useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Image,
  KeyboardAvoidingView,
  Linking,
  Modal,
  Platform,
  ScrollView,
  StyleSheet,
  TouchableOpacity,
  View,
} from "react-native";
import Feather from "@expo/vector-icons/Feather";
import * as ImagePicker from "expo-image-picker";
import { manipulateAsync, SaveFormat } from "expo-image-manipulator";
import NetInfo from "@react-native-community/netinfo";
import { Picker } from "@react-native-picker/picker";
import { ThemedText } from "@/components/ThemedText";
import { useTheme } from "@/hooks/useTheme";
import { Colors } from "@/constants/theme";
import { FieldVisit } from "@/services/field-visit.service";
import {
  createUuid,
  CurrentLocationSubmission,
  CurrentLocationVisitService,
  EvidencePhoto,
  SubmissionResult,
  validateFreshLocation,
} from "@/services/current-location-visit.service";
import { getCurrentGPS, GPSCoords, gpsFailureMessage } from "@/utils/gps";
import { reverseGeocode } from "@/utils/reverseGeocode";
import { formatTime } from "@/utils/format";

const REASONS = [
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

// Location evidence is for visual verification, not document archiving. Keep
// only a compact JPEG so mobile uploads are quick and Storage usage stays low.
const EVIDENCE_MAX_EDGE_PX = 480;
const EVIDENCE_FALLBACK_EDGE_PX = 320;
const EVIDENCE_TARGET_BYTES = 150 * 1024;

function resizeToLongestEdge(width: number, height: number, edge: number) {
  if (Math.max(width, height) <= edge) return [];
  return width >= height
    ? [{ resize: { width: edge } }]
    : [{ resize: { height: edge } }];
}

const VERIFICATION_LABELS: Record<
  SubmissionResult["verificationStatus"],
  string
> = {
  PENDING: "Pending verification",
  APPROVED: "Approved",
  REJECTED: "Rejected",
  NEEDS_INFORMATION: "Needs information",
  FLAGGED: "Flagged for review",
};
function distanceLabel(metres: number) {
  return metres >= 1000
    ? `${(metres / 1000).toFixed(1)} km`
    : `${Math.round(metres)} metres`;
}
function distanceMetres(
  a: { latitude: number; longitude: number },
  b: { latitude: number; longitude: number },
) {
  const r = 6371000;
  const p1 = (a.latitude * Math.PI) / 180;
  const p2 = (b.latitude * Math.PI) / 180;
  const dp = ((b.latitude - a.latitude) * Math.PI) / 180;
  const dl = ((b.longitude - a.longitude) * Math.PI) / 180;
  const h =
    Math.sin(dp / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) ** 2;
  return Math.round(r * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h)));
}
function notify(title: string, message: string) {
  if (Platform.OS === "web") window.alert(`${title}\n\n${message}`);
  else Alert.alert(title, message);
}

type Props = {
  visit: FieldVisit | null;
  initialLocation: GPSCoords | null;
  onClose: () => void;
  onMatched: (location: GPSCoords) => Promise<void>;
  onSubmitted: () => void;
};

export default function CurrentLocationFallbackModal({
  visit,
  initialLocation,
  onClose,
  onMatched,
  onSubmitted,
}: Props) {
  const st = useFallbackStyles();
  const { theme, isDark } = useTheme();
  const accent = isDark ? "#E2A6E2" : "#60045d";
  const [phase, setPhase] = useState<
    "VERIFY" | "MISMATCH" | "FORM" | "SUCCESS"
  >("VERIFY");
  const [location, setLocation] = useState<GPSCoords | null>(initialLocation);
  const [address, setAddress] = useState<string | null>(null);
  const [detecting, setDetecting] = useState(false);
  const [locationError, setLocationError] = useState("");
  const [reason, setReason] = useState("");
  const [photo, setPhoto] = useState<EvidencePhoto | null>(null);
  const [processingPhoto, setProcessingPhoto] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<SubmissionResult | null>(null);
  const [idempotencyKey, setIdempotencyKey] = useState(createUuid());

  const site = useMemo(
    () =>
      visit
        ? {
            latitude: visit.destination_coords?.latitude,
            longitude: visit.destination_coords?.longitude,
            radius: visit.checkin_radius_m ?? 100,
          }
        : null,
    [visit],
  );
  const distance =
    site?.latitude != null && site.longitude != null && location
      ? distanceMetres(
          { latitude: site.latitude, longitude: site.longitude },
          location,
        )
      : null;
  const quality = location
    ? validateFreshLocation(location)
    : { valid: false, reason: "A fresh GPS reading is required." };
  const formValid = Boolean(reason);
  const canSubmit = formValid && !processingPhoto && !submitting;

  useEffect(() => {
    if (!visit) return;
    setPhase("VERIFY");
    setLocation(initialLocation);
    setAddress(null);
    setLocationError("");
    setReason("");
    setPhoto(null);
    setProcessingPhoto(false);
    setResult(null);
    setIdempotencyKey(createUuid());
    if (initialLocation && site?.latitude != null && site.longitude != null) {
      setPhase(
        distanceMetres(
          { latitude: site.latitude, longitude: site.longitude },
          initialLocation,
        ) <= site.radius
          ? "VERIFY"
          : "MISMATCH",
      );
    }
  }, [visit, initialLocation, site?.latitude, site?.longitude, site?.radius]);

  if (!visit || site?.latitude == null || site.longitude == null) return null;

  const capture = async (forForm: boolean) => {
    setDetecting(true);
    setLocationError("");
    try {
      const fresh = await getCurrentGPS();
      if (!fresh) {
        setLocation(null);
        setLocationError(
          gpsFailureMessage(),
        );
        return;
      }
      setLocation(fresh);
      const nextDistance = distanceMetres(
        { latitude: site.latitude!, longitude: site.longitude! },
        fresh,
      );
      if (forForm) {
        setAddress(await reverseGeocode(fresh.latitude, fresh.longitude));
        setPhase("FORM");
      } else setPhase(nextDistance <= site.radius ? "VERIFY" : "MISMATCH");
    } finally {
      setDetecting(false);
    }
  };

  const pickPhoto = async (source: "CAMERA" | "GALLERY") => {
    const permission =
      source === "CAMERA"
        ? await ImagePicker.requestCameraPermissionsAsync()
        : await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      notify(
        "Photo permission was not granted",
        "Grant photo permission if you want to add optional evidence.",
      );
      return;
    }
    const picker =
      source === "CAMERA"
        ? ImagePicker.launchCameraAsync
        : ImagePicker.launchImageLibraryAsync;
    const selected = await picker({
      mediaTypes: ["images"],
      quality: 0.5,
      allowsEditing: true,
    });
    if (selected.canceled || !selected.assets[0]) return;
    const asset = selected.assets[0];
    const mimeType = asset.mimeType || "image/jpeg";
    if (!["image/jpeg", "image/png"].includes(mimeType)) {
      notify("Unsupported photo", "Choose a JPEG or PNG image.");
      return;
    }
    setProcessingPhoto(true);
    try {
      // Always discard the original resolution and metadata before upload.
      // A second pass handles unusually detailed images below the target size.
      let processed = await manipulateAsync(
        asset.uri,
        resizeToLongestEdge(asset.width, asset.height, EVIDENCE_MAX_EDGE_PX),
        { compress: 0.22, format: SaveFormat.JPEG },
      );
      let processedBlob = await (await fetch(processed.uri)).blob();
      if (processedBlob.size > EVIDENCE_TARGET_BYTES) {
        processed = await manipulateAsync(
          processed.uri,
          resizeToLongestEdge(
            processed.width,
            processed.height,
            EVIDENCE_FALLBACK_EDGE_PX,
          ),
          { compress: 0.15, format: SaveFormat.JPEG },
        );
        processedBlob = await (await fetch(processed.uri)).blob();
      }
      if (processedBlob.size > EVIDENCE_TARGET_BYTES) {
        processed = await manipulateAsync(
          processed.uri,
          [],
          { compress: 0.1, format: SaveFormat.JPEG },
        );
        processedBlob = await (await fetch(processed.uri)).blob();
      }
      setPhoto({
        uri: processed.uri,
        mimeType: "image/jpeg",
        fileSize: processedBlob.size,
        source,
      });
    } catch (error) {
      console.error("[CurrentLocation] Photo compression failed:", error);
      notify(
        "Unable to prepare photo",
        "Please choose the photo again or capture a new one.",
      );
    } finally {
      setProcessingPhoto(false);
    }
  };

  const submit = async () => {
    if (!reason || processingPhoto || submitting) return;
    setSubmitting(true);
    let payload: CurrentLocationSubmission | null = null;
    try {
      const freshLocation = await getCurrentGPS();
      if (!freshLocation) {
        throw new Error(
          gpsFailureMessage(),
        );
      }
      const freshQuality = validateFreshLocation(freshLocation);
      if (!freshQuality.valid) throw new Error(freshQuality.reason);
      const freshDistance = distanceMetres(
        { latitude: site.latitude!, longitude: site.longitude! },
        freshLocation,
      );
      if (freshDistance <= site.radius) {
        await onMatched(freshLocation);
        onClose();
        return;
      }
      const freshAddress =
        (await reverseGeocode(
          freshLocation.latitude,
          freshLocation.longitude,
        )) || address;
      setLocation(freshLocation);
      setAddress(freshAddress);
      payload = {
        // Current-location evidence is committed on the existing field-visit
        // row, so this is the one authoritative visit identity end-to-end.
        visitId: visit.id,
        sourceVisitId: visit.id,
        selectedSiteId: visit.predefined_site_id ?? null,
        location: freshLocation,
        address: freshAddress,
        locationName: freshAddress?.trim() || "Current GPS location",
        visitPurpose: reason,
        expectedDurationMinutes: 60,
        mismatchReason: reason,
        mismatchExplanation: reason,
        declarationAt: new Date().toISOString(),
        idempotencyKey,
        photo,
      };
      const network = await NetInfo.fetch();
      if (
        network.isConnected === false ||
        network.isInternetReachable === false
      ) {
        if (Platform.OS === "web") {
          notify(
            "Internet connection required",
            "For your privacy, the web app does not keep GPS, client details, or photos for offline upload. Nothing was saved; reconnect and submit again.",
          );
          return;
        }
        await CurrentLocationVisitService.enqueue({
          ...payload,
          capturedOffline: true,
        });
        notify(
          "Waiting to upload",
          "Your location has been saved on this device and will be submitted when an internet connection becomes available.",
        );
        onClose();
        return;
      }
      const submitted = await CurrentLocationVisitService.submit(payload);
      setResult(submitted);
      setPhase("SUCCESS");
      onSubmitted();
    } catch (error: any) {
      const message = String(error?.message || "Submission failed.");
      if (
        payload &&
        /fetch|network|offline|failed to connect|failed to send a request/i.test(
          message,
        )
      ) {
        if (Platform.OS === "web") {
          notify(
            "Submission not saved",
            "The connection failed. For your privacy, the web app did not retain this evidence. Reconnect and submit again.",
          );
        } else {
          try {
            await CurrentLocationVisitService.enqueue({
              ...payload,
              capturedOffline: true,
            });
            notify(
              "Waiting to upload",
              "Your location has been saved securely on this device and will be submitted when an internet connection becomes available.",
            );
            onClose();
          } catch (queueError: any) {
            notify(
              "Submission not saved",
              String(
                queueError?.message ||
                  "The offline queue could not be secured. Reconnect and submit again.",
              ),
            );
          }
        }
      } else if (/storage|photo|bucket|mime|upload|object/i.test(message)) {
        notify(
          "Optional photo upload failed",
          "Remove the optional photo and submit again, or retry the upload.",
        );
      } else notify("Unable to submit", message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal
      visible
      animationType="slide"
      presentationStyle="fullScreen"
      onRequestClose={onClose}
    >
      <KeyboardAvoidingView
        style={st.root}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <View style={st.header}>
          <TouchableOpacity onPress={onClose} accessibilityLabel="Close">
            <Feather name="x" size={22} color={isDark ? theme.text : "#374151"} />
          </TouchableOpacity>
          <ThemedText style={st.title}>
            {phase === "FORM"
              ? "Mark My Current Location"
              : phase === "SUCCESS"
                ? "Current Location Submitted"
                : "Location Verification"}
          </ThemedText>
          <View style={{ width: 22 }} />
        </View>
        <ScrollView
          contentContainerStyle={st.content}
          keyboardShouldPersistTaps="handled"
        >
          {detecting && (
            <View style={st.center}>
              <ActivityIndicator color={accent} />
              <ThemedText style={st.heading}>
                Verifying your location…
              </ThemedText>
              <ThemedText style={st.muted}>
                Please wait while we compare your current location with the
                selected site.
              </ThemedText>
            </View>
          )}
          {!detecting && locationError ? (
            <MessageCard
              color="#DC2626"
              title="Unable to verify your location"
              text={locationError}
            >
              <Action
                label="Try Again"
                onPress={() => capture(phase === "FORM")}
              />
            </MessageCard>
          ) : null}

          {!detecting &&
            !locationError &&
            phase === "VERIFY" &&
            location &&
            distance != null &&
            (quality.valid ? (
              <MessageCard
                color="#059669"
                title="Location Verified"
                text={`Selected site: ${visit.location_name}\nDistance from site: ${distanceLabel(distance)}\nAllowed radius: ${site.radius} metres\n\nYou are within the permitted site area.`}
              >
                <Action
                  label="Continue"
                  onPress={async () => {
                    setSubmitting(true);
                    try {
                      await onMatched(location);
                      onClose();
                    } catch (error: any) {
                      notify(
                        "Unable to verify your location",
                        error?.message ||
                          "The server could not verify this GPS reading. Try again.",
                      );
                      await capture(false);
                    } finally {
                      setSubmitting(false);
                    }
                  }}
                  loading={submitting}
                />
              </MessageCard>
            ) : (
              <MessageCard
                color="#DC2626"
                title="Location accuracy is too low"
                text={`${quality.reason}\n\nMove to an open area, enable precise location, and try again.`}
              >
                <Action label="Try Again" onPress={() => capture(false)} />
              </MessageCard>
            ))}
          {!detecting &&
            phase === "MISMATCH" &&
            location &&
            distance != null &&
            (quality.valid ? (
              <MessageCard
                color="#DC2626"
                title="You are far from this location"
                text={`Selected site: ${visit.location_name}\nYour distance from the site: ${distanceLabel(distance)}\nAllowed radius: ${site.radius} metres\nGPS accuracy: ±${Math.round(location.accuracy ?? 999)} metres\n\nYour current GPS location does not match the selected site. If you are performing official work elsewhere, you can mark your actual current location.`}
              >
                <View style={st.actionRow}>
                  <Action
                    label="Try Again"
                    secondary
                    onPress={() => capture(false)}
                  />
                  <Action
                    label="Mark My Current Location"
                    onPress={() => capture(true)}
                  />
                </View>
              </MessageCard>
            ) : (
              <MessageCard
                color="#DC2626"
                title="Location accuracy is too low"
                text={`${quality.reason}\n\nMove to an open area, enable precise location, and try again.`}
              >
                <Action label="Try Again" onPress={() => capture(false)} />
              </MessageCard>
            ))}

          {!detecting && phase === "FORM" && location && distance != null && (
            <>
              <ThemedText style={st.intro}>
                Your current GPS location will be submitted for verification.
              </ThemedText>
              <Card title="LOCATION-MISMATCH REASON">
                <ThemedText style={st.label}>
                  Reason for location mismatch*
                </ThemedText>
                <Picker
                  selectedValue={reason}
                  onValueChange={setReason}
                  style={st.picker}
                  dropdownIconColor={isDark ? theme.text : undefined}
                >
                  <Picker.Item label="Select a reason" value="" />
                  {REASONS.map((item) => (
                    <Picker.Item key={item} label={item} value={item} />
                  ))}
                </Picker>
              </Card>
              <Card title="PHOTO EVIDENCE — OPTIONAL">
                <ThemedText style={st.muted}>
                  You may add a photo to support this location mismatch.
                </ThemedText>
                {processingPhoto ? (
                  <View
                    style={{
                      alignItems: "center",
                      paddingVertical: 18,
                      gap: 8,
                    }}
                  >
                    <ActivityIndicator color={accent} />
                    <ThemedText style={st.muted}>Compressing photo…</ThemedText>
                  </View>
                ) : photo ? (
                  <>
                    <Image source={{ uri: photo.uri }} style={st.photo} />
                    <ThemedText style={st.good}>
                      Photo optimized · {Math.max(1, Math.ceil((photo.fileSize ?? 0) / 1024))} KB
                    </ThemedText>
                    <View style={st.actionRow}>
                      <Action
                        label="View"
                        secondary
                        onPress={() => Linking.openURL(photo.uri)}
                      />
                      <Action
                        label="Replace"
                        secondary
                        onPress={() => pickPhoto(photo.source)}
                      />
                      <Action
                        label="Remove"
                        secondary
                        onPress={() => setPhoto(null)}
                      />
                    </View>
                  </>
                ) : (
                  <>
                    <ThemedText style={st.muted}>
                      No photo added. You can still submit this mismatch.
                    </ThemedText>
                    <View style={st.actionRow}>
                      <Action
                        label="Capture Photo"
                        secondary
                        onPress={() => pickPhoto("CAMERA")}
                      />
                      <Action
                        label="Choose from Gallery"
                        secondary
                        onPress={() => pickPhoto("GALLERY")}
                      />
                    </View>
                  </>
                )}
              </Card>
              <TouchableOpacity
                style={[st.submit, !canSubmit && st.disabled]}
                disabled={!canSubmit}
                onPress={() => submit()}
                accessibilityLabel="Submit Current Location"
              >
                {submitting ? (
                  <>
                    <ActivityIndicator color="#fff" />
                    <ThemedText style={st.submitText}>
                      Submitting your current location…
                    </ThemedText>
                  </>
                ) : (
                  <ThemedText style={st.submitText}>
                    Submit Current Location
                  </ThemedText>
                )}
              </TouchableOpacity>
            </>
          )}

          {phase === "SUCCESS" && result && (
            <MessageCard
              color="#059669"
              title={
                result.duplicate
                  ? "Already Checked In"
                  : "Checked In Successfully"
              }
              text={
                result.duplicate
                  ? `This visit was already checked in with its current-location evidence.\n\nEvidence status: ${VERIFICATION_LABELS[result.verificationStatus]}\nChecked in at: ${formatTime(result.checkinTime)}`
                  : `You are now checked in at your current location. Your reason${result.photoAdded ? " and optional photo were" : " was"} submitted for manager verification.\n\nPlanned destination: ${visit.location_name}\nDistance from destination: ${distanceLabel(result.distanceMetres)}\nCheck-in status: Active\nEvidence status: ${VERIFICATION_LABELS[result.verificationStatus]}\nChecked in at: ${formatTime(result.checkinTime)}`
              }
            >
              <Action label="Back to Field Visits" onPress={onClose} />
            </MessageCard>
          )}
        </ScrollView>
      </KeyboardAvoidingView>
    </Modal>
  );
}

function Card({ title, children }: React.PropsWithChildren<{ title: string }>) {
  const st = useFallbackStyles();
  return (
    <View style={st.card}>
      <ThemedText style={st.sectionTitle}>{title}</ThemedText>
      {children}
    </View>
  );
}
function MessageCard({
  color,
  title,
  text,
  children,
}: React.PropsWithChildren<{ color: string; title: string; text: string }>) {
  const st = useFallbackStyles();
  const { isDark } = useTheme();
  const tone = isDark ? DARK_MESSAGE_TONE[color] ?? color : color;
  return (
    <View style={[st.message, { borderLeftColor: tone }]}>
      <ThemedText style={[st.heading, { color: tone }]}>{title}</ThemedText>
      <ThemedText style={st.messageText}>{text}</ThemedText>
      {children}
    </View>
  );
}
function Action({
  label,
  onPress,
  secondary,
  loading,
}: {
  label: string;
  onPress: () => void;
  secondary?: boolean;
  loading?: boolean;
}) {
  const st = useFallbackStyles();
  return (
    <TouchableOpacity
      style={[st.action, secondary && st.actionSecondary]}
      onPress={onPress}
      disabled={loading}
    >
      {loading ? (
        <ActivityIndicator color="#fff" size="small" />
      ) : (
        <ThemedText
          style={[st.actionText, secondary && st.actionTextSecondary]}
        >
          {label}
        </ThemedText>
      )}
    </TouchableOpacity>
  );
}

// Message accent colours re-toned for dark surfaces.
const DARK_MESSAGE_TONE: Record<string, string> = {
  "#DC2626": "#F87171",
  "#059669": "#34D399",
};

type ThemeColors = typeof Colors.light;

function useFallbackStyles() {
  const { theme, isDark } = useTheme();
  return useMemo(() => createStyles(theme, isDark), [theme, isDark]);
}

/** Light values are the original design; dark values come from the theme. */
function createStyles(t: ThemeColors, dark: boolean) {
  return StyleSheet.create({
  root: { flex: 1, backgroundColor: dark ? t.backgroundRoot : "#F7F7FA" },
  header: {
    paddingTop: Platform.OS === "ios" ? 58 : 20,
    paddingHorizontal: 18,
    paddingBottom: 14,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    backgroundColor: dark ? t.backgroundDefault : "#fff",
    borderBottomWidth: 1,
    borderBottomColor: dark ? t.border : "#E5E7EB",
  },
  title: { fontSize: 18, fontWeight: "800", color: dark ? t.text : "#111827" },
  content: { padding: 16, gap: 14, paddingBottom: 50 },
  center: { alignItems: "center", padding: 40, gap: 12 },
  intro: { color: dark ? t.textSecondary : "#4B5563", lineHeight: 21 },
  message: {
    backgroundColor: dark ? t.backgroundDefault : "#fff",
    borderRadius: 14,
    padding: 18,
    borderLeftWidth: 4,
    gap: 12,
  },
  heading: { fontSize: 18, fontWeight: "800", textAlign: "center" },
  messageText: { color: dark ? t.text : "#374151", lineHeight: 21 },
  muted: { color: dark ? t.textSecondary : "#6B7280", lineHeight: 19 },
  card: { backgroundColor: dark ? t.backgroundDefault : "#fff", borderRadius: 14, padding: 16 },
  sectionTitle: {
    fontSize: 12,
    fontWeight: "800",
    color: dark ? "#E2A6E2" : "#6D1B6D",
    letterSpacing: 0.5,
    marginBottom: 10,
  },
  cardTitle: {
    fontSize: 16,
    fontWeight: "800",
    color: dark ? t.text : "#111827",
    marginBottom: 4,
  },
  info: {
    flexDirection: "row",
    justifyContent: "space-between",
    gap: 12,
    marginTop: 8,
  },
  infoLabel: { color: dark ? t.textSecondary : "#6B7280", fontSize: 13 },
  infoValue: {
    color: dark ? t.text : "#111827",
    fontSize: 13,
    fontWeight: "700",
    flexShrink: 1,
    textAlign: "right",
  },
  actionRow: { flexDirection: "row", gap: 8, marginTop: 10 },
  action: {
    flex: 1,
    minHeight: 44,
    backgroundColor: "#60045d",
    borderRadius: 10,
    paddingHorizontal: 10,
    alignItems: "center",
    justifyContent: "center",
  },
  actionSecondary: {
    backgroundColor: dark ? t.backgroundSecondary : "#fff",
    borderWidth: 1.5,
    borderColor: dark ? "#A838A8" : "#60045d",
  },
  actionText: {
    color: "#fff",
    fontWeight: "700",
    fontSize: 13,
    textAlign: "center",
  },
  actionTextSecondary: { color: dark ? "#E2A6E2" : "#60045d" },
  label: { fontSize: 13, color: dark ? t.text : "#374151", fontWeight: "700", marginBottom: 6 },
  input: {
    borderWidth: 1.5,
    borderColor: dark ? t.border : "#E5E7EB",
    borderRadius: 10,
    backgroundColor: dark ? t.backgroundSecondary : "#F9FAFB",
    padding: 12,
    fontSize: 14,
    color: dark ? t.text : "#111827",
  },
  picker: { backgroundColor: dark ? t.backgroundSecondary : "#F9FAFB", color: dark ? t.text : "#111827" },
  photo: { width: "100%", height: 190, borderRadius: 10, marginVertical: 10 },
  good: { color: dark ? "#34D399" : "#059669", fontWeight: "700" },
  declaration: {
    flexDirection: "row",
    gap: 12,
    backgroundColor: dark ? t.backgroundDefault : "#fff",
    borderRadius: 14,
    padding: 16,
    alignItems: "flex-start",
  },
  declarationText: { flex: 1, color: dark ? t.text : "#374151", lineHeight: 20 },
  submit: {
    minHeight: 52,
    borderRadius: 12,
    backgroundColor: "#60045d",
    flexDirection: "row",
    gap: 10,
    alignItems: "center",
    justifyContent: "center",
  },
  disabled: { opacity: 0.42 },
  submitText: { color: "#fff", fontSize: 15, fontWeight: "800" },
  });
}
