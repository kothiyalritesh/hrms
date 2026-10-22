import React, { createContext, useContext, useMemo } from "react";
import { Pressable, StyleSheet, Switch, View } from "react-native";
import Feather from "@expo/vector-icons/Feather";
import { ThemedText } from "@/components/ThemedText";
import { useTheme } from "@/hooks/useTheme";
import { SearchableSelect, SelectOption } from "@/components/SearchableSelect";
import type { BulkRow, Capability, CatalogV2 } from "@/services/permissions.service";

// ─── Base data shared by every panel ────────────────────────────────────────

export type Person = {
  id: string;
  name: string;
  role: string | null;
  employee_number: string | null;
  department: string | null;
  office_id: string | null;
  team_id: string | null;
  reports_to: string | null;
  is_active: boolean | null;
};

export type PermissionBase = {
  catalog: CatalogV2;
  byKey: Map<string, Capability>;
  people: Person[];
  peopleById: Map<string, Person>;
  offices: { id: string; name: string }[];
  teams: { id: string; name: string; parent_id: string | null; office_id: string | null }[];
  departments: string[];
  canAssign: boolean;
  canRevoke: boolean;
  isRoleAdmin: boolean;
  myId: string | null;
};

const BaseContext = createContext<PermissionBase | null>(null);
export const BaseProvider = BaseContext.Provider;
export function useBase() {
  const base = useContext(BaseContext);
  if (!base) throw new Error("Permission base not loaded");
  return base;
}

export function buildByKey(catalog: CatalogV2) {
  const map = new Map<string, Capability>();
  for (const module of catalog.modules) for (const cap of module.capabilities) map.set(cap.key, cap);
  return map;
}

export function capabilityLabel(base: PermissionBase, key: string | null | undefined) {
  if (!key) return "Unknown permission";
  return base.byKey.get(key)?.label ?? key;
}

export function moduleOf(base: PermissionBase, key: string | null | undefined) {
  if (!key) return "Other";
  for (const m of base.catalog.modules) if (m.capabilities.some((c) => c.key === key)) return m.module;
  return "Other";
}

// ─── Scopes ─────────────────────────────────────────────────────────────────

export const SCOPE_TEXT: Record<string, string> = {
  GLOBAL: "All employees",
  OFFICE: "One office",
  OFFICE_TREE: "Office + its teams",
  TEAM: "One team",
  TEAM_TREE: "Team + sub-teams",
  REPORTS_TO: "Reporting tree",
  DEPARTMENT: "One department",
};
export const GRANT_SCOPES = ["GLOBAL", "OFFICE", "OFFICE_TREE", "TEAM", "TEAM_TREE", "REPORTS_TO", "DEPARTMENT"];
export const NEEDS_TARGET = ["OFFICE", "OFFICE_TREE", "TEAM", "TEAM_TREE", "DEPARTMENT"];

/** People a scope covers, worked out from the loaded org data (same rules as the server). */
export function scopeMembers(base: PermissionBase, scope: string, scopeId: string | null, holderId: string | null): Set<string> {
  const ids = new Set<string>();
  const active = base.people;
  if (scope === "GLOBAL") {
    active.forEach((p) => ids.add(p.id));
  } else if (scope === "OFFICE") {
    active.forEach((p) => p.office_id === scopeId && ids.add(p.id));
  } else if (scope === "OFFICE_TREE") {
    const teamIds = new Set(base.teams.filter((t) => t.office_id === scopeId).map((t) => t.id));
    active.forEach((p) => (p.office_id === scopeId || (p.team_id && teamIds.has(p.team_id))) && ids.add(p.id));
  } else if (scope === "TEAM") {
    active.forEach((p) => p.team_id === scopeId && ids.add(p.id));
  } else if (scope === "TEAM_TREE") {
    const tree = new Set<string>(scopeId ? [scopeId] : []);
    let grew = true;
    while (grew) {
      grew = false;
      for (const t of base.teams) if (t.parent_id && tree.has(t.parent_id) && !tree.has(t.id)) { tree.add(t.id); grew = true; }
    }
    active.forEach((p) => p.team_id && tree.has(p.team_id) && ids.add(p.id));
  } else if (scope === "REPORTS_TO") {
    const root = scopeId || holderId;
    if (!root) return ids;
    const children = new Map<string, string[]>();
    active.forEach((p) => p.reports_to && children.set(p.reports_to, [...(children.get(p.reports_to) ?? []), p.id]));
    const stack = [...(children.get(root) ?? [])];
    while (stack.length) {
      const id = stack.pop()!;
      if (ids.has(id) || id === root) continue;
      ids.add(id);
      stack.push(...(children.get(id) ?? []));
    }
  } else if (scope === "DEPARTMENT") {
    const want = String(scopeId ?? "").trim().toLowerCase();
    active.forEach((p) => want && String(p.department ?? "").trim().toLowerCase() === want && ids.add(p.id));
  }
  return ids;
}

