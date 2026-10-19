import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  useWindowDimensions,
  View,
} from "react-native";
import Feather from "@expo/vector-icons/Feather";
import { ThemedText } from "@/components/ThemedText";
import { useTheme } from "@/hooks/useTheme";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/contexts/AuthContext";
import { usePermissions, invalidatePermissionsCache } from "@/hooks/usePermissions";
import { SearchableSelect, SelectOption } from "@/components/SearchableSelect";
import { DateInput } from "@/components/DateInput";
import {
  PERMISSION_ADMIN_ROLES,
  PERMISSION_CATALOG,
  canonicalPermission,
  permissionDef,
} from "@/constants/permissionCatalog";

/**
 * Permission Manager (engine v2).
 *   People          effective access of one employee; grant / revoke with
 *                   scope, optional expiry (temporary access) and reason
 *   Role templates  permissions every holder of a role gets; "their own
 *                   reporting line" follows the org chart automatically
 *   Simulator       can USER do PERMISSION on TARGET, and why
 *   History         permission change log
 * Every action is enforced server-side (admin_grant_permission, ...); this
 * screen only hides what the caller cannot do.
 */

type Tab = "people" | "roles" | "simulator" | "history";
type CatalogItem = { key: string; module: string; label: string; description?: string; scoped: boolean; risk: string };

const SCOPE_TEXT: Record<string, string> = {
  GLOBAL: "All employees",
  OFFICE: "One office",
  OFFICE_TREE: "Office + its teams",
  TEAM: "One team",
  TEAM_TREE: "Team + sub-teams",
  REPORTS_TO: "Reporting line",
  DEPARTMENT: "One department",
  SELF: "Own records only",
};
const PEOPLE_SCOPES = ["GLOBAL", "OFFICE", "OFFICE_TREE", "TEAM", "TEAM_TREE", "REPORTS_TO", "DEPARTMENT", "SELF"];
const NEEDS_TARGET = ["OFFICE", "OFFICE_TREE", "TEAM", "TEAM_TREE", "DEPARTMENT"];

const DURATIONS: { label: string; hours: number | null }[] = [
  { label: "Permanent", hours: null },
  { label: "2 hours", hours: 2 },
  { label: "1 day", hours: 24 },
  { label: "7 days", hours: 24 * 7 },
  { label: "30 days", hours: 24 * 30 },
];

const DATE_TIME = new Intl.DateTimeFormat("en-IN", {
  timeZone: "Asia/Kolkata",
  day: "2-digit",
  month: "short",
  hour: "numeric",
  minute: "2-digit",
  hour12: true,
});
const fmt = (value?: string | null) => (value ? DATE_TIME.format(new Date(value)) : "");

function rpcResult(data: any) {
  return Array.isArray(data) ? data[0] : data;
}

