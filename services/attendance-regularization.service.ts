import { supabase } from "@/lib/supabase";
import { firstRpcRow } from "@/utils/supabaseRpc";

async function verifiedRpc(
  functionName:
    | "rpc_request_attendance_regularization"
    | "rpc_review_attendance_regularization",
  parameters: Record<string, unknown>,
) {
  const { data, error } = await supabase.rpc(functionName, parameters);
  const response = firstRpcRow<any>(data);
  if (error) return { data: response, error };
  if (response?.success !== true) {
    return {
      data: response,
      error: {
        message:
          response?.message ||
          response?.error ||
          "The server did not confirm this attendance action.",
      },
    };
  }
  return { data: response, error: null };
}

export const AttendanceRegularizationService = {
  request: (p: {
    userId: string;
    attendanceId: string;
    type: "EARLY_CHECKOUT" | "MISSED_CHECKOUT";
    reason: string;
    requestedCheckout?: string;
  }) =>
    verifiedRpc("rpc_request_attendance_regularization", {
      p_user_id: p.userId,
      p_attendance_id: p.attendanceId,
      p_request_type: p.type,
      p_reason: p.reason,
      p_requested_checkout: p.requestedCheckout ?? new Date().toISOString(),
    }),
  review: (
    requestId: string,
    adminId: string,
    approve: boolean,
    notes?: string,
  ) =>
    verifiedRpc("rpc_review_attendance_regularization", {
      p_request_id: requestId,
      p_admin_id: adminId,
      p_approve: approve,
      p_notes: notes ?? null,
    }),
};