export function scopeTargetOptions(base: PermissionBase, scope: string, personOptions: SelectOption[]): SelectOption[] {
  if (scope === "OFFICE" || scope === "OFFICE_TREE") return base.offices.map((o) => ({ value: o.id, label: o.name, icon: "home" }));
  if (scope === "TEAM" || scope === "TEAM_TREE") return base.teams.map((t) => ({ value: t.id, label: t.name, icon: "users" }));
  if (scope === "DEPARTMENT") return base.departments.map((d) => ({ value: d, label: d, icon: "briefcase" }));
  if (scope === "REPORTS_TO") return personOptions;
  return [];
}

export function usePersonOptions(): SelectOption[] {
  const base = useBase();
  return useMemo(
    () =>
      base.people.map((p) => ({
        value: p.id,
        label: p.name || "Unnamed",
        subtitle: [p.role, p.employee_number, p.is_active === false ? "inactive" : null].filter(Boolean).join(" · "),
        icon: "user" as const,
      })),
    [base.people],
  );
}

/** Scope chips + target picker + "covers N people" for the holders given. */
export function ScopePicker({
  scope,
  scopeId,
  onChange,
  holderIds,
  allowedScopes = GRANT_SCOPES,
  treeLabel = "Each person's own reporting tree",
}: {
  scope: string;
  scopeId: string;
  onChange: (scope: string, scopeId: string) => void;
  holderIds: string[];
  allowedScopes?: string[];
  treeLabel?: string;
}) {
  const base = useBase();
  const { theme } = useTheme();
  const personOptions = usePersonOptions();
  const coverage = useMemo(() => {
    if (NEEDS_TARGET.includes(scope) && !scopeId) return null;
    const holders = scope === "REPORTS_TO" && !scopeId ? holderIds : [holderIds[0] ?? null];
    const counts = holders.map((h) => scopeMembers(base, scope, scopeId || null, h).size);
    if (!counts.length) return null;
    const min = Math.min(...counts);
    const max = Math.max(...counts);
    return min === max ? `${min}` : `${min}–${max}`;
  }, [base, scope, scopeId, holderIds]);

  return (
    <View>
      <Chips
        options={allowedScopes.map((s) => ({ value: s, label: SCOPE_TEXT[s] ?? s }))}
        value={scope}
        onChange={(value) => onChange(value, "")}
      />
      {scope === "REPORTS_TO" ? (
        <SearchableSelect
          title="Whose reporting tree?"
          value={scopeId}
          options={[{ value: "", label: treeLabel, icon: "git-branch" }, ...personOptions]}
          onChange={(value) => onChange(scope, value)}
        />
      ) : NEEDS_TARGET.includes(scope) ? (
        <SearchableSelect
          title={SCOPE_TEXT[scope]}
          value={scopeId}
          options={scopeTargetOptions(base, scope, personOptions)}
          onChange={(value) => onChange(scope, value)}
          placeholder="Choose…"
        />
      ) : null}
      {coverage !== null ? (
        <ThemedText type="caption" style={{ color: theme.textSecondary, marginTop: -4, marginBottom: 10 }}>
          Covers {coverage} {coverage === "1" ? "person" : "people"}
          {scope === "REPORTS_TO" && !scopeId ? " (each person's own tree; follows the org chart)" : ""}
        </ThemedText>
      ) : null}
    </View>
  );
}

