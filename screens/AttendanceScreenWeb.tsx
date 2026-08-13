import React, { useState, useCallback } from "react";
import {
  StyleSheet,
  View,
  Alert,
  ActivityIndicator,
  TextInput,
  TouchableOpacity,
  Platform,
} from "react-native";
import Feather from "@expo/vector-icons/Feather";
import * as Location from "expo-location";
import { useFocusEffect, useNavigation } from "@react-navigation/native";
import { ScreenScrollView } from "@/components/ScreenScrollView";
import { ThemedText } from "@/components/ThemedText";
import { useTheme } from "@/hooks/useTheme";
import { useAuth } from "@/contexts/AuthContext";
import { Spacing, BorderRadius, Colors } from "@/constants/theme";
import Spacer from "@/components/Spacer";
import {
  AttendanceService,
  GeoFenceError,
} from "@/services/attendance.service";
import { OfficeService } from "@/services/office.service";
import { supabase } from "@/lib/supabase";
import AttendanceCheckoutFlow, {
  type AttendanceNextAction,
} from "@/components/AttendanceCheckoutFlow";

export default function AttendanceScreenWeb() {
  const { theme } = useTheme();
  const { user } = useAuth();
  const navigation = useNavigation<any>();
  const [todayRecord, setTodayRecord] = useState<any>(null);
  const [offices, setOffices] = useState<any[]>([]);
  const [selectedOfficeId, setSelectedOfficeId] = useState<string>("");
  const [isLoading, setIsLoading] = useState(false);
  const [purpose, setPurpose] = useState("");
  const [tab, setTab] = useState<"OFFICE" | "SITE">("OFFICE");
  const [showAttendanceCheckout, setShowAttendanceCheckout] = useState(false);

  const today = new Date();

  const loadData = useCallback(async () => {
    if (!user?.id) return;
    try {
      const [todayRec, officesData] = await Promise.all([
        AttendanceService.getToday(user.id),
        OfficeService.getAllOffices(),
      ]);
      setTodayRecord(todayRec.data);
      const list = officesData || [];
      setOffices(list);
      if (list.length === 1) setSelectedOfficeId(list[0].id);
    } catch (e) {
      console.warn("loadData error", e);
    }
  }, [user?.id]);

  useFocusEffect(
    useCallback(() => {
      loadData();
    }, [loadData]),
  );

  const getGPS = (): Promise<{
    latitude: number;
    longitude: number;
  } | null> => {
    if (Platform.OS === "web") {
      return new Promise((resolve) => {
        if (!navigator?.geolocation) {
          resolve(null);
          return;
        }
        // Try cached first (instant), then watchPosition (Safari-safe up to 30s)
        navigator.geolocation.getCurrentPosition(
          (p) => {
            if (Date.now() - p.timestamp < 60000) {
              resolve({
                latitude: p.coords.latitude,
                longitude: p.coords.longitude,
              });
            } else {
              fresh();
            }
          },
          () => fresh(),
          { enableHighAccuracy: false, timeout: 5000, maximumAge: 60000 },
        );
        function fresh() {
          let settled = false;
          const wid = navigator.geolocation.watchPosition(
            (p) => {
              if (settled) return;
              settled = true;
              navigator.geolocation.clearWatch(wid);
              resolve({
                latitude: p.coords.latitude,
                longitude: p.coords.longitude,
              });
            },
            () => {
              if (settled) return;
              settled = true;
              navigator.geolocation.clearWatch(wid);
              resolve(null);
            },
            { enableHighAccuracy: true, timeout: 30000, maximumAge: 0 },
          );
          setTimeout(() => {
            if (!settled) {
              settled = true;
              navigator.geolocation.clearWatch(wid);
              resolve(null);
            }
          }, 30000);
        }
      });
    }
    return Location.requestForegroundPermissionsAsync().then(({ status }) => {
      if (status !== "granted") {
        Alert.alert("Permission Required", "Enable location to check in.");
        return null;
      }
      return Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.Balanced,
      })
        .then((loc) => ({
          latitude: loc.coords.latitude,
          longitude: loc.coords.longitude,
        }))
        .catch(() => null);
    });
  };

  const calcDist = (lat1: number, lon1: number, lat2: number, lon2: number) => {
    const R = 6371000;
    const dLat = ((lat2 - lat1) * Math.PI) / 180;
    const dLon = ((lon2 - lon1) * Math.PI) / 180;
    const a =
      Math.sin(dLat / 2) ** 2 +
      Math.cos((lat1 * Math.PI) / 180) *
        Math.cos((lat2 * Math.PI) / 180) *
        Math.sin(dLon / 2) ** 2;
    return Math.round(R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)));
  };

  const handleCheckIn = async () => {
    if (todayRecord?.checkin_time) {
      Alert.alert("Already Checked In", "You have already checked in today.");
      return;
    }
    setIsLoading(true);
    try {
      const gps = await getGPS();
      if (!gps) return;

      // Auto-detect nearest office — user can be at ANY office, not just assigned one
      const officesWithCoords = offices.filter(
        (o) => o.latitude != null && o.longitude != null,
      );
      if (officesWithCoords.length === 0) {
        Alert.alert(
          "No Offices",
          "No offices configured with GPS. Contact your admin.",
        );
        return;
      }

      let nearestOffice = officesWithCoords[0];
      let nearestDist = calcDist(
        gps.latitude,
        gps.longitude,
        nearestOffice.latitude,
        nearestOffice.longitude,
      );
      for (const o of officesWithCoords.slice(1)) {
        const d = calcDist(
          gps.latitude,
          gps.longitude,
          o.latitude,
          o.longitude,
        );
        if (d < nearestDist) {
          nearestDist = d;
          nearestOffice = o;
        }
      }

      // Update the dropdown to reflect auto-detected office
      setSelectedOfficeId(nearestOffice.id);

      await AttendanceService.officeCheckIn({
        userId: user!.id,
        office: nearestOffice,
        location: gps,
        distance: nearestDist,
      });
      await loadData();
      Alert.alert(
        "✅ Checked In",
        `Checked in at ${nearestOffice.name} (${nearestDist}m away).`,
      );
    } catch (err: any) {
      if (err instanceof GeoFenceError) {
        Alert.alert(
          "📍 Not at Office",
          `You are ${Math.round(err.distanceMetres)}m away from the nearest office (${err.officeName}).\n\nMust be within ${err.radiusMetres}m to check in.`,
        );
        return;
      }
      Alert.alert("Check-In Failed", err?.message || "Please try again.");
    } finally {
      setIsLoading(false);
    }
  };

  const handleCheckOut = () => {
    if (!todayRecord?.checkin_time || todayRecord?.checkout_time) {
      return;
    }
    setShowAttendanceCheckout(true);
  };

  const handleSiteVisit = async () => {
    if (!purpose.trim()) {
      Alert.alert("Required", "Enter purpose of site visit.");
      return;
    }
    setIsLoading(true);
    try {
      const gps = await getGPS();
      if (!gps) return;
      await supabase.from("attendance_requests").insert({
        user_id: user!.id,
        attendance_type: "SITE",
        requested_location: gps,
        purpose,
      });
      const { data: profile } = await supabase
        .from("profiles")
        .select("*")
        .eq("id", user!.id)
        .maybeSingle();
      if (profile?.reports_to) {
        await supabase.from("notifications").insert({
          user_id: profile.reports_to,
          title: "📍 Site Visit Approval",
          message: `${profile.name} requested site visit`,
          type: "attendance_request",
        });
      }
      Alert.alert("Submitted", "Site visit request sent to your manager.");
      setPurpose("");
    } catch {
      Alert.alert("Error", "Failed to submit.");
    } finally {
      setIsLoading(false);
    }
  };

  // ── Already checked in view ───────────────────────────────────────────────
  if (todayRecord?.checkin_time) {
    return (
      <>
      <ScreenScrollView>
        <View
          style={[styles.card, { backgroundColor: theme.backgroundDefault }]}
        >
          <ThemedText type="h1">
            {today.toLocaleTimeString([], {
              hour: "2-digit",
              minute: "2-digit",
            })}
          </ThemedText>
          <Spacer height={Spacing.lg} />
          <View
            style={[
              styles.badge,
              { backgroundColor: Colors.light.success + "20" },
            ]}
          >
            <Feather
              name="check-circle"
              size={16}
              color={Colors.light.success}
            />
            <ThemedText type="small" style={{ color: Colors.light.success }}>
              Checked In:{" "}
              {new Date(todayRecord.checkin_time).toLocaleTimeString([], {
                hour: "2-digit",
                minute: "2-digit",
              })}
            </ThemedText>
          </View>
          <Spacer height={Spacing.md} />
          {todayRecord?.checkout_time ? (
            <View
              style={[
                styles.badge,
                { backgroundColor: Colors.light.info + "20" },
              ]}
            >
              <Feather name="log-out" size={16} color={Colors.light.info} />
              <ThemedText type="small" style={{ color: Colors.light.info }}>
                Checked Out:{" "}
                {new Date(todayRecord.checkout_time).toLocaleTimeString([], {
                  hour: "2-digit",
                  minute: "2-digit",
                })}
              </ThemedText>
            </View>
          ) : (
            <TouchableOpacity
              style={[styles.btn, { backgroundColor: Colors.light.error }]}
              onPress={handleCheckOut}
            >
              <ThemedText style={styles.btnText}>Check Out</ThemedText>
            </TouchableOpacity>
          )}
        </View>
      </ScreenScrollView>
      <AttendanceCheckoutFlow
        visible={showAttendanceCheckout}
        userId={user!.id}
        onCancel={() => setShowAttendanceCheckout(false)}
        onCheckedOut={loadData}
        onStartVisit={(type: AttendanceNextAction) =>
          navigation.navigate("FieldVisits", { startVisitIntent: type })
        }
      />
      </>
    );
  }

  // ── Check-in form ─────────────────────────────────────────────────────────
  return (
    <ScreenScrollView>
      <View style={[styles.card, { backgroundColor: theme.backgroundDefault }]}>
        <ThemedText type="h1">
          {today.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
        </ThemedText>
        <ThemedText type="small" style={{ color: theme.textSecondary }}>
          {today.toLocaleDateString("en-US", {
            weekday: "long",
            month: "long",
            day: "numeric",
          })}
        </ThemedText>

        <Spacer height={Spacing.lg} />

        {/* Tab toggle */}
        <View style={styles.tabRow}>
          {(["OFFICE", "SITE"] as const).map((t) => (
            <TouchableOpacity
              key={t}
              style={[
                styles.tabBtn,
                tab === t && { backgroundColor: theme.primary },
              ]}
              onPress={() => setTab(t)}
            >
              <ThemedText
                style={[styles.tabText, tab === t && { color: "#fff" }]}
              >
                {t === "OFFICE" ? "Office" : "Site Visit"}
              </ThemedText>
            </TouchableOpacity>
          ))}
        </View>

        <Spacer height={Spacing.lg} />

        {tab === "OFFICE" ? (
          <>
            <ThemedText type="body" style={styles.label}>
              Office (auto-detected from your location)
            </ThemedText>
            {/* Native HTML select — works reliably in Edge/Chrome on web */}
            {Platform.OS === "web" ? (
              <select
                value={selectedOfficeId}
                onChange={(e) => setSelectedOfficeId(e.target.value)}
                style={{
                  width: "100%",
                  padding: "12px",
                  fontSize: "15px",
                  borderRadius: "8px",
                  border: "1px solid #ddd",
                  backgroundColor: theme.backgroundRoot,
                  color: theme.text,
                  marginBottom: "16px",
                  outline: "none",
                  cursor: "pointer",
                }}
              >
                <option value="">— Select Office —</option>
                {offices.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.name}
                  </option>
                ))}
              </select>
            ) : (
              // Native fallback
              offices.map((o) => (
                <TouchableOpacity
                  key={o.id}
                  style={[
                    styles.officeRow,
                    selectedOfficeId === o.id && {
                      borderColor: theme.primary,
                      backgroundColor: theme.primary + "10",
                    },
                  ]}
                  onPress={() => setSelectedOfficeId(o.id)}
                >
                  <ThemedText
                    style={{
                      color:
                        selectedOfficeId === o.id ? theme.primary : theme.text,
                    }}
                  >
                    {o.name}
                  </ThemedText>
                  {selectedOfficeId === o.id && (
                    <Feather name="check" size={16} color={theme.primary} />
                  )}
                </TouchableOpacity>
              ))
            )}

            <TouchableOpacity
              style={[styles.btn, { backgroundColor: theme.primary }]}
              onPress={handleCheckIn}
              activeOpacity={0.8}
            >
              {isLoading ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <ThemedText style={styles.btnText}>Check In</ThemedText>
              )}
            </TouchableOpacity>
          </>
        ) : (
          <>
            <ThemedText type="body" style={styles.label}>
              Purpose of Site Visit
            </ThemedText>
            <TextInput
              style={[
                styles.textInput,
                { backgroundColor: theme.backgroundRoot, color: theme.text },
              ]}
              placeholder="Describe the purpose..."
              placeholderTextColor={theme.textSecondary}
              value={purpose}
              onChangeText={setPurpose}
              multiline
              numberOfLines={3}
            />
            <Spacer height={Spacing.lg} />
            <TouchableOpacity
              style={[styles.btn, { backgroundColor: theme.primary }]}
              onPress={handleSiteVisit}
              activeOpacity={0.8}
            >
              {isLoading ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <ThemedText style={styles.btnText}>
                  Request Site Visit
                </ThemedText>
              )}
            </TouchableOpacity>
          </>
        )}
      </View>
      <Spacer height={100} />
    </ScreenScrollView>
  );
}

