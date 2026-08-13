import React, { useState, useEffect, useCallback, useRef } from "react";
import {
  StyleSheet,
  View,
  Pressable,
  Alert,
  Platform,
  ActivityIndicator,
  Modal,
} from "react-native";
import Feather from "@expo/vector-icons/Feather";
import * as Location from "expo-location";
import { useFocusEffect, useNavigation } from "@react-navigation/native";
import { ScreenScrollView } from "@/components/ScreenScrollView";
import { ThemedText } from "@/components/ThemedText";
import { Button } from "@/components/Button";
import { useTheme } from "@/hooks/useTheme";
import { Spacing, BorderRadius, Colors } from "@/constants/theme";
import Spacer from "@/components/Spacer";
import type { AttendanceRecord } from "@/utils/storage";
import { firstRpcRow } from "@/utils/supabaseRpc";
import {
  AttendanceService,
  GeoFenceError,
} from "@/services/attendance.service";
import { useAuth } from "@/contexts/AuthContext";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { AttendanceFraudService } from "@/services/attendance-fraud.service";
import { googleGeolocate } from "@/utils/googleGeolocation";
import { AttendanceRegularizationService } from "@/services/attendance-regularization.service";
import { isDeveloperModeEnabled } from "expo-developer-mode";
import { supabase } from "@/lib/supabase";
import { attendanceInternetAvailable } from "@/utils/attendanceConnectivity";
import { reportNonFatalError } from "@/utils/operationalErrors";
import { BusinessClockService } from "@/services/business-clock.service";
import AttendanceCheckoutFlow, {
  type AttendanceNextAction,
} from "@/components/AttendanceCheckoutFlow";
import {
  restoreAttendanceTracking,
  startAttendanceTracking,
} from "@/services/location/attendanceTrackingLifecycle";
import { nativeBridge } from "@/services/nativeBridge/client";

import { secureStorage } from "@/utils/secureStorage";
const PRIMARY = "#6D1B6D";

type AttendanceStatus =
  | "present"
  | "absent"
  | "late"
  | "wfh"
  | "leave"
  | "notyet"
  | "holiday"
  | "weeklyoff"
  | "compoff";

function confirmedAttendanceStatus(value: any): AttendanceStatus {
  if (Number(value?.compOffEarned || 0) > 0) return "compoff";
  const status = String(
    value?.attendance_status ?? value?.day_status ?? value?.status ?? "",
  ).toUpperCase();
  if (value?.is_late === true) return "late";
  if (status.includes("LATE")) return "late";
  if (status === "NOTYET" || status === "NOT_YET") return "notyet";
  if (status === "HOLIDAY" || status === "H") return "holiday";
  if (status === "WEEKLY_OFF" || status === "WO") return "weeklyoff";
  if (status === "WFH" || status.includes("WORK_FROM_HOME")) return "wfh";
  if (status.includes("LEAVE")) return "leave";
  if (status === "ABSENT") return "absent";
  return value?.checkin_time || value?.checkIn ? "present" : "absent";
}

const STATUS_COLORS: Record<AttendanceStatus, string> = {
  present: Colors.light.success,
  absent: Colors.light.error,
  late: Colors.light.warning,
  wfh: Colors.light.info,
  leave: Colors.light.primary,
  notyet: Colors.light.textSecondary,
  holiday: "#7C3AED",
  weeklyoff: "#64748B",
  compoff: "#0F766E",
};

const STATUS_LABELS: Record<AttendanceStatus, string> = {
  present: "On Time",
  late: "Late",
  absent: "Not Present",
  wfh: "WFH",
  leave: "Leave",
  notyet: "Not Present Yet",
  holiday: "Holiday",
  weeklyoff: "Weekly Off",
  compoff: "Comp-Off Earned",
};

function formatWorkedMinutes(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value) || value < 0) return "—";
  const hours = Math.floor(value / 60);
  const minutes = Math.floor(value % 60);
  if (!hours) return `${minutes}m`;
  return `${hours}h ${minutes}m`;
}

