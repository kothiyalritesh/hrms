import React, { useState, useEffect, useCallback } from "react";
import {
  StyleSheet,
  View,
  Alert,
  ActivityIndicator,
  TextInput,
} from "react-native";
import Feather from "@expo/vector-icons/Feather";
import * as Location from "expo-location";
import { Platform } from "react-native";

function MiniMap({ centerCoord, extraCoord, extraLabel }: { centerCoord: { latitude: number; longitude: number }; extraCoord?: { latitude: number; longitude: number } | null; extraLabel?: string }) {
  if (Platform.OS === "web") {
    const GMAPS_KEY = process.env.EXPO_PUBLIC_GOOGLE_MAPS_API_KEY ?? "";
    const center = extraCoord ? { lat: (centerCoord.latitude + extraCoord.latitude) / 2, lng: (centerCoord.longitude + extraCoord.longitude) / 2 } : { lat: centerCoord.latitude, lng: centerCoord.longitude };
    const mapUrl = `https://www.google.com/maps/embed/v1/view?key=${GMAPS_KEY}&center=${center.lat},${center.lng}&zoom=16`;
    // @ts-ignore
    return <iframe src={mapUrl} style={{ width: "100%", height: 200, border: "none", borderRadius: 8 }} title="map" allowFullScreen loading="lazy" />;
  }
  // Native: coordinate badge
  return (
    <View style={{ height: 60, borderRadius: 8, backgroundColor: "#F3F4F6", alignItems: "center", justifyContent: "center" }}>
      <ThemedText style={{ fontSize: 12, color: "#60045d", fontWeight: "600" }}>
        📍 {centerCoord.latitude.toFixed(5)}, {centerCoord.longitude.toFixed(5)}
      </ThemedText>
    </View>
  );
}
import { Picker } from "@react-native-picker/picker";
import { useFocusEffect } from "@react-navigation/native";
import { ScreenScrollView } from "@/components/ScreenScrollView";
import { ThemedText } from "@/components/ThemedText";
import { Button } from "@/components/Button";
import { useTheme } from "@/hooks/useTheme";
import { useAuth } from "@/contexts/AuthContext";
import { Spacing, BorderRadius, Colors } from "@/constants/theme";
import Spacer from "@/components/Spacer";
import { AttendanceService } from "@/services/attendance.service";
import { OfficeService } from "@/services/office.service";
import { supabase } from "@/lib/supabase";