// ─── Capability toggles grouped by module ───────────────────────────────────

/**
 * One switch per capability. Capabilities included by a selected one (e.g.
 * View inside Approve) show as on and locked, with the reason.
 */
export function CapabilityToggles({
  selected,
  onToggle,
  exclude,
  disabled,
  held,
}: {
  selected: Set<string>;
  onToggle: (key: string, on: boolean) => void;
  exclude?: (cap: Capability) => boolean;
  disabled?: boolean;
  held?: Map<string, string>; // key -> short note (e.g. "via Manager")
}) {
  const base = useBase();
  const { theme } = useTheme();
  const includedBy = useMemo(() => {
    const map = new Map<string, string>();
    for (const key of selected) {
      const stack = [...(base.byKey.get(key)?.implies ?? [])];
      while (stack.length) {
        const next = stack.pop()!;
        if (!map.has(next)) {
          map.set(next, base.byKey.get(key)?.label ?? key);
          stack.push(...(base.byKey.get(next)?.implies ?? []));
        }
      }
    }
    return map;
  }, [selected, base.byKey]);

  return (
    <View>
      {base.catalog.modules.map((module) => {
        const caps = module.capabilities.filter((c) => !exclude?.(c));
        if (!caps.length) return null;
        return (
          <View key={module.module} style={[st.card, { backgroundColor: theme.backgroundDefault }]}>
            <ThemedText style={[st.moduleTitle, { color: theme.textSecondary }]}>{module.module.toUpperCase()}</ThemedText>
            {caps.map((cap) => {
              const on = selected.has(cap.key);
              const included = !on && includedBy.has(cap.key);
              const note = held?.get(cap.key);
              return (
                <View key={cap.key} style={[st.toggleRow, { borderTopColor: theme.border }]}>
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <View style={st.rowCenter}>
                      <ThemedText style={{ fontWeight: "700", flexShrink: 1 }}>{cap.label}</ThemedText>
                      <LevelTag level={cap.level} />
                      {cap.risk === "HIGH" ? <Feather name="alert-triangle" size={13} color="#DC2626" /> : null}
                    </View>
                    {cap.description ? (
                      <ThemedText type="caption" style={{ color: theme.textSecondary }}>{cap.description}</ThemedText>
                    ) : null}
                    {included ? (
                      <ThemedText type="caption" style={{ color: theme.primary, marginTop: 2 }}>
                        Included in “{includedBy.get(cap.key)}”
                      </ThemedText>
                    ) : null}
                    {note ? <ThemedText type="caption" style={{ color: "#047857", marginTop: 2 }}>{note}</ThemedText> : null}
                    {!cap.scoped ? (
                      <ThemedText type="caption" style={{ color: theme.textSecondary, marginTop: 2 }}>Company-wide setting</ThemedText>
                    ) : null}
                  </View>
                  <Switch
                    value={on || included}
                    disabled={disabled || included}
                    onValueChange={(value) => onToggle(cap.key, value)}
                    accessibilityLabel={cap.label}
                  />
                </View>
              );
            })}
          </View>
        );
      })}
    </View>
  );
}

export function LevelTag({ level }: { level: string }) {
  const color = level === "VIEW" ? "#2563EB" : level === "EXPORT" ? "#0891B2" : level === "APPROVE" ? "#7C3AED" : "#B45309";
  return <Badge text={level.charAt(0) + level.slice(1).toLowerCase()} color={color} />;
}

// ─── Bulk results ───────────────────────────────────────────────────────────

const STATUS_COLOR: Record<string, string> = {
  OK: "#047857",
  ADDED: "#047857",
  EXTENDED: "#2563EB",
  UNCHANGED: "#6B7280",
  NOTHING_TO_REVOKE: "#6B7280",
  ERROR: "#DC2626",
};
const STATUS_TEXT: Record<string, string> = {
  OK: "Ready",
  ADDED: "Added",
  EXTENDED: "Extended",
  UNCHANGED: "Already had it",
  NOTHING_TO_REVOKE: "Nothing to remove",
  ERROR: "Not allowed",
};

