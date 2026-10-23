import { supabase } from "@/lib/supabase";

/** Rows per table, as the server erase reports them ("public.attendance_logs": 120). */
export type EraseCounts = Record<string, number>;

export type ErasePreview =
  | { ok: true; name: string; deleted: EraseCounts; cleared: EraseCounts }
  | { ok: false; name: string; blocked: string };

const LABELS: Record<string, string> = {
  attendance_logs: "attendance days",
  location_tracking: "location points",
  location_pings: "location points",
  smartoffice_device_logs: "biometric punches",
  biometric_device_punches: "raw biometric punches",
  field_visits: "site visits",
  leave_requests: "leave requests",
  leave_transactions: "leave balance entries",
  attendance_regularization_requests: "regularization requests",
  attendance_corrections: "attendance corrections",
  geofence_events: "office exit events",
  notifications: "notifications",
  tasks: "tasks",
  user_permissions: "permissions",
  hrms_audit_events: "audit entries",
};

const tableOf = (key: string) => key.replace(/^(public|auth)\./, "");

/** "1,240 location points", most first; the profile and login are implied. */
export function summarizeErase(deleted: EraseCounts, maxLines = 8) {
  const merged = new Map<string, number>();
  for (const [key, rows] of Object.entries(deleted ?? {})) {
    const table = tableOf(key);
    if (table === "profiles" || table === "users" || !(Number(rows) > 0)) continue;
    const label = LABELS[table] ?? table.replace(/_/g, " ");
    merged.set(label, (merged.get(label) ?? 0) + Number(rows));
  }
  const sorted = [...merged.entries()].sort((a, b) => b[1] - a[1]);
  const lines = sorted.slice(0, maxLines).map(([label, rows]) => `${rows.toLocaleString("en-IN")} ${label}`);
  const rest = sorted.slice(maxLines).reduce((sum, [, rows]) => sum + rows, 0);
  if (rest > 0) lines.push(`${rest.toLocaleString("en-IN")} other records`);
  return { lines, total: sorted.reduce((sum, [, rows]) => sum + rows, 0) };
}

/** Same comparison as the server: case and extra spaces do not matter. */
export const sameName = (a: string, b: string) =>
  a.trim().replace(/\s+/g, " ").toLowerCase() === b.trim().replace(/\s+/g, " ").toLowerCase();

const READABLE: [RegExp, string][] = [
  [/PERMISSION_DENIED/, "You do not have permission to delete this employee."],
  [/SYSTEM_ADMIN_PERMISSION_REQUIRED/, "Only a system admin can delete an admin."],
  [/PROTECTED_SYSTEM_ADMIN/, "This is the protected system admin account; it cannot be deleted."],
  [/CANNOT_DELETE_CURRENT_USER/, "You cannot delete your own account."],
  [/CONFIRM_NAME_MISMATCH/, "The typed name does not match the employee's name."],
  [/EMPLOYEE_NOT_FOUND/, "This employee no longer exists."],
  [/function .*does not exist|Could not find the function/i, "The server update for deleting employees is not installed yet (migration 20261023100000)."],
];

export function readableEraseError(message: string | null | undefined) {
  const text = String(message ?? "Unknown error");
  return READABLE.find(([pattern]) => pattern.test(text))?.[1] ?? text.replace(/^ERASE_BLOCKED:\s*/, "Blocked by ");
}

/** Runs the real erase on the server and rolls it back: what would go, or what blocks it. */
export async function previewErase(profileId: string): Promise<ErasePreview> {
  const { data, error } = await supabase.rpc("rpc_admin_erase_employee_preview", { p_profile_id: profileId });
  if (error) throw new Error(readableEraseError(error.message));
  return data as ErasePreview;
}

export async function eraseEmployee(profileId: string, typedName: string) {
  const { data, error } = await supabase.rpc("rpc_admin_erase_employee", {
    p_profile_id: profileId,
    p_confirm_name: typedName,
  });
  if (error) throw new Error(readableEraseError(error.message));
  if (data?.success !== true || data?.profile_id !== profileId) {
    throw new Error("The server did not confirm the deletion.");
  }
  return data as { success: true; profile_id: string; name: string; deleted: EraseCounts };
}
