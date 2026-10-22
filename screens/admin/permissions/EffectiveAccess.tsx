import React, { useCallback, useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Alert, Pressable, TextInput, View } from "react-native";
import Feather from "@expo/vector-icons/Feather";
import { ThemedText } from "@/components/ThemedText";
import { useTheme } from "@/hooks/useTheme";
import { SearchableSelect } from "@/components/SearchableSelect";
import { invalidatePermissionsCache } from "@/hooks/usePermissions";
import { AccessGrant, PermissionsApi, UserAccess, minimalSelection, sourceLabel } from "@/services/permissions.service";
import {
  Badge,
  CapabilityToggles,
  Hint,
  PrimaryButton,
  ScopePicker,
  SecondaryButton,
  capabilityLabel,
  fmt,
  moduleOf,
  st,
  useBase,
  usePersonOptions,
} from "./shared";

const RENEW_DAYS = 30;

/**
 * Everything one person can access and why: full data access, role template,
 * Manager (reporting tree) or direct grant, with scope, people covered and
 * expiry. Direct grants can be renewed, shortened or revoked here, and the
 * switches edit their direct access in one save.
 */
export function EffectiveAccess({ personId, onPersonChange }: { personId: string; onPersonChange: (id: string) => void }) {
  const base = useBase();
  const { theme } = useTheme();
  const personOptions = usePersonOptions();
  const [access, setAccess] = useState<UserAccess | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);

  const load = useCallback(async () => {
    if (!personId) return;
    setLoading(true);
    setError(null);
    try {
      setAccess(await PermissionsApi.userAccess(personId));
    } catch (e: any) {
      setError(e?.message ?? "Could not load access.");
      setAccess(null);
    } finally {
      setLoading(false);
    }
  }, [personId]);

  useEffect(() => {
    setEditing(false);
    void load();
  }, [load]);

  const byModule = useMemo(() => {
    const groups = new Map<string, AccessGrant[]>();
    for (const g of access?.grants ?? []) {
      const module = moduleOf(base, g.capability);
      groups.set(module, [...(groups.get(module) ?? []), g]);
    }
    const order = base.catalog.modules.map((m) => m.module);
    return Array.from(groups.entries()).sort(([a], [b]) => order.indexOf(a) - order.indexOf(b));
  }, [access, base]);

  const after = async (promise: Promise<any>, failTitle: string) => {
    try {
      const res = await promise;
      if (res?.success === false) {
        Alert.alert(failTitle, res.message ?? "Not allowed.");
        return;
      }
      invalidatePermissionsCache();
      await load();
    } catch (e: any) {
      Alert.alert(failTitle, e?.message ?? "Please try again.");
    }
  };

  const revoke = (g: AccessGrant) =>
    Alert.alert("Revoke this grant?", `${capabilityLabel(base, g.capability)} · ${g.scope_label}`, [
      { text: "Keep", style: "cancel" },
      { text: "Revoke", style: "destructive", onPress: () => void after(PermissionsApi.revokeGrant(g.id, "Revoked in Effective access"), "Revoke failed") },
    ]);
  const renew = (g: AccessGrant) =>
    void after(
      PermissionsApi.setGrantExpiry(g.id, new Date(Date.now() + RENEW_DAYS * 86_400_000).toISOString(), `Renewed for ${RENEW_DAYS} days`),
      "Renew failed",
    );
  const makePermanent = (g: AccessGrant) =>
    Alert.alert("Make permanent?", `${capabilityLabel(base, g.capability)} will no longer expire.`, [
      { text: "Cancel", style: "cancel" },
      { text: "Make permanent", onPress: () => void after(PermissionsApi.setGrantExpiry(g.id, null, "Made permanent"), "Not saved") },
    ]);

  const person = base.peopleById.get(personId);

  return (
    <View>
      <ThemedText style={st.label}>Employee</ThemedText>
      <SearchableSelect title="Choose an employee" value={personId} options={personOptions} onChange={onPersonChange} placeholder="Search by name or employee number" />

      {!personId ? (
        <Hint icon="info" text="Choose an employee to see everything they can access and why." />
      ) : loading && !access ? (
        <ActivityIndicator color={theme.primary} style={{ marginTop: 24 }} />
      ) : error ? (
        <Hint icon="alert-circle" tone="error" text={error} />
      ) : access ? (
        <View>
          <View style={[st.card, { backgroundColor: theme.backgroundDefault }]}>
            <ThemedText style={st.cardTitle}>{access.user.name ?? person?.name}</ThemedText>
            <ThemedText type="caption" style={{ color: theme.textSecondary }}>
              {access.user.role || "No role"} · {access.reports} {access.reports === 1 ? "person" : "people"} in their reporting tree
              {access.user.is_active === false ? " · deactivated (no access)" : ""}
            </ThemedText>
            <View style={st.badges}>
              {access.full_data_access ? <Badge text="Full data access (role)" color="#7C3AED" /> : null}
              {access.role_admin ? <Badge text="Manages permissions (admin role)" color="#DC2626" /> : null}
              {access.reports > 0 ? <Badge text="Manager" color="#047857" /> : null}
            </View>
            {access.full_data_access ? (
              <Hint icon="shield" text="Their role has full data access: every data permission for all employees, without grants. Change it in Templates." />
            ) : null}
          </View>

          <View style={st.rowBetween}>
            <ThemedText style={st.sectionTitle}>Effective access · {access.grants.length}</ThemedText>
            {base.canAssign || base.canRevoke ? (
              <SecondaryButton label={editing ? "Close editor" : "Edit direct access"} icon={editing ? "x" : "edit-2"} onPress={() => setEditing((v) => !v)} />
            ) : null}
          </View>

          {editing ? <DirectEditor access={access} onSaved={load} /> : null}

          {byModule.length === 0 ? (
            <Hint icon="slash" text="No permissions. They can only see their own records." />
          ) : (
            byModule.map(([module, grants]) => (
              <View key={module} style={[st.card, { backgroundColor: theme.backgroundDefault }]}>
                <ThemedText style={[st.moduleTitle, { color: theme.textSecondary }]}>{module.toUpperCase()}</ThemedText>
                {grants.map((g) => {
                  const direct = g.source === "USER";
                  const soon = g.expires_at && new Date(g.expires_at).getTime() - Date.now() < 7 * 86_400_000;
                  return (
                    <View key={`${g.source}:${g.id}:${g.permission}`} style={[st.grantRow, { borderTopColor: theme.border }]}>
                      <View style={{ flex: 1, minWidth: 0 }}>
                        <ThemedText style={{ fontWeight: "700" }}>{capabilityLabel(base, g.capability ?? g.permission)}</ThemedText>
                        <ThemedText type="caption" style={{ color: theme.textSecondary }}>
                          {g.scope_label}
                          {typeof g.covers === "number" ? ` · covers ${g.covers}` : ""}
                          {g.granted_by ? ` · by ${g.granted_by}` : ""}
                          {g.granted_at ? ` · ${fmt(g.granted_at)}` : ""}
                        </ThemedText>
                        {g.reason ? <ThemedText type="caption" style={{ color: theme.textSecondary }}>“{g.reason}”</ThemedText> : null}
                        <View style={st.badges}>
                          <Badge text={sourceLabel(g.source)} color={direct ? "#6D1B6D" : g.source === "MANAGER" ? "#047857" : "#2563EB"} />
                          {g.expires_at ? <Badge text={`Until ${fmt(g.expires_at)}`} color={soon ? "#DC2626" : "#B45309"} /> : null}
                          {g.legacy ? <Badge text={`older key: ${g.permission}`} color="#6B7280" /> : null}
                        </View>
                      </View>
                      {direct ? (
                        <View style={{ alignItems: "flex-end" }}>
                          {g.expires_at && base.canAssign ? (
                            <>
                              <Pressable onPress={() => renew(g)} hitSlop={6} style={st.iconBtn} accessibilityLabel="Renew 30 days">
                                <Feather name="refresh-cw" size={16} color={theme.primary} />
                              </Pressable>
                              <Pressable onPress={() => makePermanent(g)} hitSlop={6} style={st.iconBtn} accessibilityLabel="Make permanent">
                                <Feather name="unlock" size={16} color={theme.textSecondary} />
                              </Pressable>
                            </>
                          ) : null}
                          {base.canRevoke ? (
                            <Pressable onPress={() => revoke(g)} hitSlop={6} style={st.iconBtn} accessibilityLabel="Revoke">
                              <Feather name="trash-2" size={17} color="#EF4444" />
                            </Pressable>
                          ) : null}
                        </View>
                      ) : null}
                    </View>
                  );
                })}
              </View>
            ))
          )}

          {access.expired.length ? (
            <View style={[st.card, { backgroundColor: theme.backgroundDefault }]}>
              <ThemedText style={[st.moduleTitle, { color: theme.textSecondary }]}>EXPIRED IN THE LAST 90 DAYS</ThemedText>
              {access.expired.map((g) => (
                <View key={g.id} style={[st.grantRow, { borderTopColor: theme.border, alignItems: "center" }]}>
                  <View style={{ flex: 1 }}>
                    <ThemedText style={{ fontWeight: "700", color: theme.textSecondary }}>{capabilityLabel(base, g.capability ?? g.permission)}</ThemedText>
                    <ThemedText type="caption" style={{ color: theme.textSecondary }}>{g.scope_label} · ended {fmt(g.expires_at)}</ThemedText>
                  </View>
                  {base.canAssign ? <SecondaryButton label={`Renew ${RENEW_DAYS}d`} icon="refresh-cw" onPress={() => renew(g)} /> : null}
                </View>
              ))}
            </View>
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

/** Switches for the person's direct grants; template / manager access shown as notes. */
function DirectEditor({ access, onSaved }: { access: UserAccess; onSaved: () => Promise<void> }) {
  const base = useBase();
  const { theme } = useTheme();
  const direct = useMemo(
    () => new Set(access.grants.filter((g) => g.source === "USER" && g.capability).map((g) => g.capability as string)),
    [access],
  );
  const held = useMemo(() => {
    const map = new Map<string, string>();
    for (const g of access.grants) {
      if (g.source === "USER" || !g.capability) continue;
      map.set(g.capability, `Already from ${sourceLabel(g.source)} (${g.scope_label})`);
    }
    return map;
  }, [access]);
  const [selected, setSelected] = useState<Set<string>>(new Set(direct));
  const [scope, setScope] = useState("OFFICE");
  const [scopeId, setScopeId] = useState(access.user.office_id ?? "");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const adds = minimalSelection([...selected].filter((k) => !direct.has(k)), base.byKey);
  const removes = [...direct].filter((k) => !selected.has(k));
  const needsScope = adds.some((k) => base.byKey.get(k)?.scoped);

  const save = async () => {
    if (!adds.length && !removes.length) return setError("No changes.");
    if (reason.trim().length < 5) return setError("Enter a reason (5+ characters).");
    setBusy(true);
    setError(null);
    try {
      if (adds.length) {
        const res = await PermissionsApi.setAccessBulk(
          [access.user.id],
          adds.map((k) => (base.byKey.get(k)?.scoped ? { capability: k, scope, scope_id: scopeId || null } : { capability: k, scope: "GLOBAL" })),
          null,
          reason.trim(),
          false,
        );
        if (!res.success) throw new Error(res.results?.find((r) => r.status === "ERROR")?.message ?? res.message ?? "Not allowed.");
      }
      if (removes.length) {
        const res = await PermissionsApi.revokeAccessBulk([access.user.id], removes, reason.trim(), false);
        if (!res.success) throw new Error(res.results?.find((r) => r.status === "ERROR")?.message ?? res.message ?? "Not allowed.");
      }
      invalidatePermissionsCache();
      await onSaved();
    } catch (e: any) {
      setError(e?.message ?? "Not saved.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={[st.card, { backgroundColor: theme.backgroundSecondary }]}>
      <CapabilityToggles
        selected={selected}
        held={held}
        disabled={access.full_data_access}
        exclude={(cap) => cap.key.startsWith("permissions.") && !base.isRoleAdmin}
        onToggle={(key, on) =>
          setSelected((prev) => {
            const next = new Set(prev);
            if (on) next.add(key);
            else next.delete(key);
            return next;
          })
        }
      />
      {needsScope ? (
        <>
          <ThemedText style={st.label}>New access covers</ThemedText>
          <ScopePicker scope={scope} scopeId={scopeId} holderIds={[access.user.id]} treeLabel="Their own reporting tree" onChange={(s, id) => { setScope(s); setScopeId(id); }} />
        </>
      ) : null}
      <ThemedText type="caption" style={{ color: theme.textSecondary }}>
        {adds.length} to add · {removes.length} to remove
      </ThemedText>
      <TextInput
        value={reason}
        onChangeText={setReason}
        placeholder="Reason (required)"
        placeholderTextColor={theme.textSecondary}
        style={[st.input, { color: theme.text, borderColor: theme.border, marginTop: 8 }]}
      />
      {error ? <Hint icon="alert-circle" tone="error" text={error} /> : null}
      <PrimaryButton label="Save changes" onPress={() => void save()} busy={busy} disabled={!adds.length && !removes.length} />
    </View>
  );
}
