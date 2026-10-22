import React, { useEffect, useState } from "react";
import { ActivityIndicator, Image, Pressable, StyleSheet, TextInput, View } from "react-native";
import Feather from "@expo/vector-icons/Feather";
import { ThemedText } from "@/components/ThemedText";
import { useTheme } from "@/hooks/useTheme";
import { supabase } from "@/lib/supabase";
import { CurrentLocationVisitService } from "@/services/current-location-visit.service";
import type { SiteVisitObserverVisit } from "@/types/location-database";
import { EvidencePhoto } from "@/components/EvidencePhoto";

const FLAG_LABELS: Record<string, string> = {
  CHECKED_OUT_AWAY_FROM_SITE: "Checked out away from the site",
  VERY_SHORT_VISIT: "Stayed less than 5 minutes",
  LEFT_SITE_BEFORE_CHECKOUT: "Left the site long before checking out",
  MOCK_LOCATION_PINGS: "Fake GPS detected during the visit",
  GPS_JUMPS: "GPS jumped impossibly far",
  AUTO_CLOSED_NO_CHECKOUT: "Never checked out (closed automatically)",
  // Legacy flag from when check-out required a photo (no longer required).
  NO_PHOTO: "No photo (not required)",
};

const STATUS_STYLE: Record<string, { label: string; color: string }> = {
  PENDING: { label: "Not reviewed", color: "#6B7280" },
  APPROVED: { label: "Approved", color: "#059669" },
  FLAGGED: { label: "Flagged", color: "#D97706" },
  NEEDS_INFORMATION: { label: "Needs information", color: "#2563EB" },
  REJECTED: { label: "Rejected", color: "#DC2626" },
};

type Decision = "APPROVED" | "FLAGGED" | "NEEDS_INFORMATION" | "REJECTED";

type LocationEvidence = {
  level: "STRONG" | "PARTIAL" | "NOT_AT_SITE" | "NONE";
  flags: string[];
  good_points: number;
  points_at_site: number;
  minutes_at_site: number;
  closest_m: number | null;
  best_accuracy_m: number | null;
  longest_gap_min: number;
  first_at_site: string | null;
  last_at_site: string | null;
};

const EVIDENCE_STYLE: Record<LocationEvidence["level"], { label: string; color: string }> = {
  STRONG: { label: "Strong location evidence", color: "#059669" },
  PARTIAL: { label: "Partial location evidence", color: "#D97706" },
  NOT_AT_SITE: { label: "GPS never placed the employee at the site", color: "#DC2626" },
  NONE: { label: "No location recorded for this visit", color: "#DC2626" },
};

const EVIDENCE_FLAGS: Record<string, string> = {
  MOCKED_POINTS: "Fake GPS points",
  GPS_JUMPS: "GPS jumps",
  LONG_GAP: "Location gap over 30 min",
  SITE_HAS_NO_COORDINATES: "Site has no coordinates",
};

function istTime(iso: string | null) {
  if (!iso) return "—";
  return new Date(iso).toLocaleTimeString("en-IN", { timeZone: "Asia/Kolkata", hour: "2-digit", minute: "2-digit", hour12: true });
}

function friendlyError(message: string) {
  if (message.includes("NOTES_REQUIRED")) return "Write a short note for this decision.";
  if (message.includes("CANNOT_REVIEW_OWN_VISIT")) return "You cannot review your own visit.";
  if (message.includes("PERMISSION_REQUIRED") || message.includes("42501")) return "You do not have access to review this employee.";
  return "Could not save the decision. Try again.";
}

