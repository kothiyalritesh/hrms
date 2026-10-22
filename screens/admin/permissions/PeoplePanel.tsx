import React, { useMemo, useState } from "react";
import { Alert, Pressable, TextInput, View } from "react-native";
import Feather from "@expo/vector-icons/Feather";
import { ThemedText } from "@/components/ThemedText";
import { useTheme } from "@/hooks/useTheme";
import { SearchableSelect } from "@/components/SearchableSelect";
import { DateInput } from "@/components/DateInput";
import { invalidatePermissionsCache } from "@/hooks/usePermissions";
import { BulkResult, GrantInput, PermissionsApi, minimalSelection } from "@/services/permissions.service";
import {
  CapabilityToggles,
  Chips,
  DURATIONS,
  Hint,
  NEEDS_TARGET,
  PrimaryButton,
  ResultList,
  ScopePicker,
  SecondaryButton,
  expiryFrom,
  scopeMembers,
  st,
  useBase,
  usePersonOptions,
} from "./shared";

type Mode = "ADD" | "REMOVE" | "COPY";
const PAGE = 60;

/**
 * Several people × several permissions in one change:
 * choose people (filters, select all) → choose permissions (one switch per
 * capability; View included automatically) → scope / duration / reason →
 * Review (server dry run, per person) → Apply (one atomic server call).
 */
