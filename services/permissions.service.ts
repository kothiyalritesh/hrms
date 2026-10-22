import { supabase } from "@/lib/supabase";

/**
 * Permission Manager v3 RPCs (migration 20261020100000). Every rule is enforced
 * by the server; these wrappers only type the calls and normalise errors.
 */

export type Level = "VIEW" | "EXPORT" | "MANAGE" | "APPROVE";

export type Capability = {
  key: string;
  label: string;
  description?: string | null;
  level: Level;
  risk: "LOW" | "MEDIUM" | "HIGH";
  scoped: boolean;
  grants: string[];
  implies: string[];
  sort: number;
};

export type CatalogV2 = {
  modules: { module: string; capabilities: Capability[] }[];
  screens: Record<string, string[]>;
  scopes: string[];
};

export type GrantInput = { capability: string; scope: string; scope_id?: string | null };

export type BulkRow = {
  user_id: string;
  capability: string;
  scope?: string;
  scope_id?: string | null;
  scope_label?: string | null;
  status: "OK" | "ERROR" | "ADDED" | "EXTENDED" | "UNCHANGED" | "NOTHING_TO_REVOKE";
  error?: string | null;
  message?: string | null;
  grants?: number;
  still_from?: string[] | null;
};

export type BulkResult = {
  success: boolean;
  dry_run?: boolean;
  error?: string | null;
  message?: string | null;
  errors?: number;
  applied?: number;
  added?: number;
  extended?: number;
  unchanged?: number;
  revoked?: number;
  results?: BulkRow[];
};

export type AccessGrant = {
  id: string;
  permission: string;
  capability: string | null;
  legacy?: boolean;
  scope: string;
  scope_id: string | null;
  scope_label: string;
  covers?: number;
  source: string; // USER | ROLE:<role> | MANAGER
  expires_at: string | null;
  granted_at?: string | null;
  granted_by?: string | null;
  reason?: string | null;
};

export type UserAccess = {
  user: { id: string; name: string; role: string; is_active: boolean; office_id?: string; team_id?: string; reports_to?: string };
  full_data_access: boolean;
  role_admin: boolean;
  reports: number;
  grants: AccessGrant[];
  expired: AccessGrant[];
  effective_keys: string[];
};

export type RoleTemplate = {
  role: string;
  label: string;
  locked: boolean;
  full_data_access: boolean;
  members: number;
  grants: (AccessGrant & { capability: string })[];
};

export type MatrixRow = { user_id: string; full_data_access: boolean; grants: AccessGrant[] };

export class PermissionServiceError extends Error {
  constructor(message: string, public code?: string, public missingRpc = false) {
    super(message);
  }
}

async function call<T>(fn: string, args?: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.rpc(fn, args ?? {});
  if (error) {
    const missing = /Could not find the function|does not exist|PGRST202/i.test(`${error.message} ${error.code ?? ""}`);
    throw new PermissionServiceError(
      missing ? "The Permission Manager update (migration 20261020100000) is not installed on the server yet." : error.message,
      error.code,
      missing,
    );
  }
  return (Array.isArray(data) && fn !== "rpc_admin_access_matrix" && fn !== "rpc_who_can_access" ? data[0] : data) as T;
}