export default function PermissionsManagerScreen() {
  const { theme } = useTheme();
  const { user } = useAuth();
  const { hasPermission } = usePermissions();
  const role = String(user?.role ?? "").toUpperCase();
  const isRoleAdmin = PERMISSION_ADMIN_ROLES.includes(role);
  const canView = isRoleAdmin || hasPermission("permissions.view") || hasPermission("permissions.assign");
  const canAssign = isRoleAdmin || hasPermission("permissions.assign");
  const canRevoke = isRoleAdmin || hasPermission("permissions.revoke");

  const [tab, setTab] = useState<Tab>("people");
  const { width } = useWindowDimensions();
  const compact = width < 600; // phones and the Android app
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [catalog, setCatalog] = useState<CatalogItem[]>([]);
  const [people, setPeople] = useState<any[]>([]);
  const [offices, setOffices] = useState<any[]>([]);
  const [teams, setTeams] = useState<any[]>([]);
  const [departments, setDepartments] = useState<string[]>([]);

  const loadBase = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    const [cat, profiles, officeRes, teamRes] = await Promise.all([
      supabase.rpc("get_permission_catalog"),
      supabase
        .from("profiles")
        .select("id,name,role,employee_number,department,is_active")
        .order("name")
        .limit(5000),
      supabase.from("offices").select("id,name").eq("is_active", true).order("name"),
      supabase.from("teams").select("id,name").order("name"),
    ]);
    const serverCatalog = Array.isArray(cat.data) ? (cat.data as CatalogItem[]) : [];
    // Older database (engine v2 not applied yet): fall back to the app catalog.
    setCatalog(
      serverCatalog.length
        ? serverCatalog
        : PERMISSION_CATALOG.map((p) => ({ key: p.key, module: p.module, label: p.label, description: p.description, scoped: p.scoped, risk: p.risk })),
    );
    if (profiles.error) setLoadError(profiles.error.message);
    const list = profiles.data ?? [];
    setPeople(list);
    setOffices(officeRes.data ?? []);
    setTeams(teamRes.data ?? []);
    setDepartments(
      Array.from(new Set<string>(list.map((p: any) => String(p.department ?? "").trim()).filter(Boolean))).sort(),
    );
    setLoading(false);
  }, []);

  useEffect(() => {
    if (canView) void loadBase();
  }, [canView, loadBase]);

  const personOptions = useMemo<SelectOption[]>(
    () =>
      people.map((p) => ({
        value: p.id,
        label: p.name || "Unnamed",
        subtitle: [p.role, p.employee_number, p.is_active === false ? "inactive" : null].filter(Boolean).join(" · "),
        icon: "user",
      })),
    [people],
  );
  const permissionOptions = useMemo<SelectOption[]>(
    () =>
      catalog.map((c) => ({
        value: c.key,
        label: c.label,
        subtitle: `${c.key}${c.scoped ? "" : " · company-wide"}`,
        group: c.module,
        icon: c.risk === "HIGH" ? "alert-triangle" : "key",
      })),
    [catalog],
  );

  if (!canView) {
    return (
      <View style={[st.center, { backgroundColor: theme.backgroundRoot }]}>
        <Feather name="lock" size={44} color={theme.textSecondary} />
        <ThemedText type="h3" style={{ marginTop: 14, color: theme.textSecondary }}>Access restricted</ThemedText>
        <ThemedText style={{ color: theme.textSecondary, textAlign: "center", marginTop: 8, paddingHorizontal: 32 }}>
          Administrators and System Administrators only (or users granted permissions.view / permissions.assign).
        </ThemedText>
      </View>
    );
  }

  const scopeTargetOptions = (scope: string): SelectOption[] => {
    if (scope === "OFFICE" || scope === "OFFICE_TREE") return offices.map((o) => ({ value: o.id, label: o.name, icon: "home" }));
    if (scope === "TEAM" || scope === "TEAM_TREE") return teams.map((t) => ({ value: t.id, label: t.name, icon: "users" }));
    if (scope === "DEPARTMENT") return departments.map((d) => ({ value: d, label: d, icon: "briefcase" }));
    if (scope === "REPORTS_TO") return personOptions;
    return [];
  };

  return (
    <View style={{ flex: 1, backgroundColor: theme.backgroundRoot }}>
      {/* Four equal tabs: icon above a short label on phones, inline on wide screens */}
      <View style={[st.tabs, { borderBottomColor: theme.border, backgroundColor: theme.backgroundDefault }]}>
        {([
          ["people", "People", "People", "users"],
          ["roles", "Role templates", "Roles", "layers"],
          ["simulator", "Simulator", "Check", "zap"],
          ["history", "History", "History", "clock"],
        ] as const).map(([key, label, shortLabel, icon]) => {
          const active = tab === key;
          return (
            <Pressable
              key={key}
              onPress={() => setTab(key)}
              style={[st.tab, compact && st.tabCompact, active && { borderBottomColor: theme.primary }]}
              accessibilityRole="tab"
              accessibilityLabel={label}
              accessibilityState={{ selected: active }}
            >
              <Feather name={icon} size={compact ? 18 : 14} color={active ? theme.primary : theme.textSecondary} />
              <ThemedText
                numberOfLines={1}
                style={{ color: active ? theme.primary : theme.textSecondary, fontWeight: "700", fontSize: compact ? 11 : 13 }}
              >
                {compact ? shortLabel : label}
              </ThemedText>
            </Pressable>
          );
        })}
      </View>

      {loading ? (
        <View style={st.center}>
          <ActivityIndicator color={theme.primary} />
        </View>
      ) : (
        <ScrollView
          contentContainerStyle={[st.content, compact && st.contentCompact]}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
        >
          {loadError ? <ThemedText style={st.error}>{loadError}</ThemedText> : null}
          {tab === "people" ? (
            <PeopleTab
              personOptions={personOptions}
              permissionOptions={permissionOptions}
              catalog={catalog}
              canAssign={canAssign}
              canRevoke={canRevoke}
              scopeTargetOptions={scopeTargetOptions}
            />
          ) : tab === "roles" ? (
            <RolesTab
              permissionOptions={permissionOptions}
              catalog={catalog}
              canEdit={isRoleAdmin}
              scopeTargetOptions={scopeTargetOptions}
            />
          ) : tab === "simulator" ? (
            <SimulatorTab personOptions={personOptions} permissionOptions={permissionOptions} />
          ) : (
            <HistoryTab people={people} />
          )}
        </ScrollView>
      )}
    </View>
  );
}

// ─── People ─────────────────────────────────────────────────────────────────