function formatAttendanceTimestamp(value: string | null | undefined): string {
  if (!value) return "—";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "Unavailable";
  return parsed.toLocaleTimeString("en-IN", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    timeZone: "Asia/Kolkata",
  });
}

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
  const navigation = useNavigation<any>();
  const insets = useSafeAreaInsets();
  const [todayRecord, setTodayRecord] = useState<AttendanceRecord | null>(null);
  const [todayStatus, setTodayStatus] = useState<AttendanceStatus | null>(null);
  const [monthRecords, setMonthRecords] = useState<AttendanceRecord[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [locationPermission, setLocationPermission] = useState<boolean | null>(
    null,
  );
  const [selectedDate, setSelectedDate] = useState(1);
  const [calendarMonthStart, setCalendarMonthStart] = useState("");
  const calendarMonthStartRef = useRef("");
  const [monthlyHistoryLoading, setMonthlyHistoryLoading] = useState(true);
  const [lateCutoff, setLateCutoff] = useState("");
  const [businessToday, setBusinessToday] = useState("");
  const [businessClockError, setBusinessClockError] = useState<string | null>(
    null,
  );
  const [offices, setOffices] = useState<any[]>([]);
  const [selectedOffice, setSelectedOffice] = useState<any | null>(null);
  const [showOfficeModal, setShowOfficeModal] = useState(false);
  const [checkInCoords, setCheckInCoords] = useState<{
    latitude: number;
    longitude: number;
  } | null>(null);
  const [showAttendanceCheckout, setShowAttendanceCheckout] = useState(false);
  const [undoToken, setUndoToken] = useState<string | null>(null);
  const [undoExpiresAt, setUndoExpiresAt] = useState<string | null>(null);
  const [undoTimer, setUndoTimer] = useState<number>(0);
  const [showUndoBanner, setShowUndoBanner] = useState(false);
  const [lastCheckoutId, setLastCheckoutId] = useState<string | null>(null);
  const [staleSession, setStaleSession] = useState<{
    id: string;
    date: string;
    checkin_time: string;
  } | null>(null);
  const [attendanceLoadError, setAttendanceLoadError] = useState<string | null>(
    null,
  );
  const [monthlyHistoryError, setMonthlyHistoryError] = useState<string | null>(
    null,
  );

  // Undo countdown timer
  useEffect(() => {
    if (!showUndoBanner || !undoExpiresAt) return;
    const interval = setInterval(() => {
      const remaining = Math.floor(
        (new Date(undoExpiresAt).getTime() - Date.now()) / 1000,
      );
      if (remaining <= 0) {
        setShowUndoBanner(false);
        setUndoTimer(0);
        clearInterval(interval);
      } else {
        setUndoTimer(remaining);
      }
    }, 1000);
    return () => clearInterval(interval);
  }, [showUndoBanner, undoExpiresAt]);

  // Check for stored undo token on mount
  useEffect(() => {
    if (user?.id) {
      secureStorage.getItem(`undo_checkout_${user.id}`).then((stored) => {
        if (stored) {
          try {
            const data = JSON.parse(stored);
            if (new Date(data.expiresAt).getTime() > Date.now()) {
              setUndoToken(data.token);
              setUndoExpiresAt(data.expiresAt);
              setLastCheckoutId(data.attendanceId);
              setShowUndoBanner(true);
            } else {
              secureStorage.removeItem(`undo_checkout_${user.id}`);
            }
          } catch (error) {
            console.warn("Unable to restore the checkout undo window", error);
          }
        }
      });
    }
  }, [user?.id]);

  // Background location monitor — saves hourly pings to location_tracking
  const visibleMonth =
    calendarMonthStart ||
    (businessToday ? `${businessToday.slice(0, 7)}-01` : "");
  const calendarYear = Number(visibleMonth.slice(0, 4));
  const calendarMonth = Number(visibleMonth.slice(5, 7));
  const isCurrentBusinessMonth =
    Boolean(businessToday) &&
    visibleMonth.slice(0, 7) === businessToday.slice(0, 7);
  const calendarDay = isCurrentBusinessMonth
    ? Number(businessToday.slice(8, 10))
    : -1;
  const daysInMonth =
    calendarYear && calendarMonth
      ? new Date(Date.UTC(calendarYear, calendarMonth, 0)).getUTCDate()
      : 0;
  const firstDayOfMonth =
    calendarYear && calendarMonth
      ? new Date(Date.UTC(calendarYear, calendarMonth - 1, 1)).getUTCDay()
      : 0;
  const calendarMonthDate =
    calendarYear && calendarMonth
      ? new Date(Date.UTC(calendarYear, calendarMonth - 1, 1, 12))
      : null;
  const monthName =
    calendarMonthDate?.toLocaleString("default", {
      month: "long",
      year: "numeric",
      timeZone: "UTC",
    }) ?? "Loading attendance…";

  const loadMonthlyAttendance = useCallback(async (monthStart: string) => {
    setMonthlyHistoryLoading(true);
    try {
      const { data, error } = await supabase.rpc(
        "rpc_get_my_monthly_attendance_v3",
        { p_month: monthStart },
      );
      if (error) throw error;
      const response = firstRpcRow<any>(data);
      if (response?.success !== true || !Array.isArray(response?.records)) {
        throw new Error("Monthly attendance was not confirmed by the server.");
      }
      const records = response.records.map((record: AttendanceRecord) => ({
        ...record,
        status: confirmedAttendanceStatus(record),
      })) as AttendanceRecord[];
      setMonthRecords(records);
      setLateCutoff(String(response.late_cutoff || ""));
      setMonthlyHistoryError(null);
      return records;
    } catch (error) {
      setMonthlyHistoryError(
        (error as any)?.message || "Monthly attendance could not be loaded",
      );
      void reportNonFatalError("attendance.monthly_history", error);
      return null;
    } finally {
      setMonthlyHistoryLoading(false);
    }
  }, []);

  const loadData = useCallback(async () => {
    try {
      if (user?.id) {
        const serverDate = await BusinessClockService.getDate(true);
        setBusinessToday(serverDate);
        setBusinessClockError(null);
        const currentMonthStart = `${serverDate.slice(0, 7)}-01`;
        const requestedMonthStart =
          calendarMonthStartRef.current || currentMonthStart;
        if (!calendarMonthStartRef.current) {
          calendarMonthStartRef.current = currentMonthStart;
          setCalendarMonthStart(currentMonthStart);
          setSelectedDate(Number(serverDate.slice(8, 10)));
        }
        const historyPromise = loadMonthlyAttendance(requestedMonthStart);
        try {
          const result = await AttendanceService.getToday(user.id);
          if (result.data) {
            const dbRecord: AttendanceRecord = {
              id: result.data.id,
              date: result.data.date,
              checkIn: result.data.checkin_time ?? undefined,
              checkOut: result.data.checkout_time ?? undefined,
              status: confirmedAttendanceStatus(result.data),
              attendanceSource: result.data.checkin_source ?? result.data.attendance_type,
              attendanceContext: result.data.attendance_context ?? result.data.attendance_type,
              contextName: result.data.context_location_name ?? result.data.checkin_location_name,
            };
            setTodayRecord(dbRecord);
            setTodayStatus(dbRecord.status);
            setStaleSession(null); // today record exists, no stale session
            setAttendanceLoadError(null);
            if (result.data.checkin_location) {
              setCheckInCoords(result.data.checkin_location);
            }
          } else {
            // Check for a stale open session from a previous day
            const stale = await AttendanceService.getStalePreviousDaySession(
              user.id,
            );
            setTodayRecord(null);
            setTodayStatus(null);
            setStaleSession(
              stale
                ? {
                    id: stale.id,
                    date: stale.date,
                    checkin_time: stale.checkin_time,
                  }
                : null,
            );
            setAttendanceLoadError(null);
          }
        } catch (err: any) {
          setTodayStatus(null);
          setAttendanceLoadError(
            err?.message || "Attendance verification failed",
          );
          console.warn(
            "Failed to load attendance from database:",
            err?.message,
          );
        }

        const records = await historyPromise;
        if (records && requestedMonthStart === currentMonthStart) {
          const authoritativeToday = records.find(
            (record) => record.date === serverDate,
          );
          if (authoritativeToday) {
            const authoritativeStatus =
              confirmedAttendanceStatus(authoritativeToday);
            setTodayStatus(authoritativeStatus);
            setTodayRecord((current) =>
              current
                ? {
                    ...current,
                    status: authoritativeStatus,
                  }
                : current,
            );
          }
        }
      }
    } catch (error: any) {
      console.error("Failed to load data:", error?.message);
      const message =
        error?.message ||
        "The server business date could not be loaded. Check your connection and try again.";
      setBusinessToday("");
      setBusinessClockError(message);
      setAttendanceLoadError(message);
      setMonthlyHistoryLoading(false);
      void reportNonFatalError("attendance.business_clock", error);
    }
  }, [loadMonthlyAttendance, user?.id]);

  useFocusEffect(
    useCallback(() => {
      loadData();
      checkLocationPermission();
    }, [loadData]),
  );

  // Keep the employee's attendance state in sync with server-imported
  // biometric punches while this screen remains open.
  useEffect(() => {
    if (!user?.id) return;
    const channel = supabase
      .channel(`attendance-screen-${user.id}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "attendance_logs",
          filter: `user_id=eq.${user.id}`,
        },
        () => loadData(),
      )
      .subscribe();
    const interval = setInterval(loadData, 60_000);
    return () => {
      clearInterval(interval);
      supabase.removeChannel(channel);
    };
  }, [user?.id, loadData]);

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
  const getLocation = (): Promise<{
    latitude: number;
    longitude: number;
    accuracy?: number | null;
    mocked?: boolean;
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
                accuracy: p.coords.accuracy,
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
                accuracy: p.coords.accuracy,
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
    return Location.getCurrentPositionAsync({
      accuracy: Location.Accuracy.Balanced,
    })
      .then((loc) => ({
        latitude: loc.coords.latitude,
        longitude: loc.coords.longitude,
        accuracy: loc.coords.accuracy,
        mocked: loc.mocked,
      }))
      .catch(() => null);
  };

  const executeCheckIn = async () => {
    setIsLoading(true);
    try {
      if (Platform.OS !== "web") {
        const granted =
          locationPermission || (await requestLocationPermission());
        if (!granted) {
          Alert.alert(
            "Location Required",
            "Please enable location permission in your device settings to check in.",
          );
          return;
        }
      }

      const location = await getLocation();
      if (!location) {
        Alert.alert(
          "GPS Unavailable",
          "Your location could not be detected before the timeout. Enable precise location, move outdoors, and try again.",
        );
        return;
      }
      const developerMode = await isDeveloperModeEnabled();

      const verifiedCheckIn = await AttendanceService.officeCheckIn({
        userId: user!.id,
        location,
      });
      const checkInResult = verifiedCheckIn.result;
      const office = verifiedCheckIn.office;
      const distance = verifiedCheckIn.distanceMetres;

      if (!checkInResult.success) {
        throw new Error(checkInResult.message || "Check-in failed.");
      }
      if (!checkInResult.side_effects_committed) {
        throw new Error(
          "The server did not confirm the transactional check-in side effects.",
        );
      }

      let trackingStarted = false;
      if (checkInResult.id) {
        const ipLocation = await googleGeolocate({ considerIp: true }).catch(
          () => null,
        );
        AttendanceFraudService.analyze({
          userId: user!.id,
          attendanceId: checkInResult.id,
          eventType: "CHECKIN",
          location: {
            ...location,
            developerMode: developerMode ?? false,
            ipLatitude: ipLocation?.latitude,
            ipLongitude: ipLocation?.longitude,
          },
          officeDistance: distance,
        }).catch((error) =>
          console.warn("Fraud analysis failed:", error?.message),
        );
        try {
          trackingStarted = await startAttendanceTracking(checkInResult.id);
        } catch (trackingError) {
          void reportNonFatalError(
            "attendance.tracking_start_after_checkin",
            trackingError,
          );
        }
      }

      // Only reached if check-in succeeded
      setCheckInCoords(location);

      // Attendance is committed first. The setup screen explains Android 11+
      // background access before opening the system Settings page.
      if (
        !trackingStarted &&
        (Platform.OS !== "web" || nativeBridge.isAvailable())
      ) {
        navigation.navigate("LocationTrackingSetup");
      }

      // Always re-fetch from Supabase after check-in — never rely on local fake state
      await loadData().catch(() => {
        console.warn("Check-in succeeded; attendance refresh was deferred");
      });

      // ── Auto-detect nearest predefined site and log field visit ──────────
      let siteCheckInMsg = checkInResult.automatic_site_visit_id
        ? `\n\nAuto-detected: ${checkInResult.automatic_site_name} (${Math.round(checkInResult.automatic_site_distance_metres || 0)}m away) — site visit committed with attendance.`
        : "";
      // ─────────────────────────────────────────────────────────────────────

      Alert.alert(
        "✅ Check-In Successful",
        `Checked in at ${new Date(
          checkInResult.checkin_time!,
        ).toLocaleTimeString([], {
          hour: "2-digit",
          minute: "2-digit",
          timeZone: "Asia/Kolkata",
        })} · ${office.name}${siteCheckInMsg}`,
      );
    } catch (err: any) {
      if (err instanceof GeoFenceError) {
        const distM = Math.round(err.distanceMetres);
        const distFt = Math.round(err.distanceMetres * 3.28084);
        Alert.alert(
          "📍 Outside Office Zone",
          `You are ${distM}m (${distFt} ft) away from ${err.officeName}.\n\nYou must be within ${err.radiusMetres}m to check in. Please reach the office and try again.`,
          [{ text: "OK" }],
        );
        return;
      }
      Alert.alert(
        "Check-In Failed",
        err?.message || "An unexpected error occurred. Please try again.",
      );
    } finally {
      setIsLoading(false);
      setShowOfficeModal(false);
    }
  };

  const handleCheckIn = async () => {
    if (attendanceLoadError) {
      Alert.alert(
        "Attendance unavailable",
        "Your previous attendance session could not be verified. Refresh after the connection is restored; check-in is blocked to prevent a duplicate session.",
      );
      return;
    }
    if (!user?.id) {
      Alert.alert("Error", "You must be logged in.");
      return;
    }
    if (!(await attendanceInternetAvailable())) {
      Alert.alert(
        "Internet Required",
        "A verified internet connection is required to mark attendance. No offline check-in was created.",
      );
      return;
    }

    setIsLoading(true);

    // Always re-verify from DB — never trust stale local state.
    // This is the primary guard against the "already checked in but sees Check In button" bug.
    try {
      const fresh = await AttendanceService.getToday(user.id);
      if (fresh.data?.checkin_time) {
        // DB confirms already checked in — refresh UI and bail
        await loadData();
        Alert.alert(
          "Already Checked In",
          `You checked in at ${new Date(fresh.data.checkin_time).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", timeZone: "Asia/Kolkata" })} today.`,
        );
        setIsLoading(false);
        return;
      }
    } catch (error) {
      void reportNonFatalError("attendance.preflight", error);
    }

    // Every attendance entry point uses the same assigned-office validation.
    void executeCheckIn();
  };

  const handleCheckOut = async () => {
    if (!user?.id) return;
    if (!(await attendanceInternetAvailable())) {
      Alert.alert(
        "Internet Required",
        "A verified internet connection is required to mark attendance. No offline checkout was created.",
      );
      return;
    }

    // Always re-verify from DB before showing the checkout confirmation.
    setIsLoading(true);
    try {
      const fresh = await AttendanceService.getToday(user.id);

      // No record for today at all — could be a stale previous-day session
      if (!fresh.data?.checkin_time) {
        await loadData();
        Alert.alert(
          "Not Checked In",
          "You don't have an active check-in for today. Please check in first.",
        );
        return;
      }

      // Already checked out today
      if (fresh.data?.checkout_time) {
        await loadData();
        Alert.alert(
          "Already Checked Out",
          `You already checked out at ${new Date(fresh.data.checkout_time).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", timeZone: "Asia/Kolkata" })} today.`,
        );
        return;
      }

      setShowAttendanceCheckout(true);
      return;

    } catch (e: any) {
      Alert.alert(
        "Checkout Failed",
        e?.message || "An unexpected error occurred.",
      );
    } finally {
      setIsLoading(false);
    }
  };

  const handleUndoCheckout = async () => {
    if (!undoToken || !lastCheckoutId || !user?.id) return;
    try {
      const result = await AttendanceService.undoCheckout({
        userId: user.id,
        attendanceId: lastCheckoutId,
        undoToken: undoToken,
      });
      if (result.success) {
        setShowUndoBanner(false);
        setUndoToken(null);
        setUndoExpiresAt(null);
        setLastCheckoutId(null);
        await secureStorage.removeItem(`undo_checkout_${user.id}`);
        await loadData();
        await restoreAttendanceTracking().catch((trackingError) => {
          void reportNonFatalError(
            "attendance.tracking_restore_after_undo",
            trackingError,
          );
        });
        Alert.alert(
          "✅ Checkout Undone",
          "Your checkout has been reversed. You can check out again when ready.",
        );
      } else {
        Alert.alert(
          "Undo Failed",
          result.message || "Could not undo checkout. It may have expired.",
        );
        setShowUndoBanner(false);
      }
    } catch (err: any) {
      Alert.alert("Undo Failed", err?.message || "An error occurred.");
    }
  };

  const getRecordForDay = (day: number): AttendanceRecord | undefined => {
    const dateStr = `${visibleMonth.slice(0, 7)}-${String(day).padStart(2, "0")}`;
    return monthRecords.find((r) => r.date === dateStr);
  };

  const presentDays = monthRecords.filter(
    (r) => r.status === "present" || r.status === "compoff",
  ).length;
  const lateDays = monthRecords.filter((r) => r.status === "late").length;
  const absentDays = monthRecords.filter((r) => r.status === "absent").length;
  const notYetDays = monthRecords.filter((r) => r.status === "notyet").length;
  const leaveDays = monthRecords.filter((r) => r.status === "leave").length;
  const wfhDays = monthRecords.filter((r) => r.status === "wfh").length;
  const offDays = monthRecords.filter(
    (r) => r.status === "holiday" || r.status === "weeklyoff",
  ).length;
  const selectedRecord = getRecordForDay(selectedDate);
  const selectedDateString = visibleMonth
    ? `${visibleMonth.slice(0, 7)}-${String(selectedDate).padStart(2, "0")}`
    : "";

  const canOpenNextMonth =
    Boolean(visibleMonth && businessToday) &&
    visibleMonth.slice(0, 7) < businessToday.slice(0, 7);

  const changeCalendarMonth = async (direction: -1 | 1) => {
    if (!visibleMonth || (direction === 1 && !canOpenNextMonth)) return;
    const current = new Date(
      Date.UTC(
        Number(visibleMonth.slice(0, 4)),
        Number(visibleMonth.slice(5, 7)) - 1 + direction,
        1,
      ),
    );
    const nextMonthStart = `${current.getUTCFullYear()}-${String(
      current.getUTCMonth() + 1,
    ).padStart(2, "0")}-01`;
    calendarMonthStartRef.current = nextMonthStart;
    setCalendarMonthStart(nextMonthStart);
    setMonthRecords([]);
    setMonthlyHistoryError(null);
    setSelectedDate(
      nextMonthStart.slice(0, 7) === businessToday.slice(0, 7)
        ? Number(businessToday.slice(8, 10))
        : 1,
    );
    await loadMonthlyAttendance(nextMonthStart);
  };

  const renderCalendar = () => {
    const weekDays = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
    const days = [];

    for (let i = 0; i < firstDayOfMonth; i++) {
      days.push(<View key={`empty-${i}`} style={styles.calendarDay} />);
    }

    for (let day = 1; day <= daysInMonth; day++) {
      const record = getRecordForDay(day);
      const isToday = day === calendarDay;
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
        <View style={styles.calendarHeader}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Previous attendance month"
            onPress={() => void changeCalendarMonth(-1)}
            style={({ pressed }) => [
              styles.calendarArrow,
              {
                backgroundColor: theme.backgroundSecondary,
                borderColor: theme.border,
                opacity: pressed ? 0.65 : 1,
              },
            ]}
          >
            <Feather name="chevron-left" size={18} color={theme.text} />
          </Pressable>
          <View style={styles.calendarTitleBlock}>
            <ThemedText type="h4" style={styles.calendarTitle}>
              {monthName}
            </ThemedText>
            <ThemedText type="caption" style={{ color: theme.textSecondary }}>
              Select a date to view complete attendance details
            </ThemedText>
          </View>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Next attendance month"
            accessibilityState={{ disabled: !canOpenNextMonth }}
            disabled={!canOpenNextMonth}
            onPress={() => void changeCalendarMonth(1)}
            style={({ pressed }) => [
              styles.calendarArrow,
              {
                backgroundColor: theme.backgroundSecondary,
                borderColor: theme.border,
                opacity: !canOpenNextMonth ? 0.35 : pressed ? 0.65 : 1,
              },
            ]}
          >
            <Feather name="chevron-right" size={18} color={theme.text} />
          </Pressable>
        </View>
        {monthlyHistoryLoading ? (
          <View style={styles.historyLoadingRow}>
            <ActivityIndicator size="small" color={theme.primary} />
            <ThemedText type="caption" style={{ color: theme.textSecondary }}>
              Loading attendance history…
            </ThemedText>
          </View>
        ) : null}
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
    <>
    <ScreenScrollView style={{ backgroundColor: theme.backgroundRoot }}>
      {/* ── Hero Check-In Card ── */}
      <View
        style={[
          styles.checkInCard,
          { backgroundColor: PRIMARY, paddingTop: insets.top + 16 },
        ]}
      >
        <View style={styles.timeDisplay}>
          <ThemedText
            style={{
              color: "rgba(255,255,255,0.65)",
              fontSize: 11,
              letterSpacing: 1.2,
              marginBottom: 4,
            }}
          >
            TODAY'S ATTENDANCE
          </ThemedText>
          <ThemedText
            style={{
              color: "#FFFFFF",
              fontSize: 40,
              fontWeight: "800",
              letterSpacing: -1,
            }}
          >
            {new Date().toLocaleTimeString([], {
              hour: "2-digit",
              minute: "2-digit",
              timeZone: "Asia/Kolkata",
            })}
          </ThemedText>
          <ThemedText
            style={{
              color: "rgba(255,255,255,0.70)",
              fontSize: 13,
              marginTop: 2,
            }}
          >
            {businessToday
              ? new Date(`${businessToday}T12:00:00+05:30`).toLocaleDateString(
                  "en-US",
                  {
                    weekday: "long",
                    month: "long",
                    day: "numeric",
                    timeZone: "Asia/Kolkata",
                  },
                )
              : businessClockError
                ? "Server business date unavailable"
                : "Loading business date…"}
          </ThemedText>
          {businessClockError ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Retry loading server business date"
              onPress={() => void loadData()}
              style={{
                marginTop: 10,
                paddingHorizontal: 14,
                paddingVertical: 8,
                borderRadius: 8,
                borderWidth: 1,
                borderColor: "rgba(255,255,255,0.55)",
              }}
            >
              <ThemedText
                style={{ color: "#FFFFFF", fontSize: 12, fontWeight: "700" }}
              >
                Retry server date
              </ThemedText>
            </Pressable>
          ) : null}
        </View>

        <Spacer height={Spacing.lg} />

        {/* Check-in/out time badges */}
        <View style={styles.statusRow}>
          {todayRecord?.checkIn ? (
            <View style={styles.timeBadge}>
              <Feather name="log-in" size={13} color="#FFFFFF" />
              <ThemedText
                style={{ color: "#FFFFFF", fontSize: 12, fontWeight: "600" }}
              >
                In:{" "}
                {new Date(todayRecord.checkIn).toLocaleTimeString([], {
                  hour: "2-digit",
                  minute: "2-digit",
                  second: "2-digit",
                  timeZone: "Asia/Kolkata",
                })}
              </ThemedText>
            </View>
          ) : null}
          {todayRecord?.checkOut ? (
            <View style={styles.timeBadge}>
              <Feather name="log-out" size={13} color="#FFFFFF" />
              <ThemedText
                style={{ color: "#FFFFFF", fontSize: 12, fontWeight: "600" }}
              >
                Out:{" "}
                {new Date(todayRecord.checkOut).toLocaleTimeString([], {
                  hour: "2-digit",
                  minute: "2-digit",
                  second: "2-digit",
                  timeZone: "Asia/Kolkata",
                })}
              </ThemedText>
            </View>
          ) : null}
          {todayStatus ? (
            <View style={styles.timeBadge}>
              <View
                style={{
                  width: 7,
                  height: 7,
                  borderRadius: 4,
                  backgroundColor: STATUS_COLORS[todayStatus],
                }}
              />
              <ThemedText
                style={{ color: "#FFFFFF", fontSize: 12, fontWeight: "700" }}
              >
                {STATUS_LABELS[todayStatus]}
              </ThemedText>
            </View>
          ) : null}
        </View>

        <Spacer height={Spacing.xl} />

        <View style={styles.buttonsRow}>
          <Pressable
            onPress={handleCheckIn}
            disabled={
              isLoading || !!todayRecord?.checkIn || !!businessClockError
            }
            style={[
              styles.checkButton,
              styles.checkInButton,
              {
                opacity:
                  isLoading || !!todayRecord?.checkIn || !!businessClockError
                    ? 0.55
                    : 1,
              },
            ]}
          >
            {isLoading ? (
              <ActivityIndicator color={PRIMARY} />
            ) : (
              <>
                <Feather name="log-in" size={16} color={PRIMARY} />
                <ThemedText
                  style={{ color: PRIMARY, fontWeight: "800", fontSize: 15 }}
                >
                  Check In
                </ThemedText>
              </>
            )}
          </Pressable>
          <Pressable
            onPress={handleCheckOut}
            disabled={
              isLoading ||
              !todayRecord?.checkIn ||
              !!todayRecord?.checkOut ||
              !!businessClockError
            }
            style={[
              styles.checkButton,
              styles.checkOutButton,
              {
                opacity:
                  isLoading ||
                  !todayRecord?.checkIn ||
                  !!todayRecord?.checkOut ||
                  !!businessClockError
                    ? 0.55
                    : 1,
              },
            ]}
          >
            {isLoading ? (
              <ActivityIndicator color="#FFFFFF" />
            ) : (
              <>
                <Feather name="log-out" size={16} color="#FFFFFF" />
                <ThemedText
                  style={{ color: "#FFFFFF", fontWeight: "800", fontSize: 15 }}
                >
                  Check Out
                </ThemedText>
              </>
            )}
          </Pressable>
        </View>
        <ThemedText
          type="caption"
          style={{ color: "#FFFFFF", textAlign: "center", marginTop: 10 }}
        >
          Internet connection is required to mark attendance.
        </ThemedText>

        {!locationPermission && Platform.OS !== "web" ? (
          <Pressable
            onPress={requestLocationPermission}
            style={({ pressed }) => [
              styles.locationBtn,
              { opacity: pressed ? 0.7 : 1, marginTop: Spacing.md },
            ]}
          >
            <Feather name="map-pin" size={13} color="rgba(255,255,255,0.75)" />
            <ThemedText
              style={{ color: "rgba(255,255,255,0.75)", fontSize: 12 }}
            >
              Enable location for accurate attendance
            </ThemedText>
          </Pressable>
        ) : null}
        <Spacer height={Spacing.xl} />
      </View>

      <Spacer height={Spacing.xl} />

      {monthlyHistoryError ? (
        <View
          style={{
            marginHorizontal: Spacing.lg,
            padding: 12,
            borderRadius: 10,
            backgroundColor: "#FEE2E2",
          }}
        >
          <ThemedText style={{ color: "#991B1B", fontWeight: "700" }}>
            Monthly attendance unavailable: {monthlyHistoryError}
          </ThemedText>
          <Pressable
            onPress={() =>
              void loadMonthlyAttendance(
                calendarMonthStartRef.current ||
                  `${businessToday.slice(0, 7)}-01`,
              )
            }
            style={{ marginTop: 6 }}
          >
            <ThemedText style={{ color: "#991B1B", fontWeight: "800" }}>
              Retry monthly history
            </ThemedText>
          </Pressable>
        </View>
      ) : null}

      {attendanceLoadError ? (
        <View
          style={{
            marginHorizontal: Spacing.lg,
            marginTop: Spacing.sm,
            padding: 12,
            borderRadius: 10,
            backgroundColor: "#FEE2E2",
          }}
        >
          <ThemedText style={{ color: "#991B1B", fontWeight: "700" }}>
            Today&apos;s attendance unavailable: {attendanceLoadError}
          </ThemedText>
          <Pressable onPress={() => void loadData()} style={{ marginTop: 6 }}>
            <ThemedText style={{ color: "#991B1B", fontWeight: "800" }}>
              Retry
            </ThemedText>
          </Pressable>
        </View>
      ) : null}

      {/* Summary stats row */}
      <View style={[styles.summaryRow, { paddingHorizontal: Spacing.lg }]}>
        <View
          style={[
            styles.summaryCard,
            {
              backgroundColor: theme.backgroundDefault,
              borderTopColor: theme.success,
              borderTopWidth: 3,
            },
          ]}
        >
          <ThemedText
            style={{
              fontWeight: "800",
              fontSize: 22,
              color: theme.successText,
            }}
          >
            {monthlyHistoryLoading && monthRecords.length === 0
              ? "—"
              : presentDays}
          </ThemedText>
          <ThemedText
            style={{
              color: theme.successText,
              fontSize: 12,
              marginTop: 2,
            }}
          >
            On Time
          </ThemedText>
        </View>
        <View
          style={[
            styles.summaryCard,
            {
              backgroundColor: theme.backgroundDefault,
              borderTopColor: theme.warning,
              borderTopWidth: 3,
            },
          ]}
        >
          <ThemedText
            style={{
              fontWeight: "800",
              fontSize: 22,
              color: theme.warningText,
            }}
          >
            {monthlyHistoryLoading && monthRecords.length === 0
              ? "—"
              : lateDays}
          </ThemedText>
          <ThemedText
            style={{
              color: theme.warningText,
              fontSize: 12,
              marginTop: 2,
            }}
          >
            Late
          </ThemedText>
        </View>
        <View
          style={[
            styles.summaryCard,
            {
              backgroundColor: theme.backgroundDefault,
              borderTopColor: theme.error,
              borderTopWidth: 3,
            },
          ]}
        >
          <ThemedText
            style={{
              fontWeight: "800",
              fontSize: 22,
              color: theme.errorText,
            }}
          >
            {monthlyHistoryLoading && monthRecords.length === 0
              ? "—"
              : absentDays}
          </ThemedText>
          <ThemedText
            style={{
              color: theme.errorText,
              fontSize: 12,
              marginTop: 2,
            }}
          >
            Not Present
          </ThemedText>
        </View>
        <View
          style={[
            styles.summaryCard,
            {
              backgroundColor: theme.backgroundDefault,
              borderTopColor: theme.textSecondary,
              borderTopWidth: 3,
            },
          ]}
        >
          <ThemedText
            style={{
              fontWeight: "800",
              fontSize: 22,
              color: theme.textSecondary,
            }}
          >
            {monthlyHistoryLoading && monthRecords.length === 0
              ? "—"
              : notYetDays}
          </ThemedText>
          <ThemedText
            style={{
              color: theme.textSecondary,
              fontSize: 12,
              marginTop: 2,
            }}
          >
            Not Yet
          </ThemedText>
        </View>
        <View
          style={[
            styles.summaryCard,
            {
              backgroundColor: theme.backgroundDefault,
              borderTopColor: theme.primary,
              borderTopWidth: 3,
            },
          ]}
        >
          <ThemedText
            style={{ fontWeight: "800", fontSize: 22, color: theme.primary }}
          >
            {monthlyHistoryLoading && monthRecords.length === 0
              ? "—"
              : leaveDays}
          </ThemedText>
          <ThemedText
            style={{ color: theme.primary, fontSize: 12, marginTop: 2 }}
          >
            Leave
          </ThemedText>
        </View>
        <View
          style={[
            styles.summaryCard,
            {
              backgroundColor: theme.backgroundDefault,
              borderTopColor: theme.info,
              borderTopWidth: 3,
            },
          ]}
        >
          <ThemedText
            style={{ fontWeight: "800", fontSize: 22, color: theme.infoText }}
          >
            {monthlyHistoryLoading && monthRecords.length === 0
              ? "—"
              : wfhDays}
          </ThemedText>
          <ThemedText
            style={{ color: theme.infoText, fontSize: 12, marginTop: 2 }}
          >
            WFH
          </ThemedText>
        </View>
        <View
          style={[
            styles.summaryCard,
            {
              backgroundColor: theme.backgroundDefault,
              borderTopColor: theme.textSecondary,
              borderTopWidth: 3,
            },
          ]}
        >
          <ThemedText
            style={{
              fontWeight: "800",
              fontSize: 22,
              color: theme.textSecondary,
            }}
          >
            {monthlyHistoryLoading && monthRecords.length === 0 ? "—" : offDays}
          </ThemedText>
          <ThemedText
            style={{ color: theme.textSecondary, fontSize: 12, marginTop: 2 }}
          >
            Off / Holiday
          </ThemedText>
        </View>
      </View>

      <Spacer height={Spacing.xl} />

      {renderCalendar()}

      <Spacer height={Spacing.lg} />

      <View
        style={[
          styles.selectedDayCard,
          {
            backgroundColor: theme.backgroundDefault,
            borderColor: theme.border,
          },
        ]}
      >
        <View style={styles.selectedDayHeader}>
          <View style={{ flex: 1 }}>
            <ThemedText type="h4" style={{ color: theme.text }}>
              Selected Day
            </ThemedText>
            <ThemedText type="caption" style={{ color: theme.textSecondary }}>
              {selectedDateString
                ? new Date(
                    `${selectedDateString}T12:00:00+05:30`,
                  ).toLocaleDateString("en-IN", {
                    weekday: "long",
                    day: "numeric",
                    month: "long",
                    year: "numeric",
                    timeZone: "Asia/Kolkata",
                  })
                : "Attendance date unavailable"}
            </ThemedText>
          </View>
          {selectedRecord ? (
            <View
              style={[
                styles.selectedStatusBadge,
                {
                  backgroundColor: `${STATUS_COLORS[selectedRecord.status]}20`,
                },
              ]}
            >
              <View
                style={[
                  styles.legendDot,
                  { backgroundColor: STATUS_COLORS[selectedRecord.status] },
                ]}
              />
              <ThemedText
                type="caption"
                style={{
                  color: STATUS_COLORS[selectedRecord.status],
                  fontWeight: "800",
                }}
              >
                {STATUS_LABELS[selectedRecord.status]}
              </ThemedText>
            </View>
          ) : null}
        </View>

        {selectedRecord ? (
          <>
            <View style={styles.selectedDayGrid}>
              <View
                style={[
                  styles.selectedDayMetric,
                  {
                    backgroundColor: theme.backgroundSecondary,
                    borderColor: theme.border,
                  },
                ]}
              >
                <ThemedText
                  type="caption"
                  style={[
                    styles.selectedDayLabel,
                    { color: theme.textSecondary },
                  ]}
                >
                  Check-in
                </ThemedText>
                <ThemedText
                  style={[styles.selectedDayValue, { color: theme.text }]}
                >
                  {formatAttendanceTimestamp(selectedRecord.checkIn)}
                </ThemedText>
              </View>
              <View
                style={[
                  styles.selectedDayMetric,
                  {
                    backgroundColor: theme.backgroundSecondary,
                    borderColor: theme.border,
                  },
                ]}
              >
                <ThemedText
                  type="caption"
                  style={[
                    styles.selectedDayLabel,
                    { color: theme.textSecondary },
                  ]}
                >
                  Check-out
                </ThemedText>
                <ThemedText
                  style={[styles.selectedDayValue, { color: theme.text }]}
                >
                  {formatAttendanceTimestamp(selectedRecord.checkOut)}
                </ThemedText>
              </View>
              <View
                style={[
                  styles.selectedDayMetric,
                  {
                    backgroundColor: theme.backgroundSecondary,
                    borderColor: theme.border,
                  },
                ]}
              >
                <ThemedText
                  type="caption"
                  style={[
                    styles.selectedDayLabel,
                    { color: theme.textSecondary },
                  ]}
                >
                  Working duration
                </ThemedText>
                <ThemedText
                  style={[styles.selectedDayValue, { color: theme.text }]}
                >
                  {formatWorkedMinutes(selectedRecord.workedMinutes)}
                </ThemedText>
              </View>
              <View
                style={[
                  styles.selectedDayMetric,
                  {
                    backgroundColor: theme.backgroundSecondary,
                    borderColor: theme.border,
                  },
                ]}
              >
                <ThemedText
                  type="caption"
                  style={[
                    styles.selectedDayLabel,
                    { color: theme.textSecondary },
                  ]}
                >
                  Attendance source
                </ThemedText>
                <ThemedText
                  style={[styles.selectedDayValue, { color: theme.text }]}
                >
                  {selectedRecord.attendanceSource || "—"}
                </ThemedText>
              </View>
            </View>

            {selectedRecord.attendanceContext ? (
              <View style={[styles.policyNote, { backgroundColor: theme.infoBg, borderColor: theme.info }]}>
                <Feather
                  name={selectedRecord.attendanceContext === "EVENT" ? "calendar" : selectedRecord.attendanceContext === "FIELD_VISIT" ? "map-pin" : "briefcase"}
                  size={16}
                  color={theme.infoText}
                />
                <View style={{ flex: 1 }}>
                  <ThemedText style={{ color: theme.infoText, fontWeight: "800" }}>
                    {selectedRecord.attendanceContext === "EVENT"
                      ? `Event — ${selectedRecord.eventName || selectedRecord.contextName || "Assigned event"}`
                      : selectedRecord.attendanceContext === "FIELD_VISIT"
                        ? `Field Visit — ${selectedRecord.contextName || selectedRecord.fieldVisitName || "Assigned site"}`
                        : selectedRecord.attendanceContext}
                  </ThemedText>
                  {selectedRecord.eventLocation ? (
                    <ThemedText type="caption" style={{ color: theme.infoText }}>
                      {selectedRecord.eventLocation}
                    </ThemedText>
                  ) : null}
                  {selectedRecord.eventArrivalStatus ? (
                    <ThemedText type="caption" style={{ color: theme.infoText }}>
                      {selectedRecord.eventArrivalStatus === "LATE"
                        ? `Late by ${selectedRecord.eventLateMinutes || 0} minutes (event timing)`
                        : "On Time (event timing)"}
                    </ThemedText>
                  ) : null}
                </View>
              </View>
            ) : null}

            {selectedRecord.status === "late" && lateCutoff && selectedRecord.attendanceContext !== "EVENT" ? (
              <View
                style={[
                  styles.policyNote,
                  {
                    backgroundColor: theme.warningBg,
                    borderColor: theme.warning,
                  },
                ]}
              >
                <Feather name="clock" size={16} color={theme.warningText} />
                <ThemedText
                  style={{ color: theme.warningText, flex: 1, fontWeight: "600" }}
                >
                  Late policy: check-ins at or after {lateCutoff.slice(0, 5)} are
                  marked late.
                </ThemedText>
              </View>
            ) : null}

            {selectedRecord.fieldVisitCheckIn ||
            selectedRecord.fieldVisitCheckOut ? (
              <View
                style={[
                  styles.fieldVisitDetail,
                  {
                    backgroundColor: theme.infoBg,
                    borderColor: theme.info,
                  },
                ]}
              >
                <View style={styles.fieldVisitTitleRow}>
                  <Feather name="map-pin" size={16} color={theme.infoText} />
                  <ThemedText
                    style={{ color: theme.infoText, fontWeight: "800" }}
                  >
                    Field visit timing
                  </ThemedText>
                </View>
                <View style={styles.fieldVisitTimesRow}>
                  <View style={{ flex: 1 }}>
                    <ThemedText type="caption" style={{ color: theme.infoText }}>
                      Check-in
                    </ThemedText>
                    <ThemedText
                      style={{ color: theme.infoText, fontWeight: "800" }}
                    >
                      {formatAttendanceTimestamp(
                        selectedRecord.fieldVisitCheckIn,
                      )}
                    </ThemedText>
                  </View>
                  <View style={{ flex: 1 }}>
                    <ThemedText type="caption" style={{ color: theme.infoText }}>
                      Check-out
                    </ThemedText>
                    <ThemedText
                      style={{ color: theme.infoText, fontWeight: "800" }}
                    >
                      {formatAttendanceTimestamp(
                        selectedRecord.fieldVisitCheckOut,
                      )}
                    </ThemedText>
                  </View>
                </View>
              </View>
            ) : null}

            {Number(selectedRecord.biometricPunchCount || 0) > 0 ? (
              <View
                style={[
                  styles.fieldVisitDetail,
                  {
                    backgroundColor: theme.successBg,
                    borderColor: theme.success,
                  },
                ]}
              >
                <View style={styles.fieldVisitTitleRow}>
                  <Feather name="check-circle" size={16} color={theme.successText} />
                  <ThemedText
                    style={{ color: theme.successText, fontWeight: "800" }}
                  >
                    Biometric attendance confirmed
                  </ThemedText>
                </View>
                <ThemedText style={{ color: theme.successText }}>
                  {selectedRecord.biometricPunchCount} verified punch
                  {selectedRecord.biometricPunchCount === 1 ? "" : "es"}. First
                  punch: {formatAttendanceTimestamp(
                    selectedRecord.biometricFirstPunch,
                  )}
                  {selectedRecord.biometricLastPunch &&
                  selectedRecord.biometricLastPunch !==
                    selectedRecord.biometricFirstPunch
                    ? ` · Latest punch: ${formatAttendanceTimestamp(
                        selectedRecord.biometricLastPunch,
                      )}`
                    : ""}
                </ThemedText>
              </View>
            ) : null}

            {Number(selectedRecord.compOffEarned || 0) > 0 ? (
              <View
                style={[
                  styles.fieldVisitDetail,
                  {
                    backgroundColor: theme.successBg,
                    borderColor: theme.success,
                  },
                ]}
              >
                <View style={styles.fieldVisitTitleRow}>
                  <Feather name="award" size={16} color={theme.successText} />
                  <ThemedText
                    style={{ color: theme.successText, fontWeight: "800" }}
                  >
                    Comp-off earned
                  </ThemedText>
                </View>
                <ThemedText style={{ color: theme.successText }}>
                  {selectedRecord.compOffEarned} day
                  {Number(selectedRecord.compOffEarned) === 1 ? "" : "s"}
                  {selectedRecord.compOffEventName
                    ? ` credited for ${selectedRecord.compOffEventName}`
                    : " credited for Sunday event attendance"}
                  .
                </ThemedText>
              </View>
            ) : null}

            {selectedRecord.leaveType ? (
              <ThemedText
                style={[
                  styles.selectedDayNote,
                  {
                    backgroundColor: theme.backgroundSecondary,
                    color: theme.text,
                  },
                ]}
              >
                Leave: {selectedRecord.leaveType}
                {selectedRecord.isHalfDay ? " (Half day)" : ""}
                {selectedRecord.leaveReason
                  ? ` · ${selectedRecord.leaveReason}`
                  : ""}
              </ThemedText>
            ) : null}
            {selectedRecord.holidayName ? (
              <ThemedText
                style={[
                  styles.selectedDayNote,
                  {
                    backgroundColor: theme.backgroundSecondary,
                    color: theme.text,
                  },
                ]}
              >
                Holiday: {selectedRecord.holidayName}
              </ThemedText>
            ) : null}
            {selectedRecord.fieldVisitName ? (
              <ThemedText
                style={[
                  styles.selectedDayNote,
                  {
                    backgroundColor: theme.backgroundSecondary,
                    color: theme.text,
                  },
                ]}
              >
                Field visit attendance: {selectedRecord.fieldVisitName}
              </ThemedText>
            ) : null}
            {selectedRecord.missingCheckout ? (
              <View style={styles.missingCheckoutBox}>
                <Feather name="alert-triangle" size={16} color="#B45309" />
                <ThemedText style={{ color: "#92400E", flex: 1 }}>
                  Checkout is missing for this day. Submit regularization if the
                  session should be corrected.
                </ThemedText>
              </View>
            ) : null}
            {selectedRecord.fieldVisitMissingCheckout ? (
              <View style={styles.missingCheckoutBox}>
                <Feather name="alert-triangle" size={16} color="#B45309" />
                <ThemedText style={{ color: "#92400E", flex: 1 }}>
                  This field visit has no checkout recorded. Ask HR or your
                  manager to review the visit.
                </ThemedText>
              </View>
            ) : null}
          </>
        ) : (
          <View style={styles.selectedDayEmpty}>
            <Feather name="calendar" size={22} color={theme.textSecondary} />
            <ThemedText
              style={{ color: theme.textSecondary, textAlign: "center" }}
            >
              {monthlyHistoryLoading
                ? "Loading details for this date…"
                : "No attendance record applies to this date. It may be a future date or outside your employment period."}
            </ThemedText>
          </View>
        )}
      </View>

      <Spacer height={Spacing.lg} />

      <View style={[styles.legendRow, { paddingHorizontal: Spacing.lg }]}>
        {(
          [
            "present",
            "late",
            "absent",
            "notyet",
            "wfh",
            "leave",
            "holiday",
            "weeklyoff",
          ] as AttendanceStatus[]
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
              {STATUS_LABELS[status]}
            </ThemedText>
          </View>
        ))}
      </View>

      <Spacer height={Spacing["2xl"]} />

      {/* Stale Session Warning Banner */}
      {staleSession && !todayRecord && (
        <View
          style={[
            styles.undoBanner,
            {
              backgroundColor: "#FEF3C7",
              borderColor: "#FDE68A",
              marginTop: Spacing.md,
            },
          ]}
        >
          <View style={styles.undoBannerContent}>
            <Feather name="alert-triangle" size={16} color="#D97706" />
            <View style={styles.undoBannerText}>
              <ThemedText style={[styles.undoTitle, { color: "#92400E" }]}>
                Previous session not closed
              </ThemedText>
              <ThemedText style={[styles.undoSubtitle, { color: "#A16207" }]}>
                You forgot to check out on{" "}
                {new Date(staleSession.date).toLocaleDateString("en-IN", {
                  weekday: "short",
                  day: "numeric",
                  month: "short",
                })}
                . It remains open until you submit a correction or HR resolves
                it.
              </ThemedText>
            </View>
            <Pressable
              style={styles.undoButton}
              onPress={async () => {
                const request = await AttendanceRegularizationService.request({
                  userId: user!.id,
                  attendanceId: staleSession.id,
                  type: "MISSED_CHECKOUT",
                  reason: "Employee requested missed-checkout regularization",
                  requestedCheckout: new Date(
                    `${staleSession.date}T23:59:00+05:30`,
                  ).toISOString(),
                });
                if (request.error) {
                  Alert.alert("Request Failed", request.error.message);
                  return;
                }
                Alert.alert(
                  "Request Submitted",
                  "HR will review your missed checkout.",
                );
              }}
            >
              <ThemedText style={styles.undoButtonText}>Regularize</ThemedText>
            </Pressable>
          </View>
        </View>
      )}

      {/* Undo Checkout Banner */}
      {showUndoBanner && undoTimer > 0 && (
        <View
          style={[
            styles.undoBanner,
            { backgroundColor: theme.backgroundDefault },
          ]}
        >
          <View style={styles.undoBannerContent}>
            <Feather name="alert-circle" size={16} color="#F59E0B" />
            <View style={styles.undoBannerText}>
              <ThemedText style={styles.undoTitle}>
                Checkout can be undone
              </ThemedText>
              <ThemedText style={styles.undoSubtitle}>
                {undoTimer > 60
                  ? `${Math.floor(undoTimer / 60)}m ${undoTimer % 60}s remaining`
                  : `${undoTimer}s remaining`}
              </ThemedText>
            </View>
          </View>
          <Pressable style={styles.undoButton} onPress={handleUndoCheckout}>
            <Feather name="rotate-ccw" size={14} color="#60045d" />
            <ThemedText style={styles.undoButtonText}>Undo</ThemedText>
          </Pressable>
        </View>
      )}


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
              {
                backgroundColor: theme.backgroundDefault,
                paddingBottom: insets.bottom + Spacing.md,
              },
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
                    backgroundColor:
                      selectedOffice?.id === item.id
                        ? theme.primary + "20"
                        : "transparent",
                    borderColor:
                      selectedOffice?.id === item.id
                        ? theme.primary
                        : theme.textSecondary,
                  },
                ]}
                onPress={() => {
                  setShowOfficeModal(false);
                  setSelectedOffice(item);
                  void executeCheckIn();
                }}
              >
                <Feather
                  name={
                    selectedOffice?.id === item.id ? "check-circle" : "map-pin"
                  }
                  size={18}
                  color={
                    selectedOffice?.id === item.id
                      ? theme.primary
                      : theme.textSecondary
                  }
                />
                <View style={{ flex: 1 }}>
                  <ThemedText type="body">{item.name}</ThemedText>
                  <ThemedText
                    type="caption"
                    style={{ color: theme.textSecondary }}
                  >
                    {item.latitude
                      ? `📍 Geo-fenced · ${item.attendance_radius}m radius`
                      : `${item.attendance_radius}m radius`}
                  </ThemedText>
                </View>
              </Pressable>
            ))}
            <Button
              onPress={() => setShowOfficeModal(false)}
              style={{
                marginTop: Spacing.lg,
                backgroundColor: Colors.light.error,
              }}
            >
              Cancel
            </Button>
          </View>
        </View>
      </Modal>
    </ScreenScrollView>
    {user?.id ? (
      <AttendanceCheckoutFlow
        visible={showAttendanceCheckout}
        userId={user.id}
        onCancel={() => setShowAttendanceCheckout(false)}
        onCheckedOut={loadData}
        onStartVisit={(type: AttendanceNextAction) =>
          navigation.navigate("FieldVisits", { startVisitIntent: type })
        }
      />
    ) : null}
    </>
  );
}