const styles = StyleSheet.create({
  card: {
    padding: Spacing.xl,
    borderRadius: BorderRadius.lg,
    alignItems: "center",
  },
  badge: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.sm,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    borderRadius: BorderRadius.full,
  },
  tabRow: {
    flexDirection: "row",
    width: "100%",
    borderRadius: BorderRadius.md,
    overflow: "hidden",
    borderWidth: 1,
    borderColor: "#ddd",
  },
  tabBtn: {
    flex: 1,
    paddingVertical: 10,
    alignItems: "center",
    backgroundColor: "transparent",
  },
  tabText: { fontWeight: "600", fontSize: 14, color: "#666" },
  label: { alignSelf: "flex-start", marginBottom: 8, fontWeight: "600" },
  btn: {
    width: "100%",
    height: 50,
    borderRadius: BorderRadius.md,
    alignItems: "center",
    justifyContent: "center",
  },
  btnText: { color: "#fff", fontWeight: "700", fontSize: 16 },
  officeRow: {
    width: "100%",
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    padding: 14,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "#ddd",
    marginBottom: 8,
  },
  textInput: {
    padding: Spacing.md,
    borderRadius: BorderRadius.md,
    fontSize: 16,
    textAlignVertical: "top",
    minHeight: 80,
    width: "100%",
  },
});
