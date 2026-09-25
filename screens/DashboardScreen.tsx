import React, { useState, useCallback, useEffect, useRef } from "react";
import {
  StyleSheet,
  View,
  Pressable,
  TouchableOpacity,
  RefreshControl,
  ActivityIndicator,
  Alert,
  Image,
  Platform,
  Modal,
  Dimensions,
} from "react-native";
import Feather from "@expo/vector-icons/Feather";
import { useFocusEffect, useIsFocused } from "@react-navigation/native";
import { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { ScreenScrollView } from "@/components/ScreenScrollView";
import { ThemedText } from "@/components/ThemedText";
import { useTheme } from "@/hooks/useTheme";
import { useScreenRefresh } from "@/hooks/useScreenRefresh";
import { useAuth } from "@/contexts/AuthContext";
import { Spacing, BorderRadius, Colors, Shadows } from "@/constants/theme";
import Spacer from "@/components/Spacer";
import { supabase } from "@/lib/supabase";
import { AttendanceService } from "@/services/attendance.service";
import GeofenceReasonModal from "@/components/modals/GeofenceReasonModal";
import { OfficeService } from "@/services/office.service";
import * as Location from "expo-location";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { getCurrentGPS } from "@/utils/gps";
import { secureStorage } from "@/utils/secureStorage";
import { AttendanceFraudService } from "@/services/attendance-fraud.service";
import { isDeveloperModeEnabled } from "expo-developer-mode";
import { attendanceInternetAvailable } from "@/utils/attendanceConnectivity";
import AttendanceCheckoutFlow, {
  type AttendanceNextAction,
} from "@/components/AttendanceCheckoutFlow";

// Alert.alert does nothing on Safari web — use this everywhere in this screen
function showAlert(title: string, message?: string) {
  if (Platform.OS === "web") {
    window.alert(message ? `${title}\n\n${message}` : title);
  } else {
    Alert.alert(title, message);
  }
}
import { useLocationTracking } from "@/contexts/LocationTrackingContext";
import {
  EventAnnouncement,
  EventAttendanceAction,
  EventService,
  Event,
} from "@/services/event.service";
import {
  formatDate,
  formatTime,
  getAttendanceCardStyle,
  toTitleCase,
} from "@/utils/format";
import { DashboardSummaryService } from "@/services/dashboard-summary.service";

type DashboardScreenProps = { navigation: NativeStackNavigationProp<any> };

interface Task {
  id: string;
  title: string;
  status: string;
  priority: "high" | "medium" | "low";
  due_date: string;
  type?: string;
  assigned_to?: string | null;
  created_by?: string | null;
}

// ─── color palette ───────────────────────────────────────────────────────────
const C = {
  primary: "#6D1B6D",
  success: "#12966E",
  warning: "#D97706",
  error: "#C8252D",
  info: "#1A5FD4",
  violet: "#7C3AED",
  pink: "#D4468C",
};

// ─── responsive helpers ───────────────────────────────────────────────────────
const isWeb = Platform.OS === "web";
const isWide = () => {
  const w = Dimensions.get("window").width;
  return w >= 768;
};

// ─── StatCard ────────────────────────────────────────────────────────────────
function StatCard({
  icon,
  title,
  value,
  subtitle,
  color,
  valueColor,
  onPress,
}: {
  icon: keyof typeof Feather.glyphMap;
  title: string;
  value: string | number;
  subtitle?: string;
  color: string;
  valueColor?: string;
  onPress?: () => void;
}) {
  const { theme, isDark } = useTheme();
  return (
    <Pressable
      style={({ pressed }) => [
        styles.statCard,
        {
          borderLeftColor: color,
          backgroundColor: theme.backgroundDefault,
          opacity: pressed ? 0.88 : 1,
        },
        {
          borderLeftColor: color,
          backgroundColor: isDark
            ? "rgba(255,255,255,0.06)"
            : theme.backgroundDefault,
          opacity: pressed ? 0.88 : 1,
        },
        isWeb && styles.statCardWeb,
      ]}
      onPress={onPress}
    >
      <View style={[styles.statIcon, { backgroundColor: color + "18" }]}>
        <Feather name={icon} size={18} color={color} />
      </View>
      <ThemedText
        type="caption"
        style={{ color: theme.textSecondary, marginBottom: 2, fontSize: 11 }}
      >
        {title}
      </ThemedText>
      <ThemedText
        style={{
          color: valueColor ?? theme.text,
          fontWeight: "800",
          fontSize: 20,
          lineHeight: 26,
        }}
      >
        {value}
      </ThemedText>
      {subtitle ? (
        <ThemedText
          type="caption"
          style={{ color: theme.textSecondary, fontSize: 10, marginTop: 1 }}
        >
          {subtitle}
        </ThemedText>
      ) : null}
    </Pressable>
  );
}

// ─── QuickAction ─────────────────────────────────────────────────────────────
function QuickAction({
  icon,
  label,
  color,
  onPress,
}: {
  icon: keyof typeof Feather.glyphMap;
  label: string;
  color: string;
  onPress: () => void;
}) {
  const { theme } = useTheme();
  return (
    <Pressable
      style={({ pressed }) => [
        styles.quickAction,
        {
          backgroundColor: theme.backgroundDefault,
          opacity: pressed ? 0.82 : 1,
        },
      ]}
      onPress={onPress}
    >
      <View style={[styles.quickActionIcon, { backgroundColor: color }]}>
        <Feather name={icon} size={19} color="#FFFFFF" />
      </View>
      <ThemedText
        style={[styles.quickActionLabel, { color: theme.textSecondary }]}
        numberOfLines={2}
      >
        {label}
      </ThemedText>
    </Pressable>
  );
}

// ─── Main screen ─────────────────────────────────────────────────────────────
export default function DashboardScreen({ navigation }: DashboardScreenProps) {
  const { theme, isDark } = useTheme();
  const { user } = useAuth();
  const isFocused = useIsFocused();
  const insets = useSafeAreaInsets();
  const { health: trackingHealth } = useLocationTracking();

  
  const [todayAttendance, setTodayAttendance] = useState<any>(null);
  const [pendingTasks, setPendingTasks] = useState<Task[]>([]);
  const [dashboardLoadError, setDashboardLoadError] = useState<string | null>(
    null,
  );
  const [serverBusinessHour, setServerBusinessHour] = useState<number | null>(
    null,
  );
  const [leaveBalance, setLeaveBalance] = useState({
    sick: 0,
    casual: 0,
    earned: 0,
    comp_off: 0,
  });
  const [unreadNotifications, setUnreadNotifications] = useState(0);
  const [attendanceLoading, setAttendanceLoading] = useState(false);
  const [showAttendanceCheckout, setShowAttendanceCheckout] = useState(false);
  const [pendingVisits, setPendingVisits] = useState(0);
  const [geofenceEvent, setGeofenceEvent] = useState<{ id: string; distance: number } | null>(null);
  const [checkInMsg, setCheckInMsg] = useState<{
    type: "success" | "error";
    text: string;
  } | null>(null);
  const [offices, setOffices] = useState<any[]>([]);
  const [showOfficePicker, setShowOfficePicker] = useState(false);
  const [userBaseLat, setUserBaseLat] = useState<number | null>(null);
  const [userBaseLng, setUserBaseLng] = useState<number | null>(null);
  const [isEscalationMember, setIsEscalationMember] = useState(false);
  const [upcomingEvents, setUpcomingEvents] = useState<EventAttendanceAction[]>(
    [],
  );
  const [eventAnnouncements, setEventAnnouncements] = useState<
    EventAnnouncement[]
  >([]);
  const [acknowledgingEventId, setAcknowledgingEventId] = useState<
    string | null
  >(null);
  const [selectedEvent, setSelectedEvent] = useState<Event | null>(null);
  const [showEventPicker, setShowEventPicker] = useState(false);
  const [eventCheckInLoading, setEventCheckInLoading] = useState(false);
  const [showReminderModal, setShowReminderModal] = useState<{
    type: "checkin" | "checkout";
  } | null>(null);
  const [hasTeam, setHasTeam] = useState(false);
  const [undoCheckout, setUndoCheckout] = useState<{
    attendanceId: string;
    token: string;
    expiresAt: string;
  } | null>(null);
  const [undoSeconds, setUndoSeconds] = useState(0);
  const dashboardRequestRef = useRef<Promise<void> | null>(null);
  const eventRequestRef = useRef<Promise<void> | null>(null);

  const isCheckedIn = !!(
    todayAttendance?.checkin_time ||
    todayAttendance?.checkIn ||
    todayAttendance?.check_in
  );
  const isCheckedOut = !!(
    todayAttendance?.checkout_time ||
    todayAttendance?.checkOut ||
    todayAttendance?.check_out
  );

  useEffect(() => {
    if (!user?.id) return;
    secureStorage.getItem(`undo_checkout_${user.id}`).then((raw) => {
      if (!raw) return;
      try {
        const saved = JSON.parse(raw);
        if (
          saved.attendanceId &&
          saved.token &&
          Date.parse(saved.expiresAt) > Date.now()
        ) {
          setUndoCheckout(saved);
        } else {
          secureStorage.removeItem(`undo_checkout_${user.id}`);
        }
      } catch {
        secureStorage.removeItem(`undo_checkout_${user.id}`);
      }
    });
  }, [user?.id]);

  useEffect(() => {
    if (!undoCheckout || !user?.id) {
      setUndoSeconds(0);
      return;
    }
    const update = () => {
      const seconds = Math.max(
        0,
        Math.ceil((Date.parse(undoCheckout.expiresAt) - Date.now()) / 1000),
      );
      setUndoSeconds(seconds);
      if (seconds === 0) {
        setUndoCheckout(null);
        secureStorage.removeItem(`undo_checkout_${user.id}`);
      }
    };
    update();
    const timer = setInterval(update, 1000);
    return () => clearInterval(timer);
  }, [undoCheckout, user?.id]);

  // ── data loader ─────────────────────────────────────────────────────────────
  const loadData = useCallback(
    (force = false): Promise<void> => {
      if (!user?.id) return Promise.resolve();
      if (dashboardRequestRef.current) return dashboardRequestRef.current;

      const request = (async () => {
        try {
          const summary = await DashboardSummaryService.getEmployee(
            user.id,
            force,
          );
          setServerBusinessHour(
            Number(
              new Intl.DateTimeFormat("en-US", {
                timeZone: "Asia/Kolkata",
                hour: "2-digit",
                hourCycle: "h23",
              }).format(new Date(summary.server_now)),
            ),
          );
          setTodayAttendance(summary.attendance ?? null);
          setUserBaseLat(summary.base_latitude ?? null);
          setUserBaseLng(summary.base_longitude ?? null);
          setLeaveBalance({
            sick: Number(summary.leave_balance?.sick) || 0,
            casual: Number(summary.leave_balance?.casual) || 0,
            earned: Number(summary.leave_balance?.earned) || 0,
            comp_off: Number(summary.leave_balance?.comp_off) || 0,
          });
          setPendingTasks(summary.pending_tasks);
          setUnreadNotifications(Number(summary.unread_notifications) || 0);
          setPendingVisits(Number(summary.pending_visits) || 0);
          setIsEscalationMember(summary.is_escalation_member === true);

          const privilegedRole = [
            "SYSTEM_ADMIN",
            "ADMIN",
            "HR",
            "HRD",
          ].includes(user.role);
          setHasTeam(
            !privilegedRole && Number(summary.direct_reports || 0) > 0,
          );
          setDashboardLoadError(null);

          if (!eventRequestRef.current) {
            const eventRequest = Promise.all([
              EventService.getEventsAvailableForAttendance(user.id),
              EventService.getAnnouncements(user.id),
            ])
              .then(([events, announcements]) => {
                setUpcomingEvents(events);
                setEventAnnouncements(announcements);
              })
              .catch((eventError: any) => {
                setDashboardLoadError(
                  `Events could not be loaded: ${eventError?.message || "query failed"}`,
                );
              })
              .finally(() => {
                if (eventRequestRef.current === eventRequest) {
                  eventRequestRef.current = null;
                }
              });
            eventRequestRef.current = eventRequest;
          }
        } catch (error: any) {
          setDashboardLoadError(
            error?.message ||
              "Dashboard data could not be loaded. Previous values are being preserved.",
          );
        }
      })();

      dashboardRequestRef.current = request;
      return request.finally(() => {
        if (dashboardRequestRef.current === request) {
          dashboardRequestRef.current = null;
        }
      });
    },
    [user?.id, user?.role],
  );

  useFocusEffect(
    useCallback(() => {
      void loadData();
    }, [loadData]),
  );

  // A biometric punch is imported by the server even when this app is already
  // open. Realtime refreshes the card immediately; polling is a fallback for
  // devices or networks where the Realtime socket is suspended.
  useEffect(() => {
    if (!user?.id || !isFocused) return;
    const channel = supabase
      .channel(`dashboard-attendance-${user.id}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "attendance_logs",
          filter: `user_id=eq.${user.id}`,
        },
        () => {
          DashboardSummaryService.invalidateEmployee(user.id);
          void loadData(true);
        },
      )
      .subscribe();
    const interval = setInterval(() => void loadData(), 60_000);
    return () => {
      clearInterval(interval);
      supabase.removeChannel(channel);
    };
  }, [user?.id, isFocused, loadData]);

  const onRefresh = async () => {
    setRefreshing(true);
    if (user?.id) DashboardSummaryService.invalidateEmployee(user.id);
    await loadData(true);
    setRefreshing(false);
  };

  const acknowledgeEvent = async (announcement: EventAnnouncement) => {
    if (!user?.id || announcement.acknowledgedAt) return;
    setAcknowledgingEventId(announcement.eventId);
    try {
      const acknowledgedAt = await EventService.acknowledgeEvent(
        announcement.eventId,
        user.id,
      );
      setEventAnnouncements((current) =>
        current.map((item) =>
          item.eventId === announcement.eventId
            ? { ...item, acknowledgedAt }
            : item,
        ),
      );
      setUnreadNotifications((count) => Math.max(0, count - 1));
    } catch (error: any) {
      showAlert("Unable to acknowledge", error?.message || "Please try again.");
    } finally {
      setAcknowledgingEventId(null);
    }
  };

  const openEventInTasks = (eventId: string) => {
    navigation.getParent()?.navigate("TasksTab", {
      screen: "Tasks",
      params: { eventId },
    });
  };

  const getGreeting = () => {
    const h = serverBusinessHour;
    if (h == null) return "Welcome";
    if (h < 12) return "Good Morning";
    if (h < 17) return "Good Afternoon";
    return "Good Evening";
  };

  // ── check-in handler ────────────────────────────────────────────────────────
  const getCurrentLocation = async () => {
    if (Platform.OS !== "web") {
      const { status } = await Location.getForegroundPermissionsAsync();
      if (status !== "granted") {
        const requested = await Location.requestForegroundPermissionsAsync();
        if (requested.status !== "granted") {
          showAlert("Location permission is required for attendance.");
          return null;
        }
      }
    }

    const gps = await getCurrentGPS();
    if (!gps) {
      showAlert("Unable to detect your current location. Please try again.");
      return null;
    }
    if (gps.mocked) {
      showAlert(
        "Mock location detected",
        "Attendance cannot be marked while a mock-location provider is active.",
      );
      return null;
    }
    if (gps.accuracy != null && gps.accuracy > 100) {
      showAlert(
        "GPS accuracy is too low",
        `Current accuracy is about ${Math.round(gps.accuracy)} metres. Move outdoors or enable precise location and try again.`,
      );
      return null;
    }

    return gps;
  };

  const recordFraudEvidence = async (
    attendanceId: string | undefined,
    eventType: "CHECKIN" | "CHECKOUT",
    location: NonNullable<Awaited<ReturnType<typeof getCurrentGPS>>>,
    officeDistance: number,
  ) => {
    if (!user?.id || !attendanceId) return;
    try {
      const developerMode = await isDeveloperModeEnabled();
      await AttendanceFraudService.analyze({
        userId: user.id,
        attendanceId,
        eventType,
        location: {
          latitude: location.latitude,
          longitude: location.longitude,
          accuracy: location.accuracy ?? null,
          mocked: location.mocked ?? false,
          developerMode: developerMode ?? false,
        },
        officeDistance,
      });
    } catch (error) {
      console.warn("Attendance fraud evidence was not recorded:", error);
    }
  };

  const handleUndoCheckout = async () => {
    if (!user?.id || !undoCheckout) return;
    setAttendanceLoading(true);
    try {
      const result = await AttendanceService.undoCheckout({
        userId: user.id,
        attendanceId: undoCheckout.attendanceId,
        undoToken: undoCheckout.token,
      });
      if (!result.success)
        return showAlert("Unable to undo checkout", result.message);
      setUndoCheckout(null);
      await secureStorage.removeItem(`undo_checkout_${user.id}`);
      await loadData();
      showAlert("Checkout undone", "Your attendance session is active again.");
    } finally {
      setAttendanceLoading(false);
    }
  };

  const handleCheckOut = async () => {
    if (!user?.id) {
      showAlert("Error", "You must be logged in.");
      return;
    }

    setAttendanceLoading(true);
    try {
      const fresh = await AttendanceService.getToday(user.id);
      if (!fresh.data?.checkin_time) {
        showAlert("Not Checked In", "You need to check in first.");
        return;
      }

      if (fresh.data?.checkout_time) {
        showAlert(
          "Already Checked Out",
          `You already checked out at ${new Date(fresh.data.checkout_time).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", timeZone: "Asia/Kolkata" })} today.`,
        );
        return;
      }

      setShowAttendanceCheckout(true);
    } catch (err: any) {
      showAlert(
        "Unable to check out. Please try again.",
        err?.message || undefined,
      );
    } finally {
      setAttendanceLoading(false);
    }
  };

  const handleAttendanceToggle = async () => {
    console.log("handleAttendanceToggle called");
    if (!user?.id) {
      showAlert("Error", "You must be logged in.");
      return;
    }
    if (!(await attendanceInternetAvailable())) {
      showAlert(
        "Internet Required",
        "A verified internet connection is required to mark attendance. No offline attendance record was created.",
      );
      return;
    }
    console.log("User ID:", user.id);
    console.log("isCheckedIn:", isCheckedIn, "isCheckedOut:", isCheckedOut);

    if (isCheckedIn && isCheckedOut) {
      showAlert(
        "Attendance Complete",
        "You have already checked in and out for today.",
      );
      return;
    }

    if (isCheckedIn) {
      await handleCheckOut();
      return;
    }

    setAttendanceLoading(true);
    let siteVisitWarning: string | null = null;
    try {
      // Re-verify from DB before proceeding — isCheckedIn is derived from local state
      // which may be stale if the user closed and reopened the app.
      const fresh = await AttendanceService.getToday(user.id);
      if (fresh.data?.checkin_time) {
        setTodayAttendance(fresh.data);
        setAttendanceLoading(false);
        showAlert(
          "Already Checked In",
          `You checked in at ${new Date(fresh.data.checkin_time).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", timeZone: "Asia/Kolkata" })} today.`,
        );
        return;
      }
      const gps = await getCurrentLocation();
      if (!gps) {
        return;
      }

      const verifiedCheckIn = await AttendanceService.officeCheckIn({
        userId: user.id,
        location: gps,
      });
      const checkInResult = verifiedCheckIn.result;
      const nearest = {
        office: verifiedCheckIn.office,
        distanceMetres: verifiedCheckIn.distanceMetres,
      };
      await recordFraudEvidence(
        checkInResult.id,
        "CHECKIN",
        gps,
        nearest.distanceMetres,
      );
      try {
        const { error: auditError } = await supabase.rpc(
          "rpc_record_checkin_attempt",
          {
            p_values: {
              user_id: user.id,
              latitude: gps.latitude,
              longitude: gps.longitude,
              nearest_office_name: nearest.office.name,
              nearest_office_distance_m: nearest.distanceMetres,
              status: "success",
              failure_reason: null,
            },
          },
        );
        if (auditError) {
          console.warn("Check-in succeeded but audit logging failed");
        }
      } catch {
        console.warn("Check-in succeeded but audit logging was unavailable");
      }

      if (!checkInResult.side_effects_committed) {
        throw new Error(
          "The server did not confirm the transactional check-in side effects.",
        );
      }
      siteVisitWarning = checkInResult.automatic_site_visit_id
        ? ` Automatic site visit committed for ${checkInResult.automatic_site_name}.`
        : null;

      try {
        await loadData();
      } catch {
        console.warn(
          "Check-in succeeded but the dashboard refresh was deferred",
        );
      }
      if (Platform.OS !== "web") {
        navigation.navigate("LocationTrackingSetup");
      }
      showAlert(
        "Checked In ✅",
        `Checked in at ${new Date(
          checkInResult.checkin_time!,
        ).toLocaleTimeString([], {
          hour: "2-digit",
          minute: "2-digit",
          timeZone: "Asia/Kolkata",
        })} · ${nearest.office.name}.${siteVisitWarning ?? ""}`,
      );
    } catch (e: any) {
      console.error("Check-in error:", e);
      try {
        await supabase.rpc("rpc_record_checkin_attempt", {
          p_values: {
            latitude: null,
            longitude: null,
            nearest_office_name: null,
            nearest_office_distance_m: null,
            status: "blocked",
            failure_reason: e?.message || "Unknown check-in error",
          },
        });
      } catch (auditError) {
        console.warn(
          "Failed check-in attempt could not be audited",
          auditError,
        );
      }
      showAlert(
        "Check-in Failed",
        e?.message || "Check-in failed. Please try again.",
      );
    } finally {
      setAttendanceLoading(false);
    }
  };

  const handleEventAttendance = async (event: EventAttendanceAction) => {
    if (!user?.id) return;
    if (event.userCheckInTime && event.userCheckOutTime) {
      showAlert(
        "Event Attendance Completed",
        `You have already checked out from "${event.title}".`,
      );
      return;
    }
    const isCheckingOut = !!event.userCheckInTime;
    setEventCheckInLoading(true);
    setShowEventPicker(false);
    try {
      const gps = await getCurrentGPS();
      if (!gps) {
        showAlert("Location Required", "Could not get your location.");
        return;
      }
      if (isCheckingOut) {
        const checkoutResult = await EventService.checkOutFromEvent({
          eventId: event.id,
          location: gps,
        });
        showAlert(
          "Event Check-Out ✅",
          checkoutResult.alreadyCheckedOut
            ? `You are already checked out from "${event.title}".`
            : `You have checked out from "${event.title}".`,
        );
        await loadData();
        return;
      }
      const result = await EventService.checkInToEvent({
        eventId: event.id,
        location: gps,
      });
      showAlert(
        "Event Check-In ✅",
        result.compOffCredited
          ? `You have checked in to "${event.title}". ${result.compOffEligibleDays} comp-off day(s) have been credited.`
          : result.alreadyCheckedIn
            ? `You are already checked in to "${event.title}".`
            : `You have checked in to "${event.title}" — ${result.arrivalStatus === "LATE" ? `Late by ${result.lateMinutes} min` : "On Time"}.${result.compOffEligibleDays > 0 ? ` ${result.compOffEligibleDays} comp-off day(s) are pending HR approval.` : ""}`,
      );
      await loadData();
    } catch (e: any) {
      showAlert(
        isCheckingOut ? "Event Check-Out Failed" : "Event Check-In Failed",
        e.message ||
          "Unable to verify your location. Please enable precise location access and try again.",
      );
    } finally {
      setEventCheckInLoading(false);
    }
  };

  // ── derived values ──────────────────────────────────────────────────────────
  const attendanceLabel =
    isCheckedIn && isCheckedOut
      ? "Completed"
      : isCheckedIn
        ? "Check Out"
        : "Check In";
  const isOpenEventAttendance =
    todayAttendance?.attendance_type === "EVENT" &&
    isCheckedIn &&
    !isCheckedOut;
  const openEvent = upcomingEvents.find(
    (event) => event.userCheckInTime && !event.userCheckOutTime,
  );
  const eventAttendanceLabel = openEvent
    ? "Event Check-Out"
    : upcomingEvents.length > 0 &&
        upcomingEvents.every(
          (event) => event.userCheckInTime && event.userCheckOutTime,
        )
      ? "Event Completed"
      : "Event Check-In";
  const attendanceBtnColor =
    isCheckedIn && isCheckedOut ? C.success : isCheckedIn ? C.info : "#FFFFFF";
  const attendanceBtnIcon: keyof typeof Feather.glyphMap =
    isCheckedIn && isCheckedOut
      ? "check-circle"
      : isCheckedIn
        ? "log-out"
        : "log-in";

  const SALES_ROLES = [
    "SALES_EXECUTIVE",
    "BDE",
    "SENIOR_BDE",
    "BDM",
    "BDM_SALES",
    "ASSOCIATE_BDE",
    "ASSOCIATE_BDM",
    "ASSOCIATE_SALES_EXECUTIVE",
    "SALES",
    "TELECALLER",
    "AGENT",
    "CO-ORDINATOR",
  ];
  // SALES_MANAGER is intentionally not an individual-contributor sales role.
  // It can access manager-facing team information when reports are assigned.
  const isMonitoringRole = ["SYSTEM_ADMIN", "ADMIN", "HR", "HRD"].includes(
    user?.role ?? "",
  );
  const isSalesRole = SALES_ROLES.includes(user?.role ?? "");
  const canViewLiveTracking =
    isMonitoringRole || (isEscalationMember && !isSalesRole);
  // Calculate remaining leave days (not total allocation)
  // If the database stores remaining days, use as-is
  // If it stores allocated days, we need to subtract used days
  const totalLeave = Math.max(
    0,
    leaveBalance.casual +
      leaveBalance.earned +
      leaveBalance.sick +
      leaveBalance.comp_off,
  );

  // ── render ──────────────────────────────────────────────────────────────────
  return (
    <>
    <ScreenScrollView
      style={{ backgroundColor: theme.backgroundRoot }}
      contentContainerStyle={[isWeb && styles.webContentContainer]}
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          onRefresh={onRefresh}
          tintColor={C.primary}
        />
      }
    >
      {dashboardLoadError ? (
        <View
          style={{
            margin: Spacing.md,
            marginBottom: 0,
            padding: 12,
            borderRadius: 10,
            backgroundColor: "#FEE2E2",
          }}
        >
          <ThemedText style={{ color: "#991B1B", fontWeight: "700" }}>
            Dashboard data unavailable
          </ThemedText>
          <ThemedText type="caption" style={{ color: "#991B1B", marginTop: 3 }}>
            {dashboardLoadError} Pull down to retry; existing card values were
            not replaced with zero.
          </ThemedText>
        </View>
      ) : null}
      {/* ── Hero Header ── */}
      <View
        style={[
          styles.header,
          { backgroundColor: C.primary, paddingTop: insets.top + Spacing.sm },
          isWeb && styles.headerWeb,
        ]}
      >
        {/* Top Row */}
        <View style={styles.headerTop}>
          <View style={styles.logoWrap}>
            <Image
              source={require("../assets/images/logo.png")}
              style={styles.logo}
              resizeMode="contain"
            />
          </View>
          <View style={styles.headerInfo}>
            <ThemedText type="caption" style={styles.greetingText}>
              {getGreeting()}
            </ThemedText>
            <ThemedText type="h3" style={styles.nameText} numberOfLines={1}>
              {toTitleCase(user?.name) || "User"}
            </ThemedText>
            <ThemedText type="caption" style={styles.roleText}>
              {toTitleCase(user?.role?.replace(/_/g, " "))}
            </ThemedText>
          </View>
          <Pressable
            style={({ pressed }) => [
              styles.bellBtn,
              { opacity: pressed ? 0.7 : 1 },
            ]}
            onPress={() => navigation.navigate("Notifications")}
            accessibilityLabel="Notifications"
          >
            <Feather name="bell" size={20} color="#FFFFFF" />
            {unreadNotifications > 0 ? (
              <View style={styles.badge}>
                <ThemedText style={styles.badgeText}>
                  {unreadNotifications > 9 ? "9+" : unreadNotifications}
                </ThemedText>
              </View>
            ) : null}
          </Pressable>
        </View>

        <Spacer height={Spacing.xl} />

        {/* Check-In Button */}
        <Pressable
          onPress={() => {
            console.log("Check-in button pressed");
            if (isOpenEventAttendance) setShowEventPicker(true);
            else handleAttendanceToggle();
          }}
          disabled={attendanceLoading || (isCheckedIn && isCheckedOut)}
          style={({ pressed }) => [
            styles.checkInBtn,
            {
              backgroundColor:
                isCheckedIn && isCheckedOut
                  ? "rgba(255,255,255,0.18)"
                  : "#FFFFFF",
              opacity: pressed ? 0.88 : 1,
            },
          ]}
        >
          {attendanceLoading ? (
            <ActivityIndicator color={C.primary} size="small" />
          ) : (
            <>
              <View
                style={[
                  styles.checkInIconWrap,
                  {
                    backgroundColor:
                      isCheckedIn && isCheckedOut
                        ? "rgba(255,255,255,0.15)"
                        : C.primary + "18",
                  },
                ]}
              >
                <Feather
                  name={attendanceBtnIcon}
                  size={19}
                  color={isCheckedIn && isCheckedOut ? "#FFFFFF" : C.primary}
                />
              </View>
              <ThemedText
                style={[
                  styles.checkInLabel,
                  {
                    color: isCheckedIn && isCheckedOut ? "#FFFFFF" : C.primary,
                  },
                ]}
              >
                {isOpenEventAttendance ? "Event Check Out" : attendanceLabel}
              </ThemedText>
              {isCheckedIn && !isCheckedOut ? (
                <View style={styles.liveDot} />
              ) : null}
            </>
          )}
        </Pressable>

        {isCheckedIn ? (
          <ThemedText type="caption" style={styles.checkinTime}>
            {isCheckedOut
              ? `In: ${formatTime(todayAttendance?.checkin_time)}  ·  Out: ${formatTime(todayAttendance?.checkout_time)}`
              : `Checked in · ${todayAttendance?.attendance_context === "EVENT" ? `Event — ${todayAttendance?.context_location_name || "Assigned event"}` : todayAttendance?.attendance_context === "FIELD_VISIT" ? `Field Visit — ${todayAttendance?.context_location_name || "Assigned site"}` : todayAttendance?.checkin_location_name || "Office"} · ${new Date(todayAttendance?.checkin_time || "").toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", timeZone: "Asia/Kolkata" })}`}
          </ThemedText>
        ) : null}

        {/* Event attendance */}
        {upcomingEvents.length > 0 ? (
          <Pressable
            onPress={() => setShowEventPicker(true)}
            disabled={eventCheckInLoading}
            style={({ pressed }) => [
              styles.eventBtn,
              { opacity: pressed ? 0.8 : 1 },
            ]}
          >
            {eventCheckInLoading ? (
              <ActivityIndicator size="small" color="#fff" />
            ) : (
              <>
                <Feather name="calendar" size={14} color="#fff" />
                <ThemedText type="small" style={styles.eventBtnText}>
                  {eventAttendanceLabel}
                </ThemedText>
                <Feather
                  name="chevron-down"
                  size={13}
                  color="rgba(255,255,255,0.7)"
                />
              </>
            )}
          </Pressable>
        ) : null}

        <Spacer height={Spacing.xl} />
      </View>

      {/* ── Body ── */}
      <View style={[styles.body, isWeb && styles.bodyWeb]}>
        <Spacer height={Spacing.lg} />

        {isCheckedIn && !isCheckedOut && trackingHealth.warning && Platform.OS !== "web" ? (
          <TouchableOpacity
            style={{
              flexDirection: "row",
              alignItems: "center",
              gap: 10,
              borderRadius: 12,
              padding: 13,
              marginBottom: 12,
              backgroundColor: "#FEF3C7",
              borderWidth: 1,
              borderColor: "#F59E0B",
            }}
            onPress={() => navigation.navigate("LocationTrackingSetup")}
            activeOpacity={0.82}
          >
            <Feather name="alert-triangle" size={18} color="#92400E" />
            <View style={{ flex: 1 }}>
              <ThemedText style={{ color: "#92400E", fontWeight: "800" }}>
                Location tracking needs attention
              </ThemedText>
              <ThemedText
                style={{ color: "#92400E", fontSize: 12, marginTop: 2 }}
                numberOfLines={2}
              >
                {trackingHealth.warning}
              </ThemedText>
            </View>
            <Feather name="chevron-right" size={18} color="#92400E" />
          </TouchableOpacity>
        ) : null}

        {eventAnnouncements.length > 0 ? (
          <View style={styles.dashboardEventList}>
            {eventAnnouncements.map((announcement) => (
              <Pressable
                key={announcement.eventId}
                onPress={() => openEventInTasks(announcement.eventId)}
                style={({ pressed }) => [
                  styles.dashboardEventCard,
                  {
                    backgroundColor: theme.backgroundDefault,
                    borderColor: C.primary + "40",
                    opacity: pressed ? 0.9 : 1,
                  },
                ]}
              >
                <View style={styles.dashboardEventHeader}>
                  <View
                    style={[
                      styles.dashboardEventIcon,
                      { backgroundColor: C.primary + "18" },
                    ]}
                  >
                    <Feather name="calendar" size={19} color={C.primary} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <ThemedText
                      style={{ color: theme.text, fontWeight: "800" }}
                    >
                      {announcement.event.title}
                    </ThemedText>
                    <ThemedText
                      type="caption"
                      style={{ color: theme.textSecondary, marginTop: 2 }}
                    >
                      {announcement.event.event_date} •{" "}
                      {announcement.event.start_time.slice(0, 5)}-
                      {announcement.event.end_time.slice(0, 5)}
                    </ThemedText>
                  </View>
                  <Feather
                    name="chevron-right"
                    size={18}
                    color={theme.textSecondary}
                  />
                </View>
                <View style={styles.dashboardEventLocation}>
                  <Feather name="map-pin" size={14} color={C.primary} />
                  <ThemedText
                    type="small"
                    style={{ color: theme.textSecondary, flex: 1 }}
                  >
                    {announcement.event.address}
                  </ThemedText>
                </View>
                {announcement.event.description ? (
                  <ThemedText
                    type="small"
                    numberOfLines={2}
                    style={{ color: theme.textSecondary, lineHeight: 18 }}
                  >
                    {announcement.event.description}
                  </ThemedText>
                ) : null}
                <Pressable
                  disabled={
                    !!announcement.acknowledgedAt ||
                    acknowledgingEventId === announcement.eventId
                  }
                  onPress={(event) => {
                    event.stopPropagation();
                    acknowledgeEvent(announcement);
                  }}
                  style={[
                    styles.dashboardGotIt,
                    {
                      backgroundColor: announcement.acknowledgedAt
                        ? C.success + "18"
                        : C.primary,
                    },
                  ]}
                >
                  <Feather
                    name={
                      announcement.acknowledgedAt ? "check-circle" : "check"
                    }
                    size={15}
                    color={announcement.acknowledgedAt ? C.success : "#FFFFFF"}
                  />
                  <ThemedText
                    type="small"
                    style={{
                      color: announcement.acknowledgedAt
                        ? C.success
                        : "#FFFFFF",
                      fontWeight: "800",
                    }}
                  >
                    {announcement.acknowledgedAt
                      ? "Seen"
                      : acknowledgingEventId === announcement.eventId
                        ? "Saving..."
                        : "Got it"}
                  </ThemedText>
                </Pressable>
              </Pressable>
            ))}
          </View>
        ) : null}

        {/* Field Visit Alert */}
        {pendingVisits > 0 ? (
          <TouchableOpacity
            style={styles.visitAlert}
            onPress={() => navigation.navigate("FieldVisits")}
            activeOpacity={0.85}
          >
            <View style={styles.visitAlertLeft}>
              <View style={styles.visitAlertIconWrap}>
                <Feather name="alert-circle" size={17} color="#D97706" />
              </View>
              <View>
                <ThemedText style={styles.visitAlertTitle}>
                  {pendingVisits} Field Visit{pendingVisits > 1 ? "s" : ""}{" "}
                  Pending
                </ThemedText>
                <ThemedText style={styles.visitAlertSub}>
                  Tap to check in / check out at your location
                </ThemedText>
              </View>
            </View>
            <Feather name="chevron-right" size={15} color="#D97706" />
          </TouchableOpacity>
        ) : null}

        {/* ── Stats Grid ── */}
        <View style={[styles.statsGrid, isWeb && styles.statsGridWeb]}>
          {(() => {
            const attStyle = getAttendanceCardStyle(
              isCheckedIn,
              isCheckedOut,
              todayAttendance?.attendance_status || todayAttendance?.day_status,
            );
            return (
              <StatCard
                icon="clock"
                title="Attendance"
                value={
                  isCheckedIn
                    ? formatTime(todayAttendance?.checkin_time)
                    : attStyle.statusText
                }
                subtitle={
                  isCheckedIn
                    ? isCheckedOut
                      ? `Out ${formatTime(todayAttendance?.checkout_time)}`
                      : "Checked in"
                    : attStyle.statusText === "Late"
                      ? "Late attendance recorded by the server"
                      : "Check in to start your day"
                }
                color={attStyle.color}
                valueColor={attStyle.color}
                onPress={() => navigation.navigate("HomeTab")}
              />
            );
          })()}
          <StatCard
            icon="check-square"
            title="Pending Tasks"
            value={pendingTasks.length}
            subtitle="To complete"
            color={C.primary}
            onPress={() => navigation.navigate("TasksTab")}
          />
          <StatCard
            icon="map-pin"
            title="Site Visits"
            value={pendingTasks.filter((t) => t.type === "site_visit").length}
            subtitle="Scheduled"
            color={C.info}
            onPress={() => navigation.navigate("TasksTab")}
          />
          <StatCard
            icon="sun"
            title="Leave Balance"
            value={totalLeave}
            subtitle="Days remaining"
            color={C.violet}
            onPress={() => navigation.navigate("LeaveScreen")}
          />
        </View>

        <Spacer height={Spacing.xl} />

        {/* ── Quick Actions ── */}
        <View style={styles.sectionHeader}>
          <ThemedText
            type="h3"
            style={{ color: theme.text, fontWeight: "700" }}
          >
            Quick Actions
          </ThemedText>
        </View>
        <Spacer height={Spacing.md} />
        <View style={[styles.quickGrid, isWeb && styles.quickGridWeb]}>
          <QuickAction
            icon="file-plus"
            label="Apply Leave"
            color={C.primary}
            onPress={() => navigation.navigate("LeaveScreen")}
          />
          <QuickAction
            icon="map-pin"
            label="Field Visits"
            color={C.primary}
            onPress={() => navigation.navigate("FieldVisits")}
          />
          <QuickAction
            icon="clock"
            label="Attendance Details"
            color={C.primary}
            onPress={() => navigation.navigate("AttendanceDetails")}
          />
          <QuickAction
            icon="list"
            label="My Logs"
            color={C.primary}
            onPress={() => navigation.navigate("MyActivityLogs")}
          />
          <QuickAction
            icon="gift"
            label="Birthdays"
            color={C.primary}
            onPress={() => navigation.navigate("UpcomingBirthdays")}
          />
          <QuickAction
            icon="life-buoy"
            label="Support"
            color={C.primary}
            onPress={() => navigation.navigate("RaiseTicket")}
          />
          {hasTeam ? (
            <QuickAction
              icon="users"
              label="My Team"
              color={C.primary}
              onPress={() => navigation.navigate("MyTeam")}
            />
          ) : null}
          {canViewLiveTracking ? (
            <QuickAction
              icon="radio"
              label="Live Track"
              color={C.primary}
              onPress={() =>
                navigation.navigate("AdminTab", { screen: "LiveTracking" })
              }
            />
          ) : null}
        </View>

        <Spacer height={Spacing.xl} />

        {/* ── Pending Tasks ── */}
        <View style={styles.sectionHeader}>
          <ThemedText
            type="h3"
            style={{ color: theme.text, fontWeight: "700" }}
          >
            Pending Tasks
          </ThemedText>
          <Pressable
            onPress={() => navigation.navigate("TasksTab")}
            style={styles.seeAll}
          >
            <ThemedText
              type="small"
              style={{ color: C.primary, fontWeight: "600" }}
            >
              View All
            </ThemedText>
            <Feather name="chevron-right" size={14} color={C.primary} />
          </Pressable>
        </View>
        <Spacer height={Spacing.md} />

        {pendingTasks.length > 0 ? (
          <View style={[styles.taskList, isWeb && styles.taskListWeb]}>
            {pendingTasks.slice(0, 5).map((task) => {
              const pc =
                { high: C.error, medium: C.warning, low: C.success }[
                  task.priority
                ] || C.info;
              return (
                <Pressable
                  key={task.id}
                  style={({ pressed }) => [
                    styles.taskItem,
                    {
                      backgroundColor: theme.backgroundDefault,
                      opacity: pressed ? 0.85 : 1,
                    },
                  ]}
                  onPress={() =>
                    navigation.navigate("TasksTab", { taskId: task.id })
                  }
                >
                  <View style={[styles.taskBar, { backgroundColor: pc }]} />
                  <View style={styles.taskContent}>
                    <ThemedText
                      type="small"
                      numberOfLines={1}
                      style={{ color: theme.text, fontWeight: "600" }}
                    >
                      {task.title}
                    </ThemedText>
                    <ThemedText
                      type="caption"
                      style={{ color: theme.textSecondary, marginTop: 3 }}
                    >
                      Due:{" "}
                      {task.due_date ? formatDate(task.due_date) : "No date"}
                    </ThemedText>
                  </View>
                  <View
                    style={[
                      styles.priorityChip,
                      { backgroundColor: pc + "20" },
                    ]}
                  >
                    <ThemedText
                      type="caption"
                      style={{ color: pc, fontWeight: "700", fontSize: 10 }}
                    >
                      {task.priority?.toUpperCase()}
                    </ThemedText>
                  </View>
                </Pressable>
              );
            })}
          </View>
        ) : (
          <View
            style={[
              styles.emptyBox,
              { backgroundColor: theme.backgroundDefault },
            ]}
          >
            <Feather name="check-circle" size={30} color={C.success} />
            <Spacer height={Spacing.sm} />
            <ThemedText
              type="small"
              style={{ color: theme.textSecondary, textAlign: "center" }}
            >
              All caught up! No pending tasks.
            </ThemedText>
          </View>
        )}

        <Spacer height={Spacing["2xl"]} />
      </View>

      {/* ── Reminder Modal ── */}
      {undoCheckout && undoSeconds > 0 ? (
        <View
          style={[
            styles.dashboardUndoBanner,
            {
              backgroundColor: theme.backgroundDefault,
              borderColor: theme.primary,
            },
          ]}
        >
          <View style={{ flex: 1 }}>
            <ThemedText style={{ fontWeight: "800" }}>
              Checkout can be undone
            </ThemedText>
            <ThemedText type="caption" style={{ color: theme.textSecondary }}>
              {Math.floor(undoSeconds / 60)}m {undoSeconds % 60}s remaining
            </ThemedText>
          </View>
          <Pressable
            style={[
              styles.dashboardUndoButton,
              { backgroundColor: theme.primary },
            ]}
            onPress={handleUndoCheckout}
            disabled={attendanceLoading}
          >
            <Feather name="rotate-ccw" size={14} color="#fff" />
            <ThemedText
              type="caption"
              style={{ color: "#fff", fontWeight: "800" }}
            >
              Undo
            </ThemedText>
          </Pressable>
        </View>
      ) : null}


      <Modal
        visible={!!showReminderModal}
        transparent
        animationType="fade"
        onRequestClose={() => setShowReminderModal(null)}
      >
        <View style={styles.overlayCenter}>
          <View
            style={[
              styles.reminderModal,
              { backgroundColor: theme.backgroundDefault },
            ]}
          >
            <View
              style={[
                styles.reminderIconWrap,
                {
                  backgroundColor:
                    showReminderModal?.type === "checkin"
                      ? "#DCFCE7"
                      : "#FEE2E2",
                },
              ]}
            >
              <Feather
                name={
                  showReminderModal?.type === "checkin" ? "log-in" : "log-out"
                }
                size={26}
                color={
                  showReminderModal?.type === "checkin" ? "#16A34A" : "#DC2626"
                }
              />
            </View>
            <ThemedText
              type="h3"
              style={{ textAlign: "center", marginTop: 14 }}
            >
              {showReminderModal?.type === "checkin"
                ? "Time to Check In!"
                : "Time to Check Out!"}
            </ThemedText>
            <ThemedText
              type="small"
              style={[styles.reminderSubtext, { color: theme.textSecondary }]}
            >
              {showReminderModal?.type === "checkin"
                ? "Please mark your attendance."
                : "Please check out before leaving."}
            </ThemedText>
            <Pressable
              style={[
                styles.reminderBtn,
                {
                  backgroundColor:
                    showReminderModal?.type === "checkin"
                      ? "#16A34A"
                      : C.primary,
                },
              ]}
              onPress={() => {
                setShowReminderModal(null);
                handleAttendanceToggle();
              }}
            >
              <ThemedText
                type="body"
                style={{ color: "#fff", fontWeight: "700" }}
              >
                {showReminderModal?.type === "checkin"
                  ? "Check In Now"
                  : "Check Out Now"}
              </ThemedText>
            </Pressable>
            <Pressable
              style={styles.dismissBtn}
              onPress={() => setShowReminderModal(null)}
            >
              <ThemedText type="small" style={{ color: theme.textSecondary }}>
                Dismiss
              </ThemedText>
            </Pressable>
          </View>
        </View>
      </Modal>

      {/* ── Event Picker Modal ── */}
      <Modal
        visible={showEventPicker}
        transparent
        animationType="slide"
        onRequestClose={() => setShowEventPicker(false)}
      >
        <View style={styles.sheetOverlay}>
          <Pressable
            style={StyleSheet.absoluteFill}
            onPress={() => setShowEventPicker(false)}
          />
          <View
            style={[styles.sheet, { backgroundColor: theme.backgroundDefault }]}
          >
            <View style={styles.sheetHandle} />
            <ThemedText type="h3" style={{ marginBottom: Spacing.md }}>
              Event Attendance
            </ThemedText>
            {upcomingEvents.map((ev) => (
              <Pressable
                key={ev.id}
                disabled={!!(ev.userCheckInTime && ev.userCheckOutTime)}
                style={({ pressed }) => [
                  styles.eventOption,
                  {
                    borderColor:
                      ev.userCheckInTime && !ev.userCheckOutTime
                        ? C.warning
                        : ev.userCheckOutTime
                          ? C.success
                          : theme.border,
                    opacity: pressed
                      ? 0.8
                      : ev.userCheckInTime && ev.userCheckOutTime
                        ? 0.72
                        : 1,
                  },
                ]}
                onPress={() => handleEventAttendance(ev)}
              >
                <View
                  style={[
                    styles.eventOptionIcon,
                    {
                      backgroundColor:
                        (ev.userCheckOutTime
                          ? C.success
                          : ev.userCheckInTime
                            ? C.warning
                            : C.primary) + "18",
                    },
                  ]}
                >
                  <Feather
                    name={
                      ev.userCheckOutTime
                        ? "check-circle"
                        : ev.userCheckInTime
                          ? "log-out"
                          : "log-in"
                    }
                    size={17}
                    color={
                      ev.userCheckOutTime
                        ? C.success
                        : ev.userCheckInTime
                          ? C.warning
                          : C.primary
                    }
                  />
                </View>
                <View style={{ flex: 1 }}>
                  <ThemedText type="body" style={{ fontWeight: "700" }}>
                    {ev.title}
                  </ThemedText>
                  <ThemedText
                    type="caption"
                    style={{ color: theme.textSecondary }}
                  >
                    {ev.event_date} · {ev.start_time} – {ev.end_time}
                  </ThemedText>
                  <ThemedText
                    type="caption"
                    style={{
                      color: ev.userCheckOutTime
                        ? C.success
                        : ev.userCheckInTime
                          ? C.warning
                          : C.primary,
                      fontWeight: "700",
                      marginTop: 3,
                    }}
                  >
                    {ev.userCheckOutTime
                      ? "Attendance completed"
                      : ev.userCheckInTime
                        ? "Tap to check out while leaving"
                        : "Tap to check in within 200m"}
                  </ThemedText>
                </View>
                {!ev.userCheckOutTime ? (
                  <Feather
                    name="chevron-right"
                    size={15}
                    color={theme.textSecondary}
                  />
                ) : null}
              </Pressable>
            ))}
            <Spacer height={Spacing.md} />
            <Pressable
              onPress={() => setShowEventPicker(false)}
              style={[styles.sheetCancel, { borderColor: C.error }]}
            >
              <ThemedText
                type="small"
                style={{ color: C.error, fontWeight: "600" }}
              >
                Cancel
              </ThemedText>
            </Pressable>
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

// ─── styles ───────────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  // ── web layout wrappers ──────────────────────────────────────────────────────
  webContentContainer: {
    maxWidth: 900,
    alignSelf: "center" as any,
    width: "100%",
    paddingHorizontal: 0,
  },
  headerWeb: {
    borderRadius: 0,
  },
  bodyWeb: {
    paddingHorizontal: Spacing.xl,
  },

  // ── header ───────────────────────────────────────────────────────────────────
  header: {
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
  headerTop: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  logoWrap: {
    width: 46,
    height: 46,
    borderRadius: 13,
    backgroundColor: "#FFFFFF",
    alignItems: "center",
    justifyContent: "center",
    ...(Platform.OS === "web"
      ? { boxShadow: "0 2px 8px rgba(0,0,0,0.16)" }
      : {
          shadowColor: "#000",
          shadowOffset: { width: 0, height: 2 },
          shadowOpacity: 0.16,
          shadowRadius: 6,
          elevation: 3,
        }),
  },
  logo: { width: 36, height: 36, borderRadius: 9 },
  headerInfo: { flex: 1, paddingLeft: 2 },
  greetingText: {
    color: "rgba(255,255,255,0.65)",
    fontSize: 11,
    marginBottom: 1,
  },
  nameText: { color: "#FFFFFF", fontWeight: "800" },
  roleText: { color: "rgba(255,255,255,0.55)", fontSize: 10, marginTop: 1 },
  bellBtn: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: "rgba(255,255,255,0.16)",
    alignItems: "center",
    justifyContent: "center",
    position: "relative",
  },
  badge: {
    position: "absolute",
    top: 4,
    right: 4,
    minWidth: 14,
    height: 14,
    borderRadius: 7,
    backgroundColor: "#C8252D",
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 2,
    borderWidth: 1.5,
    borderColor: "#6D1B6D",
  },
  badgeText: { color: "#FFF", fontSize: 8, fontWeight: "700" },

  // ── check-in button ──────────────────────────────────────────────────────────
  checkInBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: Spacing.sm,
    paddingVertical: 14,
    paddingHorizontal: Spacing.xl,
    borderRadius: BorderRadius.full,
    alignSelf: "center",
    minWidth: 200,
    ...(Platform.OS === "web"
      ? { boxShadow: "0 6px 18px rgba(0,0,0,0.16)" }
      : {
          shadowColor: "#000",
          shadowOffset: { width: 0, height: 6 },
          shadowOpacity: 0.16,
          shadowRadius: 18,
          elevation: 8,
        }),
  },
  checkInIconWrap: {
    width: 30,
    height: 30,
    borderRadius: 15,
    alignItems: "center",
    justifyContent: "center",
  },
  checkInLabel: { fontWeight: "800", fontSize: 15, letterSpacing: 0.2 },
  liveDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: "#12966E" },
  checkinTime: {
    color: "rgba(255,255,255,0.65)",
    textAlign: "center",
    marginTop: 7,
    fontSize: 11,
  },

  // ── event / apk ──────────────────────────────────────────────────────────────
  dashboardEventList: {
    gap: Spacing.md,
    marginBottom: Spacing.md,
  },
  dashboardEventCard: {
    borderWidth: 1,
    borderRadius: BorderRadius.lg,
    padding: Spacing.lg,
    gap: Spacing.sm,
  },
  dashboardEventHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.md,
  },
  dashboardEventIcon: {
    width: 42,
    height: 42,
    borderRadius: BorderRadius.md,
    alignItems: "center",
    justifyContent: "center",
  },
  dashboardEventLocation: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: Spacing.sm,
  },
  dashboardGotIt: {
    alignSelf: "stretch",
    flexDirection: "row",
    justifyContent: "center",
    alignItems: "center",
    gap: Spacing.sm,
    paddingVertical: Spacing.sm,
    borderRadius: BorderRadius.md,
    marginTop: Spacing.xs,
  },
  eventBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    marginTop: 10,
    paddingHorizontal: 16,
    paddingVertical: 7,
    borderRadius: BorderRadius.full,
    borderWidth: 1.5,
    borderColor: "rgba(255,255,255,0.28)",
    backgroundColor: "rgba(255,255,255,0.12)",
    alignSelf: "center",
  },
  eventBtnText: { color: "#fff", fontWeight: "600" },
  // ── body ─────────────────────────────────────────────────────────────────────
  body: { paddingHorizontal: Spacing.lg },

  // ── visit alert ──────────────────────────────────────────────────────────────
  visitAlert: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    backgroundColor: "#FEF3C7",
    borderWidth: 1.5,
    borderColor: "#F59E0B",
    borderRadius: 14,
    padding: 13,
    marginBottom: Spacing.lg,
  },
  visitAlertLeft: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    flex: 1,
  },
  visitAlertIconWrap: {
    width: 34,
    height: 34,
    borderRadius: 10,
    backgroundColor: "#FDE68A",
    alignItems: "center",
    justifyContent: "center",
  },
  visitAlertTitle: { fontSize: 13, fontWeight: "700", color: "#92400E" },
  visitAlertSub: { fontSize: 11, color: "#B45309", marginTop: 1 },

  // ── stats box container ──
  statsBox: {
    padding: 12,
    borderRadius: 20,
    ...(Platform.OS === "web"
      ? { boxShadow: "0 4px 16px rgba(109,27,109,0.12)" }
      : {
          shadowColor: "#6D1B6D",
          shadowOffset: { width: 0, height: 4 },
          shadowOpacity: 0.1,
          shadowRadius: 12,
          elevation: 4,
        }),
  },

  // ── stats grid ───────────────────────────────────────────────────────────────
  statsGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 12,
    justifyContent: "space-between",
  },
  statsGridWeb: {
    flexWrap: "nowrap",
  },
  statCard: {
    flex: 1,
    minWidth: 140,
    padding: 14,
    borderRadius: 14,
    borderLeftWidth: 4,
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
  statCardWeb: {
    minWidth: 0,
  },
  statIcon: {
    width: 36,
    height: 36,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 8,
  },

  // ── section header ────────────────────────────────────────────────────────────
  sectionHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  seeAll: {
    flexDirection: "row",
    alignItems: "center",
    gap: 2,
  },

  // ── quick actions ─────────────────────────────────────────────────────────────
  quickGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  quickGridWeb: {
    gap: 12,
  },
  quickAction: {
    width: "22%",
    flexGrow: 1,
    alignItems: "center",
    paddingVertical: 13,
    paddingHorizontal: 6,
    borderRadius: 14,
    minWidth: 72,
    ...(Platform.OS === "web"
      ? { boxShadow: "0 1px 5px rgba(109,27,109,0.06)" }
      : {
          shadowColor: "#6D1B6D",
          shadowOffset: { width: 0, height: 1 },
          shadowOpacity: 0.06,
          shadowRadius: 5,
          elevation: 1,
        }),
  },
  quickActionIcon: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 6,
  },
  quickActionLabel: {
    textAlign: "center",
    fontSize: 11,
    fontWeight: "600",
    lineHeight: 14,
  },

  // ── tasks ─────────────────────────────────────────────────────────────────────
  taskList: { gap: Spacing.sm },
  taskListWeb: {
    display: "flex" as any,
    flexDirection: "column" as any,
  },
  taskItem: {
    flexDirection: "row",
    alignItems: "center",
    borderRadius: 13,
    overflow: "hidden",
    ...(Platform.OS === "web"
      ? { boxShadow: "0 1px 5px rgba(109,27,109,0.06)" }
      : {
          shadowColor: "#6D1B6D",
          shadowOffset: { width: 0, height: 1 },
          shadowOpacity: 0.06,
          shadowRadius: 5,
          elevation: 1,
        }),
  },
  taskBar: { width: 4, alignSelf: "stretch", minHeight: 56 },
  taskContent: {
    flex: 1,
    paddingVertical: 12,
    paddingLeft: 12,
    paddingRight: 6,
  },
  priorityChip: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
    marginRight: 12,
  },
  emptyBox: {
    alignItems: "center",
    padding: Spacing.xl,
    borderRadius: 14,
  },

  // ── modals ────────────────────────────────────────────────────────────────────
  overlayCenter: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.55)",
    justifyContent: "center",
    alignItems: "center",
    padding: 32,
  },
  reminderModal: {
    width: "100%",
    maxWidth: 400,
    borderRadius: 20,
    padding: 28,
    alignItems: "center",
  },
  reminderIconWrap: {
    width: 62,
    height: 62,
    borderRadius: 31,
    alignItems: "center",
    justifyContent: "center",
  },
  reminderSubtext: {
    textAlign: "center",
    marginTop: 6,
    marginBottom: 20,
    lineHeight: 18,
  },
  reminderBtn: {
    width: "100%",
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: "center",
    marginBottom: 4,
  },
  dismissBtn: {
    padding: 10,
    alignItems: "center",
  },
  dashboardUndoBanner: {
    position: "absolute",
    left: 16,
    right: 16,
    bottom: 84,
    zIndex: 20,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    padding: 13,
    borderWidth: 1,
    borderRadius: 13,
    ...(Platform.OS === "web"
      ? { boxShadow: "0 4px 14px rgba(0,0,0,0.15)" }
      : {
          elevation: 8,
          shadowColor: "#000",
          shadowOpacity: 0.15,
          shadowRadius: 10,
        }),
  },
  dashboardUndoButton: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    paddingHorizontal: 12,
    paddingVertical: 9,
    borderRadius: 9,
  },
  earlyCheckoutModal: {
    width: "100%",
    maxWidth: 430,
    borderRadius: 18,
    padding: 22,
  },
  earlyCheckoutIcon: {
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: "#FEF3C7",
    alignItems: "center",
    justifyContent: "center",
    alignSelf: "center",
    marginBottom: 12,
  },
  earlyCheckoutInput: {
    height: 100,
    borderWidth: 1,
    borderRadius: 10,
    padding: 11,
    marginVertical: 16,
  },
  earlyCheckoutAction: {
    flex: 1,
    minHeight: 44,
    borderRadius: 9,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 8,
  },

  sheetOverlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.48)",
    justifyContent: "flex-end",
  },
  sheet: {
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    padding: Spacing.lg,
    paddingBottom: Spacing["2xl"],
    ...(isWeb
      ? {
          maxWidth: 540,
          alignSelf: "center" as any,
          width: "100%",
          borderRadius: 24,
          marginBottom: 40,
        }
      : {}),
  },
  sheetHandle: {
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: "rgba(0,0,0,0.15)",
    alignSelf: "center",
    marginBottom: 16,
  },
  eventOption: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.md,
    padding: Spacing.md,
    borderRadius: 12,
    borderWidth: 1,
    marginBottom: 8,
  },
  eventOptionIcon: {
    width: 38,
    height: 38,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
  },
  sheetCancel: {
    borderWidth: 1.5,
    borderRadius: BorderRadius.full,
    paddingVertical: 10,
    alignItems: "center",
  },
});
