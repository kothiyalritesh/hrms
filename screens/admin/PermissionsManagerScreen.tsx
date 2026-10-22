import React, { useCallback, useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, useWindowDimensions, View } from "react-native";
import Feather from "@expo/vector-icons/Feather";
import { ThemedText } from "@/components/ThemedText";
import { useTheme } from "@/hooks/useTheme";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/contexts/AuthContext";
import { usePermissions } from "@/hooks/usePermissions";
import { PermissionsApi } from "@/services/permissions.service";
import LegacyPermissionsManager from "@/screens/admin/permissions/LegacyPermissionsManager";
import { BaseProvider, Hint, PermissionBase, Person, buildByKey } from "@/screens/admin/permissions/shared";
import { PeoplePanel } from "@/screens/admin/permissions/PeoplePanel";
import { EffectiveAccess } from "@/screens/admin/permissions/EffectiveAccess";
import { MatrixView } from "@/screens/admin/permissions/MatrixView";
import { TemplatesPanel } from "@/screens/admin/permissions/TemplatesPanel";
import { History, Simulator, WhoCanSee } from "@/screens/admin/permissions/InsightPanels";

/**
 * Permission Manager v3.
 *   People     several people × several permissions in one reviewed change
 *   Access     one person: everything they can do, from where, renew / revoke
 *   Matrix     people × modules at a glance
 *   Templates  Managers (whole reporting tree), HR / HRD full-access switch, roles
 *   Who sees   everyone who can see one employee, and why
 *   Simulator  can A do X to B, and why
 *   History    every change: direct grants, templates, full-access switches
 * The server enforces every rule (delegation ceiling, scopes, audit); this
 * screen only hides what the caller cannot do. Without the 20261020100000
 * migration it falls back to the previous manager.
 */

type Tab = "people" | "access" | "matrix" | "templates" | "who" | "simulator" | "history";
const TABS: { key: Tab; label: string; icon: keyof typeof Feather.glyphMap }[] = [
  { key: "people", label: "People", icon: "users" },
  { key: "access", label: "Access", icon: "user-check" },
  { key: "matrix", label: "Matrix", icon: "grid" },
  { key: "templates", label: "Templates", icon: "layers" },
  { key: "who", label: "Who sees", icon: "eye" },
  { key: "simulator", label: "Check", icon: "zap" },
  { key: "history", label: "History", icon: "clock" },
];

