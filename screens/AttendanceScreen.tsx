import React, { useState, useEffect, useCallback } from "react";
import { StyleSheet, View, Pressable, Alert, Platform, ActivityIndicator } from "react-native";
import { Feather } from "@expo/vector-icons";
import * as Location from "expo-location";
import { useFocusEffect } from "@react-navigation/native";
import { ScreenScrollView } from "@/components/ScreenScrollView";
import { ThemedText } from "@/components/ThemedText";
import { Button } from "@/components/Button";
import { useTheme } from "@/hooks/useTheme";
import { Spacing, BorderRadius, Colors } from "@/constants/theme";
import Spacer from "@/components/Spacer";
import { AttendanceStorage, AttendanceRecord } from "@/utils/storage";

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
  onPress 
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
        }
      ]}
      onPress={onPress}
    >
      <ThemedText 
        type="body" 
        style={[
          styles.dayText,
          { color: isSelected ? "#FFFFFF" : theme.text }
        ]}
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
  const [todayRecord, setTodayRecord] = useState<AttendanceRecord | null>(null);
  const [monthRecords, setMonthRecords] = useState<AttendanceRecord[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [locationPermission, setLocationPermission] = useState<boolean | null>(null);
  const [selectedDate, setSelectedDate] = useState(new Date().getDate());
  
  const today = new Date();
  const daysInMonth = new Date(today.getFullYear(), today.getMonth() + 1, 0).getDate();
  const firstDayOfMonth = new Date(today.getFullYear(), today.getMonth(), 1).getDay();
  const monthName = today.toLocaleString("default", { month: "long", year: "numeric" });

  const loadData = useCallback(async () => {
    const [todayRec, allRecords] = await Promise.all([
      AttendanceStorage.getTodayRecord(),
      AttendanceStorage.getAll(),
    ]);
    setTodayRecord(todayRec);
    
    const thisMonthRecords = allRecords.filter(r => {
      const recordDate = new Date(r.date);
      return recordDate.getMonth() === today.getMonth() && 
             recordDate.getFullYear() === today.getFullYear();
    });
    setMonthRecords(thisMonthRecords);
  }, []);

  useFocusEffect(
    useCallback(() => {
      loadData();
      checkLocationPermission();
    }, [loadData])
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

  const handleCheckIn = async () => {
    if (todayRecord?.checkIn) {
      Alert.alert("Already Checked In", "You have already marked your attendance for today.");
      return;
    }

    setIsLoading(true);
    
    try {
      let location: { latitude: number; longitude: number } | undefined;
      
      if (locationPermission || await requestLocationPermission()) {
        const loc = await Location.getCurrentPositionAsync({ 
          accuracy: Location.Accuracy.Balanced 
        });
        location = {
          latitude: loc.coords.latitude,
          longitude: loc.coords.longitude,
        };
      }

      const now = new Date();
      const isLate = now.getHours() >= 10;
      
      const newRecord: AttendanceRecord = {
        id: "att_" + Date.now(),
        date: now.toISOString().split("T")[0],
        checkIn: now.toISOString(),
        status: isLate ? "late" : "present",
        location,
      };

      await AttendanceStorage.add(newRecord);
      setTodayRecord(newRecord);
      await loadData();
      
      Alert.alert(
        "Check-In Successful", 
        `You checked in at ${now.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}${isLate ? " (Late)" : ""}`
      );
    } catch (error) {
      Alert.alert("Error", "Failed to mark attendance. Please try again.");
    } finally {
      setIsLoading(false);
    }
  };

  const handleCheckOut = async () => {
    if (!todayRecord?.checkIn) {
      Alert.alert("Not Checked In", "Please check in first before checking out.");
      return;
    }
    if (todayRecord?.checkOut) {
      Alert.alert("Already Checked Out", "You have already checked out for today.");
      return;
    }

    setIsLoading(true);
    
    try {
      const now = new Date();
      await AttendanceStorage.update(todayRecord.id, {
        checkOut: now.toISOString(),
      });
      
      await loadData();
      
      Alert.alert(
        "Check-Out Successful", 
        `You checked out at ${now.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`
      );
    } catch (error) {
      Alert.alert("Error", "Failed to check out. Please try again.");
    } finally {
      setIsLoading(false);
    }
  };

  const getRecordForDay = (day: number): AttendanceRecord | undefined => {
    const dateStr = new Date(today.getFullYear(), today.getMonth(), day).toISOString().split("T")[0];
    return monthRecords.find(r => r.date === dateStr);
  };

  const presentDays = monthRecords.filter(r => r.status === "present").length;
  const lateDays = monthRecords.filter(r => r.status === "late").length;
  const absentDays = monthRecords.filter(r => r.status === "absent").length;

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
        />
      );
    }
    
    return (
      <View style={[styles.calendar, { backgroundColor: theme.backgroundDefault }]}>
        <ThemedText type="h4" style={styles.calendarTitle}>{monthName}</ThemedText>
        <View style={styles.weekDaysRow}>
          {weekDays.map(d => (
            <ThemedText key={d} type="caption" style={[styles.weekDay, { color: theme.textSecondary }]}>
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
      <View style={[styles.checkInCard, { backgroundColor: theme.backgroundDefault }]}>
        <View style={styles.timeDisplay}>
          <ThemedText type="h1">{today.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</ThemedText>
          <ThemedText type="small" style={{ color: theme.textSecondary }}>
            {today.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" })}
          </ThemedText>
        </View>
        
        <Spacer height={Spacing.lg} />
        
        <View style={styles.statusRow}>
          {todayRecord?.checkIn ? (
            <View style={[styles.statusBadge, { backgroundColor: Colors.light.successBg }]}>
              <Feather name="check-circle" size={16} color={Colors.light.successText} />
              <ThemedText type="small" style={{ color: Colors.light.successText }}>
                In: {new Date(todayRecord.checkIn).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
              </ThemedText>
            </View>
          ) : null}
          {todayRecord?.checkOut ? (
            <View style={[styles.statusBadge, { backgroundColor: Colors.light.infoBg }]}>
              <Feather name="log-out" size={16} color={Colors.light.infoText} />
              <ThemedText type="small" style={{ color: Colors.light.infoText }}>
                Out: {new Date(todayRecord.checkOut).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
              </ThemedText>
            </View>
          ) : null}
        </View>
        
        <Spacer height={Spacing.xl} />
        
        <View style={styles.buttonsRow}>
          <Button 
            onPress={handleCheckIn}
            disabled={isLoading || !!todayRecord?.checkIn}
            style={[styles.checkButton, { opacity: todayRecord?.checkIn ? 0.5 : 1 }]}
          >
            {isLoading ? <ActivityIndicator color="#FFFFFF" /> : "Check In"}
          </Button>
          <Button 
            onPress={handleCheckOut}
            disabled={isLoading || !todayRecord?.checkIn || !!todayRecord?.checkOut}
            style={[
              styles.checkButton, 
              { 
                backgroundColor: Colors.light.info,
                opacity: (!todayRecord?.checkIn || todayRecord?.checkOut) ? 0.5 : 1 
              }
            ]}
          >
            {isLoading ? <ActivityIndicator color="#FFFFFF" /> : "Check Out"}
          </Button>
        </View>
        
        {!locationPermission && Platform.OS !== "web" ? (
          <>
            <Spacer height={Spacing.md} />
            <Pressable 
              onPress={requestLocationPermission}
              style={({ pressed }) => [styles.locationBtn, { opacity: pressed ? 0.7 : 1 }]}
            >
              <Feather name="map-pin" size={16} color={Colors.light.warning} />
              <ThemedText type="caption" style={{ color: Colors.light.warning }}>
                Enable location for accurate attendance
              </ThemedText>
            </Pressable>
          </>
        ) : null}
      </View>

      <Spacer height={Spacing.xl} />

      <View style={styles.summaryRow}>
        <View style={[styles.summaryCard, { backgroundColor: Colors.light.successBg }]}>
          <ThemedText type="h3" style={{ color: Colors.light.successText }}>{presentDays}</ThemedText>
          <ThemedText type="caption" style={{ color: Colors.light.successText }}>Present</ThemedText>
        </View>
        <View style={[styles.summaryCard, { backgroundColor: Colors.light.warningBg }]}>
          <ThemedText type="h3" style={{ color: Colors.light.warningText }}>{lateDays}</ThemedText>
          <ThemedText type="caption" style={{ color: Colors.light.warningText }}>Late</ThemedText>
        </View>
        <View style={[styles.summaryCard, { backgroundColor: Colors.light.errorBg }]}>
          <ThemedText type="h3" style={{ color: Colors.light.errorText }}>{absentDays}</ThemedText>
          <ThemedText type="caption" style={{ color: Colors.light.errorText }}>Absent</ThemedText>
        </View>
      </View>

      <Spacer height={Spacing.xl} />

      {renderCalendar()}

      <Spacer height={Spacing.lg} />

      <View style={styles.legendRow}>
        {(["present", "late", "absent", "wfh", "leave"] as AttendanceStatus[]).map(status => (
          <View key={status} style={styles.legendItem}>
            <View style={[styles.legendDot, { backgroundColor: STATUS_COLORS[status] }]} />
            <ThemedText type="caption" style={{ color: theme.textSecondary, textTransform: "capitalize" }}>
              {status === "wfh" ? "WFH" : status}
            </ThemedText>
          </View>
        ))}
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
});
