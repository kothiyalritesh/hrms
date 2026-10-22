import React, { useCallback, useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, TextInput, View } from "react-native";
import { ThemedText } from "@/components/ThemedText";
import { useTheme } from "@/hooks/useTheme";
import { SearchableSelect } from "@/components/SearchableSelect";
import { MatrixRow, PermissionsApi } from "@/services/permissions.service";
import { Hint, st, useBase } from "./shared";

const LEVEL_RANK: Record<string, number> = { VIEW: 1, EXPORT: 2, APPROVE: 3, MANAGE: 4 };
const LEVEL_SHORT: Record<string, string> = { VIEW: "View", EXPORT: "Export", APPROVE: "Approve", MANAGE: "Manage" };
const LEVEL_COLOR: Record<string, string> = { VIEW: "#2563EB", EXPORT: "#0891B2", APPROVE: "#7C3AED", MANAGE: "#B45309" };
const MAX_ROWS = 150;

/**
 * People × modules: the highest level each person holds per module and where
 * it comes from (D = direct, T = role template, M = Manager tree). Tap a row to
 * open their effective access; change many people at once in People.
 */
export function MatrixView({ onOpenPerson }: { onOpenPerson: (id: string) => void }) {
  const base = useBase();
  const { theme } = useTheme();
  const [search, setSearch] = useState("");
  const [officeId, setOfficeId] = useState("");
  const [rows, setRows] = useState<Map<string, MatrixRow>>(new Map());
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const people = useMemo(() => {
    const q = search.trim().toLowerCase();
    return base.people
      .filter((p) => p.is_active !== false && (!officeId || p.office_id === officeId))
      .filter((p) => !q || `${p.name} ${p.role ?? ""} ${p.employee_number ?? ""}`.toLowerCase().includes(q))
      .slice(0, MAX_ROWS);
  }, [base.people, search, officeId]);
  const ids = useMemo(() => people.map((p) => p.id).join(","), [people]);

  const load = useCallback(async () => {
    if (!ids) return setRows(new Map());
    setLoading(true);
    setError(null);
    try {
      const data = await PermissionsApi.matrix(ids.split(","));
      setRows(new Map((data ?? []).map((r) => [r.user_id, r])));
    } catch (e: any) {
      setError(e?.message ?? "Could not load the matrix.");
    } finally {
      setLoading(false);
    }
  }, [ids]);

  useEffect(() => {
    const timer = setTimeout(() => void load(), 300);
    return () => clearTimeout(timer);
  }, [load]);

  const modules = base.catalog.modules.filter((m) => m.module !== "Permissions");

  const cell = (row: MatrixRow | undefined, module: string) => {
    if (!row) return null;
    if (row.full_data_access) return { text: "Full", color: "#7C3AED", src: "" };
    const caps = base.catalog.modules.find((m) => m.module === module)?.capabilities ?? [];
    let best: { level: string; sources: Set<string> } | null = null;
    for (const g of row.grants) {
      const cap = caps.find((c) => c.key === g.capability);
      if (!cap) continue;
      const src = g.source === "USER" ? "D" : g.source === "MANAGER" ? "M" : "T";
      if (!best || LEVEL_RANK[cap.level] > LEVEL_RANK[best.level]) best = { level: cap.level, sources: new Set([src]) };
      else if (LEVEL_RANK[cap.level] === LEVEL_RANK[best.level]) best.sources.add(src);
    }
    return best ? { text: LEVEL_SHORT[best.level], color: LEVEL_COLOR[best.level], src: [...best.sources].sort().join("") } : null;
  };

  return (
    <View>
      <Hint icon="grid" text="Highest level per module. D = direct grant, T = role template, M = manager (reporting tree). Tap a person for details; use People to change many at once." />
      <TextInput
        value={search}
        onChangeText={setSearch}
        placeholder="Search people"
        placeholderTextColor={theme.textSecondary}
        style={[st.input, { color: theme.text, borderColor: theme.border }]}
      />
      <SearchableSelect
        title="Office"
        value={officeId}
        options={[{ value: "", label: "All offices", icon: "globe" }, ...base.offices.map((o) => ({ value: o.id, label: o.name, icon: "home" as const }))]}
        onChange={setOfficeId}
        placeholder="All offices"
      />
      {error ? <Hint icon="alert-circle" tone="error" text={error} /> : null}
      {loading && !rows.size ? <ActivityIndicator color={theme.primary} style={{ marginTop: 16 }} /> : null}
      <ScrollView horizontal style={{ marginTop: 10 }}>
        <View>
          <View style={{ flexDirection: "row", borderBottomWidth: 1, borderBottomColor: theme.border }}>
            <ThemedText style={{ width: 170, fontWeight: "800", fontSize: 12, paddingVertical: 8 }}>Person</ThemedText>
            {modules.map((m) => (
              <ThemedText key={m.module} style={{ width: 92, fontWeight: "800", fontSize: 11, paddingVertical: 8, textAlign: "center" }}>
                {m.module}
              </ThemedText>
            ))}
          </View>
          {people.map((p) => {
            const row = rows.get(p.id);
            return (
              <Pressable
                key={p.id}
                onPress={() => onOpenPerson(p.id)}
                style={{ flexDirection: "row", alignItems: "center", borderBottomWidth: 0.5, borderBottomColor: theme.border, minHeight: 40 }}
                accessibilityLabel={`Access of ${p.name}`}
              >
                <View style={{ width: 170, paddingRight: 6 }}>
                  <ThemedText numberOfLines={1} style={{ fontWeight: "700", fontSize: 13 }}>{p.name}</ThemedText>
                  <ThemedText numberOfLines={1} type="caption" style={{ color: theme.textSecondary }}>{p.role}</ThemedText>
                </View>
                {modules.map((m) => {
                  const c = cell(row, m.module);
                  return (
                    <View key={m.module} style={{ width: 92, alignItems: "center" }}>
                      {c ? (
                        <View style={{ backgroundColor: c.color + "1A", borderRadius: 8, paddingHorizontal: 6, paddingVertical: 2 }}>
                          <ThemedText style={{ color: c.color, fontSize: 11, fontWeight: "800" }}>
                            {c.text}{c.src ? ` · ${c.src}` : ""}
                          </ThemedText>
                        </View>
                      ) : (
                        <ThemedText style={{ color: theme.textSecondary, fontSize: 11 }}>—</ThemedText>
                      )}
                    </View>
                  );
                })}
              </Pressable>
            );
          })}
        </View>
      </ScrollView>
      {base.people.length > MAX_ROWS && people.length === MAX_ROWS ? (
        <ThemedText type="caption" style={{ color: theme.textSecondary, marginTop: 8 }}>
          Showing the first {MAX_ROWS}. Narrow with search or office.
        </ThemedText>
      ) : null}
    </View>
  );
}
