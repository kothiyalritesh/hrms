import { Alert, Platform } from "react-native";
import { OfflineAttendanceService } from "@/services/offline-attendance.service";
import type { GPSCoords } from "@/utils/gps";

function confirmAction(title: string, message: string, confirmLabel: string) {
  if (Platform.OS === "web") {
    return Promise.resolve(window.confirm(`${title}\n\n${message}`));
  }
  return new Promise<boolean>((resolve) => {
    Alert.alert(
      title,
      message,
      [
        { text: "Cancel", style: "cancel", onPress: () => resolve(false) },
        { text: confirmLabel, onPress: () => resolve(true) },
      ],
      { cancelable: true, onDismiss: () => resolve(false) },
    );
  });
}

export const istClock = (iso?: string | null) =>
  iso
    ? new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", timeZone: "Asia/Kolkata" })
    : "";

/**
 * No internet: after confirmation, saves a check-in (or, when already checked
 * in, a Going Home check-out) on the phone for later sync.
 */
export async function runOfflineAttendanceAction(options: {
  userId: string;
  serverCheckedIn: boolean;
  serverCheckedOut: boolean;
  getLocation: () => Promise<GPSCoords | null>;
  alert: (title: string, message?: string) => void;
}): Promise<"CHECKIN" | "CHECKOUT" | null> {
  const { userId, serverCheckedIn, serverCheckedOut, getLocation, alert } = options;
  const pending = await OfflineAttendanceService.pending(userId);
  if (serverCheckedOut || pending.some((item) => item.operationType === "ATTENDANCE_CHECKOUT")) {
    alert("Attendance Complete", "Today's check-out is already recorded or saved on this phone.");
    return null;
  }
  const checkedIn = serverCheckedIn || !!(await OfflineAttendanceService.pendingCheckInToday(userId));
  const proceed = await confirmAction(
    checkedIn ? "No internet: check out offline?" : "No internet: check in offline?",
    `Your ${checkedIn ? "check-out (Going Home)" : "check-in"} will be saved on this phone with your GPS location and the current time, and sent automatically when the internet is back. It is not confirmed by the server until then.`,
    checkedIn ? "Save check-out" : "Save check-in",
  );
  if (!proceed) return null;
  try {
    const gps = await getLocation();
    if (!gps) return null;
    if (checkedIn) {
      const item = await OfflineAttendanceService.queueCheckOut(userId, gps);
      alert(
        "Check-out saved on this phone",
        `Going Home at ${istClock(item.payload.location.capturedAt)}. Location tracking has stopped. It will be sent automatically when you are back online.`,
      );
      return "CHECKOUT";
    }
    const item = await OfflineAttendanceService.queueCheckIn(userId, gps);
    alert(
      "Check-in saved on this phone",
      `${istClock(item.payload.location.capturedAt)} at ${item.payload.officeName}. It will be sent automatically when you are back online. Not confirmed by the server yet.`,
    );
    return "CHECKIN";
  } catch (error: any) {
    alert(checkedIn ? "Offline check-out not saved" : "Offline check-in not saved", error?.message || "Please try again.");
    return null;
  }
}