/** Per-person outcome of a bulk preview or apply, errors first. */
export function ResultList({ rows, revoke }: { rows: BulkRow[]; revoke?: boolean }) {
  const base = useBase();
  const { theme } = useTheme();
  const grouped = useMemo(() => {
    const map = new Map<string, BulkRow[]>();
    for (const row of rows) map.set(row.user_id, [...(map.get(row.user_id) ?? []), row]);
    return Array.from(map.entries()).sort(
      ([, a], [, b]) => Number(b.some((r) => r.status === "ERROR")) - Number(a.some((r) => r.status === "ERROR")),
    );
  }, [rows]);

  return (
    <View style={[st.card, { backgroundColor: theme.backgroundDefault }]}>
      {grouped.map(([userId, items]) => (
        <View key={userId} style={[st.grantRow, { borderTopColor: theme.border, flexDirection: "column", gap: 4 }]}>
          <ThemedText style={{ fontWeight: "800" }}>{base.peopleById.get(userId)?.name ?? userId}</ThemedText>
          {items.map((r, i) => (
            <View key={i} style={st.rowCenter}>
              <Badge text={STATUS_TEXT[r.status] ?? r.status} color={STATUS_COLOR[r.status] ?? "#6B7280"} />
              <ThemedText type="caption" style={{ flex: 1, color: theme.text }}>
                {capabilityLabel(base, r.capability)}
                {r.scope_label ? ` · ${r.scope_label}` : ""}
                {revoke && r.grants ? ` · ${r.grants} grant${r.grants === 1 ? "" : "s"}` : ""}
                {r.message ? ` — ${r.message}` : ""}
                {r.still_from?.length ? ` — still has it from ${r.still_from.join(", ")}` : ""}
              </ThemedText>
            </View>
          ))}
        </View>
      ))}
    </View>
  );
}

// ─── Small UI pieces ────────────────────────────────────────────────────────

export const DURATIONS: { label: string; hours: number | null }[] = [
  { label: "Permanent", hours: null },
  { label: "1 day", hours: 24 },
  { label: "7 days", hours: 24 * 7 },
  { label: "30 days", hours: 24 * 30 },
  { label: "90 days", hours: 24 * 90 },
];

const DATE_TIME = new Intl.DateTimeFormat("en-IN", {
  timeZone: "Asia/Kolkata",
  day: "2-digit",
  month: "short",
  year: "numeric",
  hour: "numeric",
  minute: "2-digit",
  hour12: true,
});
export const fmt = (value?: string | null) => (value ? DATE_TIME.format(new Date(value)) : "");

export function expiryFrom(duration: number | null | "custom", customUntil: string): { value: string | null; error?: string } {
  if (duration === "custom") {
    if (!customUntil) return { value: null, error: "Choose the last day of access." };
    return { value: new Date(`${customUntil}T23:59:59+05:30`).toISOString() };
  }
  if (typeof duration === "number") return { value: new Date(Date.now() + duration * 3_600_000).toISOString() };
  return { value: null };
}

export function Chips({ options, value, onChange }: { options: { value: string; label: string }[]; value: string; onChange: (v: string) => void }) {
  const { theme } = useTheme();
  return (
    <View style={st.chips}>
      {options.map((o) => {
        const active = o.value === value;
        return (
          <Pressable
            key={o.value}
            onPress={() => onChange(o.value)}
            accessibilityRole="button"
            accessibilityState={{ selected: active }}
            style={[st.chip, { borderColor: active ? theme.primary : theme.border, backgroundColor: active ? theme.primary : "transparent" }]}
          >
            <ThemedText style={{ fontSize: 12, fontWeight: "600", color: active ? "#fff" : theme.text }}>{o.label}</ThemedText>
          </Pressable>
        );
      })}
    </View>
  );
}

export function Badge({ text, color }: { text: string; color: string }) {
  return (
    <View style={[st.badge, { backgroundColor: color + "1A" }]}>
      <ThemedText style={{ fontSize: 11, fontWeight: "700", color }}>{text}</ThemedText>
    </View>
  );
}

