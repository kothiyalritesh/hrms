import { supabase } from "@/lib/supabase";
import { DurableWriteOutbox, OutboxItem } from "@/services/outbox/DurableWriteOutbox";
import { AttendanceFraudService } from "@/services/attendance-fraud.service";
import { OfflineAttendanceService } from "@/services/offline-attendance.service";

let initialized = false;

export function initializeOutboxHandlers() {
  if (initialized) return;
  initialized = true;

  // P1: attendance saved while offline (original GPS time, idempotent per key)
  DurableWriteOutbox.registerHandler("ATTENDANCE_CHECKIN", (item: OutboxItem) =>
    OfflineAttendanceService.sendCheckIn(item),
  );
  DurableWriteOutbox.registerHandler("ATTENDANCE_CHECKOUT", (item: OutboxItem) =>
    OfflineAttendanceService.sendCheckOut(item),
  );

  // P2: Important Audit Log
  DurableWriteOutbox.registerHandler("AUDIT_LOG", async (item: OutboxItem) => {
    const { data, error } = await supabase.rpc("rpc_record_checkin_attempt", {
      p_values: item.payload,
    });
    if (error) throw error;
    return data;
  });

  // P3: Fraud Evidence Telemetry
  DurableWriteOutbox.registerHandler("FRAUD_EVIDENCE", async (item: OutboxItem) => {
    return AttendanceFraudService.analyze(item.payload);
  });
}

