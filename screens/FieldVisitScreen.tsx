import React, { useState, useCallback } from "react";
import {
  View, StyleSheet, ScrollView, TouchableOpacity,
  Alert, RefreshControl, ActivityIndicator, Platform,
} from "react-native";
import { useFocusEffect, useNavigation, useRoute } from "@react-navigation/native";
import Feather from "@expo/vector-icons/Feather";
import { ThemedView } from "@/components/ThemedView";
import { ThemedText } from "@/components/ThemedText";
import Spacer from "@/components/Spacer";
import { FieldVisitService, FieldVisit } from "@/services/field-visit.service";
import { AttendanceService } from "@/services/attendance.service";
import { useAuth } from "@/contexts/AuthContext";
import { useTheme } from "@/hooks/useTheme";
import MeetingDetailModal, { MeetingDetails } from "@/components/MeetingDetailModal";
import VisitDetailModal from "@/components/VisitDetailModal";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { getCurrentGPS } from "@/utils/gps";
import { OfficeService } from "@/services/office.service";
import CurrentLocationFallbackModal from "@/components/CurrentLocationFallbackModal";
import { GPSCoords } from "@/utils/gps";
import {
  CurrentLocationVisitService,
  validateFreshLocation,
} from "@/services/current-location-visit.service";
import { locationTrackingCoordinator } from "@/services/location/LocationTrackingCoordinator";
import ActiveJourneyCard from "@/components/ActiveJourneyCard";
import { Destination } from "@/services/location/types";
import { openGoogleMapsNavigation } from "@/utils/googleNavigation";
import { reportNonFatalError } from "@/utils/operationalErrors";
import { formatTime } from "@/utils/format";
import { nativeBridge } from "@/services/nativeBridge/client";

function fmt(iso?: string) {
  return formatTime(iso);
}

const STATUS_CONFIG: Record<string, { color: string; bg: string; label: string; icon: any }> = {
  PENDING:    { color: "#F59E0B", bg: "#FEF3C7", label: "En Route",    icon: "navigation" as const },
  CHECKED_IN: { color: "#3B82F6", bg: "#DBEAFE", label: "At Location", icon: "map-pin" as const },
  COMPLETED:  { color: "#10B981", bg: "#D1FAE5", label: "Completed",   icon: "check-circle" as const },
  MISSED:     { color: "#EF4444", bg: "#FEE2E2", label: "Missed",      icon: "x-circle" as const },
  IN_TRANSIT: { color: "#8B5CF6", bg: "#EDE9FE", label: "In Transit",  icon: "navigation" as const },
};

// Use window.alert/confirm on web — Edge always allows these from user gesture
function webAlert(msg: string) {
  if (Platform.OS === "web" && typeof window !== "undefined") window.alert(msg);
  else Alert.alert("", msg);
}

// Haversine distance in metres
function haversineMetres(
  lat1: number, lon1: number,
  lat2: number, lon2: number
): number {
  const R = 6371000;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
    Math.cos((lat2 * Math.PI) / 180) *
    Math.sin(dLon / 2) ** 2;
  return Math.round(R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)));
}

/** Find the nearest office to the given GPS coordinates. Returns office ID or null. */
async function findNearestOffice(lat: number, lon: number): Promise<string | null> {
  try {
    const offices = await OfficeService.getAllOffices();
    if (!offices || offices.length === 0) return null;

    let nearestOffice: any = null;
    let nearestDist = Infinity;

    for (const office of offices) {
      if (office.latitude == null || office.longitude == null) continue;
      const dist = haversineMetres(lat, lon, office.latitude, office.longitude);
      const radius = office.attendance_radius || 50;
      if (dist <= radius && dist < nearestDist) {
        nearestDist = dist;
        nearestOffice = office;
      }
    }

    return nearestOffice?.id || null;
  } catch (e) {
    console.warn("[FieldVisit] Error finding nearest office:", e);
    return null;
  }
}