export const PermissionsApi = {
  catalog: () => call<CatalogV2>("get_permission_catalog_v2"),
  myAccess: () => call<any>("get_my_access"),
  userAccess: (userId: string) => call<UserAccess>("get_user_access", { p_user_id: userId }),
  matrix: (userIds: string[]) => call<MatrixRow[]>("rpc_admin_access_matrix", { p_user_ids: userIds }),

  setAccessBulk: (userIds: string[], grants: GrantInput[], expiresAt: string | null, reason: string | null, dryRun: boolean) =>
    call<BulkResult>("admin_set_access_bulk", {
      p_user_ids: userIds,
      p_grants: grants,
      p_expires_at: expiresAt,
      p_reason: reason,
      p_dry_run: dryRun,
    }),
  revokeAccessBulk: (userIds: string[], capabilities: string[], reason: string | null, dryRun: boolean) =>
    call<BulkResult>("admin_revoke_access_bulk", {
      p_user_ids: userIds,
      p_capabilities: capabilities,
      p_reason: reason,
      p_dry_run: dryRun,
    }),
  copyAccess: (fromId: string, toIds: string[], reason: string | null, expiresAt: string | null, dryRun: boolean) =>
    call<BulkResult>("admin_copy_access", {
      p_from: fromId,
      p_to: toIds,
      p_reason: reason,
      p_expires_at: expiresAt,
      p_dry_run: dryRun,
    }),
  revokeGrant: (grantId: string, reason: string | null) =>
    call<BulkResult>("admin_revoke_grant", { p_grant_id: grantId, p_reason: reason }),
  setGrantExpiry: (grantId: string, expiresAt: string | null, reason: string | null) =>
    call<BulkResult>("admin_set_grant_expiry", { p_grant_id: grantId, p_expires_at: expiresAt, p_reason: reason }),

  roleTemplates: () => call<{ can_edit: boolean; templates: RoleTemplate[] }>("rpc_admin_role_templates"),
  setRoleTemplate: (role: string, grants: GrantInput[], reason: string | null) =>
    call<BulkResult & { added?: number; removed?: number; affected_people?: number }>("rpc_admin_set_role_template", {
      p_role: role,
      p_grants: grants,
      p_reason: reason,
    }),
  setRoleFullAccess: (role: string, enabled: boolean, reason: string) =>
    call<BulkResult & { affected_people?: number }>("rpc_admin_set_role_full_access", {
      p_role: role,
      p_enabled: enabled,
      p_reason: reason,
    }),

  whoCanAccess: (targetId: string, capability: string | null) =>
    call<any[]>("rpc_who_can_access", { p_target: targetId, p_capability: capability }),
  explain: (userId: string, capability: string, targetId: string) =>
    call<any>("explain_access", { p_user: userId, p_permission: capability, p_target: targetId }),
  history: (filters: { userId?: string | null; actorId?: string | null; capability?: string | null; limit?: number; offset?: number }) =>
    call<{ rows: any[]; has_more: boolean }>("rpc_permission_history", {
      p_user_id: filters.userId ?? null,
      p_actor_id: filters.actorId ?? null,
      p_capability: filters.capability ?? null,
      p_limit: filters.limit ?? 50,
      p_offset: filters.offset ?? 0,
    }),

  setBirthday: (profileId: string, dateOfBirth: string | null) =>
    call<BulkResult>("rpc_admin_set_birthday", { p_profile_id: profileId, p_date_of_birth: dateOfBirth }),
  importBirthdays: (rows: { name: string; phone?: string | null; date_of_birth: string }[]) =>
    call<{ success: boolean; updated: number; skipped: { name: string; reason: string }[] }>("rpc_admin_import_birthdays", {
      p_rows: rows,
    }),
};

/** Every capability the given ones include (implied View etc.). */
export function impliedBy(selected: Iterable<string>, byKey: Map<string, Capability>): Set<string> {
  const out = new Set<string>();
  const stack = [...selected];
  while (stack.length) {
    const key = stack.pop()!;
    for (const next of byKey.get(key)?.implies ?? []) {
      if (!out.has(next)) {
        out.add(next);
        stack.push(next);
      }
    }
  }
  return out;
}

/** Only the capabilities that are not already implied by another selected one. */
export function minimalSelection(selected: Iterable<string>, byKey: Map<string, Capability>): string[] {
  const list = [...new Set(selected)];
  const implied = impliedBy(list, byKey);
  return list.filter((key) => !implied.has(key));
}

export function sourceLabel(source: string | null | undefined) {
  const s = String(source ?? "USER");
  if (s === "USER") return "Direct";
  if (s === "MANAGER") return "Manager (reporting tree)";
  if (s === "FULL_ACCESS") return "Full data access";
  if (s.startsWith("ROLE:")) return `Role template · ${s.slice(5)}`;
  return s;
}
