import React, { useState, useEffect, useCallback } from "react";
import {
  StyleSheet,
  View,
  Pressable,
  Alert,
  Platform,
  ActivityIndicator,
  Modal,
} from "react-native";
import { Feather } from "@expo/vector-icons";
import * as Location from "expo-location";
import { useFocusEffect, useNavigation } from "@react-navigation/native";
import { ScreenScrollView } from "@/components/ScreenScrollView";
import { ThemedText } from "@/components/ThemedText";
import { Button } from "@/components/Button";
import { useTheme } from "@/hooks/useTheme";
import { Spacing, BorderRadius, Colors } from "@/constants/theme";
import Spacer from "@/components/Spacer";
import { AttendanceStorage, AttendanceRecord } from "@/utils/storage";
import { AttendanceService, GeoFenceError } from "@/services/attendance.service";
import { OfficeService } from "@/services/office.service";
import { useAuth } from "@/contexts/AuthContext";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useLocationMonitor } from "@/hooks/useLocationMonitor";

type AttendanceStatus = "present" | "absent" | "late" | "wfh" | "leave";

const STATUS_COLORS: Record<AttendanceStatus, string> = {
  present: Colors.light.success,
  absent: Colors.light.error,
  late: Colors.light.warning,
  wfh: Colors.light.info,
  leave: Colors.light.primary,
};

function CalendarDay({
  day,
  status,
  isToday,
  isSelected,
  onPress,
}: {
  day: number;
  status?: AttendanceStatus;
  isToday: boolean;
  isSelected: boolean;
  onPress: () => void;
}) {
  const { theme } = useTheme();
  const bgColor = status ? STATUS_COLORS[status] + "30" : "transparent";
  const dotColor = status ? STATUS_COLORS[status] : "transparent";

  return (
    <Pressable
      style={({ pressed }) => [
        styles.calendarDay,
        {
          backgroundColor: isSelected ? theme.primary : bgColor,
          borderColor: isToday ? theme.primary : "transparent",
          borderWidth: isToday && !isSelected ? 2 : 0,
          opacity: pressed ? 0.7 : 1,
        },
      ]}
      onPress={onPress}
    >
      <ThemedText
        type="body"
        style={[styles.dayText, { color: isSelected ? "#FFFFFF" : theme.text }]}
      >
        {day}
      </ThemedText>
      {status && !isSelected ? (
        <View style={[styles.statusDot, { backgroundColor: dotColor }]} />
      ) : null}
    </Pressable>
  );
}

