import React, { useState, useEffect, useCallback } from "react";
import { StyleSheet, View, Alert, ActivityIndicator } from "react-native";
import Feather from "@expo/vector-icons/Feather";
import * as Location from "expo-location";
import { Platform } from "react-native";

function MiniMap({ officeCoord, userCoord }: { officeCoord: { latitude: number; longitude: number }; userCoord?: { latitude: number; longitude: number } | null }) {
  if (Platform.OS === "web") {
    const GMAPS_KEY = process.env.EXPO_PUBLIC_GOOGLE_MAPS_API_KEY ?? "";
    const markers = userCoord
      ? `markers=[{location:{lat:${officeCoord.latitude},lng:${officeCoord.longitude}},title:'Office',label:'🏢'},{location:{lat:${userCoord.latitude},lng:${userCoord.longitude}},title:'You',label:'📍'}]`
      : `markers=[{location:{lat:${officeCoord.latitude},lng:${officeCoord.longitude}},title:'Office',label:'🏢'}]`;
    const centerLat = userCoord ? (officeCoord.latitude + userCoord.latitude) / 2 : officeCoord.latitude;
    const centerLng = userCoord ? (officeCoord.longitude + userCoord.longitude) / 2 : officeCoord.longitude;
    const mapUrl = `https://www.google.com/maps/embed/v1/view?key=${GMAPS_KEY}&center=${centerLat},${centerLng}&zoom=16`;
    // @ts-ignore
    return <iframe src={mapUrl} style={{ width: "100%", height: 200, border: "none", borderRadius: 8 }} title="map" allowFullScreen loading="lazy" />;
  }
  // Native: coordinate badge
  return (
    <View style={{ height: 60, borderRadius: 8, backgroundColor: "#F3F4F6", alignItems: "center", justifyContent: "center" }}>
      <ThemedText style={{ fontSize: 12, color: "#60045d", fontWeight: "600" }}>
        📍 {officeCoord.latitude.toFixed(5)}, {officeCoord.longitude.toFixed(5)}
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

export default function AttendanceScreen() {
  const { theme } = useTheme();
  const { user } = useAuth();
  const [todayRecord, setTodayRecord] = useState<any>(null);
  const [offices, setOffices] = useState<any[]>([]);
  const [selectedOffice, setSelectedOffice] = useState<any>(null);
  const [userLocation, setUserLocation] = useState<any>(null);
  const [distance, setDistance] = useState<number | null>(null);
  const [isLoading, setIsLoading] = useState(false);

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
    if (selectedOffice && userLocation) {
      const d = distanceInMeters(
        userLocation.latitude,
        userLocation.longitude,
        selectedOffice.latitude,
        selectedOffice.longitude,
      );
      setDistance(Math.round(d));
    }
  }, [selectedOffice, userLocation]);

  useEffect(() => {
    if (selectedOffice) {
      getLocation().catch(console.error);
    }
  }, [selectedOffice]);

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
              Select Office
            </ThemedText>

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
                    <MiniMap officeCoord={{ latitude: selectedOffice.latitude, longitude: selectedOffice.longitude }} userCoord={userLocation} />
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
});