export default function AttendanceScreen() {
  const { theme } = useTheme();
  const { user } = useAuth();
  const [todayRecord, setTodayRecord] = useState<any>(null);
  const [offices, setOffices] = useState<any[]>([]);
  const [selectedOffice, setSelectedOffice] = useState<any>(null);
  const [userLocation, setUserLocation] = useState<any>(null);
  const [distance, setDistance] = useState<number | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [attendanceType, setAttendanceType] = useState<"OFFICE" | "SITE">(
    "OFFICE",
  );
  const [purpose, setPurpose] = useState("");

  const today = new Date();

  const loadData = useCallback(async () => {
    if (!user?.id) return;

    const [todayRec, officesData] = await Promise.all([
      AttendanceService.getToday(user.id),
      OfficeService.getAllOffices(),
    ]);
    setTodayRecord(todayRec.data);
    setOffices(officesData || []);
  }, [user?.id]);

  useFocusEffect(
    useCallback(() => {
      loadData();
    }, [loadData]),
  );

  const getLocation = async () => {
    const { status } = await Location.requestForegroundPermissionsAsync();
    if (status !== "granted") throw new Error("Location denied");

    const loc = await Location.getCurrentPositionAsync({
      accuracy: Location.Accuracy.Highest,
    });

    setUserLocation({
      latitude: loc.coords.latitude,
      longitude: loc.coords.longitude,
    });
  };

  const getSiteLocation = async () => {
    const { status } = await Location.requestForegroundPermissionsAsync();
    if (status !== "granted") {
      Alert.alert(
        "Permission Required",
        "Location permission is required for site visits.",
      );
      return;
    }

    const loc = await Location.getCurrentPositionAsync({
      accuracy: Location.Accuracy.High,
    });

    setUserLocation({
      latitude: loc.coords.latitude,
      longitude: loc.coords.longitude,
    });
  };

  const distanceInMeters = (
    lat1: number,
    lon1: number,
    lat2: number,
    lon2: number,
  ) => {
    const R = 6371000;
    const toRad = (v: number) => (v * Math.PI) / 180;

    const dLat = toRad(lat2 - lat1);
    const dLon = toRad(lon2 - lon1);

    const a =
      Math.sin(dLat / 2) ** 2 +
      Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;

    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  };

  useEffect(() => {
    if (selectedOffice && userLocation && attendanceType === "OFFICE") {
      const d = distanceInMeters(
        userLocation.latitude,
        userLocation.longitude,
        selectedOffice.latitude,
        selectedOffice.longitude,
      );
      setDistance(Math.round(d));
    }
  }, [selectedOffice, userLocation, attendanceType]);

  useEffect(() => {
    if (selectedOffice && attendanceType === "OFFICE") {
      getLocation().catch(console.error);
    }
  }, [selectedOffice, attendanceType]);

  const handleCheckIn = async () => {
    if (todayRecord?.checkin_time) {
      Alert.alert(
        "Already Checked In",
        "You have already marked your attendance for today.",
      );
      return;
    }

    if (!selectedOffice) {
      Alert.alert("Select Office", "Please select an office to check in.");
      return;
    }

    if (!userLocation) {
      Alert.alert("Location Required", "Please enable location to check in.");
      return;
    }

    setIsLoading(true);

    try {
      await AttendanceService.officeCheckIn({
        userId: user!.id,
        office: selectedOffice,
        location: userLocation,
        distance: distance!,
      });

      await loadData();

      const warningMsg =
        distance! > selectedOffice.attendance_radius
          ? " (Warning: Outside office radius)"
          : "";

      Alert.alert(
        "Check-In Successful",
        `You checked in at ${selectedOffice.name}${warningMsg}`,
      );
    } catch (error) {
      Alert.alert("Error", "Failed to mark attendance. Please try again.");
    } finally {
      setIsLoading(false);
    }
  };

  const handleSiteVisitRequest = async () => {
    if (!purpose.trim()) {
      Alert.alert(
        "Purpose Required",
        "Please enter the purpose of your site visit.",
      );
      return;
    }

    if (!userLocation) {
      Alert.alert(
        "Location Required",
        "Please enable location to request site visit.",
      );
      return;
    }

    setIsLoading(true);

    try {
      await supabase.from("attendance_requests").insert({
        user_id: user!.id,
        attendance_type: "SITE",
        requested_location: {
          latitude: userLocation.latitude,
          longitude: userLocation.longitude,
        },
        purpose,
      });

      // Notify manager
      const { data: profile } = await supabase
        .from("profiles")
        .select("reports_to, name")
        .eq("id", user!.id)
        .maybeSingle();

      if (profile?.reports_to) {
        await supabase.from("notifications").insert({
          user_id: profile.reports_to,
          title: "📍 Site Visit Approval",
          message: `${profile.name} requested site visit attendance`,
          type: "attendance_request",
        });
      }

      Alert.alert(
        "Request Submitted",
        "Your site visit request has been sent to your manager for approval.",
      );
      setPurpose("");
      setUserLocation(null);
    } catch (error) {
      Alert.alert(
        "Error",
        "Failed to submit site visit request. Please try again.",
      );
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <ScreenScrollView>
      <View
        style={[
          styles.checkInCard,
          { backgroundColor: theme.backgroundDefault },
        ]}
      >
        <View style={styles.timeDisplay}>
          <ThemedText type="h1">
            {today.toLocaleTimeString([], {
              hour: "2-digit",
              minute: "2-digit",
            })}
          </ThemedText>
          <ThemedText type="small" style={{ color: theme.textSecondary }}>
            {today.toLocaleDateString("en-US", {
              weekday: "long",
              month: "long",
              day: "numeric",
            })}
          </ThemedText>
        </View>

        <Spacer height={Spacing.lg} />

        {todayRecord?.checkin_time ? (
          <View
            style={[
              styles.statusBadge,
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
        ) : (
          <>
            <ThemedText type="h3" style={{ marginBottom: Spacing.md }}>
              Mark Attendance
            </ThemedText>

            <View
              style={[
                styles.pickerContainer,
                { backgroundColor: theme.backgroundRoot },
              ]}
            >
              <Picker
                selectedValue={attendanceType}
                onValueChange={(value) => {
                  setAttendanceType(value as "OFFICE" | "SITE");
                  setUserLocation(null);
                  setSelectedOffice(null);
                }}
                style={{ color: theme.text }}
              >
                <Picker.Item label="Office Attendance" value="OFFICE" />
                <Picker.Item label="Site Visit" value="SITE" />
              </Picker>
            </View>

            {attendanceType === "OFFICE" ? (
              <>
                <Spacer height={Spacing.md} />
                <View
                  style={[
                    styles.pickerContainer,
                    { backgroundColor: theme.backgroundRoot },
                  ]}
                >
                  <Picker
                    selectedValue={selectedOffice?.id}
                    onValueChange={(value) => {
                      const office = offices.find((o) => o.id === value);
                      setSelectedOffice(office);
                    }}
                    style={{ color: theme.text }}
                  >
                    <Picker.Item label="Select Office" value={null} />
                    {offices.map((o) => (
                      <Picker.Item key={o.id} label={o.name} value={o.id} />
                    ))}
                  </Picker>
                </View>

                {selectedOffice && (
                  <>
                    <Spacer height={Spacing.lg} />

                    <View
                      style={[
                        styles.officeInfo,
                        { backgroundColor: theme.backgroundRoot },
                      ]}
                    >
                      <ThemedText type="body" style={{ fontWeight: "600" }}>
                        {selectedOffice.name}
                      </ThemedText>

                      {distance !== null && (
                        <ThemedText
                          type="caption"
                          style={{
                            color:
                              distance > selectedOffice.attendance_radius
                                ? Colors.light.warning
                                : Colors.light.success,
                            fontWeight: "600",
                          }}
                        >
                          Distance: {distance}m
                          {distance > selectedOffice.attendance_radius &&
                            " (Outside radius)"}
                        </ThemedText>
                      )}
                    </View>

                    {userLocation && (
                      <>
                        <Spacer height={Spacing.md} />
                        <MiniMap centerCoord={{ latitude: selectedOffice.latitude, longitude: selectedOffice.longitude }} extraCoord={userLocation} extraLabel="You" />
                      </>
                    )}

                    <Spacer height={Spacing.lg} />

                    <Button
                      onPress={handleCheckIn}
                      disabled={isLoading || !userLocation}
                      style={[
                        styles.checkButton,
                        { opacity: !userLocation || isLoading ? 0.5 : 1 },
                      ]}
                    >
                      {isLoading ? (
                        <ActivityIndicator color="#FFFFFF" />
                      ) : (
                        "Check In"
                      )}
                    </Button>
                  </>
                )}
              </>
            ) : (
              <>
                <Spacer height={Spacing.md} />

                <TextInput
                  style={[
                    styles.textInput,
                    {
                      backgroundColor: theme.backgroundRoot,
                      color: theme.text,
                    },
                  ]}
                  placeholder="Purpose of site visit"
                  placeholderTextColor={theme.textSecondary}
                  value={purpose}
                  onChangeText={setPurpose}
                  multiline
                  numberOfLines={3}
                />

                <Spacer height={Spacing.md} />

                <Button
                  onPress={getSiteLocation}
                  disabled={isLoading}
                  style={[
                    styles.checkButton,
                    { backgroundColor: Colors.light.info },
                  ]}
                >
                  {userLocation ? "Location Captured" : "Get Current Location"}
                </Button>

                {userLocation && (
                  <>
                    <Spacer height={Spacing.md} />
                    <MiniMap centerCoord={{ latitude: userLocation.latitude, longitude: userLocation.longitude }} />
                  </>
                )}

                <Spacer height={Spacing.lg} />

                <Button
                  onPress={handleSiteVisitRequest}
                  disabled={isLoading || !userLocation || !purpose.trim()}
                  style={[
                    styles.checkButton,
                    {
                      opacity:
                        !userLocation || !purpose.trim() || isLoading ? 0.5 : 1,
                    },
                  ]}
                >
                  {isLoading ? (
                    <ActivityIndicator color="#FFFFFF" />
                  ) : (
                    "Request Site Visit"
                  )}
                </Button>
              </>
            )}
          </>
        )}
      </View>

      <Spacer height={Spacing["2xl"]} />
    </ScreenScrollView>
  );
}

const styles = StyleSheet.create({
  checkInCard: {
    padding: Spacing.xl,
    borderRadius: BorderRadius.lg,
    alignItems: "center",
  },
  timeDisplay: {
    alignItems: "center",
  },
  statusBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.sm,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    borderRadius: BorderRadius.full,
  },
  pickerContainer: {
    borderRadius: BorderRadius.md,
    width: "100%",
  },
  officeInfo: {
    padding: Spacing.md,
    borderRadius: BorderRadius.md,
    alignItems: "center",
    gap: Spacing.xs,
    width: "100%",
  },
  map: {
    height: 200,
    width: "100%",
    borderRadius: BorderRadius.md,
  },
  checkButton: {
    width: "100%",
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