export default function AttendanceScreen() {
  const { theme } = useTheme();
  const { user } = useAuth();
  const navigation = useNavigation();
  const insets = useSafeAreaInsets();
  const [todayRecord, setTodayRecord] = useState<AttendanceRecord | null>(null);
  const [monthRecords, setMonthRecords] = useState<AttendanceRecord[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [locationPermission, setLocationPermission] = useState<boolean | null>(
    null,
  );
  const [selectedDate, setSelectedDate] = useState(new Date().getDate());
  const [offices, setOffices] = useState<any[]>([]);
  const [selectedOffice, setSelectedOffice] = useState<any | null>(null);
  const [activeOffice, setActiveOffice] = useState<any | null>(null);
  const [showOfficeModal, setShowOfficeModal] = useState(false);
  const [checkInCoords, setCheckInCoords] = useState<{ latitude: number; longitude: number } | null>(null);

  const monitorOffice = activeOffice ?? selectedOffice;

  useLocationMonitor({
    userId: user?.id || "",
    officeId: monitorOffice?.id || "",
    officeLat: monitorOffice?.latitude ?? 0,
    officeLon: monitorOffice?.longitude ?? 0,
    officeRadius: monitorOffice?.attendance_radius ?? 200,
    officeName: monitorOffice?.name || "your assigned location",
    active:
      !!user?.id &&
      !!todayRecord?.checkIn &&
      !todayRecord?.checkOut &&
      !!monitorOffice?.id &&
      monitorOffice?.latitude != null &&
      monitorOffice?.longitude != null,
    onCheckOut: async () => {
      if (!user?.id) return;
      const location = await getLocation();
      await AttendanceService.checkOut({
        userId: user.id,
        location: location || undefined,
      });
      const now = new Date().toISOString();
      if (todayRecord) {
        const checkedOutRecord = { ...todayRecord, checkOut: now };
        await AttendanceStorage.add(checkedOutRecord);
        setTodayRecord(checkedOutRecord);
      }
      await loadData();
    },
  });

  const today = new Date();
  const daysInMonth = new Date(
    today.getFullYear(),
    today.getMonth() + 1,
    0,
  ).getDate();
  const firstDayOfMonth = new Date(
    today.getFullYear(),
    today.getMonth(),
    1,
  ).getDay();
  const monthName = today.toLocaleString("default", {
    month: "long",
    year: "numeric",
  });

  const loadData = useCallback(async () => {
    try {
      let attendanceOfficeId: string | null = null;
      // Load from local storage first
      const [todayRec, allRecords] = await Promise.all([
        AttendanceStorage.getTodayRecord(),
        AttendanceStorage.getAll(),
      ]);

      // Load local data immediately
      setTodayRecord(todayRec);

      const thisMonthRecords = allRecords.filter((r) => {
        const recordDate = new Date(r.date);
        return (
          recordDate.getMonth() === today.getMonth() &&
          recordDate.getFullYear() === today.getFullYear()
        );
      });
      setMonthRecords(thisMonthRecords);

      // Only try database operations if user is authenticated
      if (user?.id) {
        try {
          // Get today's attendance from database
          const result = await AttendanceService.getToday(user.id);
          if (result.data) {
            const dbRecord: AttendanceRecord = {
              id: result.data.id,
              date: result.data.date,
              checkIn: result.data.checkin_time,
              checkOut: result.data.checkout_time,
              status:
                result.data.status === "CHECKED_IN" || result.data.status === "CHECKED_OUT"
                  ? result.data.checkin_time && new Date(result.data.checkin_time).getHours() >= 10
                    ? "late"
                    : "present"
                  : "absent",
            };
            setTodayRecord(dbRecord);
            attendanceOfficeId = result.data.office_id ?? null;
            if (result.data.checkin_location) {
              setCheckInCoords(result.data.checkin_location);
            }
          } else {
            // DB has no record for today — clear any stale local record
            setTodayRecord(null);
          }
        } catch (err: any) {
          console.warn("Failed to load attendance from database:", err?.message);
        }

        // Load offices list
        try {
          const officeList = await OfficeService.getAllOffices();
          if (officeList && officeList.length > 0) {
            setOffices(officeList);
            if (attendanceOfficeId) {
              setActiveOffice(officeList.find((office) => office.id === attendanceOfficeId) || null);
            }
            if (officeList.length === 1) {
              setSelectedOffice(officeList[0]);
            }
          } else {
            console.warn("No offices found in database");
            setOffices([]);
          }
        } catch (err: any) {
          console.warn("Failed to load offices:", err?.message);
          setOffices([]);
          // User can still mark attendance locally
        }
      }
    } catch (error: any) {
      console.error("Failed to load data:", error?.message);
      // Still show local data even if database fails
    }
  }, [user?.id]);

  useFocusEffect(
    useCallback(() => {
      loadData();
      checkLocationPermission();
    }, [loadData]),
  );

  const checkLocationPermission = async () => {
    const { status } = await Location.getForegroundPermissionsAsync();
    setLocationPermission(status === "granted");
  };

  const requestLocationPermission = async () => {
    const { status } = await Location.requestForegroundPermissionsAsync();
    setLocationPermission(status === "granted");
    return status === "granted";
  };

  // Extracted so the office modal can pass the selected office directly,
  // avoiding the React async-state race where selectedOffice is still stale.
  const getLocation = (): Promise<{ latitude: number; longitude: number } | null> => {
    if (Platform.OS === "web") {
      return new Promise((resolve) => {
        if (!navigator?.geolocation) {
          Alert.alert("Location Not Supported", "Your browser does not support location. Please use the mobile app.");
          resolve(null);
          return;
        }
        navigator.geolocation.getCurrentPosition(
          (pos) => resolve({ latitude: pos.coords.latitude, longitude: pos.coords.longitude }),
          (err) => {
            if (err.code === 1) {
              Alert.alert("Location Blocked", "Location access was denied. Please allow location in your browser and try again.");
            } else {
              Alert.alert("Location Error", "Could not get your location. Please try again.");
            }
            resolve(null);
          },
          { enableHighAccuracy: false, timeout: 10000, maximumAge: 60000 }
        );
      });
    }
    return Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced })
      .then((loc) => ({ latitude: loc.coords.latitude, longitude: loc.coords.longitude }))
      .catch(() => null);
  };

  const executeCheckIn = async (office: any) => {
    setIsLoading(true);
    try {
      if (Platform.OS !== "web") {
        const granted = locationPermission || (await requestLocationPermission());
        if (!granted) {
          Alert.alert(
            "Location Required",
            "Please enable location permission in your device settings to check in."
          );
          return;
        }
      }

      const location = await getLocation();
      if (!location) return;

      // Pass any office — officeCheckIn auto-detects the nearest one across all offices
      await AttendanceService.officeCheckIn({
        userId: user!.id,
        office,
        location,
        distance: 0,
      });

      setCheckInCoords(location);
      setActiveOffice(office);

      const now = new Date();
      const newRecord: AttendanceRecord = {
        id: "att_" + Date.now(),
        date: now.toISOString().split("T")[0],
        checkIn: now.toISOString(),
        status: now.getHours() >= 10 ? "late" : "present",
        location,
      };
      await AttendanceStorage.add(newRecord);
      setTodayRecord(newRecord);
      await loadData();

      Alert.alert(
        "✅ Check-In Successful",
        `Checked in at ${now.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`,
      );
    } catch (err: any) {
      if (err instanceof GeoFenceError) {
        const distM = Math.round(err.distanceMetres);
        Alert.alert(
          "📍 Not Near Any Office",
          `You are ${distM}m away from the nearest office (${err.officeName}).\n\nYou must be within ${err.radiusMetres}m of any company office to check in.`,
          [{ text: "OK" }]
        );
        return;
      }
      Alert.alert("Check-In Failed", err?.message || "An unexpected error occurred. Please try again.");
    } finally {
      setIsLoading(false);
      setShowOfficeModal(false);
    }
  };

  const handleCheckIn = async () => {
    if (todayRecord?.checkIn) {
      Alert.alert("Already Checked In", "You have already checked in today.");
      return;
    }
    if (!user?.id) {
      Alert.alert("Error", "You must be logged in.");
      return;
    }

    setIsLoading(true);
    let officeList: any[] = [];
    try {
      officeList = (await OfficeService.getAllOffices()) || [];
      setOffices(officeList);
    } catch {
      Alert.alert("Connection Issue", "Unable to load offices. Please try again.");
      setIsLoading(false);
      return;
    }

    if (officeList.length === 0) {
      Alert.alert("No Offices Found", "No offices configured. Contact your admin.");
      setIsLoading(false);
      return;
    }

    if (officeList.length === 1) {
      // executeCheckIn manages isLoading itself from here
      executeCheckIn(officeList[0]);
      return;
    }

    // Multiple offices — show picker, executeCheckIn called from modal
    setIsLoading(false);
    setShowOfficeModal(true);
  };

  const handleCheckOut = async () => {
    if (!todayRecord?.checkIn) {
      Alert.alert("Not Checked In", "Please check in first.");
      return;
    }
    if (todayRecord?.checkOut) {
      Alert.alert("Already Checked Out", "You have already checked out today.");
      return;
    }
    // Navigate to Field Visits — attendance completes when user picks "Going Home"
    (navigation as any).navigate("HomeTab", { screen: "FieldVisits" });
  };

  const getRecordForDay = (day: number): AttendanceRecord | undefined => {
    const dateStr = new Date(today.getFullYear(), today.getMonth(), day)
      .toISOString()
      .split("T")[0];
    return monthRecords.find((r) => r.date === dateStr);
  };

  const presentDays = monthRecords.filter((r) => r.status === "present").length;
  const lateDays = monthRecords.filter((r) => r.status === "late").length;
  const absentDays = monthRecords.filter((r) => r.status === "absent").length;

  const renderCalendar = () => {
    const weekDays = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
    const days = [];

    for (let i = 0; i < firstDayOfMonth; i++) {
      days.push(<View key={`empty-${i}`} style={styles.calendarDay} />);
    }

    for (let day = 1; day <= daysInMonth; day++) {
      const record = getRecordForDay(day);
      const isToday = day === today.getDate();
      days.push(
        <CalendarDay
          key={day}
          day={day}
          status={record?.status}
          isToday={isToday}
          isSelected={day === selectedDate}
          onPress={() => setSelectedDate(day)}
        />,
      );
    }

    return (
      <View
        style={[styles.calendar, { backgroundColor: theme.backgroundDefault }]}
      >
        <ThemedText type="h4" style={styles.calendarTitle}>
          {monthName}
        </ThemedText>
        <View style={styles.weekDaysRow}>
          {weekDays.map((d) => (
            <ThemedText
              key={d}
              type="caption"
              style={[styles.weekDay, { color: theme.textSecondary }]}
            >
              {d}
            </ThemedText>
          ))}
        </View>
        <View style={styles.daysGrid}>{days}</View>
      </View>
    );
  };

  return (
    <ScreenScrollView>
      {/* Web-only: keep tab open warning when checked in */}
      {Platform.OS === "web" && todayRecord?.checkIn && !todayRecord?.checkOut && (
        <View style={styles.keepOpenBanner}>
          <Feather name="wifi" size={14} color="#92400E" />
          <ThemedText type="caption" style={styles.keepOpenText}>
            GPS tracking is active. Keep this tab open — closing the browser stops location updates.
          </ThemedText>
        </View>
      )}

      {/* Hero Check-In Card */}
      <View style={[styles.checkInCard, { backgroundColor: theme.primary }]}>
        <View style={styles.timeDisplay}>
          <ThemedText type="h1" style={{ color: "#FFFFFF", fontSize: 42, fontWeight: "800" }}>
            {today.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
          </ThemedText>
          <ThemedText type="small" style={{ color: "rgba(255,255,255,0.75)" }}>
            {today.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" })}
          </ThemedText>
        </View>

        <Spacer height={Spacing.lg} />

        <View style={styles.statusRow}>
          {todayRecord?.checkIn ? (
            <View style={[styles.statusBadge, { backgroundColor: "rgba(255,255,255,0.2)" }]}>
              <Feather name="log-in" size={14} color="#FFFFFF" />
              <ThemedText type="small" style={{ color: "#FFFFFF" }}>
                In: {new Date(todayRecord.checkIn).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
              </ThemedText>
            </View>
          ) : null}
          {todayRecord?.checkOut ? (
            <View style={[styles.statusBadge, { backgroundColor: "rgba(255,255,255,0.2)" }]}>
              <Feather name="log-out" size={14} color="#FFFFFF" />
              <ThemedText type="small" style={{ color: "#FFFFFF" }}>
                Out: {new Date(todayRecord.checkOut).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
              </ThemedText>
            </View>
          ) : null}
        </View>

        <Spacer height={Spacing.xl} />

        <View style={styles.buttonsRow}>
          <Pressable
            onPress={handleCheckIn}
            disabled={isLoading || !!todayRecord?.checkIn}
            style={[
              styles.checkButton,
              { backgroundColor: "#FFFFFF", opacity: (isLoading || !!todayRecord?.checkIn) ? 0.5 : 1 },
            ]}
          >
            {isLoading
              ? <ActivityIndicator color={theme.primary} />
              : <ThemedText type="body" style={{ color: theme.primary, fontWeight: "700" }}>Check In</ThemedText>
            }
          </Pressable>
          <Pressable
            onPress={handleCheckOut}
            disabled={isLoading || !todayRecord?.checkIn || !!todayRecord?.checkOut}
            style={[
              styles.checkButton,
              {
                backgroundColor: "rgba(255,255,255,0.2)",
                borderWidth: 1.5,
                borderColor: "#FFFFFF",
                opacity: (isLoading || !todayRecord?.checkIn || !!todayRecord?.checkOut) ? 0.5 : 1,
              },
            ]}
          >
            {isLoading
              ? <ActivityIndicator color="#FFFFFF" />
              : <ThemedText type="body" style={{ color: "#FFFFFF", fontWeight: "700" }}>Check Out</ThemedText>
            }
          </Pressable>
        </View>

        {!locationPermission && Platform.OS !== "web" ? (
          <>
            <Spacer height={Spacing.md} />
            <Pressable
              onPress={requestLocationPermission}
              style={({ pressed }) => [styles.locationBtn, { opacity: pressed ? 0.7 : 1 }]}
            >
              <Feather name="map-pin" size={14} color="rgba(255,255,255,0.8)" />
              <ThemedText type="caption" style={{ color: "rgba(255,255,255,0.8)" }}>
                Enable location for accurate attendance
              </ThemedText>
            </Pressable>
          </>
        ) : null}
      </View>

      <Spacer height={Spacing.xl} />

      <View style={styles.summaryRow}>
        <View
          style={[
            styles.summaryCard,
            { backgroundColor: Colors.light.successBg },
          ]}
        >
          <ThemedText type="h3" style={{ color: Colors.light.successText }}>
            {presentDays}
          </ThemedText>
          <ThemedText
            type="caption"
            style={{ color: Colors.light.successText }}
          >
            Present
          </ThemedText>
        </View>
        <View
          style={[
            styles.summaryCard,
            { backgroundColor: Colors.light.warningBg },
          ]}
        >
          <ThemedText type="h3" style={{ color: Colors.light.warningText }}>
            {lateDays}
          </ThemedText>
          <ThemedText
            type="caption"
            style={{ color: Colors.light.warningText }}
          >
            Late
          </ThemedText>
        </View>
        <View
          style={[
            styles.summaryCard,
            { backgroundColor: Colors.light.errorBg },
          ]}
        >
          <ThemedText type="h3" style={{ color: Colors.light.errorText }}>
            {absentDays}
          </ThemedText>
          <ThemedText type="caption" style={{ color: Colors.light.errorText }}>
            Absent
          </ThemedText>
        </View>
      </View>

      <Spacer height={Spacing.xl} />

      {renderCalendar()}

      <Spacer height={Spacing.lg} />

      <View style={styles.legendRow}>
        {(
          ["present", "late", "absent", "wfh", "leave"] as AttendanceStatus[]
        ).map((status) => (
          <View key={status} style={styles.legendItem}>
            <View
              style={[
                styles.legendDot,
                { backgroundColor: STATUS_COLORS[status] },
              ]}
            />
            <ThemedText
              type="caption"
              style={{
                color: theme.textSecondary,
                textTransform: "capitalize",
              }}
            >
              {status === "wfh" ? "WFH" : status}
            </ThemedText>
          </View>
        ))}
      </View>

      <Spacer height={Spacing["2xl"]} />

      <Modal
        visible={showOfficeModal}
        transparent
        animationType="slide"
        onRequestClose={() => setShowOfficeModal(false)}
      >
        <View style={styles.modalOverlay}>
          <Pressable
            style={StyleSheet.absoluteFill}
            onPress={() => setShowOfficeModal(false)}
          />
          <View
            style={[
              styles.officeModal,
              { backgroundColor: theme.backgroundDefault, paddingBottom: insets.bottom + Spacing.md },
            ]}
          >
            <ThemedText type="h3" style={{ marginBottom: Spacing.lg }}>
              Select Your Office
            </ThemedText>
            {offices.map((item) => (
              <Pressable
                key={item.id}
                style={[
                  styles.officeOption,
                  {
                    backgroundColor: selectedOffice?.id === item.id ? theme.primary + "20" : "transparent",
                    borderColor: selectedOffice?.id === item.id ? theme.primary : theme.textSecondary,
                  },
                ]}
                onPress={() => {
                  setShowOfficeModal(false);
                  setSelectedOffice(item);
                  executeCheckIn(item);
                }}
              >
                <Feather
                  name={selectedOffice?.id === item.id ? "check-circle" : "map-pin"}
                  size={18}
                  color={selectedOffice?.id === item.id ? theme.primary : theme.textSecondary}
                />
                <View style={{ flex: 1 }}>
                  <ThemedText type="body">{item.name}</ThemedText>
                  <ThemedText type="caption" style={{ color: theme.textSecondary }}>
                    {item.latitude ? `📍 Geo-fenced · ${item.attendance_radius}m radius` : `${item.attendance_radius}m radius`}
                  </ThemedText>
                </View>
              </Pressable>
            ))}
            <Button
              onPress={() => setShowOfficeModal(false)}
              style={{ marginTop: Spacing.lg, backgroundColor: Colors.light.error }}
            >
              Cancel
            </Button>
          </View>
        </View>
      </Modal>
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
  statusRow: {
    flexDirection: "row",
    gap: Spacing.md,
    flexWrap: "wrap",
    justifyContent: "center",
  },
  statusBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.sm,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    borderRadius: BorderRadius.full,
  },
  buttonsRow: {
    flexDirection: "row",
    gap: Spacing.md,
    width: "100%",
  },
  checkButton: {
    flex: 1,
    height: 48,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
  },
  locationBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.sm,
  },
  summaryRow: {
    flexDirection: "row",
    gap: Spacing.md,
  },
  summaryCard: {
    flex: 1,
    alignItems: "center",
    padding: Spacing.lg,
    borderRadius: BorderRadius.md,
  },
  calendar: {
    padding: Spacing.lg,
    borderRadius: BorderRadius.lg,
  },
  calendarTitle: {
    textAlign: "center",
    marginBottom: Spacing.md,
  },
  weekDaysRow: {
    flexDirection: "row",
    marginBottom: Spacing.sm,
  },
  weekDay: {
    flex: 1,
    textAlign: "center",
  },
  daysGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
  },
  calendarDay: {
    width: "14.28%",
    aspectRatio: 1,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: BorderRadius.full,
    position: "relative",
  },
  dayText: {
    fontWeight: "500",
  },
  statusDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    position: "absolute",
    bottom: 4,
  },
  legendRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: Spacing.lg,
    justifyContent: "center",
  },
  legendItem: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.xs,
  },
  legendDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
  },
  modalOverlay: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: "rgba(0,0,0,0.55)",
  },
  officeModal: {
    width: "85%",
    maxHeight: "70%",
    borderRadius: BorderRadius.lg,
    padding: Spacing.lg,
    elevation: 5,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 3.84,
  },
  officeOption: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.md,
    padding: Spacing.md,
    borderRadius: BorderRadius.md,
    borderWidth: 1,
    marginBottom: Spacing.sm,
  },
  keepOpenBanner: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.sm,
    backgroundColor: "#FEF3C7",
    borderLeftWidth: 3,
    borderLeftColor: "#F59E0B",
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.md,
    marginBottom: Spacing.sm,
  },
  keepOpenText: {
    flex: 1,
    color: "#92400E",
    fontSize: 12,
  },
});
