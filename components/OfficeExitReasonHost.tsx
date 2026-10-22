import React, { useCallback, useEffect, useRef, useState } from "react";
import { Alert, AppState } from "react-native";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/contexts/AuthContext";
import GeofenceReasonModal from "@/components/modals/GeofenceReasonModal";
import { subscribeOfficeExitPrompt } from "@/services/location/officeExitPrompt";

type OpenEvent = { id: string; status: string | null; distance: number; officeName: string | null };

const AUTO_CHECK_MS = 5 * 60_000;
// "Later" keeps the form away for this long (automatic checks only; a tap on
// the alert always opens it).
const SNOOZE_MS = 15 * 60_000;

function asOpenEvent(data: any): OpenEvent | null {
  if (!data || typeof data !== "object" || !data.id || data.answered) return null;
  return {
    id: String(data.id),
    status: data.status ? String(data.status) : "PENDING_REASON",
    distance: Number(data.distance) || 0,
    officeName: data.office_name ? String(data.office_name) : null,
  };
}

/**
 * Shows "Tell us why you left the office" anywhere in the app:
 *  - when the employee taps the office alert (local or push) or the in-app
 *    notification: the tapped exit, or the newest open one;
 *  - on its own when the server has confirmed an exit (outside > 10 min) that
 *    still has no reason: on start, on return to the app, every 5 minutes.
 */
export default function OfficeExitReasonHost() {
  const { user } = useAuth();
  const [event, setEvent] = useState<OpenEvent | null>(null);
  const snoozed = useRef<Map<string, number>>(new Map());
  const busy = useRef(false);

  const openFromTap = useCallback(async (eventId: string | null) => {
    if (!user?.id) return;
    let res = await supabase.rpc("rpc_my_open_geofence_event", { p_event_id: eventId });
    if (res.error && ["PGRST202", "42883"].includes(String(res.error.code))) {
      // Database without 20261021120000: only confirmed exits can be explained.
      res = await supabase.rpc("rpc_my_pending_geofence_reason");
    }
    if (res.error) {
      Alert.alert("Could not open the form", "Check your internet connection and tap the alert again.");
      return;
    }
    const data = res.data as any;
    if (data && data.answered) {
      Alert.alert("Reason already submitted", "Your manager and HR have your reason for this office exit.");
      return;
    }
    const open = asOpenEvent(data);
    if (!open) {
      Alert.alert(
        "Nothing to explain right now",
        "There is no open office exit for you. If you stay outside the office area, HRMS will ask you for the reason.",
      );
      return;
    }
    snoozed.current.delete(open.id);
    setEvent(open);
  }, [user?.id]);

  const autoCheck = useCallback(async () => {
    if (!user?.id || busy.current) return;
    busy.current = true;
    try {
      const { data, error } = await supabase.rpc("rpc_my_pending_geofence_reason");
      if (error) return;
      const open = asOpenEvent(data);
      if (!open) return;
      const until = snoozed.current.get(open.id);
      if (until && Date.now() < until) return;
      setEvent((current) => current ?? open);
    } finally {
      busy.current = false;
    }
  }, [user?.id]);

  useEffect(() => {
    if (!user?.id) {
      setEvent(null);
      return;
    }
    const unsubscribe = subscribeOfficeExitPrompt((eventId) => void openFromTap(eventId));
    void autoCheck();
    const timer = setInterval(() => void autoCheck(), AUTO_CHECK_MS);
    const appState = AppState.addEventListener("change", (state) => {
      if (state === "active") void autoCheck();
    });
    return () => {
      unsubscribe();
      clearInterval(timer);
      appState.remove();
    };
  }, [user?.id, openFromTap, autoCheck]);

  if (!event) return null;
  return (
    <GeofenceReasonModal
      key={event.id}
      visible
      eventId={event.id}
      distance={event.distance}
      status={event.status}
      officeName={event.officeName}
      onClose={() => {
        snoozed.current.set(event.id, Date.now() + SNOOZE_MS);
        setEvent(null);
      }}
      onSubmitSuccess={() => setEvent(null)}
    />
  );
}