/** Evidence, risk flags and the reviewer's decision for one site visit. */
export function VisitReviewPanel({ visit, onReviewed }: { visit: SiteVisitObserverVisit; onReviewed: () => void }) {
  const { theme } = useTheme();
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState<Decision | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [evidence, setEvidence] = useState<LocationEvidence | null>(null);

  useEffect(() => {
    let cancelled = false;
    setEvidence(null);
    void Promise.resolve(supabase.rpc("rpc_field_visit_location_evidence", { p_visit_id: visit.visit_id }))
      .then(({ data }: any) => {
        if (!cancelled && data && typeof data === "object") setEvidence(data as LocationEvidence);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [visit.visit_id, visit.status]);

  useEffect(() => {
    setNotes("");
    setError(null);
  }, [visit.visit_id]);

  const status = STATUS_STYLE[visit.verification_status || "PENDING"] || STATUS_STYLE.PENDING;
  const flags = Array.isArray(visit.risk_flags) ? visit.risk_flags : [];
  const completed = visit.status === "COMPLETED";

  const decide = async (decision: Decision) => {
    if (decision !== "APPROVED" && notes.trim().length < 3) {
      setError("Write a short note for this decision.");
      return;
    }
    setBusy(decision);
    setError(null);
    const { error: rpcError } = await supabase.rpc("rpc_review_field_visit", {
      p_visit_id: visit.visit_id,
      p_decision: decision,
      p_notes: notes.trim() || null,
    });
    setBusy(null);
    if (rpcError) {
      setError(friendlyError(rpcError.message || ""));
      return;
    }
    onReviewed();
  };

  return (
    <View style={[styles.box, { borderColor: theme.border, backgroundColor: theme.backgroundRoot }]}>
      <View style={styles.row}>
        <ThemedText style={styles.heading}>Verification</ThemedText>
        <View style={[styles.pill, { borderColor: status.color, backgroundColor: status.color + "14" }]}>
          <ThemedText style={{ color: status.color, fontSize: 12, fontWeight: "800" }}>{status.label}</ThemedText>
        </View>
      </View>

      {flags.length > 0 ? (
        <View style={{ gap: 4 }}>
          {flags.map((flag) => (
            <View key={flag} style={styles.flagRow}>
              <Feather name="alert-triangle" size={13} color="#D97706" />
              <ThemedText style={{ fontSize: 13, flex: 1 }}>{FLAG_LABELS[flag] || flag}</ThemedText>
            </View>
          ))}
        </View>
      ) : completed ? (
        <View style={styles.flagRow}>
          <Feather name="check-circle" size={13} color="#059669" />
          <ThemedText style={{ fontSize: 13 }}>No automatic warnings</ThemedText>
        </View>
      ) : null}

      {evidence ? (() => {
        const ui = EVIDENCE_STYLE[evidence.level] ?? EVIDENCE_STYLE.NONE;
        return (
          <View style={[styles.evidence, { borderColor: ui.color + "55", backgroundColor: ui.color + "0F" }]}>
            <View style={styles.flagRow}>
              <Feather name="map-pin" size={13} color={ui.color} />
              <ThemedText style={{ color: ui.color, fontWeight: "800", fontSize: 13 }}>{ui.label}</ThemedText>
            </View>
            {evidence.points_at_site > 0 ? (
              <ThemedText type="caption" style={{ color: theme.text }}>
                At site {istTime(evidence.first_at_site)} – {istTime(evidence.last_at_site)} · about {evidence.minutes_at_site} min
              </ThemedText>
            ) : null}
            <ThemedText type="caption" style={{ color: theme.textSecondary }}>
              {evidence.good_points} good GPS points
              {evidence.closest_m != null ? ` · closest ${evidence.closest_m} m` : ""}
              {evidence.best_accuracy_m != null ? ` · best accuracy ±${evidence.best_accuracy_m} m` : ""}
              {evidence.longest_gap_min > 0 ? ` · longest gap ${evidence.longest_gap_min} min` : ""}
            </ThemedText>
            {evidence.flags?.length ? (
              <ThemedText type="caption" style={{ color: "#B45309" }}>
                ⚠ {evidence.flags.map((flag) => EVIDENCE_FLAGS[flag] || flag).join(" · ")}
              </ThemedText>
            ) : null}
          </View>
        );
      })() : null}

      {visit.checkout_distance_m != null ? (
        <ThemedText type="caption" style={{ color: theme.textSecondary }}>
          Check-out was {Math.round(visit.checkout_distance_m)} m from the site (allowed {Math.round(Number(visit.radius_m) || 100)} m)
        </ThemedText>
      ) : null}

      {/* A photo exists only for a location mismatch; check-out has no photo. */}
      {visit.evidence_photo_path ? (
        <>
          <ThemedText type="caption" style={{ color: theme.textSecondary, fontWeight: "700" }}>Location mismatch photo</ThemedText>
          <EvidencePhoto path={visit.evidence_photo_path} height={200} />
        </>
      ) : null}

      {visit.checkout_notes ? (
        <ThemedText style={{ fontSize: 13 }}>
          <ThemedText style={{ fontWeight: "700", fontSize: 13 }}>Employee note: </ThemedText>
          {visit.checkout_notes}
        </ThemedText>
      ) : null}
      {visit.reviewer_notes ? (
        <ThemedText style={{ fontSize: 13 }}>
          <ThemedText style={{ fontWeight: "700", fontSize: 13 }}>Review note: </ThemedText>
          {visit.reviewer_notes}
        </ThemedText>
      ) : null}

      {completed ? (
        <>
          <TextInput
            value={notes}
            onChangeText={(text) => {
              setNotes(text);
              if (error) setError(null);
            }}
            placeholder="Note (required unless approving)"
            placeholderTextColor={theme.textSecondary}
            editable={!busy}
            style={[styles.input, { color: theme.text, borderColor: error ? theme.error : theme.border, backgroundColor: theme.backgroundDefault }]}
          />
          {error ? <ThemedText style={{ color: theme.error, fontSize: 13 }}>{error}</ThemedText> : null}
          <View style={styles.actions}>
            {([
              ["APPROVED", "Approve", "#059669"],
              ["NEEDS_INFORMATION", "Ask info", "#2563EB"],
              ["FLAGGED", "Flag", "#D97706"],
              ["REJECTED", "Reject", "#DC2626"],
            ] as const).map(([decision, label, color]) => (
              <Pressable
                key={decision}
                disabled={!!busy}
                onPress={() => void decide(decision)}
                style={[styles.action, { borderColor: color, opacity: busy && busy !== decision ? 0.5 : 1 }]}
              >
                {busy === decision ? <ActivityIndicator size="small" color={color} /> : (
                  <ThemedText style={{ color, fontWeight: "800", fontSize: 13 }}>{label}</ThemedText>
                )}
              </Pressable>
            ))}
          </View>
        </>
      ) : (
        <ThemedText type="caption" style={{ color: theme.textSecondary }}>
          Review opens after the employee checks out.
        </ThemedText>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  box: { borderWidth: 1, borderRadius: 12, padding: 12, gap: 10 },
  row: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8 },
  heading: { fontSize: 14, fontWeight: "800" },
  pill: { borderWidth: 1, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 3 },
  flagRow: { flexDirection: "row", alignItems: "center", gap: 6 },
  evidence: { borderWidth: 1, borderRadius: 10, padding: 10, gap: 4 },
  photo: { width: "100%", height: 200, borderRadius: 10, borderWidth: 1 },
  center: { alignItems: "center", justifyContent: "center" },
  input: { borderWidth: 1, borderRadius: 8, paddingHorizontal: 10, minHeight: 44, fontSize: 16 },
  actions: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  action: { flexGrow: 1, flexBasis: "22%", minWidth: 72, minHeight: 44, borderWidth: 1.5, borderRadius: 8, alignItems: "center", justifyContent: "center" },
});

export default VisitReviewPanel;
