import { supabase } from "@/lib/supabase";
import { firstRpcRow } from "@/utils/supabaseRpc";

export const TrackingAdminService = {
  async reviewFraudEvent(eventId: string, notes?: string) {
    const { data, error } = await supabase.rpc("rpc_admin_review_fraud_event", {
      p_event_id: eventId,
      p_notes: notes ?? null,
    });
    const response = firstRpcRow<any>(data);
    return {
      data: response,
      error:
        error ??
        (response?.success === true &&
        response?.event_id === eventId &&
        response?.reviewed_at
          ? null
          : new Error("The server did not confirm the fraud-event review.")),
    };
  },
  async resolveAlert(alertId: string) {
    const { data, error } = await supabase.rpc("rpc_admin_resolve_location_alert", {
      p_alert_id: alertId,
    });
    const response = firstRpcRow<any>(data);
    return {
      data: response,
      error:
        error ??
        (response?.success === true
          ? null
          : new Error("The server did not confirm alert resolution.")),
    };
  },
  async requestPings(targetUserIds: string[]) {
    const { data, error } = await supabase.rpc(
      "rpc_admin_request_location_pings",
      { p_target_user_ids: targetUserIds },
    );
    const result = firstRpcRow<any>(data);
    return {
      requests: result?.requests ?? [],
      error:
        error ??
        (result?.success === true
          ? null
          : new Error("The server did not confirm the ping request.")),
    };
  },
};