function PeopleTab({
  personOptions,
  permissionOptions,
  catalog,
  canAssign,
  canRevoke,
  scopeTargetOptions,
}: {
  personOptions: SelectOption[];
  permissionOptions: SelectOption[];
  catalog: CatalogItem[];
  canAssign: boolean;
  canRevoke: boolean;
  scopeTargetOptions: (scope: string) => SelectOption[];
}) {
  const { theme } = useTheme();
  const [personId, setPersonId] = useState("");
  const [access, setAccess] = useState<any>(null);
  const [loadingAccess, setLoadingAccess] = useState(false);
  const [showGrant, setShowGrant] = useState(false);

  const loadAccess = useCallback(async (id: string) => {
    if (!id) return;
    setLoadingAccess(true);
    const { data, error } = await supabase.rpc("get_user_permission_grants", { p_user_id: id });
    setLoadingAccess(false);
    if (error) {
      Alert.alert("Could not load access", error.message);
      setAccess(null);
      return;
    }
    setAccess(rpcResult(data));
  }, []);

  useEffect(() => {
    setShowGrant(false);
    void loadAccess(personId);
  }, [personId, loadAccess]);

  const grantsByModule = useMemo(() => {
    const groups = new Map<string, any[]>();
    for (const grant of access?.grants ?? []) {
      const def = permissionDef(grant.permission);
      const module = def?.module ?? catalog.find((c) => c.key === grant.permission)?.module ?? "Other";
      groups.set(module, [...(groups.get(module) ?? []), grant]);
    }
    return Array.from(groups.entries());
  }, [access, catalog]);

  const revoke = (grant: any) => {
    Alert.alert(
      "Revoke this permission?",
      `${permissionDef(grant.permission)?.label ?? grant.permission} · ${grant.scope_label}`,
      [
        { text: "Keep", style: "cancel" },
        {
          text: "Revoke",
          style: "destructive",
          onPress: async () => {
            const { data, error } = await supabase.rpc("admin_revoke_permission", {
              p_user_id: personId,
              p_permission: grant.permission,
              p_scope: grant.scope,
              p_scope_id: grant.scope_id,
              p_reason: null,
            });
            const result = rpcResult(data);
            if (error || result?.success !== true) {
              Alert.alert("Revoke failed", error?.message || result?.message || "Please try again.");
              return;
            }
            invalidatePermissionsCache();
            await loadAccess(personId);
          },
        },
      ],
    );
  };

  const person = personOptions.find((p) => p.value === personId);

  return (
    <View>
      <ThemedText style={st.label}>Employee</ThemedText>
      <SearchableSelect
        title="Choose an employee"
        value={personId}
        options={personOptions}
        onChange={setPersonId}
        placeholder="Search by name or employee number"
        searchPlaceholder="Name, role or employee number"
      />

      {!personId ? (
        <Hint icon="info" text="Choose an employee to see everything they can access and why." />
      ) : loadingAccess && !access ? (
        <ActivityIndicator color={theme.primary} style={{ marginTop: 24 }} />
      ) : access ? (
        <View>
          <View style={[st.card, { backgroundColor: theme.backgroundDefault }]}>
            <ThemedText style={st.cardTitle}>{person?.label}</ThemedText>
            <ThemedText type="caption" style={{ color: theme.textSecondary }}>
              Role: {access.role || "—"}
            </ThemedText>
            {access.is_admin ? (
              <Hint
                icon="shield"
                text="This role is an HR data admin: every data permission for all employees, without grants. Permission management still needs System Admin / Admin or a permissions.* grant."
              />
            ) : null}
          </View>

          <View style={st.rowBetween}>
            <ThemedText style={st.sectionTitle}>
              Effective access · {(access.grants ?? []).length}
            </ThemedText>
            {canAssign ? (
              <Pressable onPress={() => setShowGrant((v) => !v)} style={[st.smallBtn, { backgroundColor: theme.primary }]}>
                <Feather name={showGrant ? "x" : "plus"} size={14} color="#fff" />
                <ThemedText style={st.smallBtnText}>{showGrant ? "Close" : "Grant permission"}</ThemedText>
              </Pressable>
            ) : null}
          </View>

          {showGrant ? (
            <GrantForm
              personId={personId}
              permissionOptions={permissionOptions}
              catalog={catalog}
              scopeTargetOptions={scopeTargetOptions}
              onDone={async () => {
                setShowGrant(false);
                invalidatePermissionsCache();
                await loadAccess(personId);
              }}
            />
          ) : null}

          {grantsByModule.length === 0 ? (
            <Hint icon="slash" text="No permissions granted. They can only see their own records." />
          ) : (
            grantsByModule.map(([module, grants]) => (
              <View key={module} style={[st.card, { backgroundColor: theme.backgroundDefault }]}>
                <ThemedText style={[st.moduleTitle, { color: theme.textSecondary }]}>{module.toUpperCase()}</ThemedText>
                {grants.map((g: any) => {
                  const def = permissionDef(g.permission);
                  const fromRole = String(g.source ?? "USER") !== "USER";
                  return (
                    <View key={`${g.source}:${g.id}`} style={[st.grantRow, { borderTopColor: theme.border }]}>
                      <View style={{ flex: 1, minWidth: 0 }}>
                        <ThemedText style={{ fontWeight: "700" }}>{def?.label ?? g.permission}</ThemedText>
                        <ThemedText type="caption" style={{ color: theme.textSecondary }}>
                          {g.scope_label}
                          {g.reason ? ` · ${g.reason}` : ""}
                        </ThemedText>
                        <View style={st.badges}>
                          <Badge text={fromRole ? `Role template · ${String(g.source).slice(5)}` : "Direct grant"} color={fromRole ? "#2563EB" : "#6D1B6D"} />
                          {g.expires_at ? <Badge text={`Until ${fmt(g.expires_at)}`} color="#B45309" /> : null}
                          {def?.risk === "HIGH" ? <Badge text="High risk" color="#DC2626" /> : null}
                          {canonicalPermission(g.permission) !== g.permission ? <Badge text={`legacy: ${g.permission}`} color="#6B7280" /> : null}
                        </View>
                      </View>
                      {!fromRole && canRevoke ? (
                        <Pressable onPress={() => revoke(g)} hitSlop={8} style={st.iconBtn} accessibilityLabel="Revoke">
                          <Feather name="trash-2" size={17} color="#EF4444" />
                        </Pressable>
                      ) : null}
                    </View>
                  );
                })}
              </View>
            ))
          )}
        </View>
      ) : null}
    </View>
  );
}