const styles = StyleSheet.create({
  checkInCard: {
    paddingHorizontal: Spacing.xl,
    paddingBottom: 0,
    borderBottomLeftRadius: 28,
    borderBottomRightRadius: 28,
    ...(Platform.OS === "web"
      ? { boxShadow: "0 8px 28px rgba(109,27,109,0.20)" }
      : {
          shadowColor: "#6D1B6D",
          shadowOffset: { width: 0, height: 8 },
          shadowOpacity: 0.2,
          shadowRadius: 24,
          elevation: 10,
        }),
  },
  timeDisplay: { alignItems: "center", paddingBottom: 0 },
  statusRow: {
    flexDirection: "row",
    gap: Spacing.md,
    flexWrap: "wrap",
    justifyContent: "center",
  },
  timeBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: "rgba(255,255,255,0.18)",
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: BorderRadius.full,
  },
  buttonsRow: { flexDirection: "row", gap: Spacing.md, width: "100%" },
  checkButton: {
    flex: 1,
    height: 50,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    flexDirection: "row",
    gap: 8,
  },
  checkInButton: {
    backgroundColor: "#FFFFFF",
  },
  checkOutButton: {
    backgroundColor: "rgba(255,255,255,0.18)",
    borderWidth: 1.5,
    borderColor: "rgba(255,255,255,0.5)",
  },
  locationBtn: { flexDirection: "row", alignItems: "center", gap: Spacing.sm },
  summaryRow: { flexDirection: "row", flexWrap: "wrap", gap: Spacing.md },
  summaryCard: {
    flex: 1,
    minWidth: 120,
    alignItems: "center",
    padding: Spacing.lg,
    borderRadius: BorderRadius.md,
    ...(Platform.OS === "web"
      ? { boxShadow: "0 2px 8px rgba(109,27,109,0.07)" }
      : {
          shadowColor: "#6D1B6D",
          shadowOffset: { width: 0, height: 2 },
          shadowOpacity: 0.07,
          shadowRadius: 8,
          elevation: 2,
        }),
  },
  calendar: {
    padding: Spacing.lg,
    borderRadius: BorderRadius.lg,
    marginHorizontal: Spacing.lg,
    ...(Platform.OS === "web"
      ? { boxShadow: "0 2px 8px rgba(109,27,109,0.07)" }
      : {
          shadowColor: "#6D1B6D",
          shadowOffset: { width: 0, height: 2 },
          shadowOpacity: 0.07,
          shadowRadius: 8,
          elevation: 2,
        }),
  },
  calendarTitle: {
    textAlign: "center",
    fontWeight: "700",
    fontSize: 15,
  },
  calendarHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.sm,
    marginBottom: Spacing.md,
  },
  calendarTitleBlock: {
    flex: 1,
    alignItems: "center",
  },
  calendarArrow: {
    width: 36,
    height: 36,
    borderRadius: BorderRadius.full,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  historyLoadingRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: Spacing.sm,
    paddingBottom: Spacing.md,
  },
  selectedDayCard: {
    padding: Spacing.lg,
    borderRadius: BorderRadius.lg,
    marginHorizontal: Spacing.lg,
    borderWidth: 1,
    ...(Platform.OS === "web"
      ? { boxShadow: "0 2px 8px rgba(109,27,109,0.07)" }
      : {
          shadowColor: "#6D1B6D",
          shadowOffset: { width: 0, height: 2 },
          shadowOpacity: 0.07,
          shadowRadius: 8,
          elevation: 2,
        }),
  },
  selectedDayHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.md,
    marginBottom: Spacing.md,
  },
  selectedStatusBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    borderRadius: BorderRadius.full,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  selectedDayGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: Spacing.sm,
  },
  selectedDayMetric: {
    minWidth: 130,
    flex: 1,
    padding: Spacing.md,
    borderRadius: BorderRadius.md,
    borderWidth: 1,
  },
  selectedDayLabel: {
    fontSize: 12,
    lineHeight: 17,
    fontWeight: "600",
  },
  selectedDayValue: {
    fontWeight: "800",
    fontSize: 16,
    lineHeight: 22,
    marginTop: 4,
  },
  selectedDayNote: {
    marginTop: Spacing.md,
    padding: Spacing.md,
    borderRadius: BorderRadius.md,
  },
  policyNote: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.sm,
    marginTop: Spacing.md,
    padding: Spacing.md,
    borderRadius: BorderRadius.md,
    borderWidth: 1,
  },
  fieldVisitDetail: {
    marginTop: Spacing.md,
    padding: Spacing.md,
    borderRadius: BorderRadius.md,
    borderWidth: 1,
  },
  fieldVisitTitleRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.sm,
    marginBottom: Spacing.sm,
  },
  fieldVisitTimesRow: {
    flexDirection: "row",
    gap: Spacing.md,
  },
  selectedDayEmpty: {
    alignItems: "center",
    gap: Spacing.sm,
    paddingVertical: Spacing.lg,
  },
  missingCheckoutBox: {
    flexDirection: "row",
    gap: Spacing.sm,
    alignItems: "center",
    marginTop: Spacing.md,
    padding: Spacing.md,
    borderRadius: BorderRadius.md,
    backgroundColor: "#FEF3C7",
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
  undoBanner: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginHorizontal: Spacing.lg,
    marginBottom: Spacing.md,
    padding: Spacing.md,
    borderRadius: BorderRadius.md,
    borderWidth: 1,
    borderColor: "#FDE68A",
    ...(Platform.OS === "web"
      ? { boxShadow: "0 2px 8px rgba(245,158,11,0.12)" }
      : {
          shadowColor: "#F59E0B",
          shadowOffset: { width: 0, height: 2 },
          shadowOpacity: 0.12,
          shadowRadius: 8,
          elevation: 3,
        }),
  },
  undoBannerContent: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.sm,
    flex: 1,
  },
  undoBannerText: {
    gap: 2,
  },
  undoTitle: {
    fontSize: 13,
    fontWeight: "700",
    color: "#92400E",
  },
  undoSubtitle: {
    fontSize: 11,
    color: "#A16207",
  },
  undoButton: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    backgroundColor: "#F5EEF5",
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: BorderRadius.full,
  },
  undoButtonText: {
    fontSize: 12,
    fontWeight: "700",
    color: "#60045d",
  },
  earlyCheckoutCard: {
    width: "90%",
    maxWidth: 430,
    borderRadius: 16,
    padding: 20,
  },
  earlyCheckoutTitle: { fontSize: 19, fontWeight: "800" },
  earlyCheckoutHelp: {
    fontSize: 13,
    lineHeight: 19,
    marginTop: 6,
    marginBottom: 14,
  },
  earlyCheckoutInput: {
    borderWidth: 1.5,
    borderRadius: 10,
    minHeight: 100,
    padding: 12,
    textAlignVertical: "top",
  },
  earlyCheckoutActions: { flexDirection: "row", gap: 10, marginTop: 14 },
  earlyCheckoutButton: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 9,
    alignItems: "center",
  },
});