export function Hint({ icon, text, tone }: { icon: keyof typeof Feather.glyphMap; text: string; tone?: "warn" | "error" }) {
  const { theme } = useTheme();
  const color = tone === "error" ? "#DC2626" : tone === "warn" ? "#B45309" : theme.textSecondary;
  return (
    <View style={[st.hint, { backgroundColor: tone ? color + "14" : theme.backgroundSecondary }]}>
      <Feather name={icon} size={15} color={color} />
      <ThemedText type="caption" style={{ color: tone ? color : theme.textSecondary, flex: 1, lineHeight: 18 }}>{text}</ThemedText>
    </View>
  );
}

export function PrimaryButton({ label, onPress, busy, disabled, tone }: { label: string; onPress: () => void; busy?: boolean; disabled?: boolean; tone?: "danger" }) {
  const { theme } = useTheme();
  const off = busy || disabled;
  return (
    <Pressable
      onPress={onPress}
      disabled={off}
      accessibilityRole="button"
      style={[st.primaryBtn, { backgroundColor: tone === "danger" ? "#DC2626" : theme.primary, opacity: off ? 0.55 : 1 }]}
    >
      <ThemedText style={st.primaryBtnText}>{busy ? "Working…" : label}</ThemedText>
    </Pressable>
  );
}

export function SecondaryButton({ label, icon, onPress }: { label: string; icon?: keyof typeof Feather.glyphMap; onPress: () => void }) {
  const { theme } = useTheme();
  return (
    <Pressable onPress={onPress} accessibilityRole="button" style={[st.secondaryBtn, { borderColor: theme.border }]}>
      {icon ? <Feather name={icon} size={14} color={theme.text} /> : null}
      <ThemedText style={{ fontWeight: "700", fontSize: 13 }}>{label}</ThemedText>
    </Pressable>
  );
}

export const st = StyleSheet.create({
  center: { flex: 1, alignItems: "center", justifyContent: "center", padding: 24 },
  label: { fontWeight: "700", fontSize: 13, marginBottom: 6, marginTop: 4 },
  card: { borderRadius: 14, padding: 14, marginBottom: 12, overflow: "hidden" },
  cardTitle: { fontSize: 17, fontWeight: "800" },
  sectionTitle: { fontSize: 15, fontWeight: "800" },
  moduleTitle: { fontSize: 11, fontWeight: "800", letterSpacing: 0.6, marginBottom: 4 },
  rowBetween: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginVertical: 10, gap: 8, flexWrap: "wrap" },
  rowCenter: { flexDirection: "row", alignItems: "center", gap: 8, flexWrap: "wrap" },
  grantRow: { flexDirection: "row", alignItems: "flex-start", gap: 8, paddingVertical: 10, borderTopWidth: StyleSheet.hairlineWidth },
  toggleRow: { flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 10, borderTopWidth: StyleSheet.hairlineWidth },
  badges: { flexDirection: "row", flexWrap: "wrap", gap: 6, marginTop: 6 },
  badge: { paddingHorizontal: 8, paddingVertical: 2, borderRadius: 10 },
  iconBtn: { minWidth: 44, minHeight: 44, alignItems: "center", justifyContent: "center", borderRadius: 10 },
  primaryBtn: { minHeight: 48, borderRadius: 10, alignItems: "center", justifyContent: "center", marginTop: 8, paddingHorizontal: 16 },
  primaryBtnText: { color: "#fff", fontWeight: "800" },
  secondaryBtn: { flexDirection: "row", alignItems: "center", gap: 6, borderWidth: 1, borderRadius: 10, paddingHorizontal: 12, minHeight: 40 },
  input: { borderWidth: 1, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, minHeight: 48, marginBottom: 10, fontSize: 16 },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 6, marginBottom: 12 },
  chip: { borderWidth: 1, borderRadius: 18, paddingHorizontal: 12, minHeight: 36, justifyContent: "center" },
  hint: { flexDirection: "row", gap: 8, padding: 12, borderRadius: 10, marginVertical: 8, alignItems: "flex-start" },
  error: { color: "#DC2626", marginBottom: 8 },
});