function GrantForm({
  personId,
  permissionOptions,
  catalog,
  scopeTargetOptions,
  onDone,
}: {
  personId: string;
  permissionOptions: SelectOption[];
  catalog: CatalogItem[];
  scopeTargetOptions: (scope: string) => SelectOption[];
  onDone: () => void | Promise<void>;
}) {
  const { theme } = useTheme();
  const [permission, setPermission] = useState("");
  const [scope, setScope] = useState("GLOBAL");
  const [scopeId, setScopeId] = useState("");
  const [duration, setDuration] = useState<number | null | "custom">(null);
  const [customUntil, setCustomUntil] = useState("");
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const def = catalog.find((c) => c.key === permission);
  const scopes = def && !def.scoped ? ["GLOBAL"] : PEOPLE_SCOPES;
  useEffect(() => {
    if (!scopes.includes(scope)) setScope("GLOBAL");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [permission]);

  const save = async () => {
    setError(null);
    if (!permission) return setError("Choose a permission.");
    if (NEEDS_TARGET.includes(scope) && !scopeId) return setError("Choose who this scope covers.");
    if (def?.risk === "HIGH" && reason.trim().length < 5) return setError("High-risk permission: enter a reason (5+ characters).");
    let expiresAt: string | null = null;
    if (duration === "custom") {
      if (!customUntil) return setError("Choose the last day of access.");
      expiresAt = new Date(`${customUntil}T23:59:59+05:30`).toISOString();
    } else if (typeof duration === "number") {
      expiresAt = new Date(Date.now() + duration * 3_600_000).toISOString();
    }
    setSaving(true);
    const { data, error: rpcError } = await supabase.rpc("admin_grant_permission", {
      p_user_id: personId,
      p_permission: permission,
      p_scope: scope,
      p_scope_id: scopeId || null,
      p_reason: reason.trim() || null,
      p_expires_at: expiresAt,
    });
    setSaving(false);
    const result = rpcResult(data);
    if (rpcError || result?.success !== true) {
      setError(rpcError?.message || result?.message || "The server did not confirm the grant.");
      return;
    }
    await onDone();
  };

  return (
    <View style={[st.card, { backgroundColor: theme.backgroundDefault, borderColor: theme.primary, borderWidth: 1 }]}>
      <ThemedText style={st.label}>Permission</ThemedText>
      <SearchableSelect title="Choose a permission" value={permission} options={permissionOptions} onChange={setPermission} placeholder="What should they be able to do?" />
      {def?.description ? (
        <ThemedText type="caption" style={{ color: theme.textSecondary, marginTop: -6, marginBottom: 10 }}>{def.description}</ThemedText>
      ) : null}

      <ThemedText style={st.label}>For which employees</ThemedText>
      <Chips
        options={scopes.map((s) => ({ value: s, label: SCOPE_TEXT[s] }))}
        value={scope}
        onChange={(value) => {
          setScope(value);
          setScopeId("");
        }}
      />
      {scope === "REPORTS_TO" ? (
        <>
          <SearchableSelect
            title="Whose reporting line?"
            value={scopeId}
            options={[{ value: "", label: "Their own reports (follows the org chart)", icon: "git-branch" }, ...scopeTargetOptions(scope)]}
            onChange={setScopeId}
          />
        </>
      ) : NEEDS_TARGET.includes(scope) ? (
        <SearchableSelect title={SCOPE_TEXT[scope]} value={scopeId} options={scopeTargetOptions(scope)} onChange={setScopeId} placeholder="Choose…" />
      ) : null}

      <ThemedText style={st.label}>Duration</ThemedText>
      <Chips
        options={[...DURATIONS.map((d) => ({ value: String(d.hours), label: d.label })), { value: "custom", label: "Until date" }]}
        value={String(duration)}
        onChange={(value) => setDuration(value === "custom" ? "custom" : value === "null" ? null : Number(value))}
      />
      {duration === "custom" ? (
        <DateInput
          value={customUntil}
          onChange={setCustomUntil}
          min={new Date().toISOString().slice(0, 10)}
          style={[st.input, { color: theme.text, borderColor: theme.border }]}
        />
      ) : null}

      <ThemedText style={st.label}>Reason {def?.risk === "HIGH" ? "(required)" : "(optional)"}</ThemedText>
      <TextInput
        value={reason}
        onChangeText={setReason}
        placeholder="e.g. Covering Noida HR during leave"
        placeholderTextColor={theme.textSecondary}
        style={[st.input, { color: theme.text, borderColor: theme.border }]}
      />
      {error ? <ThemedText style={st.error}>{error}</ThemedText> : null}
      <Pressable onPress={() => void save()} disabled={saving} style={[st.primaryBtn, { backgroundColor: theme.primary, opacity: saving ? 0.6 : 1 }]}>
        <ThemedText style={st.primaryBtnText}>{saving ? "Saving..." : "Grant permission"}</ThemedText>
      </Pressable>
    </View>
  );
}

// ─── Role templates ─────────────────────────────────────────────────────────

function RolesTab({
  permissionOptions,
  catalog,
  canEdit,
  scopeTargetOptions,
}: {
  permissionOptions: SelectOption[];
  catalog: CatalogItem[];
  canEdit: boolean;
  scopeTargetOptions: (scope: string) => SelectOption[];
}) {
  const { theme } = useTheme();
  const [state, setState] = useState<{ roles: string[]; members: Record<string, number>; grants: any[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [role, setRole] = useState("");
  const [permission, setPermission] = useState("");
  const [scope, setScope] = useState("REPORTS_TO");
  const [scopeId, setScopeId] = useState("");
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    const { data, error: rpcError } = await supabase.rpc("rpc_admin_list_role_permissions");
    if (rpcError) {
      setError(
        rpcError.message.includes("Could not find")
          ? "Role templates need the 20261007100000 migration to be run."
          : rpcError.message,
      );
      return;
    }
    setError(null);
    setState(rpcResult(data));
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  const roleOptions = (state?.roles ?? [])
    .filter((r) => !["SYSTEM_ADMIN", "SUPER_ADMIN", "ADMIN", "HR", "HRD"].includes(r))
    .map((r) => ({ value: r, label: r, subtitle: `${state?.members?.[r] ?? 0} active people`, icon: "users" as const }));
  const def = catalog.find((c) => c.key === permission);
  const scopes = def && !def.scoped ? ["GLOBAL"] : ["REPORTS_TO", "OFFICE", "OFFICE_TREE", "TEAM", "TEAM_TREE", "DEPARTMENT", "GLOBAL"];
  const roleGrants = (state?.grants ?? []).filter((g) => g.role === role);

  const add = async () => {
    if (!role || !permission) return Alert.alert("Choose a role and a permission");
    if (NEEDS_TARGET.includes(scope) && !scopeId) return Alert.alert("Choose who this scope covers");
    setSaving(true);
    const { data, error: rpcError } = await supabase.rpc("rpc_admin_grant_role_permission", {
      p_role: role,
      p_permission: permission,
      p_scope: scope,
      p_scope_id: scope === "REPORTS_TO" ? null : scopeId || null,
      p_reason: null,
    });
    setSaving(false);
    const result = rpcResult(data);
    if (rpcError || result?.success !== true) {
      Alert.alert("Not saved", rpcError?.message || result?.message || "Please try again.");
      return;
    }
    setPermission("");
    invalidatePermissionsCache();
    await load();
  };

  const remove = (grant: any) =>
    Alert.alert("Remove from role template?", `${grant.role}: ${permissionDef(grant.permission)?.label ?? grant.permission}`, [
      { text: "Keep", style: "cancel" },
      {
        text: "Remove",
        style: "destructive",
        onPress: async () => {
          const { data, error: rpcError } = await supabase.rpc("rpc_admin_revoke_role_permission", { p_id: grant.id, p_reason: null });
          const result = rpcResult(data);
          if (rpcError || result?.success !== true) {
            Alert.alert("Not removed", rpcError?.message || result?.message || "Please try again.");
            return;
          }
          invalidatePermissionsCache();
          await load();
        },
      },
    ]);

  if (error) return <Hint icon="alert-circle" text={error} />;
  if (!state) return <ActivityIndicator color={theme.primary} style={{ marginTop: 24 }} />;

  return (
    <View>
      <Hint
        icon="git-branch"
        text={'A role template gives a permission to everyone with that role. "Their own reporting line" means each person sees only the people who report to them (directly or indirectly), and it updates automatically when someone changes manager.'}
      />
      <ThemedText style={st.label}>Role</ThemedText>
      <SearchableSelect title="Choose a role" value={role} options={roleOptions} onChange={setRole} placeholder="e.g. TEAM_LEAD, SALES_MANAGER" />

      {role ? (
        <>
          <View style={[st.card, { backgroundColor: theme.backgroundDefault }]}>
            <ThemedText style={st.sectionTitle}>{role} · {roleGrants.length} permission{roleGrants.length === 1 ? "" : "s"}</ThemedText>
            {roleGrants.length === 0 ? (
              <ThemedText type="caption" style={{ color: theme.textSecondary, marginTop: 6 }}>Nothing yet.</ThemedText>
            ) : (
              roleGrants.map((g) => (
                <View key={g.id} style={[st.grantRow, { borderTopColor: theme.border }]}>
                  <View style={{ flex: 1 }}>
                    <ThemedText style={{ fontWeight: "700" }}>{permissionDef(g.permission)?.label ?? g.permission}</ThemedText>
                    <ThemedText type="caption" style={{ color: theme.textSecondary }}>{g.scope_label}</ThemedText>
                  </View>
                  {canEdit ? (
                    <Pressable onPress={() => remove(g)} hitSlop={8} style={st.iconBtn} accessibilityLabel="Remove">
                      <Feather name="trash-2" size={17} color="#EF4444" />
                    </Pressable>
                  ) : null}
                </View>
              ))
            )}
          </View>

          {canEdit ? (
            <View style={[st.card, { backgroundColor: theme.backgroundDefault }]}>
              <ThemedText style={st.sectionTitle}>Add to {role}</ThemedText>
              <ThemedText style={st.label}>Permission</ThemedText>
              <SearchableSelect
                title="Choose a permission"
                value={permission}
                options={permissionOptions.filter((o) => !o.value.startsWith("permissions."))}
                onChange={(value) => {
                  setPermission(value);
                  const next = catalog.find((c) => c.key === value);
                  setScope(next && !next.scoped ? "GLOBAL" : "REPORTS_TO");
                  setScopeId("");
                }}
              />
              <ThemedText style={st.label}>For which employees</ThemedText>
              <Chips
                options={scopes.map((s) => ({ value: s, label: s === "REPORTS_TO" ? "Their own reporting line" : SCOPE_TEXT[s] }))}
                value={scope}
                onChange={(value) => {
                  setScope(value);
                  setScopeId("");
                }}
              />
              {NEEDS_TARGET.includes(scope) ? (
                <SearchableSelect title={SCOPE_TEXT[scope]} value={scopeId} options={scopeTargetOptions(scope)} onChange={setScopeId} placeholder="Choose…" />
              ) : null}
              <Pressable onPress={() => void add()} disabled={saving} style={[st.primaryBtn, { backgroundColor: theme.primary, opacity: saving ? 0.6 : 1 }]}>
                <ThemedText style={st.primaryBtnText}>{saving ? "Saving..." : "Add to role"}</ThemedText>
              </Pressable>
            </View>
          ) : (
            <Hint icon="lock" text="Only System Admin / Admin can change role templates." />
          )}
        </>
      ) : null}
    </View>
  );
}

// ─── Simulator ──────────────────────────────────────────────────────────────

function SimulatorTab({ personOptions, permissionOptions }: { personOptions: SelectOption[]; permissionOptions: SelectOption[] }) {
  const { theme } = useTheme();
  const [userId, setUserId] = useState("");
  const [permission, setPermission] = useState("attendance.view");
  const [targetId, setTargetId] = useState("");
  const [result, setResult] = useState<any>(null);
  const [running, setRunning] = useState(false);

  const run = async () => {
    if (!userId || !targetId) return Alert.alert("Choose both people");
    setRunning(true);
    const { data, error } = await supabase.rpc("explain_access", { p_user: userId, p_permission: permission, p_target: targetId });
    setRunning(false);
    setResult(error ? { allowed: false, reason: "ERROR", explanation: error.message } : rpcResult(data));
  };

  return (
    <View>
      <Hint icon="zap" text="Check whether someone can act on another employee, and see exactly which grant allows or blocks it." />
      <ThemedText style={st.label}>Who</ThemedText>
      <SearchableSelect title="Who is asking?" value={userId} options={personOptions} onChange={setUserId} />
      <ThemedText style={st.label}>Wants to</ThemedText>
      <SearchableSelect title="Permission" value={permission} options={permissionOptions} onChange={setPermission} />
      <ThemedText style={st.label}>For employee</ThemedText>
      <SearchableSelect title="Target employee" value={targetId} options={personOptions} onChange={setTargetId} />
      <Pressable onPress={() => void run()} disabled={running} style={[st.primaryBtn, { backgroundColor: theme.primary, opacity: running ? 0.6 : 1 }]}>
        <ThemedText style={st.primaryBtnText}>{running ? "Checking..." : "Check access"}</ThemedText>
      </Pressable>

      {result ? (
        <View style={[st.card, { backgroundColor: result.allowed ? "#ECFDF5" : "#FEF2F2", borderColor: result.allowed ? "#10B981" : "#EF4444", borderWidth: 1 }]}>
          <View style={st.rowCenter}>
            <Feather name={result.allowed ? "check-circle" : "x-circle"} size={20} color={result.allowed ? "#047857" : "#B91C1C"} />
            <ThemedText style={{ fontWeight: "800", color: result.allowed ? "#047857" : "#B91C1C" }}>
              {result.allowed ? "ALLOWED" : "DENIED"} · {String(result.reason ?? "").replace(/_/g, " ")}
            </ThemedText>
          </View>
          <ThemedText style={{ color: "#111827", marginTop: 8, lineHeight: 20 }}>{result.explanation}</ThemedText>
          {result.target ? (
            <ThemedText type="caption" style={{ color: "#374151", marginTop: 8 }}>
              Target: {result.target.name} · {result.target.office_name ?? "no office"} · {result.target.team_name ?? "no team"} · reports to {result.target.reports_to_name ?? "nobody"}
            </ThemedText>
          ) : null}
          {(result.grants ?? []).length ? (
            <View style={{ marginTop: 8 }}>
              {(result.grants as any[]).map((g, i) => (
                <ThemedText key={i} type="caption" style={{ color: "#374151" }}>
                  {g.covers_target ? "✓" : "✗"} {g.scope_label} ({String(g.source ?? "USER") === "USER" ? "direct" : String(g.source).slice(5) + " template"})
                </ThemedText>
              ))}
            </View>
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

// ─── History ────────────────────────────────────────────────────────────────

function HistoryTab({ people }: { people: any[] }) {
  const { theme } = useTheme();
  const [rows, setRows] = useState<any[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const names = useMemo(() => new Map(people.map((p) => [p.id, p.name])), [people]);

  useEffect(() => {
    void supabase
      .from("permission_audit_logs")
      .select("id,action,permission,permission_key,scope,scope_id,reason,created_at,actor_id,performed_by,target_user_id,metadata")
      .order("created_at", { ascending: false })
      .limit(150)
      .then(({ data, error: queryError }: { data: any[] | null; error: any }) => {
        if (queryError) setError(queryError.message);
        else setRows(data ?? []);
      });
  }, []);

  if (error) return <Hint icon="alert-circle" text={error} />;
  if (!rows) return <ActivityIndicator color={theme.primary} style={{ marginTop: 24 }} />;
  if (!rows.length) return <Hint icon="clock" text="No permission changes recorded yet." />;

  return (
    <View style={[st.card, { backgroundColor: theme.backgroundDefault }]}>
      {rows.map((r) => {
        const key = r.permission_key || r.permission;
        const action = String(r.action ?? "").toUpperCase();
        const color = action.includes("REVOKE") || action === "DELETE" ? "#DC2626" : action.includes("GRANT") ? "#047857" : "#6B7280";
        const expires = r.metadata?.row?.expires_at ?? r.metadata?.new?.expires_at;
        return (
          <View key={r.id} style={[st.grantRow, { borderTopColor: theme.border }]}>
            <View style={{ flex: 1 }}>
              <ThemedText style={{ fontWeight: "700" }}>
                <ThemedText style={{ color, fontWeight: "800" }}>{action || "CHANGE"}</ThemedText> · {permissionDef(key)?.label ?? key}
              </ThemedText>
              <ThemedText type="caption" style={{ color: theme.textSecondary }}>
                {names.get(r.target_user_id) ?? "—"} · {SCOPE_TEXT[r.scope] ?? r.scope ?? ""}
                {expires ? ` · until ${fmt(expires)}` : ""}
              </ThemedText>
              <ThemedText type="caption" style={{ color: theme.textSecondary }}>
                by {names.get(r.actor_id ?? r.performed_by) ?? "system"} · {fmt(r.created_at)}
                {r.reason ? ` · "${r.reason}"` : ""}
              </ThemedText>
            </View>
          </View>
        );
      })}
    </View>
  );
}

// ─── Small UI pieces ────────────────────────────────────────────────────────

function Chips({ options, value, onChange }: { options: { value: string; label: string }[]; value: string; onChange: (v: string) => void }) {
  const { theme } = useTheme();
  return (
    <View style={st.chips}>
      {options.map((o) => {
        const active = o.value === value;
        return (
          <Pressable
            key={o.value}
            onPress={() => onChange(o.value)}
            style={[st.chip, { borderColor: active ? theme.primary : theme.border, backgroundColor: active ? theme.primary : "transparent" }]}
          >
            <ThemedText style={{ fontSize: 12, fontWeight: "600", color: active ? "#fff" : theme.text }}>{o.label}</ThemedText>
          </Pressable>
        );
      })}
    </View>
  );
}

function Badge({ text, color }: { text: string; color: string }) {
  return (
    <View style={[st.badge, { backgroundColor: color + "1A" }]}>
      <ThemedText style={{ fontSize: 11, fontWeight: "700", color }}>{text}</ThemedText>
    </View>
  );
}

function Hint({ icon, text }: { icon: keyof typeof Feather.glyphMap; text: string }) {
  const { theme } = useTheme();
  return (
    <View style={[st.hint, { backgroundColor: theme.backgroundSecondary }]}>
      <Feather name={icon} size={15} color={theme.textSecondary} />
      <ThemedText type="caption" style={{ color: theme.textSecondary, flex: 1, lineHeight: 18 }}>{text}</ThemedText>
    </View>
  );
}

const st = StyleSheet.create({
  center: { flex: 1, alignItems: "center", justifyContent: "center", padding: 24 },
  tabs: { flexDirection: "row", borderBottomWidth: StyleSheet.hairlineWidth },
  tab: { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, paddingHorizontal: 8, minHeight: 48, borderBottomWidth: 2, borderBottomColor: "transparent" },
  tabCompact: { flexDirection: "column", gap: 2, paddingVertical: 8, minHeight: 56 },
  content: { padding: 16, paddingBottom: 80, width: "100%", maxWidth: 860, alignSelf: "center" },
  contentCompact: { padding: 12 },
  label: { fontWeight: "700", fontSize: 13, marginBottom: 6, marginTop: 4 },
  card: { borderRadius: 14, padding: 14, marginBottom: 12, overflow: "hidden" },
  cardTitle: { fontSize: 17, fontWeight: "800" },
  sectionTitle: { fontSize: 15, fontWeight: "800" },
  moduleTitle: { fontSize: 11, fontWeight: "800", letterSpacing: 0.6, marginBottom: 4 },
  rowBetween: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginVertical: 10, gap: 8, flexWrap: "wrap" },
  rowCenter: { flexDirection: "row", alignItems: "center", gap: 8 },
  grantRow: { flexDirection: "row", alignItems: "flex-start", gap: 8, paddingVertical: 10, borderTopWidth: StyleSheet.hairlineWidth },
  badges: { flexDirection: "row", flexWrap: "wrap", gap: 6, marginTop: 6 },
  badge: { paddingHorizontal: 8, paddingVertical: 2, borderRadius: 10 },
  iconBtn: { minWidth: 44, minHeight: 44, alignItems: "center", justifyContent: "center", borderRadius: 10 },
  smallBtn: { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 14, minHeight: 40, borderRadius: 10 },
  smallBtnText: { color: "#fff", fontWeight: "700", fontSize: 13 },
  primaryBtn: { minHeight: 48, borderRadius: 10, alignItems: "center", justifyContent: "center", marginTop: 8 },
  primaryBtnText: { color: "#fff", fontWeight: "800" },
  input: { borderWidth: 1, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, minHeight: 48, marginBottom: 10, fontSize: 16 },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 6, marginBottom: 12 },
  chip: { borderWidth: 1, borderRadius: 18, paddingHorizontal: 12, minHeight: 36, justifyContent: "center" },
  hint: { flexDirection: "row", gap: 8, padding: 12, borderRadius: 10, marginVertical: 8, alignItems: "flex-start" },
  error: { color: "#DC2626", marginBottom: 8 },
});
