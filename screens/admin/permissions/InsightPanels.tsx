import React, { useCallback, useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Pressable, View } from "react-native";
import Feather from "@expo/vector-icons/Feather";
import { ThemedText } from "@/components/ThemedText";
import { useTheme } from "@/hooks/useTheme";
import { SearchableSelect, SelectOption } from "@/components/SearchableSelect";
import { PermissionsApi, sourceLabel } from "@/services/permissions.service";
import { Badge, Hint, PrimaryButton, SecondaryButton, capabilityLabel, fmt, st, useBase, usePersonOptions } from "./shared";

function useCapabilityOptions(includeAny: boolean): SelectOption[] {
  const base = useBase();
  return useMemo(() => {
    const list: SelectOption[] = base.catalog.modules.flatMap((m) =>
      m.capabilities.map((c) => ({ value: c.key, label: c.label, group: m.module, subtitle: c.description ?? undefined, icon: c.risk === "HIGH" ? "alert-triangle" : "key" }) as SelectOption),
    );
    return includeAny ? [{ value: "", label: "Any permission", icon: "layers" }, ...list] : list;
  }, [base.catalog, includeAny]);
}

// ─── Who can see this employee ──────────────────────────────────────────────

export function WhoCanSee({ onOpenPerson }: { onOpenPerson: (id: string) => void }) {
  const base = useBase();
  const { theme } = useTheme();
  const personOptions = usePersonOptions();
  const capabilityOptions = useCapabilityOptions(true);
  const [targetId, setTargetId] = useState("");
  const [capability, setCapability] = useState("");
  const [rows, setRows] = useState<any[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    if (!targetId) return;
    setLoading(true);
    setError(null);
    try {
      setRows(await PermissionsApi.whoCanAccess(targetId, capability || null));
    } catch (e: any) {
      setError(e?.message ?? "Could not load.");
    } finally {
      setLoading(false);
    }
  }, [targetId, capability]);
  useEffect(() => {
    void load();
  }, [load]);

  const admins = (rows ?? []).filter((r) => r.full_data_access);
  const others = (rows ?? []).filter((r) => !r.full_data_access);

  return (
    <View>
      <Hint icon="eye" text="Everyone who can see or act on one employee's data, and the exact reason." />
      <ThemedText style={st.label}>Employee</ThemedText>
      <SearchableSelect title="Whose data?" value={targetId} options={personOptions} onChange={setTargetId} placeholder="Choose an employee" />
      <ThemedText style={st.label}>Permission</ThemedText>
      <SearchableSelect title="Permission" value={capability} options={capabilityOptions} onChange={setCapability} placeholder="Any permission" />
      {error ? <Hint icon="alert-circle" tone="error" text={error} /> : null}
      {loading ? <ActivityIndicator color={theme.primary} style={{ marginTop: 16 }} /> : null}
      {rows && !loading ? (
        <>
          <View style={[st.card, { backgroundColor: theme.backgroundDefault }]}>
            <ThemedText style={st.sectionTitle}>Through grants, templates and the reporting tree · {others.length}</ThemedText>
            {others.length === 0 ? <ThemedText type="caption" style={{ color: theme.textSecondary, marginTop: 6 }}>Nobody.</ThemedText> : null}
            {others.map((r) => (
              <Pressable key={r.user_id} onPress={() => onOpenPerson(r.user_id)} style={[st.grantRow, { borderTopColor: theme.border, flexDirection: "column", gap: 4 }]}>
                <ThemedText style={{ fontWeight: "800" }}>{r.name} <ThemedText type="caption" style={{ color: theme.textSecondary }}>· {r.role}</ThemedText></ThemedText>
                {(r.via ?? []).map((v: any, i: number) => (
                  <View key={i} style={st.rowCenter}>
                    <Badge text={sourceLabel(v.source)} color={v.source === "USER" ? "#6D1B6D" : v.source === "MANAGER" ? "#047857" : "#2563EB"} />
                    <ThemedText type="caption" style={{ flex: 1 }}>
                      {capabilityLabel(base, v.capability)} · {v.scope_label}
                      {v.expires_at ? ` · until ${fmt(v.expires_at)}` : ""}
                    </ThemedText>
                  </View>
                ))}
              </Pressable>
            ))}
          </View>
          <View style={[st.card, { backgroundColor: theme.backgroundDefault }]}>
            <ThemedText style={st.sectionTitle}>Full data access (role) · {admins.length}</ThemedText>
            <ThemedText type="caption" style={{ color: theme.textSecondary, marginTop: 6 }}>
              {admins.map((a) => `${a.name} (${a.role})`).join(", ") || "Nobody."}
            </ThemedText>
          </View>
        </>
      ) : null}
    </View>
  );
}

// ─── Simulator ──────────────────────────────────────────────────────────────