export default function FieldVisitScreen() {
  const navigation = useNavigation<any>();
  const route = useRoute<any>();
  const { user } = useAuth();
  const { theme } = useTheme();
  const insets = useSafeAreaInsets();
  const [visits, setVisits] = useState<FieldVisit[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [isCheckedOut, setIsCheckedOut] = useState(false);
  const [showNextModal, setShowNextModal] = useState(false);
  const [initialVisitType, setInitialVisitType] = useState<
    "site" | "meeting" | "office" | undefined
  >(undefined);
  const [detailVisit, setDetailVisit] = useState<FieldVisit | null>(null);
  const [locationVerification, setLocationVerification] = useState<{ visit: FieldVisit; location: GPSCoords } | null>(null);
  const [pendingUploads, setPendingUploads] = useState<
    Awaited<ReturnType<typeof CurrentLocationVisitService.getQueue>>
  >([]);

  const loadVisits = async () => {
    if (!user?.id) {
      setLoading(false);
      return;
    }
    try {
      const { data, error } = await FieldVisitService.getTodayVisits(user.id);
      if (error) throw error;
      const { data: att } = await AttendanceService.getToday(user.id);
      setVisits(data);
      if (route.params?.fieldVisitId) {
        const linkedVisit = data.find(
          (visit) => visit.id === route.params.fieldVisitId,
        );
        if (linkedVisit) setDetailVisit(linkedVisit);
      }
      setIsCheckedOut(!!att?.checkout_time);
      setPendingUploads(await CurrentLocationVisitService.getQueue());
      setLoadError(null);
    } catch (error: any) {
      const message =
        error?.message ||
        "Field visits could not be loaded. Check your connection and try again.";
      setLoadError(message);
      void reportNonFatalError("field_visit.load_today", error);
    } finally {
      setLoading(false);
    }
  };

  useFocusEffect(useCallback(() => {
    setLoading(true);
    CurrentLocationVisitService.retryQueue()
      .catch((error) => reportNonFatalError("field_visit.retry_queue", error))
      .finally(loadVisits);
    if (route.params?.startVisitIntent) {
      setInitialVisitType(route.params.startVisitIntent);
      setShowNextModal(true);
      navigation.setParams({ startVisitIntent: undefined });
    }
  }, [user?.id, route.params?.startVisitIntent]));

  const onRefresh = async () => {
    setRefreshing(true);
    try {
      await loadVisits();
    } finally {
      setRefreshing(false);
    }
  };
  const getGPS = () => getCurrentGPS();

  // ── Check In — enforces geo-fence against destination coords (100m radius) ──
  const handleCheckIn = async (visit: FieldVisit) => {
    setActionLoading(visit.id);
    try {
      const gps = await getGPS();
      if (!gps) {
        webAlert("Could not get your location. Please enable GPS and try again.");
        setActionLoading(null);
        return;
      }
      const quality = validateFreshLocation(gps);

      // Debug: log exactly what we have so we can diagnose coord issues
      console.log("[CheckIn] visit.id:", visit.id);
      console.log("[CheckIn] visit.destination_coords:", JSON.stringify(visit.destination_coords));
      console.log("[CheckIn] visit.predefined_site_id:", (visit as any).predefined_site_id);
      console.log("[CheckIn] visit.checkin_radius_m:", visit.checkin_radius_m);
      console.log("[CheckIn] user GPS:", gps.latitude, gps.longitude);

      // Resolve destination coordinates.
      const dc = visit.destination_coords as any;
      let destLat: number | null = dc?.latitude ?? dc?.lat ?? null;
      let destLon: number | null = dc?.longitude ?? dc?.lng ?? dc?.lon ?? null;
      let radius: number | null = visit.checkin_radius_m ?? null;
      let selectedSiteId: string | null = (visit as any).predefined_site_id ?? null;

      // A selected site's current server policy is mandatory. Never continue
      // with stale coordinates or an invented radius when this refresh fails.
      if (selectedSiteId) {
        const { supabase } = await import("@/lib/supabase");
        const { data: site, error: siteError } = await supabase
          .from("predefined_sites")
          .select("latitude, longitude, checkin_radius_m")
          .eq("id", selectedSiteId)
          .eq("is_active", true)
          .maybeSingle();
        if (siteError) {
          void reportNonFatalError("field_visit.site_lookup", siteError);
          throw new Error(
            "The selected site's current location policy could not be loaded. Check-in is blocked; reconnect and try again.",
          );
        }
        if (
          !site ||
          !Number.isFinite(Number(site.latitude)) ||
          !Number.isFinite(Number(site.longitude)) ||
          !Number.isFinite(Number(site.checkin_radius_m)) ||
          Number(site.checkin_radius_m) < 10
        ) {
          throw new Error(
            "The selected site is inactive or does not have a valid check-in radius. Ask HR to correct the site configuration.",
          );
        }
        destLat = Number(site.latitude);
        destLon = Number(site.longitude);
        radius = Number(site.checkin_radius_m);
      }

      // Visits created before predefined_site_id was stored can still contain the
      // exact coordinates of the selected predefined site. Recover that site so
      // those existing visits can use the current-location fallback as well.
      if (!selectedSiteId && destLat != null && destLon != null) {
        const { supabase } = await import("@/lib/supabase");
        const latitudeWindow = 0.001;
        const longitudeWindow = 0.0015;
        const { data: nearbySites, error: nearbySitesError } = await supabase
          .from("predefined_sites")
          .select("id, latitude, longitude, checkin_radius_m")
          .eq("is_active", true)
          .gte("latitude", destLat - latitudeWindow)
          .lte("latitude", destLat + latitudeWindow)
          .gte("longitude", destLon - longitudeWindow)
          .lte("longitude", destLon + longitudeWindow);
        if (nearbySitesError) {
          void reportNonFatalError(
            "field_visit.legacy_site_lookup",
            nearbySitesError,
          );
          throw new Error(
            "The current site policy could not be verified. Check-in is blocked; reconnect and try again.",
          );
        }

        const candidateSites = (nearbySites || []) as {
          id: string;
          latitude: number | string;
          longitude: number | string;
          checkin_radius_m: number | null;
        }[];
        const recoveredSite = candidateSites
          .map((site) => {
            const dLat = ((Number(site.latitude) - destLat!) * Math.PI) / 180;
            const dLon = ((Number(site.longitude) - destLon!) * Math.PI) / 180;
            const a = Math.sin(dLat / 2) ** 2 +
              Math.cos((destLat! * Math.PI) / 180) *
              Math.cos((Number(site.latitude) * Math.PI) / 180) *
              Math.sin(dLon / 2) ** 2;
            return {
              ...site,
              distance: 6371000 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)),
            };
          })
          .filter((site) => site.distance <= 25)
          .sort((a, b) => a.distance - b.distance)[0];

        if (recoveredSite) {
          if (
            !Number.isFinite(Number(recoveredSite.checkin_radius_m)) ||
            Number(recoveredSite.checkin_radius_m) < 10
          ) {
            throw new Error(
              "The selected site does not have a valid check-in radius. Ask HR to correct the site configuration.",
            );
          }
          selectedSiteId = recoveredSite.id;
          destLat = Number(recoveredSite.latitude);
          destLon = Number(recoveredSite.longitude);
          radius = Number(recoveredSite.checkin_radius_m);
        }
      }

      if (destLat != null && destLon != null) {
        if (
          !Number.isFinite(Number(radius)) ||
          Number(radius) < 10
        ) {
          throw new Error(
            "This visit does not have a verified check-in radius. Check-in is blocked until HR corrects the visit or site policy.",
          );
        }
        const maxRadius = Number(radius);
        const R = 6371000;
        const dLat = ((gps.latitude  - destLat) * Math.PI) / 180;
        const dLon = ((gps.longitude - destLon) * Math.PI) / 180;
        const a = Math.sin(dLat / 2) ** 2 +
          Math.cos((destLat * Math.PI) / 180) *
          Math.cos((gps.latitude * Math.PI) / 180) *
          Math.sin(dLon / 2) ** 2;
        const dist = Math.round(R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)));
        if (!quality.valid || dist + Math.max(0, gps.accuracy ?? 0) > maxRadius) {
          setLocationVerification({ visit: {
            ...visit,
            predefined_site_id: selectedSiteId ?? undefined,
            destination_coords: { latitude: destLat, longitude: destLon },
            checkin_radius_m: maxRadius,
          }, location: gps });
          setActionLoading(null);
          return;
        }
      } else {
        console.warn("[CheckIn] No destination coords found. visit.destination_coords:", visit.destination_coords, "predefined_site_id:", (visit as any).predefined_site_id);
        webAlert(
          `Location Not Set\n\n"${visit.location_name}" has no saved coordinates.\n\nPlease mark this visit as Missed and recreate it — search for the address and confirm the pin on the map.`
        );
        setActionLoading(null);
        return;
      }

      const { data: confirmedVisit, error } =
        await FieldVisitService.checkIn(visit.id, gps);
      if (error) throw error;
      await loadVisits();
      webAlert(
        `Checked In\n\nAt ${visit.location_name} · ${fmt(confirmedVisit?.checkin_time)}\nGPS: ${gps.latitude.toFixed(5)}, ${gps.longitude.toFixed(5)}`,
      );
    } catch (e: any) {
      webAlert(`Error\n\n${e.message || "Failed to check in."}`);
    } finally {
      setActionLoading(null);
    }
  };

  // ── Simple Check Out — confirm dialog, then checkout ──
  const handleCheckOut = async (visit: FieldVisit) => {
    if (Platform.OS === "web") {
      const ok = window.confirm("You are checking out of \"" + visit.location_name + "\"");
      if (!ok) return;
      // Web: confirmed, proceed to checkout
      setActionLoading(visit.id);
      try {
        const gps = await getGPS();
        if (!gps) {
          throw new Error("GPS is required to check out. Enable location and try again.");
        }
        const quality = validateFreshLocation(gps);
        if (!quality.valid) throw new Error(quality.reason);
        const nearestOfficeId = await findNearestOffice(gps.latitude, gps.longitude);
        const { error } = await FieldVisitService.checkOut(visit.id, gps, undefined, nearestOfficeId || undefined);
        if (error) throw error;
        await loadVisits().catch(() => {
          console.warn("Field-visit checkout succeeded; refresh was deferred");
        });
      } catch (e: any) {
        console.error("[FieldVisit] Checkout error:", e);
        window.alert("Checkout Failed\n\n" + (e.message || "Unknown error. Please try again."));
      } finally {
        setActionLoading(null);
      }
    } else {
      // Mobile: use Alert.alert with OK/Cancel
      Alert.alert(
        "Check Out",
        "You are checking out of \"" + visit.location_name + "\"",
        [
          { text: "Cancel", style: "cancel" },
          {
            text: "OK",
            onPress: async () => {
              setActionLoading(visit.id);
              try {
                const gps = await getGPS();
                if (!gps) {
                  throw new Error("GPS is required to check out. Enable location and try again.");
                }
                const quality = validateFreshLocation(gps);
                if (!quality.valid) throw new Error(quality.reason);
                const nearestOfficeId = await findNearestOffice(gps.latitude, gps.longitude);
                const { error } = await FieldVisitService.checkOut(visit.id, gps, undefined, nearestOfficeId || undefined);
                if (error) throw error;
                await loadVisits().catch(() => {
                  console.warn("Field-visit checkout succeeded; refresh was deferred");
                });
              } catch (e: any) {
                console.error("[FieldVisit] Checkout error:", e);
                Alert.alert("Checkout Failed", e.message || "Unknown error. Please try again.");
              } finally {
                setActionLoading(null);
              }
            }
          },
        ]
      );
    }
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

  const pending = visits.filter(
    (v) => v.status === "PENDING" || v.status === "IN_TRANSIT",
  );
  const active = visits.filter((v) => v.status === "CHECKED_IN");
  const completed = visits.filter((v) => v.status === "COMPLETED");
  const missed = visits.filter((v) => v.status === "MISSED");
  const hasActiveVisit = active.length > 0;
  const journeyVisit = visits.find(
    (visit) =>
      (visit.status === "PENDING" || visit.status === "IN_TRANSIT") &&
      Number.isFinite(visit.destination_coords?.latitude) &&
      Number.isFinite(visit.destination_coords?.longitude),
  );
  const journeyDestination: Destination | null =
    journeyVisit?.destination_coords
      ? {
          fieldVisitId: journeyVisit.id,
          journeyId: journeyVisit.id,
          visitDate: journeyVisit.date,
          name: journeyVisit.project_name || journeyVisit.location_name,
          latitude: journeyVisit.destination_coords.latitude,
          longitude: journeyVisit.destination_coords.longitude,
          arrivalRadiusM: Math.max(
            25,
            Math.min(journeyVisit.checkin_radius_m || 100, 1_000),
          ),
        }
      : null;

  if (loading) return <ThemedView style={s.container}><ActivityIndicator color="#60045d" style={{ marginTop: 60 }} /></ThemedView>;

  return (
    <ThemedView style={s.container}>
      <MeetingDetailModal visible={showNextModal}
        activityType={initialVisitType}
        onSubmit={async (details: MeetingDetails) => {
          setShowNextModal(false);
          setInitialVisitType(undefined);
          if (!user?.id) return;
          const VALID_TYPES = ["site", "meeting", "office", "others"] as const;
          const rawType = (details as any).activityType;
          const actType: string = VALID_TYPES.includes(rawType) ? rawType : "meeting";
          if (actType === "office") {
            try {
              const officeName = (details as any).clientName as string;
              if (!officeName) { webAlert("No office selected."); return; }
              const { OfficeService } = await import("@/services/office.service");
              const offices = await OfficeService.getAllOffices();
              const office = (offices || []).find((o: any) => o.name === officeName);
              const { error: fvErr } = await FieldVisitService.createVisit({
                userId: user.id,
                visitType: "office",
                locationName: officeName,
                destinationCoords: office?.latitude != null && office?.longitude != null
                  ? { latitude: office.latitude, longitude: office.longitude }
                  : undefined,
                checkinRadiusM: 500,
                notes: details.notes,
              });
              if (fvErr) throw fvErr;
              await loadVisits();
              webAlert(`Office Stop Added\n\nTap "I've Arrived — Check In" when you reach ${officeName}.`);
            } catch (e: any) { console.error("[FieldVisit] office createVisit error:", e); webAlert(`Error\n\n${e.message || "Failed to add office stop."}`); }
            return;
          }

          try {
            const isSiteVisit = actType === "site";
            const name = isSiteVisit
              ? (details as any).clientName
              : details.meetingType === "client" ? details.clientName : details.cpCompany;
            const address = isSiteVisit
              ? (details as any).clientAddress
              : details.meetingType === "client" ? (details as any).clientAddress : (details as any).cpAddress;
            const notes = isSiteVisit
              ? (details.notes || "").trim()
              : details.meetingType === "client"
                ? `Client: ${details.clientName}. Project: ${details.projectName}. ${details.notes}`.trim()
                : `Channel Partner: ${details.cpName} (${details.cpCompany}). Project: ${details.projectName}. ${details.notes}`.trim();

            const { error: createErr } = await FieldVisitService.createVisit({
              userId: user.id,
              visitType: actType as "site" | "meeting" | "office" | "others",
              locationName: name,
              locationAddress: address || undefined,
              predefinedSiteId: (details as any).predefinedSiteId,
              destinationCoords: (details as any).destinationCoords,
              checkinRadiusM: (details as any).checkinRadiusM ?? 100,
              meetingType: isSiteVisit ? undefined : details.meetingType,
              contactName: isSiteVisit ? undefined : details.meetingType === "client" ? (details as any).clientName : (details as any).cpName,
              contactPhone: isSiteVisit ? undefined : details.meetingType === "client" ? (details as any).clientPhone : (details as any).cpPhone,
              companyName: isSiteVisit ? undefined : details.meetingType === "client" ? (details as any).clientName : (details as any).cpCompany,
              projectName: (details as any).projectName || undefined,
              notes,
              googlePlaceId: (details as any).googlePlaceId,
              locationSource: (details as any).locationSource,
            });
            if (createErr) throw createErr;

            await loadVisits();
            webAlert(`On Your Way!\n\n${name} added. Check in when you arrive.`);
          } catch (e: any) { console.error("[FieldVisit] createVisit error:", e); webAlert(`Error\n\n${e.message || "Failed to add next stop. Please try again."}`); }
        }}
        onCancel={() => {
          setShowNextModal(false);
          setInitialVisitType(undefined);
        }} />
      <VisitDetailModal visit={detailVisit} onClose={() => setDetailVisit(null)} />
      <CurrentLocationFallbackModal
        visit={locationVerification?.visit || null}
        initialLocation={locationVerification?.location || null}
        onClose={() => setLocationVerification(null)}
        onMatched={async (fresh) => {
          if (!locationVerification) return;
          const { data: confirmedVisit, error } =
            await FieldVisitService.checkInAtSelectedSite(
              locationVerification.visit.id,
              fresh,
            );
          if (error) throw error;
          await loadVisits();
          webAlert(
            `Checked In\n\nAt ${locationVerification.visit.location_name} · ${fmt(confirmedVisit?.checkin_time)}`,
          );
        }}
        onSubmitted={loadVisits}
      />

      <ScrollView style={s.scroll} contentContainerStyle={{ paddingTop: insets.top + 16, paddingBottom: insets.bottom + 80 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#60045d" />} showsVerticalScrollIndicator={false}>

        <View style={[s.summaryRow, { backgroundColor: "#6D1B6D" }]}>
          {[{ label: "En Route", count: pending.length, color: "#F59E0B" }, { label: "Active", count: active.length, color: "#3B82F6" },
            { label: "Done", count: completed.length, color: "#10B981" }, { label: "Missed", count: missed.length, color: "#EF4444" }].map((item) => (
            <View key={item.label} style={s.summaryItem}>
              <ThemedText style={[s.summaryCount, { color: item.color }]}>{item.count}</ThemedText>
              <ThemedText style={s.summaryLabel}>{item.label}</ThemedText>
            </View>
          ))}
        </View>

        <Spacer height={16} />

        {Platform.OS === "web" && !nativeBridge.isAvailable() ? (
          <View style={s.webTrackingNotice}>
            <Feather name="info" size={16} color="#92400E" />
            <ThemedText style={s.webTrackingNoticeText}>
              Web/PWA tracking works only while this page is active. Reliable
              locked-screen and background arrival tracking requires the Android app.
            </ThemedText>
          </View>
        ) : null}

        <ActiveJourneyCard fallbackDestination={journeyDestination} />

        {pendingUploads.length > 0 && (
          <View style={s.pendingUploads}>
            <View style={s.pendingHeader}>
              <ThemedText style={s.pendingTitle}>
                Pending uploads ({pendingUploads.length})
              </ThemedText>
              <TouchableOpacity
                onPress={async () => {
                  await CurrentLocationVisitService.retryQueue();
                  setPendingUploads(
                    await CurrentLocationVisitService.getQueue(),
                  );
                }}
              >
                <ThemedText style={s.pendingRetry}>Retry now</ThemedText>
              </TouchableOpacity>
            </View>
            {pendingUploads.map((item) => (
              <View key={item.idempotencyKey} style={s.pendingItem}>
                <ThemedText style={s.pendingName}>
                  {item.locationName || "Current location evidence"}
                </ThemedText>
                <ThemedText style={s.pendingMeta}>
                  Attempts: {item.retryCount ?? 0}
                  {item.photo ? "" : " · No photo (optional)"}
                </ThemedText>
                {item.lastError ? (
                  <ThemedText style={s.pendingError}>
                    {item.lastError}
                  </ThemedText>
                ) : null}
                {item.nextRetryAt ? (
                  <ThemedText style={s.pendingMeta}>
                    Next retry: {fmt(item.nextRetryAt)}
                  </ThemedText>
                ) : null}
              </View>
            ))}
          </View>
        )}

        {loadError ? (
          <View style={s.emptyState}>
            <Feather name="alert-circle" size={34} color="#DC2626" />
            <ThemedText style={[s.emptyTitle, { color: "#991B1B" }]}>
              Field visits unavailable
            </ThemedText>
            <ThemedText style={s.emptySub}>{loadError}</ThemedText>
            <Spacer height={16} />
            <TouchableOpacity
              style={s.addFirstBtn}
              onPress={() => {
                setLoading(true);
                void loadVisits();
              }}
            >
              <Feather name="refresh-cw" size={16} color="#fff" />
              <ThemedText style={s.addFirstBtnText}>Try Again</ThemedText>
            </TouchableOpacity>
          </View>
        ) : visits.length === 0 ? (
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
              const isMarkedLocation = !!visit.location_match_status && visit.location_match_status !== "MATCHED";
              const reviewLabel = visit.verification_status === "APPROVED" ? "Verified field visit" : visit.verification_status === "REJECTED" ? "Rejected" : visit.verification_status === "NEEDS_INFORMATION" ? "Needs information" : visit.verification_status === "FLAGGED" ? "Flagged" : visit.status === "CHECKED_IN" ? "Active · Pending verification" : "Pending verification";
              const cfg = isMarkedLocation
                ? { color: visit.verification_status === "APPROVED" ? "#059669" : visit.verification_status === "REJECTED" ? "#DC2626" : "#D97706", bg: visit.verification_status === "APPROVED" ? "#D1FAE5" : visit.verification_status === "REJECTED" ? "#FEE2E2" : "#FEF3C7", label: reviewLabel, icon: "shield" as const }
                : STATUS_CONFIG[visit.status];
              const isActioning = actionLoading === visit.id;
              const typeLabel = visit.visit_type === "site" ? "🏗️ Site" : visit.visit_type === "others" ? "📌 Other" : "🤝 Meeting";
              const meetingLabel = visit.meeting_type === "client" ? "👤 Client" : visit.meeting_type === "channel_partner" ? "🏘️ Channel Partner" : "";
              const hasCheckinGps = !!(visit.checkin_location?.latitude);
              const displayLocationName = isMarkedLocation
                ? visit.actual_location_name || visit.location_name
                : visit.location_name;
              const locationAddress = isMarkedLocation
                ? visit.actual_location_address || visit.location_address
                : visit.location_address;

              return (
                <TouchableOpacity key={visit.id} style={[s.card, { backgroundColor: theme.backgroundDefault }]} onPress={() => setDetailVisit(visit)} activeOpacity={0.85}>
                  <View style={s.cardTitleRow}>
                    <ThemedText style={s.cardTitle} numberOfLines={1}>{displayLocationName}</ThemedText>
                    <View style={[s.statusBadge, { backgroundColor: cfg.bg }]}>
                      <Feather name={cfg.icon} size={11} color={cfg.color} />
                      <ThemedText style={[s.statusText, { color: cfg.color }]}>{cfg.label}</ThemedText>
                    </View>
                  </View>

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

                  {/* Navigation button */}
                  {(() => {
                    const destLat = (visit as any).destination_coords?.latitude;
                    const destLng = (visit as any).destination_coords?.longitude;
                    const originLat = (visit as any).origin_lat;
                    const originLng = (visit as any).origin_lon;
                    if (
                      !Number.isFinite(destLat) ||
                      !Number.isFinite(destLng)
                    ) {
                      return null;
                    }
                    const origin =
                      Number.isFinite(originLat) && Number.isFinite(originLng)
                        ? {
                            latitude: Number(originLat),
                            longitude: Number(originLng),
                          }
                        : null;
                    return (
                      <TouchableOpacity
                        style={s.navBtn}
                        onPress={(e) => {
                          e.stopPropagation?.();
                          void openGoogleMapsNavigation(
                            {
                              latitude: Number(destLat),
                              longitude: Number(destLng),
                            },
                            origin,
                          );
                        }}
                      >
                        <Feather name="navigation" size={13} color="#fff" />
                        <ThemedText style={s.navBtnText}>
                          Start turn-by-turn navigation
                        </ThemedText>
                      </TouchableOpacity>
                    );
                  })()}

                  {(visit as any).checkout_notes ? (
                    <View style={s.notesBox}>
                      <ThemedText style={s.notesLabel}>📝 Meeting Notes</ThemedText>
                      <ThemedText style={s.notesText}>{(visit as any).checkout_notes}</ThemedText>
                    </View>
                  ) : null}

                  {visit.status === "PENDING" && !isMarkedLocation && (
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
                    <TouchableOpacity style={[s.actionBtn, s.actionBtnDanger, { marginTop: 12 }]} onPress={(e) => { e.stopPropagation?.(); handleCheckOut(visit); }} disabled={isActioning}>
                      {isActioning ? <ActivityIndicator color="#fff" size="small" /> : <><Feather name="log-out" size={14} color="#fff" /><ThemedText style={s.actionBtnText}>Check Out</ThemedText></>}
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
  container: { flex: 1 },
  scroll: { flex: 1, padding: 16 },
  summaryRow: {
    flexDirection: "row", backgroundColor: "#6D1B6D", borderRadius: 14, padding: 14,
    ...(Platform.OS === "web"
      ? { boxShadow: "0 4px 14px rgba(109,27,109,0.18)" }
      : { shadowColor: "#6D1B6D", shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.18, shadowRadius: 14, elevation: 6 }),
  },
  summaryItem: { flex: 1, alignItems: "center" },
  summaryCount: { fontSize: 20, fontWeight: "800", color: "#FFFFFF" },
  summaryLabel: { fontSize: 10, color: "rgba(255,255,255,0.72)", marginTop: 2 },
  emptyState: { alignItems: "center", paddingTop: 50 },
  emptyEmoji: { fontSize: 48 },
  emptyTitle: { fontSize: 17, fontWeight: "700", marginTop: 10 },
  emptySub: { fontSize: 13, color: "#6B7280", textAlign: "center", marginTop: 6, lineHeight: 20 },
  pendingUploads: {
    borderWidth: 1,
    borderColor: "#F59E0B",
    backgroundColor: "#FFFBEB",
    borderRadius: 12,
    padding: 12,
    marginBottom: 14,
  },
  pendingHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 8,
  },
  pendingTitle: { color: "#92400E", fontWeight: "800" },
  pendingRetry: { color: "#60045d", fontWeight: "800" },
  pendingItem: {
    borderTopWidth: 1,
    borderTopColor: "#FDE68A",
    paddingTop: 8,
    marginTop: 6,
  },
  pendingName: { color: "#78350F", fontWeight: "700" },
  pendingMeta: { color: "#92400E", fontSize: 12, marginTop: 2 },
  pendingError: { color: "#B91C1C", fontSize: 12, marginTop: 2 },
  addFirstBtn: { flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: "#6D1B6D", paddingHorizontal: 20, paddingVertical: 12, borderRadius: 10 },
  addFirstBtnText: { color: "#fff", fontWeight: "700", fontSize: 14 },
  addNextBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, borderWidth: 1.5, borderColor: "#6D1B6D", borderRadius: 10, paddingVertical: 10, marginBottom: 12, backgroundColor: "#F5EEF5" },
  addNextBtnText: { color: "#6D1B6D", fontWeight: "700", fontSize: 14 },
  dayDoneBanner: { backgroundColor: "#E4F4EE", borderWidth: 1.5, borderColor: "#12966E", borderRadius: 12, padding: 14, marginBottom: 12, alignItems: "center" },
  dayDoneText: { fontSize: 13, color: "#0A7354", fontWeight: "600", textAlign: "center" },
  webTrackingNotice: { flexDirection: "row", gap: 8, alignItems: "flex-start", padding: 11, marginBottom: 12, borderRadius: 10, backgroundColor: "#FFFBEB", borderWidth: 1, borderColor: "#FDE68A" },
  webTrackingNoticeText: { flex: 1, fontSize: 12, lineHeight: 17, color: "#92400E" },
  card: {
    borderRadius: 14, padding: 14, marginBottom: 12,
    ...(Platform.OS === "web"
      ? { boxShadow: "0 2px 8px rgba(109,27,109,0.07)" }
      : { shadowColor: "#6D1B6D", shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.07, shadowRadius: 8, elevation: 2 }),
  },
  cardTitleRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 4 },
  cardTitle: { fontSize: 15, fontWeight: "700", flex: 1, marginRight: 8 },
  statusBadge: { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 8, paddingVertical: 3, borderRadius: 20 },
  statusText: { fontSize: 11, fontWeight: "700" },
  cardMeta: { flexDirection: "row", flexWrap: "wrap" },
  metaText: { fontSize: 12, color: "#6B7280" },
  contactText: { fontSize: 12, marginTop: 3 },
  addressText: { fontSize: 12, color: "#6B7280", marginTop: 3, lineHeight: 17 },
  projectText: { fontSize: 12, color: "#6D1B6D", marginTop: 3, fontWeight: "600" },
  timesRow: { flexDirection: "row", gap: 14, marginTop: 10, paddingTop: 10, borderTopWidth: 1, borderTopColor: "rgba(128,128,128,0.12)" },
  timeItem: { flexDirection: "row", alignItems: "center", gap: 4 },
  timeText: { fontSize: 12, fontWeight: "600" },
  notesBox: { backgroundColor: "#E3EEFB", borderRadius: 8, padding: 10, marginTop: 8, borderLeftWidth: 3, borderLeftColor: "#1A5FD4" },
  notesLabel: { fontSize: 11, fontWeight: "700", color: "#123E9C", marginBottom: 4 },
  notesText: { fontSize: 13, color: "#1A3070", lineHeight: 18 },
  actions: { marginTop: 12, gap: 8 },
  actionBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, paddingVertical: 12, borderRadius: 10 },
  actionBtnPrimary: { backgroundColor: "#6D1B6D" },
  actionBtnDanger: { backgroundColor: "#C8252D" },
  actionBtnGhost: { borderWidth: 1.5, borderColor: "rgba(128,128,128,0.3)" },
  actionBtnText: { color: "#fff", fontWeight: "700", fontSize: 14 },
  actionBtnGhostText: { color: "#6B7280", fontWeight: "600", fontSize: 13 },
  navBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, backgroundColor: "#1D4ED8", borderRadius: 8, paddingVertical: 9, paddingHorizontal: 14, marginTop: 10 },
  navBtnText: { color: "#fff", fontWeight: "700", fontSize: 13 },
});