export function PeoplePanel({ onOpenPerson }: { onOpenPerson: (id: string) => void }) {
  const base = useBase();
  const { theme } = useTheme();
  const personOptions = usePersonOptions();

  // people + filters
  const [search, setSearch] = useState("");
  const [officeId, setOfficeId] = useState("");
  const [role, setRole] = useState("");
  const [treeOf, setTreeOf] = useState("");
  const [showInactive, setShowInactive] = useState(false);
  const [limit, setLimit] = useState(PAGE);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  // change
  const [mode, setMode] = useState<Mode>("ADD");
  const [caps, setCaps] = useState<Set<string>>(new Set());
  const [scope, setScope] = useState("OFFICE");
  const [scopeId, setScopeId] = useState("");
  const [copyFrom, setCopyFrom] = useState("");
  const [duration, setDuration] = useState<number | null | "custom">(null);
  const [customUntil, setCustomUntil] = useState("");
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<BulkResult | null>(null);
  const [result, setResult] = useState<BulkResult | null>(null);
  const [busy, setBusy] = useState(false);

  const roles = useMemo(
    () => Array.from(new Set(base.people.map((p) => String(p.role ?? "").toUpperCase()).filter(Boolean))).sort(),
    [base.people],
  );

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const tree = treeOf ? scopeMembers(base, "REPORTS_TO", treeOf, treeOf) : null;
    return base.people.filter(
      (p) =>
        (showInactive || p.is_active !== false) &&
        (!officeId || p.office_id === officeId) &&
        (!role || String(p.role ?? "").toUpperCase() === role) &&
        (!tree || tree.has(p.id)) &&
        (!q || `${p.name} ${p.employee_number ?? ""} ${p.role ?? ""} ${p.department ?? ""}`.toLowerCase().includes(q)),
    );
  }, [base, search, officeId, role, treeOf, showInactive]);

  const selectedIds = useMemo(() => Array.from(selected), [selected]);
  const minimal = useMemo(() => minimalSelection(caps, base.byKey), [caps, base.byKey]);
  const anyScoped = minimal.some((k) => base.byKey.get(k)?.scoped);
  const anyHigh = minimal.some((k) => base.byKey.get(k)?.risk === "HIGH");

  const resetOutcome = () => {
    setPreview(null);
    setResult(null);
    setError(null);
  };
  const toggleSelected = (id: string) => {
    resetOutcome();
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const grants = (): GrantInput[] =>
    minimal.map((key) =>
      base.byKey.get(key)?.scoped
        ? { capability: key, scope, scope_id: scopeId || null }
        : { capability: key, scope: "GLOBAL", scope_id: null },
    );

  const validate = (): string | null => {
    if (!selectedIds.length) return "Choose at least one person.";
    if (mode === "COPY") return copyFrom ? null : "Choose whose access to copy.";
    if (!minimal.length) return "Turn on at least one permission.";
    if (mode === "ADD" && anyScoped && NEEDS_TARGET.includes(scope) && !scopeId) return "Choose who the scope covers.";
    if (mode !== "REMOVE" && anyHigh && reason.trim().length < 5) return "High-risk access: enter a reason (5+ characters).";
    if (mode === "REMOVE" && reason.trim().length < 3) return "Enter a reason for removing access.";
    return null;
  };

  const run = async (dryRun: boolean) => {
    const problem = validate();
    if (problem) return setError(problem);
    const expiry = expiryFrom(duration, customUntil);
    if (expiry.error) return setError(expiry.error);
    setBusy(true);
    setError(null);
    try {
      const response =
        mode === "ADD"
          ? await PermissionsApi.setAccessBulk(selectedIds, grants(), expiry.value, reason.trim() || null, dryRun)
          : mode === "REMOVE"
            ? await PermissionsApi.revokeAccessBulk(selectedIds, minimal, reason.trim() || null, dryRun)
            : await PermissionsApi.copyAccess(copyFrom, selectedIds, reason.trim() || null, expiry.value, dryRun);
      if (dryRun) {
        setPreview(response);
        setResult(null);
      } else {
        setResult(response);
        setPreview(null);
        if (response.success) invalidatePermissionsCache();
      }
      if (!response.success && response.message && !response.results?.length) setError(response.message);
    } catch (e: any) {
      setError(e?.message ?? "The server did not answer.");
    } finally {
      setBusy(false);
    }
  };

  const canAct = mode === "REMOVE" ? base.canRevoke : base.canAssign;
  const shown = filtered.slice(0, limit);

  return (
    <View>
      {/* 1. People */}
      <ThemedText style={st.sectionTitle}>1 · People</ThemedText>
      <TextInput
        value={search}
        onChangeText={setSearch}
        placeholder="Search name, employee no., role, department"
        placeholderTextColor={theme.textSecondary}
        style={[st.input, { color: theme.text, borderColor: theme.border, marginTop: 8 }]}
      />
      <View style={{ gap: 8 }}>
        <SearchableSelect
          title="Office"
          value={officeId}
          options={[{ value: "", label: "All offices", icon: "globe" }, ...base.offices.map((o) => ({ value: o.id, label: o.name, icon: "home" as const }))]}
          onChange={setOfficeId}
          placeholder="All offices"
        />
        <SearchableSelect
          title="Role"
          value={role}
          options={[{ value: "", label: "All roles", icon: "layers" }, ...roles.map((r) => ({ value: r, label: r, icon: "tag" as const }))]}
          onChange={setRole}
          placeholder="All roles"
        />
        <SearchableSelect
          title="In the reporting tree of"
          value={treeOf}
          options={[{ value: "", label: "Anyone", icon: "git-branch" }, ...personOptions]}
          onChange={setTreeOf}
          placeholder="Anyone (no manager filter)"
        />
      </View>
      <View style={st.rowBetween}>
        <ThemedText type="caption" style={{ color: theme.textSecondary }}>
          {filtered.length} shown · {selected.size} selected
        </ThemedText>
        <View style={st.rowCenter}>
          <SecondaryButton
            label={`Select ${filtered.length}`}
            icon="check-square"
            onPress={() => {
              resetOutcome();
              setSelected((prev) => new Set([...prev, ...filtered.map((p) => p.id)]));
            }}
          />
          <SecondaryButton label="Clear" icon="x" onPress={() => { resetOutcome(); setSelected(new Set()); }} />
          <SecondaryButton label={showInactive ? "Hide inactive" : "Show inactive"} onPress={() => setShowInactive((v) => !v)} />
        </View>
      </View>
      <View style={[st.card, { backgroundColor: theme.backgroundDefault, paddingVertical: 4 }]}>
        {shown.map((p) => {
          const on = selected.has(p.id);
          return (
            <View key={p.id} style={[st.grantRow, { borderTopColor: theme.border, alignItems: "center" }]}>
              <Pressable
                onPress={() => toggleSelected(p.id)}
                style={[st.rowCenter, { flex: 1, minHeight: 40, flexWrap: "nowrap" }]}
                accessibilityRole="checkbox"
                accessibilityState={{ checked: on }}
                accessibilityLabel={p.name}
              >
                <Feather name={on ? "check-square" : "square"} size={20} color={on ? theme.primary : theme.textSecondary} />
                <View style={{ flex: 1, minWidth: 0 }}>
                  <ThemedText numberOfLines={1} style={{ fontWeight: "700" }}>{p.name}</ThemedText>
                  <ThemedText type="caption" numberOfLines={1} style={{ color: theme.textSecondary }}>
                    {[p.role, p.employee_number, p.is_active === false ? "inactive" : null].filter(Boolean).join(" · ")}
                  </ThemedText>
                </View>
              </Pressable>
              <Pressable onPress={() => onOpenPerson(p.id)} hitSlop={8} style={st.iconBtn} accessibilityLabel={`Access of ${p.name}`}>
                <Feather name="eye" size={17} color={theme.primary} />
              </Pressable>
            </View>
          );
        })}
        {filtered.length > limit ? (
          <Pressable onPress={() => setLimit((n) => n + PAGE)} style={{ paddingVertical: 12, alignItems: "center" }}>
            <ThemedText style={{ color: theme.primary, fontWeight: "700" }}>Show {Math.min(PAGE, filtered.length - limit)} more</ThemedText>
          </Pressable>
        ) : null}
        {!filtered.length ? <Hint icon="search" text="Nobody matches these filters." /> : null}
      </View>

      {/* 2. What */}
      <ThemedText style={[st.sectionTitle, { marginTop: 8 }]}>2 · Change</ThemedText>
      <Chips
        options={[
          { value: "ADD", label: "Give access" },
          { value: "REMOVE", label: "Remove access" },
          { value: "COPY", label: "Copy from a person" },
        ]}
        value={mode}
        onChange={(value) => {
          resetOutcome();
          setMode(value as Mode);
        }}
      />
      {!canAct ? (
        <Hint icon="lock" text={mode === "REMOVE" ? "You need the Revoke permissions right." : "You need the Grant permissions right."} />
      ) : null}

      {mode === "COPY" ? (
        <>
          <SearchableSelect title="Copy the direct access of" value={copyFrom} options={personOptions} onChange={(v) => { resetOutcome(); setCopyFrom(v); }} placeholder="Choose a person" />
          <Hint icon="copy" text="Copies their direct grants (same scopes) to everyone selected. Role and Manager templates are not copied; they already follow the role and the org chart." />
        </>
      ) : (
        <CapabilityToggles
          selected={caps}
          onToggle={(key, on) => {
            resetOutcome();
            setCaps((prev) => {
              const next = new Set(prev);
              if (on) next.add(key);
              else next.delete(key);
              return next;
            });
          }}
          exclude={(cap) => cap.key.startsWith("permissions.") && !base.isRoleAdmin}
        />
      )}

      {/* 3. Scope, duration, reason */}
      {mode === "ADD" && anyScoped ? (
        <>
          <ThemedText style={st.label}>For which employees</ThemedText>
          <ScopePicker
            scope={scope}
            scopeId={scopeId}
            holderIds={selectedIds}
            onChange={(s, id) => { resetOutcome(); setScope(s); setScopeId(id); }}
          />
        </>
      ) : null}
      {mode !== "REMOVE" ? (
        <>
          <ThemedText style={st.label}>How long</ThemedText>
          <Chips
            options={[...DURATIONS.map((d) => ({ value: String(d.hours), label: d.label })), { value: "custom", label: "Until date" }]}
            value={String(duration)}
            onChange={(value) => { resetOutcome(); setDuration(value === "custom" ? "custom" : value === "null" ? null : Number(value)); }}
          />
          {duration === "custom" ? (
            <DateInput value={customUntil} onChange={setCustomUntil} min={new Date().toISOString().slice(0, 10)} style={[st.input, { color: theme.text, borderColor: theme.border }]} />
          ) : null}
        </>
      ) : null}
      <ThemedText style={st.label}>Reason {mode === "REMOVE" || anyHigh ? "(required)" : "(optional)"}</ThemedText>
      <TextInput
        value={reason}
        onChangeText={(v) => { setReason(v); setPreview(null); }}
        placeholder="e.g. Covering Noida HR during leave"
        placeholderTextColor={theme.textSecondary}
        style={[st.input, { color: theme.text, borderColor: theme.border }]}
      />

      {error ? <Hint icon="alert-circle" tone="error" text={error} /> : null}

      {/* 4. Review → Apply */}
      {!preview ? (
        <PrimaryButton
          label={`Review changes for ${selected.size} ${selected.size === 1 ? "person" : "people"}`}
          onPress={() => void run(true)}
          busy={busy}
          disabled={!canAct}
        />
      ) : (
        <View style={{ marginTop: 8 }}>
          <ThemedText style={st.sectionTitle}>Review</ThemedText>
          {preview.success ? (
            <Hint icon="check-circle" text="Everything below is allowed. Nothing is saved until you apply." />
          ) : (
            <Hint icon="alert-triangle" tone="error" text={preview.message ?? "Some changes are not allowed. Fix them or remove those people; nothing was saved."} />
          )}
          <ResultList rows={preview.results ?? []} revoke={mode === "REMOVE"} />
          <PrimaryButton
            label={mode === "REMOVE" ? "Remove access" : "Apply to everyone"}
            tone={mode === "REMOVE" ? "danger" : undefined}
            disabled={!preview.success}
            busy={busy}
            onPress={() =>
              mode === "REMOVE"
                ? Alert.alert("Remove access?", `This removes the direct grants shown for ${selected.size} people.`, [
                    { text: "Cancel", style: "cancel" },
                    { text: "Remove", style: "destructive", onPress: () => void run(false) },
                  ])
                : void run(false)
            }
          />
        </View>
      )}

      {result ? (
        <View style={{ marginTop: 12 }}>
          <Hint
            icon={result.success ? "check-circle" : "alert-triangle"}
            tone={result.success ? undefined : "error"}
            text={
              result.success
                ? mode === "REMOVE"
                  ? `Removed ${result.revoked ?? 0} grant(s). Their app updates within seconds.`
                  : `Saved: ${result.added ?? 0} added, ${result.extended ?? 0} extended, ${result.unchanged ?? 0} already in place. Their app updates within seconds.`
                : result.message ?? "Nothing was saved."
            }
          />
          <ResultList rows={result.results ?? []} revoke={mode === "REMOVE"} />
        </View>
      ) : null}
    </View>
  );
}