export default function PermissionsManagerScreen() {
  const { theme } = useTheme();
  const { user } = useAuth();
  const { hasPermission, isRoleAdmin, loading: permsLoading } = usePermissions();
  const canView = hasPermission("permissions.view") || hasPermission("permissions.assign");
  const { width } = useWindowDimensions();
  const compact = width < 600;

  const [tab, setTab] = useState<Tab>("people");
  const [personId, setPersonId] = useState("");
  const [base, setBase] = useState<PermissionBase | null>(null);
  const [legacy, setLegacy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const [catalog, profiles, offices, teams] = await Promise.all([
        PermissionsApi.catalog(),
        supabase
          .from("profiles")
          .select("id,name,role,employee_number,department,office_id,team_id,reports_to,is_active")
          .order("name")
          .limit(5000),
        supabase.from("offices").select("id,name").eq("is_active", true).order("name"),
        supabase.from("teams").select("id,name,parent_id,office_id").order("name"),
      ]);
      if (profiles.error) throw new Error(profiles.error.message);
      const people = (profiles.data ?? []) as Person[];
      setBase({
        catalog,
        byKey: buildByKey(catalog),
        people,
        peopleById: new Map(people.map((p) => [p.id, p])),
        offices: (offices.data ?? []) as any[],
        teams: (teams.data ?? []) as any[],
        departments: Array.from(new Set(people.map((p) => String(p.department ?? "").trim()).filter(Boolean))).sort(),
        canAssign: hasPermission("permissions.assign"),
        canRevoke: hasPermission("permissions.revoke"),
        isRoleAdmin,
        myId: user?.id ?? null,
      });
    } catch (e: any) {
      if (e?.missingRpc) setLegacy(true);
      else setError(e?.message ?? "Could not load the Permission Manager.");
    }
  }, [hasPermission, isRoleAdmin, user?.id]);

  useEffect(() => {
    if (canView) void load();
  }, [canView, load]);

  const openPerson = useCallback((id: string) => {
    setPersonId(id);
    setTab("access");
  }, []);

  const tabBar = useMemo(
    () => (
      // Fixed-height bar that never shrinks (a ScrollView shrinks by default and
      // was squeezed by tall tab content); scrolls sideways on narrow phones.
      <View style={[s.tabBar, { borderBottomColor: theme.border, backgroundColor: theme.backgroundDefault }]}>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={s.tabScroll}
        contentContainerStyle={s.tabScrollContent}
      >
        {TABS.map((t) => {
          const active = tab === t.key;
          return (
            <Pressable
              key={t.key}
              onPress={() => setTab(t.key)}
              style={[s.tab, compact && s.tabCompact, active && { borderBottomColor: theme.primary }]}
              accessibilityRole="tab"
              accessibilityLabel={t.label}
              accessibilityState={{ selected: active }}
            >
              <Feather name={t.icon} size={compact ? 18 : 14} color={active ? theme.primary : theme.textSecondary} />
              <ThemedText numberOfLines={1} style={{ color: active ? theme.primary : theme.textSecondary, fontWeight: "700", fontSize: compact ? 11 : 13 }}>
                {t.label}
              </ThemedText>
            </Pressable>
          );
        })}
      </ScrollView>
      </View>
    ),
    [tab, compact, theme],
  );

  if (!canView) {
    if (permsLoading) {
      return (
        <View style={[s.center, { backgroundColor: theme.backgroundRoot }]}>
          <ActivityIndicator color={theme.primary} />
        </View>
      );
    }
    return (
      <View style={[s.center, { backgroundColor: theme.backgroundRoot }]}>
        <Feather name="lock" size={44} color={theme.textSecondary} />
        <ThemedText type="h3" style={{ marginTop: 14, color: theme.textSecondary }}>Access restricted</ThemedText>
        <ThemedText style={{ color: theme.textSecondary, textAlign: "center", marginTop: 8, paddingHorizontal: 32 }}>
          Administrators and System Administrators only (or users granted View permissions / Grant permissions).
        </ThemedText>
      </View>
    );
  }

  if (legacy) return <LegacyPermissionsManager />;

  return (
    <View style={{ flex: 1, backgroundColor: theme.backgroundRoot }}>
      {tabBar}
      {!base ? (
        <View style={s.center}>
          {error ? <Hint icon="alert-circle" tone="error" text={error} /> : <ActivityIndicator color={theme.primary} />}
        </View>
      ) : (
        <BaseProvider value={base}>
          <ScrollView
            contentContainerStyle={[s.content, compact && s.contentCompact]}
            keyboardShouldPersistTaps="handled"
            keyboardDismissMode="on-drag"
          >
            {tab === "people" ? (
              <PeoplePanel onOpenPerson={openPerson} />
            ) : tab === "access" ? (
              <EffectiveAccess personId={personId} onPersonChange={setPersonId} />
            ) : tab === "matrix" ? (
              <MatrixView onOpenPerson={openPerson} />
            ) : tab === "templates" ? (
              <TemplatesPanel />
            ) : tab === "who" ? (
              <WhoCanSee onOpenPerson={openPerson} />
            ) : tab === "simulator" ? (
              <Simulator />
            ) : (
              <History />
            )}
          </ScrollView>
        </BaseProvider>
      )}
    </View>
  );
}

const s = StyleSheet.create({
  center: { flex: 1, alignItems: "center", justifyContent: "center", padding: 24 },
  tabBar: { flexGrow: 0, flexShrink: 0, borderBottomWidth: StyleSheet.hairlineWidth },
  tabScroll: { flexGrow: 0, flexShrink: 0 },
  tabScrollContent: { flexGrow: 1, alignItems: "stretch" },
  tab: { flexGrow: 1, flexShrink: 0, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, paddingHorizontal: 16, height: 48, borderBottomWidth: 2, borderBottomColor: "transparent" },
  tabCompact: { flexDirection: "column", gap: 2, height: 58, minWidth: 74, paddingHorizontal: 10 },
  content: { padding: 16, paddingBottom: 80, width: "100%", maxWidth: 920, alignSelf: "center" },
  contentCompact: { padding: 12 },
});