export function Simulator() {
  const personOptions = usePersonOptions();
  const capabilityOptions = useCapabilityOptions(false);
  const [userId, setUserId] = useState("");
  const [capability, setCapability] = useState("attendance.view");
  const [targetId, setTargetId] = useState("");
  const [result, setResult] = useState<any>(null);
  const [running, setRunning] = useState(false);

  const run = async () => {
    if (!userId || !targetId) return setResult({ allowed: false, reason: "INPUT", explanation: "Choose both people." });
    setRunning(true);
    try {
      setResult(await PermissionsApi.explain(userId, capability, targetId));
    } catch (e: any) {
      setResult({ allowed: false, reason: "ERROR", explanation: e?.message });
    } finally {
      setRunning(false);
    }
  };

  return (
    <View>
      <Hint icon="zap" text="Can someone act on another employee? See the grant, template or reporting line that allows or blocks it." />
      <ThemedText style={st.label}>Who</ThemedText>
      <SearchableSelect title="Who is asking?" value={userId} options={personOptions} onChange={setUserId} />
      <ThemedText style={st.label}>Wants to</ThemedText>
      <SearchableSelect title="Permission" value={capability} options={capabilityOptions} onChange={setCapability} />
      <ThemedText style={st.label}>For employee</ThemedText>
      <SearchableSelect title="Target employee" value={targetId} options={personOptions} onChange={setTargetId} />
      <PrimaryButton label="Check access" onPress={() => void run()} busy={running} />
      {result ? (
        <View style={[st.card, { backgroundColor: result.allowed ? "#ECFDF5" : "#FEF2F2", borderColor: result.allowed ? "#10B981" : "#EF4444", borderWidth: 1, marginTop: 12 }]}>
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
          {(result.grants ?? []).map((g: any, i: number) => (
            <ThemedText key={i} type="caption" style={{ color: "#374151" }}>
              {g.covers_target ? "✓" : "✗"} {g.permission} · {g.scope_label} ({sourceLabel(g.source)})
            </ThemedText>
          ))}
        </View>
      ) : null}
    </View>
  );
}

// ─── History ────────────────────────────────────────────────────────────────

const PAGE = 50;

export function History() {
  const base = useBase();
  const { theme } = useTheme();
  const personOptions = usePersonOptions();
  const capabilityOptions = useCapabilityOptions(true);
  const [userId, setUserId] = useState("");
  const [actorId, setActorId] = useState("");
  const [capability, setCapability] = useState("");
  const [rows, setRows] = useState<any[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(
    async (offset: number) => {
      setLoading(true);
      setError(null);
      try {
        const res = await PermissionsApi.history({ userId: userId || null, actorId: actorId || null, capability: capability || null, limit: PAGE, offset });
        setRows((prev) => (offset ? [...prev, ...(res.rows ?? [])] : res.rows ?? []));
        setHasMore(!!res.has_more);
      } catch (e: any) {
        setError(e?.message ?? "Could not load history.");
      } finally {
        setLoading(false);
      }
    },
    [userId, actorId, capability],
  );
  useEffect(() => {
    void load(0);
  }, [load]);

  const anyone: SelectOption = { value: "", label: "Anyone", icon: "users" };

  return (
    <View>
      <View style={{ gap: 8 }}>
        <SearchableSelect title="Person changed" value={userId} options={[anyone, ...personOptions]} onChange={setUserId} placeholder="Any person" />
        <SearchableSelect title="Changed by" value={actorId} options={[anyone, ...personOptions]} onChange={setActorId} placeholder="Anyone" />
        <SearchableSelect title="Permission" value={capability} options={capabilityOptions} onChange={setCapability} placeholder="Any permission" />
      </View>
      {error ? <Hint icon="alert-circle" tone="error" text={error} /> : null}
      {!rows.length && !loading && !error ? <Hint icon="clock" text="No changes match." /> : null}
      <View style={[st.card, { backgroundColor: theme.backgroundDefault, marginTop: 10 }]}>
        {rows.map((r, i) => {
          const action = String(r.action ?? "").toUpperCase();
          const color = /REVOKE|DELETE|OFF/.test(action) ? "#DC2626" : /GRANT|ON$/.test(action) ? "#047857" : "#6B7280";
          const what =
            r.kind === "FULL_ACCESS"
              ? `${r.role}: full data access`
              : `${capabilityLabel(base, r.capability ?? r.permission)}${r.permission && r.capability && r.permission !== r.capability ? ` (${r.permission})` : ""}`;
          return (
            <View key={`${r.at}-${i}`} style={[st.grantRow, { borderTopColor: theme.border }]}>
              <View style={{ flex: 1 }}>
                <ThemedText style={{ fontWeight: "700" }}>
                  <ThemedText style={{ color, fontWeight: "800" }}>{action.replace(/_/g, " ") || "CHANGE"}</ThemedText> · {what}
                </ThemedText>
                <ThemedText type="caption" style={{ color: theme.textSecondary }}>
                  {r.kind === "USER" ? r.target_name ?? "—" : r.kind === "TEMPLATE" ? `Template: ${r.role === "@MANAGER" ? "Managers" : r.role}` : "Role setting"}
                  {r.scope_label ? ` · ${r.scope_label}` : ""}
                </ThemedText>
                <ThemedText type="caption" style={{ color: theme.textSecondary }}>
                  by {r.actor_name ?? "system"} · {fmt(r.at)}
                  {r.reason ? ` · “${r.reason}”` : ""}
                </ThemedText>
              </View>
            </View>
          );
        })}
      </View>
      {loading ? <ActivityIndicator color={theme.primary} /> : null}
      {hasMore && !loading ? <SecondaryButton label="Load more" icon="chevrons-down" onPress={() => void load(rows.length)} /> : null}
    </View>
  );
}
