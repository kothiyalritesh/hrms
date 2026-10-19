import React, { useState, useCallback, useMemo, useEffect, useRef } from "react";
import {
  StyleSheet, View, ScrollView, Pressable, Modal, FlatList,
  TextInput, RefreshControl, Alert, ActivityIndicator, Platform,
  useWindowDimensions,
} from "react-native";
import Feather from "@expo/vector-icons/Feather";
import { useFocusEffect } from "@react-navigation/native";
import { ThemedText } from "@/components/ThemedText";
import { useTheme } from "@/hooks/useTheme";
import { Spacing, BorderRadius } from "@/constants/theme";
import Spacer from "@/components/Spacer";
import { supabase } from "@/lib/supabase";
import { usePermissions } from "@/hooks/usePermissions";
import { canonicalPermission } from "@/constants/permissionCatalog";
import * as DocumentPicker from "expo-document-picker";
import * as Crypto from "expo-crypto";
import { firstRpcRow } from "@/utils/supabaseRpc";
import { fetchAllPages } from "@/utils/supabasePagination";
import { normalizeUserRole } from "@/utils/userRole";
import {
  canAssignReportingManager,
  canReportToSalesManager,
  isSalesManagerRole,
  salesManagerDirectReportLabel,
} from "@/utils/salesHierarchy";
import {
  HIERARCHY_IMPORT_HEADERS,
  HIERARCHY_TEMPLATE_EXAMPLE_ROWS,
  isHierarchyExampleRow,
  saveCsvFile,
  toCsv,
} from "@/utils/hierarchyTemplate";

interface Profile {
  id: string;
  name: string;
  role: string;
  team: string | null;
  reports_to: string | null;
  phone: string | null;
  employee_number: string | null;
  email: string | null;
  office_id: string | null;
  is_active: boolean | null;
}

const ADMIN_ROLES = ["SYSTEM_ADMIN", "ADMIN", "HR", "HRD"];
const AP_ROLE = "ASSOCIATE_PARTNER";

function isAP(role: string) { return normalizeUserRole(role) === AP_ROLE; }
function isAdmin(role: string) { return ADMIN_ROLES.includes(normalizeUserRole(role)); }
function isAgent(role: string) { return !isAP(role) && !isAdmin(role); }
function roleLabel(role: string | null | undefined) { return (role ?? "").replace(/_/g, " "); }
function initials(name: string) {
  return (name || "?").split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]!.toUpperCase()).join("") || "?";
}
const byName = (a: Profile, b: Profile) =>
  (a.name ?? "").localeCompare(b.name ?? "", undefined, { sensitivity: "base" });

/** Works on web (window.confirm) and native (Alert). */
function confirmAction(title: string, message: string, confirmLabel: string, destructive = false): Promise<boolean> {
  if (Platform.OS === "web" && typeof window !== "undefined") {
    return Promise.resolve(window.confirm(`${title}\n\n${message}`));
  }
  return new Promise<boolean>((resolve) =>
    Alert.alert(title, message, [
      { text: "Cancel", style: "cancel", onPress: () => resolve(false) },
      { text: confirmLabel, style: destructive ? "destructive" : "default", onPress: () => resolve(true) },
    ], { cancelable: true, onDismiss: () => resolve(false) }));
}

function notify(title: string, message: string) {
  if (Platform.OS === "web" && typeof window !== "undefined") window.alert(`${title}\n\n${message}`);
  else Alert.alert(title, message);
}

// ─── Types for bulk import ────────────────────────────────────────────────────
interface ImportRow {
  empName: string;
  employeeNumber: string;
  email: string;
  managerEmployeeNumber: string;
  managerEmail: string;
  contact: string;
  team: string;
  designation: string;
  location: string;
}
interface ImportResult {
  empName: string;
  parentName: string | null;
  parentId: string | null;
  isNew: boolean;
  warning: string | null;
}
interface ImportSummary {
  rows: ImportResult[];
  warnings: string[];
  treeText: string;
}

function employeeIdentity(row: ImportRow): string | null {
  if (row.employeeNumber.trim())
    return `number:${row.employeeNumber.trim().toLowerCase()}`;
  if (row.email.trim()) return `email:${row.email.trim().toLowerCase()}`;
  return null;
}

function managerIdentity(row: ImportRow): string | null {
  if (row.managerEmployeeNumber.trim())
    return `number:${row.managerEmployeeNumber.trim().toLowerCase()}`;
  if (row.managerEmail.trim())
    return `email:${row.managerEmail.trim().toLowerCase()}`;
  return null;
}

function buildTreeText(rows: ImportResult[], importRows: ImportRow[]): string {
  return rows.map((result, index) => {
    const row = importRows[index];
    const ownId = employeeIdentity(row) ?? "missing identity";
    const managerId = managerIdentity(row) ?? "top level";
    return `${result.empName} [${ownId}] → ${result.parentName ?? managerId}`;
  }).join("\n");
}

async function processImportFile(rows: ImportRow[], allProfiles: Profile[]): Promise<ImportSummary> {
  const warnings: string[] = [];
  const results: ImportResult[] = [];

  const profileByIdentity = new Map<string, Profile>();
  for (const profile of allProfiles) {
    if (profile.employee_number)
      profileByIdentity.set(`number:${profile.employee_number.trim().toLowerCase()}`, profile);
    if (profile.email)
      profileByIdentity.set(`email:${profile.email.trim().toLowerCase()}`, profile);
  }
  const rowByIdentity = new Map<string, ImportRow>();
  const duplicateIdentities = new Set<string>();
  for (const row of rows) {
    for (const identity of [
      row.employeeNumber ? `number:${row.employeeNumber.trim().toLowerCase()}` : null,
      row.email ? `email:${row.email.trim().toLowerCase()}` : null,
    ].filter(Boolean) as string[]) {
      if (rowByIdentity.has(identity)) duplicateIdentities.add(identity);
      else rowByIdentity.set(identity, row);
    }
  }

  const detectCycle = (startIdentity: string, currentIdentity: string, visited = new Set<string>()): boolean => {
    if (visited.has(currentIdentity)) return currentIdentity === startIdentity;
    visited.add(currentIdentity);
    const row = rowByIdentity.get(currentIdentity);
    const parent = row ? managerIdentity(row) : null;
    return parent ? detectCycle(startIdentity, parent, visited) : false;
  };

  for (const row of rows) {
    const empName = row.empName.trim();
    if (!empName) continue;
    const identity = employeeIdentity(row);
    if (!identity) {
      warnings.push(`Employee number or email is required for "${empName}".`);
      results.push({ empName, parentName: null, parentId: null, isNew: true, warning: "Missing identity" });
      continue;
    }
    if (duplicateIdentities.has(identity)) {
      warnings.push(`Duplicate employee identity detected for "${empName}".`);
      results.push({ empName, parentName: null, parentId: null, isNew: !profileByIdentity.has(identity), warning: "Duplicate identity" });
      continue;
    }
    const parentIdentity = managerIdentity(row);
    if (parentIdentity === identity) {
      warnings.push(`Self-referencing manager identity for "${empName}".`);
      results.push({ empName, parentName: null, parentId: null, isNew: !profileByIdentity.has(identity), warning: "Self-ref" });
      continue;
    }
    if (parentIdentity && detectCycle(identity, parentIdentity)) {
      warnings.push(`Circular reference detected for "${empName}". Manual review needed.`);
      results.push({ empName, parentName: null, parentId: null, isNew: !profileByIdentity.has(identity), warning: "Circular" });
      continue;
    }

    let parentName: string | null = null;
    let parentId: string | null = null;
    let relationshipWarning: string | null = null;
    if (parentIdentity) {
      const inFileParent = rowByIdentity.get(parentIdentity);
      const inSystemParent = profileByIdentity.get(parentIdentity);
      parentName = inFileParent?.empName ?? inSystemParent?.name ?? null;
      parentId = inSystemParent?.id ?? null;
      if (!parentName) {
        warnings.push(`Manager identity "${parentIdentity}" for "${empName}" was not found.`);
        relationshipWarning = "Manager not found";
      } else {
        const parentRole = inFileParent?.designation ?? inSystemParent?.role;
        if (!canAssignReportingManager(row.designation, parentRole)) {
          relationshipWarning = "Invalid Sales Manager direct-report role";
          warnings.push(
            `${empName} (${row.designation || "no role"}) cannot report directly to ${parentName} (Sales Manager). ` +
            `Allowed roles: ${salesManagerDirectReportLabel()}.`,
          );
        }
      }
    }
    results.push({ empName, parentName, parentId, isNew: !profileByIdentity.has(identity), warning: relationshipWarning });
  }

  return { rows: results, warnings, treeText: buildTreeText(results, rows) };
}

// ─── Org model ────────────────────────────────────────────────────────────────
type AttentionReason = "NO_MANAGER" | "INACTIVE_MANAGER" | "MISSING_MANAGER" | "SELF" | "CYCLE";
interface AttentionItem { id: string; reason: AttentionReason; detail: string }
interface TreeRow { id: string; depth: number; open: boolean; onSearchPath: boolean }

function buildOrgModel(allProfiles: Profile[]) {
  const allById = new Map(allProfiles.map((p) => [p.id, p]));
  const active = allProfiles.filter((p) => p.is_active !== false);
  const byId = new Map(active.map((p) => [p.id, p]));

  // Actual direct reports (reports_to), active people only.
  const directReports = new Map<string, Profile[]>();
  for (const p of active) {
    if (!p.reports_to || p.reports_to === p.id || !byId.has(p.reports_to)) continue;
    const list = directReports.get(p.reports_to);
    if (list) list.push(p); else directReports.set(p.reports_to, [p]);
  }

  // Display forest: each person appears once; a reporting loop is cut.
  const kids = new Map<string, string[]>();
  const parent = new Map<string, string | null>();
  const depth = new Map<string, number>();
  const order: string[] = [];
  const roots: string[] = [];
  const visited = new Set<string>();
  const walk = (rootId: string) => {
    visited.add(rootId);
    parent.set(rootId, null);
    depth.set(rootId, 0);
    roots.push(rootId);
    const stack = [rootId];
    while (stack.length) {
      const id = stack.pop()!;
      order.push(id);
      const list = (directReports.get(id) ?? []).filter((c) => !visited.has(c.id)).sort(byName);
      for (const c of list) {
        visited.add(c.id);
        parent.set(c.id, id);
        depth.set(c.id, (depth.get(id) ?? 0) + 1);
      }
      kids.set(id, list.map((c) => c.id));
      for (let i = list.length - 1; i >= 0; i--) stack.push(list[i].id);
    }
  };
  const topLevel = active.filter((p) => !p.reports_to || p.reports_to === p.id || !byId.has(p.reports_to));
  topLevel.sort((a, b) =>
    (directReports.has(b.id) ? 1 : 0) - (directReports.has(a.id) ? 1 : 0) || byName(a, b));
  topLevel.forEach((p) => walk(p.id));

  // Whoever is still unvisited sits on (or under) a reporting loop.
  // Each such group is shown from one entry point so nobody disappears.
  const unreached = active.filter((p) => !visited.has(p.id)).sort(byName);
  // Flag the actual loop members (whose chain leads back to themselves).
  const cycleIds = new Set<string>();
  for (const p of unreached) {
    const seen = new Set<string>();
    let cur: string | null = p.reports_to;
    while (cur && !seen.has(cur) && byId.has(cur)) {
      if (cur === p.id) { cycleIds.add(p.id); break; }
      seen.add(cur);
      cur = byId.get(cur)!.reports_to;
    }
  }
  // Enter each loop from a loop member so people hanging under it nest correctly.
  for (const p of unreached) if (cycleIds.has(p.id) && !visited.has(p.id)) walk(p.id);
  for (const p of unreached) if (!visited.has(p.id)) walk(p.id);

  const total = new Map<string, number>();
  for (let i = order.length - 1; i >= 0; i--) {
    const id = order[i];
    let t = 0;
    for (const k of kids.get(id) ?? []) t += 1 + (total.get(k) ?? 0);
    total.set(id, t);
  }

  const attention: AttentionItem[] = [];
  for (const p of [...active].sort(byName)) {
    if (!p.reports_to) {
      if (!directReports.has(p.id) && !isAdmin(p.role))
        attention.push({ id: p.id, reason: "NO_MANAGER", detail: "No manager assigned" });
    } else if (p.reports_to === p.id) {
      attention.push({ id: p.id, reason: "SELF", detail: "Reports to themselves" });
    } else if (!allById.has(p.reports_to)) {
      attention.push({ id: p.id, reason: "MISSING_MANAGER", detail: "Manager record not found or not visible" });
    } else if (!byId.has(p.reports_to)) {
      attention.push({ id: p.id, reason: "INACTIVE_MANAGER", detail: `Manager inactive: ${allById.get(p.reports_to)!.name}` });
    } else if (cycleIds.has(p.id)) {
      attention.push({ id: p.id, reason: "CYCLE", detail: "Part of a reporting loop" });
    }
  }
  const attentionById = new Map(attention.map((a) => [a.id, a]));

  return { allById, active, byId, directReports, kids, parent, depth, order, roots, total, attention, attentionById };
}

function Highlight({ text, query, style, highlightColor, numberOfLines = 1 }: {
  text: string; query: string; style: any; highlightColor: string; numberOfLines?: number;
}) {
  const index = query ? text.toLowerCase().indexOf(query) : -1;
  if (index < 0) return <ThemedText style={style} numberOfLines={numberOfLines}>{text}</ThemedText>;
  return (
    <ThemedText style={style} numberOfLines={numberOfLines}>
      {text.slice(0, index)}
      <ThemedText style={[style, { backgroundColor: highlightColor, fontWeight: "800" }]}>
        {text.slice(index, index + query.length)}
      </ThemedText>
      {text.slice(index + query.length)}
    </ThemedText>
  );
}

export default function TeamHierarchyScreen() {
  const { theme } = useTheme();
  const { width, height } = useWindowDimensions();
  const isWide = width >= 900;
  const { isDataAdmin, isPermissionAdmin, scopedPermissions } = usePermissions();
  // The server saves hierarchy changes only for a company-wide (GLOBAL)
  // teams.manage grant; an office/team-limited grant could see but never save.
  const canEdit = isDataAdmin || isPermissionAdmin || scopedPermissions.some(
    (p) => canonicalPermission(p.permission) === "teams.manage" && String(p.scope).toUpperCase() === "GLOBAL",
  );

  const [allProfiles, setAllProfiles] = useState<Profile[]>([]);
  const [officeNames, setOfficeNames] = useState<Map<string, string>>(new Map());
  const [loaded, setLoaded] = useState(false);
  const [hierarchyError, setHierarchyError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [search, setSearch] = useState("");
  const [saving, setSaving] = useState(false);
  const [downloading, setDownloading] = useState<"template" | "export" | null>(null);

  // Tree state
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [searchCollapsed, setSearchCollapsed] = useState<Set<string>>(new Set());
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [attentionOpen, setAttentionOpen] = useState(true);
  const [attentionShowAll, setAttentionShowAll] = useState(false);
  const [teamsOpen, setTeamsOpen] = useState(false);
  const expansionInitialised = useRef(false);
  const pendingScrollId = useRef<string | null>(null);
  const listRef = useRef<FlatList<TreeRow>>(null);

  // ── Bulk import state ──────────────────────────────────────────────────────
  const [importModal, setImportModal] = useState(false);
  const [importLoading, setImportLoading] = useState(false);
  const [importSummary, setImportSummary] = useState<ImportSummary | null>(null);
  const [importRows, setImportRows] = useState<ImportRow[]>([]);
  const [importSkippedExamples, setImportSkippedExamples] = useState(0);
  const [importBatchId, setImportBatchId] = useState<string | null>(null);
  const [importCommitting, setImportCommitting] = useState(false);
  const [importDone, setImportDone] = useState<{ success: number; warnings: number } | null>(null);

  // Set team head modal
  const [teamHeadModal, setTeamHeadModal] = useState(false);
  const [teamHeadTarget, setTeamHeadTarget] = useState<{ teamName: string; currentHeadId: string | null } | null>(null);
  const [teamHeadSearch, setTeamHeadSearch] = useState("");
  const [selectedAPId, setSelectedAPId] = useState<string>("");

  // Change manager modal
  const [assignModal, setAssignModal] = useState(false);
  const [assignTarget, setAssignTarget] = useState<Profile | null>(null);
  const [assignTo, setAssignTo] = useState<string>("");
  const [assignSearch, setAssignSearch] = useState("");

  // Move to team modal
  const [teamModal, setTeamModal] = useState(false);
  const [teamTarget, setTeamTarget] = useState<Profile | null>(null);
  const [teamChoice, setTeamChoice] = useState("");
  const [teamSearch, setTeamSearch] = useState("");

  const model = useMemo(() => buildOrgModel(allProfiles), [allProfiles]);
  const officeName = useCallback(
    (p: Profile | null | undefined) => (p?.office_id ? officeNames.get(p.office_id) ?? "" : ""),
    [officeNames],
  );

  // ── Data ───────────────────────────────────────────────────────────────────
  const loadData = useCallback(async () => {
    const [result, offices] = await Promise.all([
      fetchAllPages<Profile>((from, to) =>
        supabase
          .from("profiles")
          .select("id, name, role, team, reports_to, phone, employee_number, email, office_id, is_active")
          .order("name")
          .order("id")
          .range(from, to),
      ),
      supabase.from("offices").select("id, name"),
    ]);
    if (result.error) {
      setHierarchyError(result.error.message);
      setLoaded(true);
      return;
    }
    setAllProfiles(result.data || []);
    setOfficeNames(new Map(((offices.data ?? []) as { id: string; name: string }[]).map((o) => [o.id, o.name])));
    setHierarchyError(null);
    setLoaded(true);
  }, []);

  useFocusEffect(useCallback(() => { loadData(); }, [loadData]));
  const onRefresh = async () => { setRefreshing(true); await loadData(); setRefreshing(false); };

  useEffect(() => {
    if (!expansionInitialised.current && model.roots.length) {
      expansionInitialised.current = true;
      setExpanded(new Set(model.roots));
    }
  }, [model]);

  // ── Search ─────────────────────────────────────────────────────────────────
  const q = search.trim().toLowerCase();
  useEffect(() => { setSearchCollapsed(new Set()); }, [q]);

  const searchState = useMemo(() => {
    if (!q) return null;
    const matches = new Set<string>();
    for (const p of model.active) {
      const hay = [p.name, p.employee_number, p.email, roleLabel(p.role), p.team, officeName(p)]
        .filter(Boolean).join(" ").toLowerCase();
      if (hay.includes(q)) matches.add(p.id);
    }
    const path = new Set<string>();
    for (const id of matches) {
      let cur = model.parent.get(id) ?? null;
      while (cur && !path.has(cur)) {
        path.add(cur);
        cur = model.parent.get(cur) ?? null;
      }
    }
    return { matches, path };
  }, [q, model, officeName]);

  const rows = useMemo(() => {
    const out: TreeRow[] = [];
    const visit = (id: string, filtered: boolean) => {
      if (filtered && searchState && !searchState.matches.has(id) && !searchState.path.has(id)) return;
      const children = model.kids.get(id) ?? [];
      const onSearchPath = !!(filtered && searchState?.path.has(id));
      const open = onSearchPath ? !searchCollapsed.has(id) : expanded.has(id);
      out.push({ id, depth: model.depth.get(id) ?? 0, open: open && children.length > 0, onSearchPath });
      if (!open) return;
      for (const c of children) visit(c, onSearchPath);
    };
    for (const r of model.roots) visit(r, !!searchState);
    return out;
  }, [model, searchState, expanded, searchCollapsed]);

  const toggleRow = (row: TreeRow) => {
    const flip = (set: Set<string>) => {
      const next = new Set(set);
      if (next.has(row.id)) next.delete(row.id); else next.add(row.id);
      return next;
    };
    if (row.onSearchPath) setSearchCollapsed(flip);
    else setExpanded(flip);
  };

  const expandAll = () => {
    setSearchCollapsed(new Set());
    setExpanded(new Set(model.order.filter((id) => (model.kids.get(id) ?? []).length > 0)));
  };
  const collapseAll = () => {
    setExpanded(new Set());
    if (searchState) setSearchCollapsed(new Set(searchState.path));
  };

  /** Selects a person and makes sure their row is visible in the tree. */
  const focusPerson = (id: string) => {
    setSelectedId(id);
    if (searchState && !searchState.matches.has(id) && !searchState.path.has(id)) setSearch("");
    setExpanded((prev) => {
      const next = new Set(prev);
      let cur = model.parent.get(id) ?? null;
      while (cur) { next.add(cur); cur = model.parent.get(cur) ?? null; }
      return next;
    });
    pendingScrollId.current = id;
  };

  useEffect(() => {
    const id = pendingScrollId.current;
    if (!id) return;
    const index = rows.findIndex((r) => r.id === id);
    if (index < 0) return;
    pendingScrollId.current = null;
    try { listRef.current?.scrollToIndex({ index, viewPosition: 0.3, animated: true }); } catch { /* list not laid out yet */ }
  }, [rows]);

  const selected = selectedId ? model.byId.get(selectedId) ?? null : null;
  const breadcrumb = useMemo(() => {
    if (!selected) return [] as Profile[];
    const chain: Profile[] = [];
    let cur: string | null = selected.id;
    const guard = new Set<string>();
    while (cur && !guard.has(cur)) {
      guard.add(cur);
      const p = model.byId.get(cur);
      if (!p) break;
      chain.unshift(p);
      cur = model.parent.get(cur) ?? null;
    }
    return chain;
  }, [selected, model]);

  // ── Teams (text column profiles.team) ──────────────────────────────────────
  const agents = useMemo(() => model.active.filter((p) => isAgent(p.role)), [model]);
  const associatePartners = useMemo(() => model.active.filter((p) => isAP(p.role)), [model]);

  const distinctTeams = (list: Profile[]) => Array.from(
    list.reduce((acc, p) => {
      const raw = p.team?.trim();
      if (raw && !acc.has(raw.toLowerCase())) acc.set(raw.toLowerCase(), raw);
      return acc;
    }, new Map<string, string>()).values(),
  ).sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()));
  const teamNames = useMemo(() => distinctTeams(agents), [agents]);
  const allTeamNames = useMemo(() => distinctTeams(model.active), [model]);

  // Team head = the Associate Partner most team members report to.
  const getTeamHeadId = (teamName: string): string | null => {
    const members = agents.filter((p) => p.team?.trim().toLowerCase() === teamName.trim().toLowerCase());
    const counts: Record<string, number> = {};
    for (const m of members) {
      if (m.reports_to) {
        const ap = model.byId.get(m.reports_to);
        if (ap && isAP(ap.role)) counts[ap.id] = (counts[ap.id] || 0) + 1;
      }
    }
    const entries = Object.entries(counts);
    if (!entries.length) return null;
    return entries.sort((a, b) => b[1] - a[1])[0][0];
  };

  // ── Writes (all through the existing permission-checked RPC) ───────────────
  const applyHierarchyUpdates = async (updates: Array<Record<string, unknown>>) => {
    const { data, error } = await supabase.rpc("rpc_admin_update_hierarchy_v2", { p_updates: updates });
    if (error) throw error;
    const response = firstRpcRow<any>(data);
    if (response?.success !== true || Number(response?.updated) !== updates.length)
      throw new Error("The server did not confirm every hierarchy update.");
  };

  const friendlyError = (error: any) => {
    const message = String(error?.message ?? "");
    if (message.includes("REPORTING_HIERARCHY_CYCLE"))
      return "This change would create a reporting loop (someone would end up reporting to their own subordinate). Nothing was saved.";
    return message || "Nothing was confirmed.";
  };

  const openTeamHeadModal = (teamName: string) => {
    const headId = getTeamHeadId(teamName);
    setTeamHeadTarget({ teamName, currentHeadId: headId });
    setSelectedAPId(headId ?? "");
    setTeamHeadSearch("");
    setTeamHeadModal(true);
  };

  const handleSetTeamHead = async () => {
    if (!teamHeadTarget) return;
    const members = agents.filter(
      (p) => p.team?.trim().toLowerCase() === teamHeadTarget.teamName.trim().toLowerCase(),
    );
    const head = selectedAPId ? model.byId.get(selectedAPId) : null;
    if (head) {
      // The head must not already report (directly or indirectly) to a member.
      const memberIds = new Set(members.map((m) => m.id));
      const guard = new Set<string>();
      let cur: string | null = head.reports_to;
      while (cur && !guard.has(cur)) {
        if (memberIds.has(cur)) {
          notify("Not allowed", `${head.name} reports to ${model.byId.get(cur)?.name ?? "a team member"}, who is in this team. Making them head would create a reporting loop.`);
          return;
        }
        guard.add(cur);
        cur = model.byId.get(cur)?.reports_to ?? null;
      }
    }
    const ok = await confirmAction(
      head ? "Set team head" : "Remove team head",
      head
        ? `All ${members.length} member(s) of "${teamHeadTarget.teamName}" will report to ${head.name}.`
        : `All ${members.length} member(s) of "${teamHeadTarget.teamName}" will have no manager.`,
      head ? "Assign" : "Remove",
      !head,
    );
    if (!ok) return;
    setSaving(true);
    try {
      await applyHierarchyUpdates(members.map((member) => ({ id: member.id, reports_to: selectedAPId || null })));
      setTeamHeadModal(false);
      await loadData();
    } catch (error: any) {
      notify("Assignment failed", friendlyError(error));
    } finally {
      setSaving(false);
    }
  };

  const openAssignModal = (person: Profile) => {
    setAssignTarget(person);
    setAssignTo(person.reports_to && model.byId.has(person.reports_to) ? person.reports_to : "");
    setAssignSearch("");
    setAssignModal(true);
  };

  const handleUnassign = async (person: Profile) => {
    const manager = person.reports_to ? model.allById.get(person.reports_to) : null;
    const ok = await confirmAction(
      "Remove manager",
      `${person.name} will no longer report to ${manager?.name ?? "their current manager"}.`,
      "Remove", true,
    );
    if (!ok) return;
    try {
      await applyHierarchyUpdates([{ id: person.id, reports_to: null }]);
      await loadData();
    } catch (error: any) {
      notify("Unassign failed", friendlyError(error));
    }
  };

  const getDescendantIds = (id: string): Set<string> => {
    const result = new Set<string>();
    const queue = [id];
    while (queue.length) {
      const cur = queue.shift()!;
      for (const p of model.directReports.get(cur) ?? []) {
        if (result.has(p.id) || p.id === id) continue;
        result.add(p.id);
        queue.push(p.id);
      }
    }
    return result;
  };

  const assignTargetDescendants = useMemo(
    () => (assignTarget ? getDescendantIds(assignTarget.id) : new Set<string>()),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [assignTarget?.id, model],
  );

  const handleAssignSave = async () => {
    if (!assignTarget) return;
    if (assignTo === assignTarget.id) {
      notify("Not allowed", "A person cannot report to themselves.");
      return;
    }
    const manager = assignTo ? model.byId.get(assignTo) ?? null : null;
    if (assignTo && assignTargetDescendants.has(assignTo)) {
      notify("Not allowed", `${manager?.name ?? "This person"} already reports to ${assignTarget.name} (directly or indirectly). That would create a reporting loop.`);
      return;
    }
    if (manager && !canAssignReportingManager(assignTarget.role, manager.role)) {
      notify("Role cannot report to Sales Manager",
        `Only ${salesManagerDirectReportLabel()} can be assigned directly under a Sales Manager.`);
      return;
    }
    if ((assignTarget.reports_to ?? "") === assignTo) { setAssignModal(false); return; }
    const current = assignTarget.reports_to ? model.allById.get(assignTarget.reports_to)?.name ?? "unknown" : "no manager";
    const ok = await confirmAction(
      "Change manager",
      `${assignTarget.name}\nFrom: ${current}\nTo: ${manager?.name ?? "no manager"}`,
      "Save",
    );
    if (!ok) return;
    setSaving(true);
    try {
      await applyHierarchyUpdates([{ id: assignTarget.id, reports_to: assignTo || null }]);
      setAssignModal(false);
      await loadData();
    } catch (error: any) {
      notify("Assignment failed", friendlyError(error));
    } finally {
      setSaving(false);
    }
  };

  const validParents = assignTarget
    ? model.active.filter((p) => {
        if (p.id === assignTarget.id) return false;
        if (assignTargetDescendants.has(p.id)) return false;
        if (!canAssignReportingManager(assignTarget.role, p.role)) return false;
        return isAP(p.role) || isAgent(p.role);
      })
    : [];
  const assignQ = assignSearch.trim().toLowerCase();
  const filteredParents = assignQ
    ? validParents.filter((p) =>
        (p.name ?? "").toLowerCase().includes(assignQ) ||
        (p.role ?? "").toLowerCase().includes(assignQ) ||
        (p.employee_number ?? "").toLowerCase().includes(assignQ) ||
        (p.team ?? "").toLowerCase().includes(assignQ))
    : validParents;

  const openTeamModal = (person: Profile) => {
    setTeamTarget(person);
    setTeamChoice(person.team?.trim() ?? "");
    setTeamSearch("");
    setTeamModal(true);
  };

  const handleTeamSave = async () => {
    if (!teamTarget) return;
    const next = teamChoice.trim();
    const current = teamTarget.team?.trim() ?? "";
    if (next.toLowerCase() === current.toLowerCase()) { setTeamModal(false); return; }
    const ok = await confirmAction(
      "Move to team",
      `${teamTarget.name}\nFrom: ${current || "no team"}\nTo: ${next || "no team"}\n\nTheir manager does not change.`,
      "Move",
    );
    if (!ok) return;
    setSaving(true);
    try {
      await applyHierarchyUpdates([{ id: teamTarget.id, team: next || null }]);
      setTeamModal(false);
      await loadData();
    } catch (error: any) {
      notify("Move failed", friendlyError(error));
    } finally {
      setSaving(false);
    }
  };

  // ── Downloads ──────────────────────────────────────────────────────────────
  const handleDownloadTemplate = async () => {
    setDownloading("template");
    try {
      await saveCsvFile(
        "team_hierarchy_import_template.csv",
        toCsv([[...HIERARCHY_IMPORT_HEADERS], ...HIERARCHY_TEMPLATE_EXAMPLE_ROWS]),
      );
    } catch (e: any) {
      notify("Download failed", e?.message ?? "Could not create the template.");
    } finally {
      setDownloading(null);
    }
  };

  const handleExportCurrent = async () => {
    setDownloading("export");
    try {
      const data = model.order.map((id) => {
        const p = model.byId.get(id)!;
        const manager = p.reports_to ? model.allById.get(p.reports_to) : null;
        return [
          p.name ?? "",
          p.employee_number ?? "",
          p.email ?? "",
          manager?.employee_number ?? "",
          manager?.email ?? "",
          p.team ?? "",
          p.role ?? "",
          p.phone ?? "",
          officeName(p),
        ];
      });
      if (!data.length) throw new Error("There is no hierarchy data to export.");
      const stamp = new Date().toISOString().slice(0, 10);
      await saveCsvFile(`team_hierarchy_${stamp}.csv`, toCsv([[...HIERARCHY_IMPORT_HEADERS], ...data]));
    } catch (e: any) {
      notify("Export failed", e?.message ?? "Could not export the hierarchy.");
    } finally {
      setDownloading(null);
    }
  };

  // ── Bulk import: file picker & parser ──────────────────────────────────────
  const handlePickFile = async () => {
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: ["application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
               "text/csv", "application/vnd.ms-excel", "*/*"],
        copyToCacheDirectory: true,
      });
      if (result.canceled || !result.assets?.[0]) return;

      setImportLoading(true);
      setImportSummary(null);
      setImportDone(null);

      const resp = await fetch(result.assets[0].uri);
      const ab = await resp.arrayBuffer();
      const XLSX = await import("xlsx");
      const workbook = XLSX.read(ab, { type: "array" });
      const sheet = workbook.Sheets[workbook.SheetNames[0]];
      const raw: any[][] = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: "" });
      if (raw.length < 2) { setImportLoading(false); notify("Error", "File appears empty."); return; }

      const header: string[] = (raw[0] as string[]).map((h: string) => (h ?? "").toString().trim().toLowerCase());
      const headerKey = (value: string) => value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
      const colIdx = (aliases: string[]): number => {
        const allowed = new Set(aliases.map(headerKey));
        return header.findIndex((value) => allowed.has(headerKey(value)));
      };

      const empCol = colIdx(["employee name", "emp name", "empname"]);
      const employeeNumberCol = colIdx(["employee number", "employee no", "emp no", "emp code"]);
      const emailCol = colIdx(["employee email", "email"]);
      const managerEmployeeNumberCol = colIdx([
        "manager employee number", "manager employee no",
        "reporting manager employee number", "reporting manager emp no",
      ]);
      const managerEmailCol = colIdx(["manager email", "reporting manager email"]);
      const teamCol = colIdx(["team", "department"]);
      const desigCol = colIdx(["designation", "role"]);
      const contactCol = colIdx(["contact", "phone", "mobile"]);
      const locCol = colIdx(["location", "office"]);

      const missing: string[] = [];
      if (empCol === -1) missing.push("Emp Name");
      if (desigCol === -1) missing.push("Designation");
      if (employeeNumberCol === -1 && emailCol === -1) missing.push("Employee Number or Employee Email");
      if (managerEmployeeNumberCol === -1 && managerEmailCol === -1) missing.push("Manager Employee Number or Manager Email");
      if (missing.length) {
        setImportLoading(false);
        notify("Missing Columns", `Missing required column(s): ${missing.join(", ")}. Download the template to see the expected format.`);
        return;
      }

      const cell = (row: string[], col: number) => (col >= 0 ? (row[col] ?? "").toString().trim() : "");
      const parsed: ImportRow[] = [];
      let skippedExamples = 0;
      for (let i = 1; i < raw.length; i++) {
        const row = raw[i] as string[];
        const empName = cell(row, empCol);
        if (!empName) continue; // skip blank rows
        const employeeNumber = cell(row, employeeNumberCol);
        // Template example rows (EMP-EXAMPLE-*) are never imported.
        if (isHierarchyExampleRow(employeeNumber)) { skippedExamples++; continue; }
        parsed.push({
          empName,
          employeeNumber,
          email: cell(row, emailCol).toLowerCase(),
          managerEmployeeNumber: cell(row, managerEmployeeNumberCol),
          managerEmail: cell(row, managerEmailCol).toLowerCase(),
          contact: cell(row, contactCol),
          team: cell(row, teamCol),
          designation: cell(row, desigCol),
          location: cell(row, locCol),
        });
      }
      setImportSkippedExamples(skippedExamples);
      if (!parsed.length) {
        setImportLoading(false);
        notify("Nothing to import", skippedExamples
          ? "The file only contains the template's example rows. Replace them with real employees."
          : "No employee rows were found.");
        return;
      }

      const invalidIdentity = parsed.find((row) => !row.employeeNumber && !row.email);
      if (invalidIdentity) {
        setImportLoading(false);
        notify("Employee identity required",
          `${invalidIdentity.empName} has neither an employee number nor an email. Names are never used as identifiers.`);
        return;
      }
      setImportBatchId(Crypto.randomUUID());
      setImportRows(parsed);
      setImportSummary(await processImportFile(parsed, model.active));
      setImportLoading(false);
    } catch (e: any) {
      setImportLoading(false);
      notify("Error reading file", e?.message ?? "Unknown error");
    }
  };

  const handleCommitImport = async () => {
    if (!importSummary || !importBatchId) return;
    if (importSummary.warnings.length > 0) {
      notify("Resolve import warnings",
        "No changes were applied. Every identity and manager relationship must be valid before the transactional import can run.");
      return;
    }
    setImportCommitting(true);
    try {
      const payload = importRows.map((row) => ({
        name: row.empName,
        employee_number: row.employeeNumber || null,
        email: row.email || null,
        manager_employee_number: row.managerEmployeeNumber || null,
        manager_email: row.managerEmail || null,
        phone: row.contact || null,
        role: row.designation || "Agent",
        team: row.team || null,
      }));
      const { data, error } = await supabase.rpc("rpc_admin_apply_hierarchy_import", {
        p_batch_id: importBatchId, p_rows: payload,
      });
      if (error) throw error;
      const response = firstRpcRow<any>(data);
      if (
        response?.success !== true ||
        response?.batch_id !== importBatchId ||
        Number(response?.processed) !== payload.length ||
        Number(response?.updated) !== payload.length
      ) throw new Error("The server did not confirm the complete hierarchy transaction.");

      setImportDone({ success: payload.length, warnings: 0 });
      setImportSummary(null);
      await loadData();
    } catch (e: any) {
      notify("Import not confirmed",
        `${friendlyError(e)}\n\nThe same batch ID is preserved. Retry safely checks the exact transaction without applying it twice.`);
    } finally {
      setImportCommitting(false);
    }
  };

  // ── Render helpers ─────────────────────────────────────────────────────────
  const hl = theme.warningBg;
  const indentStep = isWide ? 20 : 14;
  const maxIndentLevels = isWide ? 12 : 6;

  const subtitleFor = (p: Profile) =>
    [roleLabel(p.role), p.team, officeName(p), p.employee_number ? `#${p.employee_number}` : ""]
      .filter(Boolean).join(" · ");

  const renderRow = ({ item }: { item: TreeRow }) => {
    const p = model.byId.get(item.id);
    if (!p) return null;
    const direct = (model.kids.get(p.id) ?? []).length;
    const total = model.total.get(p.id) ?? 0;
    const isSel = selectedId === p.id;
    const flag = model.attentionById.get(p.id);
    const indent = Math.min(item.depth, maxIndentLevels) * indentStep;
    const deep = item.depth > maxIndentLevels;
    return (
      <Pressable
        onPress={() => setSelectedId(p.id)}
        accessibilityRole="button"
        accessibilityLabel={`${p.name}, ${direct} direct reports`}
        style={[s.row, {
          paddingLeft: Spacing.xs + indent,
          backgroundColor: isSel ? theme.primary + "1F" : theme.backgroundDefault,
          borderBottomColor: theme.borderLight,
        }]}
      >
        {item.depth > 0 ? (
          <View style={[s.guide, { left: Spacing.xs + indent - indentStep / 2, backgroundColor: theme.border }]} />
        ) : null}
        {direct > 0 ? (
          <Pressable hitSlop={10} onPress={() => toggleRow(item)} style={s.chevron}
            accessibilityLabel={item.open ? `Collapse ${p.name}` : `Expand ${p.name}`}>
            <Feather name={item.open ? "chevron-down" : "chevron-right"} size={16} color={theme.textSecondary} />
          </Pressable>
        ) : (
          <View style={s.chevron}><View style={[s.leafDot, { backgroundColor: theme.textTertiary }]} /></View>
        )}
        <View style={[s.avatar, { backgroundColor: theme.primary + "22" }]}>
          <ThemedText style={{ color: theme.primary, fontSize: 11, fontWeight: "800", lineHeight: 14 }}>{initials(p.name)}</ThemedText>
        </View>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Highlight text={p.name ?? ""} query={q} highlightColor={hl}
            style={{ fontWeight: "700", fontSize: 14, lineHeight: 19, color: theme.text }} />
          <Highlight text={(deep ? `Level ${item.depth + 1} · ` : "") + subtitleFor(p)} query={q} highlightColor={hl}
            style={{ fontSize: 11, lineHeight: 15, color: theme.textSecondary }} />
          {direct > 0 ? (
            <ThemedText style={{ fontSize: 11, lineHeight: 15, color: theme.primary, fontWeight: "600" }} numberOfLines={1}>
              {direct} direct · {total} total
            </ThemedText>
          ) : null}
        </View>
        {flag ? <Feather name="alert-triangle" size={14} color={theme.warning} style={{ marginLeft: 4 }} /> : null}
      </Pressable>
    );
  };

  const chip = (label: string, icon: any, onPress: () => void, opts: { primary?: boolean; busy?: boolean; disabled?: boolean } = {}) => (
    <Pressable
      key={label}
      onPress={onPress}
      disabled={opts.disabled || opts.busy}
      style={[s.chip, {
        backgroundColor: opts.primary ? theme.primary : theme.backgroundSecondary,
        borderColor: opts.primary ? theme.primary : theme.border,
        opacity: opts.disabled ? 0.5 : 1,
      }]}
    >
      {opts.busy
        ? <ActivityIndicator size="small" color={opts.primary ? theme.buttonText : theme.primary} />
        : <Feather name={icon} size={13} color={opts.primary ? theme.buttonText : theme.text} />}
      <ThemedText style={{ fontSize: 12, fontWeight: "700", color: opts.primary ? theme.buttonText : theme.text }}>{label}</ThemedText>
    </Pressable>
  );

  const reasonColor = (reason: AttentionReason) =>
    reason === "CYCLE" || reason === "SELF" ? theme.error : reason === "NO_MANAGER" ? theme.info : theme.warning;

  const attentionVisible = attentionShowAll ? model.attention : model.attention.slice(0, 25);

  const listHeader = (
    <View style={{ gap: Spacing.sm, paddingBottom: Spacing.sm }}>
      {model.attention.length > 0 ? (
        <View style={[s.card, { backgroundColor: theme.backgroundDefault, borderColor: theme.warning + "55" }]}>
          <Pressable style={s.cardHeader} onPress={() => setAttentionOpen((v) => !v)}>
            <Feather name="alert-triangle" size={16} color={theme.warning} />
            <ThemedText style={{ flex: 1, fontWeight: "800", fontSize: 14, color: theme.text }}>
              Needs attention ({model.attention.length})
            </ThemedText>
            <Feather name={attentionOpen ? "chevron-up" : "chevron-down"} size={16} color={theme.textSecondary} />
          </Pressable>
          {attentionOpen ? (
            <View>
              {attentionVisible.map((a) => {
                const p = model.byId.get(a.id);
                if (!p) return null;
                return (
                  <Pressable key={a.id} onPress={() => focusPerson(a.id)}
                    style={[s.attnRow, { borderTopColor: theme.borderLight, backgroundColor: selectedId === a.id ? theme.primary + "1F" : "transparent" }]}>
                    <View style={{ flex: 1, minWidth: 0 }}>
                      <ThemedText style={{ fontWeight: "700", fontSize: 13, color: theme.text }} numberOfLines={1}>{p.name}</ThemedText>
                      <ThemedText style={{ fontSize: 11, color: theme.textSecondary }} numberOfLines={1}>{subtitleFor(p)}</ThemedText>
                    </View>
                    <View style={[s.reasonPill, { backgroundColor: reasonColor(a.reason) + "22" }]}>
                      <ThemedText style={{ fontSize: 10, fontWeight: "700", color: reasonColor(a.reason) }} numberOfLines={2}>
                        {a.detail}
                      </ThemedText>
                    </View>
                  </Pressable>
                );
              })}
              {model.attention.length > 25 ? (
                <Pressable onPress={() => setAttentionShowAll((v) => !v)} style={[s.attnRow, { borderTopColor: theme.borderLight, justifyContent: "center" }]}>
                  <ThemedText style={{ fontSize: 12, fontWeight: "700", color: theme.primary }}>
                    {attentionShowAll ? "Show fewer" : `Show all ${model.attention.length}`}
                  </ThemedText>
                </Pressable>
              ) : null}
            </View>
          ) : null}
        </View>
      ) : null}

      {teamNames.length > 0 ? (
        <View style={[s.card, { backgroundColor: theme.backgroundDefault, borderColor: theme.border }]}>
          <Pressable style={s.cardHeader} onPress={() => setTeamsOpen((v) => !v)}>
            <Feather name="users" size={16} color={theme.primary} />
            <ThemedText style={{ flex: 1, fontWeight: "800", fontSize: 14, color: theme.text }}>
              Teams ({teamNames.length})
            </ThemedText>
            <Feather name={teamsOpen ? "chevron-up" : "chevron-down"} size={16} color={theme.textSecondary} />
          </Pressable>
          {teamsOpen ? teamNames.map((teamName) => {
            const members = model.active.filter((a) => a.team?.trim().toLowerCase() === teamName.toLowerCase()).length;
            const headId = getTeamHeadId(teamName);
            const head = headId ? model.byId.get(headId) : null;
            return (
              <View key={teamName} style={[s.attnRow, { borderTopColor: theme.borderLight }]}>
                <Pressable style={{ flex: 1, minWidth: 0 }} onPress={() => setSearch(teamName)}>
                  <ThemedText style={{ fontWeight: "700", fontSize: 13, color: theme.text }} numberOfLines={1}>{teamName}</ThemedText>
                  <ThemedText style={{ fontSize: 11, color: theme.textSecondary }} numberOfLines={1}>
                    {members} member{members !== 1 ? "s" : ""} · {head ? `Head: ${head.name}` : "No head set"}
                  </ThemedText>
                </Pressable>
                {canEdit ? (
                  <Pressable style={[s.smallBtn, { borderColor: theme.primary }]} onPress={() => openTeamHeadModal(teamName)}>
                    <Feather name="star" size={12} color={theme.primary} />
                    <ThemedText style={{ fontSize: 11, fontWeight: "700", color: theme.primary }}>{head ? "Change head" : "Set head"}</ThemedText>
                  </Pressable>
                ) : null}
              </View>
            );
          }) : null}
        </View>
      ) : null}

      <ThemedText style={{ fontSize: 11, fontWeight: "800", color: theme.textSecondary, letterSpacing: 0.6, marginTop: 4 }}>
        ORGANISATION TREE{searchState ? ` · ${searchState.matches.size} MATCH${searchState.matches.size === 1 ? "" : "ES"}` : ""}
      </ThemedText>
    </View>
  );

  const infoLine = (label: string, value: React.ReactNode) => (
    <View style={s.infoLine}>
      <ThemedText style={{ width: 84, fontSize: 12, color: theme.textSecondary }}>{label}</ThemedText>
      <View style={{ flex: 1, minWidth: 0 }}>
        {typeof value === "string"
          ? <ThemedText style={{ fontSize: 13, color: theme.text }} numberOfLines={2}>{value || "—"}</ThemedText>
          : value}
      </View>
    </View>
  );

  const actionBtn = (label: string, icon: any, onPress: () => void, tone: "primary" | "danger" | "neutral" = "neutral") => {
    const color = tone === "primary" ? theme.primary : tone === "danger" ? theme.error : theme.text;
    return (
      <Pressable key={label} onPress={onPress} style={[s.actionBtn, { borderColor: tone === "neutral" ? theme.border : color + "66", backgroundColor: color + "10" }]}>
        <Feather name={icon} size={14} color={color} />
        <ThemedText style={{ fontSize: 12, fontWeight: "700", color }}>{label}</ThemedText>
      </Pressable>
    );
  };

  const renderDetails = (p: Profile) => {
    const manager = p.reports_to ? model.allById.get(p.reports_to) ?? null : null;
    const managerActive = manager ? model.byId.has(manager.id) : false;
    const directs = [...(model.directReports.get(p.id) ?? [])].sort(byName);
    const flag = model.attentionById.get(p.id);
    return (
      <View style={{ gap: Spacing.md }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: Spacing.sm }}>
          <View style={[s.avatarLg, { backgroundColor: theme.primary + "22" }]}>
            <ThemedText style={{ color: theme.primary, fontWeight: "800", fontSize: 15 }}>{initials(p.name)}</ThemedText>
          </View>
          <View style={{ flex: 1, minWidth: 0 }}>
            <ThemedText style={{ fontWeight: "800", fontSize: 16, color: theme.text }} numberOfLines={2}>{p.name}</ThemedText>
            <ThemedText style={{ fontSize: 12, color: theme.textSecondary }} numberOfLines={1}>
              {roleLabel(p.role)}{p.employee_number ? ` · #${p.employee_number}` : ""}
            </ThemedText>
          </View>
          <Pressable hitSlop={10} onPress={() => setSelectedId(null)} accessibilityLabel="Close details">
            <Feather name="x" size={18} color={theme.textSecondary} />
          </Pressable>
        </View>

        {breadcrumb.length > 1 ? (
          <View style={s.crumbs}>
            {breadcrumb.map((c, i) => (
              <View key={c.id} style={{ flexDirection: "row", alignItems: "center" }}>
                {i > 0 ? <ThemedText style={{ fontSize: 12, color: theme.textTertiary, marginHorizontal: 4 }}>›</ThemedText> : null}
                <Pressable onPress={() => focusPerson(c.id)} disabled={c.id === p.id}>
                  <ThemedText style={{ fontSize: 12, fontWeight: c.id === p.id ? "800" : "600", color: c.id === p.id ? theme.text : theme.primary }}>
                    {c.name}
                  </ThemedText>
                </Pressable>
              </View>
            ))}
          </View>
        ) : null}

        {flag ? (
          <View style={[s.flagBox, { backgroundColor: reasonColor(flag.reason) + "1A" }]}>
            <Feather name="alert-triangle" size={14} color={reasonColor(flag.reason)} />
            <ThemedText style={{ flex: 1, fontSize: 12, fontWeight: "600", color: reasonColor(flag.reason) }}>{flag.detail}</ThemedText>
          </View>
        ) : null}

        <View style={[s.infoBox, { backgroundColor: theme.backgroundSecondary }]}>
          {infoLine("Manager", manager ? (
            <Pressable onPress={() => managerActive && focusPerson(manager.id)} disabled={!managerActive}>
              <ThemedText style={{ fontSize: 13, fontWeight: "700", color: managerActive ? theme.primary : theme.warning }} numberOfLines={2}>
                {manager.name}{managerActive ? "" : " (inactive)"}
              </ThemedText>
            </Pressable>
          ) : p.reports_to ? "Not found" : "None")}
          {infoLine("Team", p.team ?? "")}
          {infoLine("Office", officeName(p))}
          {infoLine("Reports", `${directs.length} direct · ${model.total.get(p.id) ?? 0} total`)}
          {p.email ? infoLine("Email", p.email) : null}
          {p.phone ? infoLine("Phone", p.phone) : null}
          {isSalesManagerRole(p.role) ? infoLine("Can manage", salesManagerDirectReportLabel()) : null}
        </View>

        {canEdit ? (
          <View style={s.actions}>
            {actionBtn("Change manager", "git-branch", () => openAssignModal(p), "primary")}
            {actionBtn("Move to team", "users", () => openTeamModal(p))}
            {p.team?.trim() && teamNames.some((t) => t.toLowerCase() === p.team!.trim().toLowerCase())
              ? actionBtn("Team head", "star", () => openTeamHeadModal(p.team!.trim()))
              : null}
            {p.reports_to ? actionBtn("Remove manager", "user-minus", () => handleUnassign(p), "danger") : null}
          </View>
        ) : null}

        <View>
          <ThemedText style={{ fontSize: 11, fontWeight: "800", color: theme.textSecondary, letterSpacing: 0.6, marginBottom: 4 }}>
            DIRECT REPORTS ({directs.length})
          </ThemedText>
          {directs.length === 0 ? (
            <ThemedText style={{ fontSize: 12, color: theme.textSecondary, fontStyle: "italic" }}>No direct reports</ThemedText>
          ) : directs.map((d) => (
            <Pressable key={d.id} onPress={() => focusPerson(d.id)} style={[s.reportRow, { borderBottomColor: theme.borderLight }]}>
              <View style={{ flex: 1, minWidth: 0 }}>
                <ThemedText style={{ fontSize: 13, fontWeight: "600", color: theme.text }} numberOfLines={1}>{d.name}</ThemedText>
                <ThemedText style={{ fontSize: 11, color: theme.textSecondary }} numberOfLines={1}>
                  {subtitleFor(d)}
                  {isSalesManagerRole(p.role) && !canReportToSalesManager(d.role) ? " · role not allowed under Sales Manager" : ""}
                </ThemedText>
              </View>
              <Feather name="chevron-right" size={14} color={theme.textTertiary} />
            </Pressable>
          ))}
        </View>
      </View>
    );
  };

  const option = (key: string, active: boolean, onPress: () => void, title: string, subtitle?: string, titleColor?: string) => (
    <Pressable key={key} style={[s.option, active && { backgroundColor: theme.primary + "15" }]} onPress={onPress}>
      <View style={{ flex: 1, minWidth: 0 }}>
        <ThemedText style={{ fontSize: 13, fontWeight: "700", color: active ? theme.primary : titleColor ?? theme.text }} numberOfLines={1}>{title}</ThemedText>
        {subtitle ? <ThemedText style={{ fontSize: 11, color: theme.textSecondary }} numberOfLines={1}>{subtitle}</ThemedText> : null}
      </View>
      {active ? <Feather name="check" size={14} color={theme.primary} /> : null}
    </Pressable>
  );

  const teamQ = teamSearch.trim();
  const teamOptions = allTeamNames.filter((t) => !teamQ || t.toLowerCase().includes(teamQ.toLowerCase()));
  const canCreateTeam = !!teamQ && !allTeamNames.some((t) => t.toLowerCase() === teamQ.toLowerCase());

  // ── Layout ─────────────────────────────────────────────────────────────────
  return (
    <View style={{ flex: 1, backgroundColor: theme.backgroundRoot }}>
      {hierarchyError ? (
        <View style={[s.errorBox, { backgroundColor: theme.errorBg }]}>
          <ThemedText style={{ color: theme.errorText, fontWeight: "700", fontSize: 13 }}>
            Hierarchy data unavailable: {hierarchyError}
          </ThemedText>
        </View>
      ) : null}

      <View style={[s.toolbar, { backgroundColor: theme.backgroundDefault, borderBottomColor: theme.border }]}>
        <View style={[s.searchRow, { backgroundColor: theme.backgroundSecondary }]}>
          <Feather name="search" size={16} color={theme.textSecondary} />
          <TextInput
            style={[s.searchInput, { color: theme.text }]}
            placeholder="Search name, emp no, team, role, office"
            placeholderTextColor={theme.textSecondary}
            value={search}
            onChangeText={setSearch}
            autoCorrect={false}
            autoCapitalize="none"
          />
          {search ? (
            <Pressable hitSlop={8} onPress={() => setSearch("")} accessibilityLabel="Clear search">
              <Feather name="x" size={16} color={theme.textSecondary} />
            </Pressable>
          ) : null}
        </View>
        <View style={s.chips}>
          {chip("Expand all", "maximize-2", expandAll)}
          {chip("Collapse all", "minimize-2", collapseAll)}
          {chip("Download template", "download", handleDownloadTemplate, { busy: downloading === "template" })}
          {canEdit ? chip("Export current", "file-text", handleExportCurrent, { busy: downloading === "export", disabled: !model.active.length }) : null}
          {canEdit ? chip("Import", "upload", () => { setImportModal(true); setImportSummary(null); setImportDone(null); }, { primary: true }) : null}
        </View>
        <ThemedText style={{ fontSize: 11, color: theme.textSecondary }} numberOfLines={1}>
          {model.active.length} people · {model.roots.length} top-level · {model.attention.length} need attention
        </ThemedText>
      </View>

      <View style={{ flex: 1, flexDirection: isWide ? "row" : "column" }}>
        <FlatList
          ref={listRef}
          style={{ flex: 1 }}
          contentContainerStyle={{ padding: Spacing.md, paddingBottom: 40 }}
          data={rows}
          keyExtractor={(r) => r.id}
          renderItem={renderRow}
          extraData={selectedId}
          ListHeaderComponent={listHeader}
          initialNumToRender={40}
          windowSize={11}
          keyboardShouldPersistTaps="handled"
          onScrollToIndexFailed={(info) => {
            listRef.current?.scrollToOffset({ offset: info.averageItemLength * info.index, animated: true });
          }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={theme.primary} />}
          ListEmptyComponent={
            <View style={s.empty}>
              {!loaded ? <ActivityIndicator color={theme.primary} /> : (
                <>
                  <Feather name="users" size={36} color={theme.textSecondary} />
                  <Spacer height={Spacing.sm} />
                  <ThemedText style={{ color: theme.textSecondary, textAlign: "center" }}>
                    {q ? `No one matches "${search.trim()}"` : "No active employees found"}
                  </ThemedText>
                </>
              )}
            </View>
          }
        />

        {isWide ? (
          <View style={[s.sidePanel, { backgroundColor: theme.backgroundDefault, borderLeftColor: theme.border }]}>
            {selected ? (
              <ScrollView contentContainerStyle={{ padding: Spacing.lg }}>{renderDetails(selected)}</ScrollView>
            ) : (
              <View style={[s.empty, { paddingHorizontal: Spacing.lg }]}>
                <Feather name="mouse-pointer" size={28} color={theme.textTertiary} />
                <Spacer height={Spacing.sm} />
                <ThemedText style={{ color: theme.textSecondary, textAlign: "center", fontSize: 13 }}>
                  Select a person to see their manager, team, office and direct reports.
                </ThemedText>
              </View>
            )}
          </View>
        ) : selected ? (
          <View style={[s.bottomPanel, { maxHeight: Math.max(260, height * 0.5), backgroundColor: theme.backgroundDefault, borderTopColor: theme.border }]}>
            <ScrollView contentContainerStyle={{ padding: Spacing.lg }} keyboardShouldPersistTaps="handled">
              {renderDetails(selected)}
            </ScrollView>
          </View>
        ) : null}
      </View>

      {/* ── Bulk Import Modal ── */}
      <Modal visible={importModal} transparent animationType="slide" onRequestClose={() => setImportModal(false)}>
        <View style={s.overlay}>
          <Pressable style={StyleSheet.absoluteFill} onPress={() => setImportModal(false)} />
          <View style={[s.sheet, { backgroundColor: theme.backgroundDefault, maxHeight: "92%" }]}>
            <View style={{ flexDirection: "row", alignItems: "center", marginBottom: Spacing.sm }}>
              <ThemedText type="h3" style={{ flex: 1 }}>Bulk hierarchy import</ThemedText>
              <Pressable onPress={() => setImportModal(false)} hitSlop={8}>
                <Feather name="x" size={20} color={theme.textSecondary} />
              </Pressable>
            </View>
            <ThemedText style={{ color: theme.textSecondary, fontSize: 12, marginBottom: Spacing.sm }}>
              Excel (.xlsx) or CSV with columns: {HIERARCHY_IMPORT_HEADERS.join(", ")}. Required: Emp Name, Designation,
              Employee Number or Employee Email, and the Manager column(s). A blank Team clears the person's team.
              Rows with Employee Number EMP-EXAMPLE-* are skipped.
            </ThemedText>
            <View style={[s.chips, { marginBottom: Spacing.md }]}>
              {chip("Download template", "download", handleDownloadTemplate, { busy: downloading === "template" })}
              {chip("Export current", "file-text", handleExportCurrent, { busy: downloading === "export" })}
            </View>

            {importDone ? (
              <View style={{ alignItems: "center", padding: Spacing.xl }}>
                <Feather name="check-circle" size={40} color={theme.success} />
                <Spacer height={12} />
                <ThemedText type="h3" style={{ color: theme.success }}>Import complete</ThemedText>
                <ThemedText style={{ color: theme.textSecondary, marginTop: 6, fontSize: 13 }}>
                  {importDone.success} employees assigned
                </ThemedText>
                <Spacer height={Spacing.lg} />
                <Pressable style={[s.saveBtn, { backgroundColor: theme.primary, alignSelf: "stretch" }]} onPress={() => { setImportModal(false); setImportDone(null); }}>
                  <ThemedText style={{ color: theme.buttonText, fontWeight: "700" }}>Close</ThemedText>
                </Pressable>
              </View>
            ) : importLoading ? (
              <View style={{ alignItems: "center", padding: Spacing.xl }}>
                <ActivityIndicator color={theme.primary} size="large" />
                <ThemedText style={{ color: theme.textSecondary, marginTop: 12, fontSize: 13 }}>Parsing file…</ThemedText>
              </View>
            ) : importSummary ? (
              <ScrollView showsVerticalScrollIndicator={false} nestedScrollEnabled>
                <View style={{ flexDirection: "row", gap: 8, marginBottom: Spacing.sm, flexWrap: "wrap" }}>
                  <View style={[s.statChip, { backgroundColor: theme.successBg }]}>
                    <ThemedText style={{ color: theme.successText, fontWeight: "700", fontSize: 12 }}>
                      {importSummary.rows.filter((r) => !r.warning).length} ready
                    </ThemedText>
                  </View>
                  <View style={[s.statChip, { backgroundColor: theme.infoBg }]}>
                    <ThemedText style={{ color: theme.infoText, fontWeight: "700", fontSize: 12 }}>
                      {importSummary.rows.filter((r) => r.isNew && !r.warning).length} new
                    </ThemedText>
                  </View>
                  <View style={[s.statChip, { backgroundColor: theme.warningBg }]}>
                    <ThemedText style={{ color: theme.warningText, fontWeight: "700", fontSize: 12 }}>
                      {importSummary.warnings.length} warnings
                    </ThemedText>
                  </View>
                  {importSkippedExamples ? (
                    <View style={[s.statChip, { backgroundColor: theme.backgroundSecondary }]}>
                      <ThemedText style={{ color: theme.textSecondary, fontWeight: "700", fontSize: 12 }}>
                        {importSkippedExamples} example row(s) skipped
                      </ThemedText>
                    </View>
                  ) : null}
                </View>

                <ThemedText style={{ fontWeight: "700", color: theme.text, marginBottom: 4, fontSize: 13 }}>Hierarchy preview</ThemedText>
                <ScrollView style={[s.treeBox, { backgroundColor: theme.backgroundSecondary }]} nestedScrollEnabled>
                  <ThemedText style={{ fontFamily: Platform.OS === "web" ? "monospace" : undefined, color: theme.text, fontSize: 11, lineHeight: 18 }}>
                    {importSummary.treeText || "(empty)"}
                  </ThemedText>
                </ScrollView>

                {importSummary.warnings.length > 0 ? (
                  <>
                    <ThemedText style={{ fontWeight: "700", color: theme.warning, marginTop: Spacing.md, marginBottom: 4, fontSize: 13 }}>
                      Warnings ({importSummary.warnings.length})
                    </ThemedText>
                    {importSummary.warnings.map((w, i) => (
                      <View key={i} style={[s.warningRow, { backgroundColor: theme.warningBg }]}>
                        <ThemedText style={{ color: theme.warningText, fontSize: 11 }}>{w}</ThemedText>
                      </View>
                    ))}
                  </>
                ) : null}

                <Spacer height={Spacing.lg} />
                <View style={{ flexDirection: "row", gap: 8 }}>
                  <Pressable style={[s.saveBtn, { flex: 1, backgroundColor: theme.backgroundSecondary }]} onPress={() => setImportSummary(null)}>
                    <ThemedText style={{ fontWeight: "700", fontSize: 13 }}>Re-upload</ThemedText>
                  </Pressable>
                  <Pressable
                    style={[s.saveBtn, { flex: 2, backgroundColor: theme.primary, opacity: importCommitting || importSummary.warnings.length > 0 ? 0.5 : 1 }]}
                    onPress={handleCommitImport}
                    disabled={importCommitting || importSummary.warnings.length > 0}
                  >
                    <ThemedText style={{ color: theme.buttonText, fontWeight: "700", fontSize: 13 }}>
                      {importCommitting ? "Applying…" : "Confirm & apply"}
                    </ThemedText>
                  </Pressable>
                </View>
                <Spacer height={8} />
              </ScrollView>
            ) : (
              <View style={{ alignItems: "center", gap: Spacing.lg }}>
                <View style={[s.uploadBox, { borderColor: theme.primary }]}>
                  <Feather name="file-text" size={32} color={theme.primary} />
                  <Spacer height={8} />
                  <ThemedText style={{ color: theme.text, fontWeight: "600", textAlign: "center" }}>Select Excel or CSV file</ThemedText>
                  <ThemedText style={{ color: theme.textSecondary, textAlign: "center", marginTop: 4, fontSize: 12 }}>Supported: .xlsx, .csv</ThemedText>
                </View>
                <Pressable style={[s.saveBtn, { backgroundColor: theme.primary, alignSelf: "stretch" }]} onPress={handlePickFile}>
                  <ThemedText style={{ color: theme.buttonText, fontWeight: "700" }}>Browse file</ThemedText>
                </Pressable>
              </View>
            )}
          </View>
        </View>
      </Modal>

      {/* ── Set Team Head Modal ── */}
      <Modal visible={teamHeadModal} transparent animationType="slide" onRequestClose={() => setTeamHeadModal(false)}>
        <View style={s.overlay}>
          <Pressable style={StyleSheet.absoluteFill} onPress={() => setTeamHeadModal(false)} />
          <View style={[s.sheet, { backgroundColor: theme.backgroundDefault }]}>
            <ThemedText type="h3" style={{ marginBottom: 2 }} numberOfLines={2}>Head for "{teamHeadTarget?.teamName}"</ThemedText>
            <ThemedText style={{ color: theme.textSecondary, marginBottom: Spacing.md, fontSize: 12 }}>
              Every member of this team will report to the selected Associate Partner.
            </ThemedText>
            <View style={[s.inlineSearch, { backgroundColor: theme.backgroundSecondary }]}>
              <Feather name="search" size={14} color={theme.textSecondary} />
              <TextInput
                style={[s.searchInput, { color: theme.text, fontSize: 13 }]}
                placeholder="Search Associate Partner..."
                placeholderTextColor={theme.textSecondary}
                value={teamHeadSearch}
                onChangeText={setTeamHeadSearch}
              />
            </View>
            <ScrollView style={{ maxHeight: 300 }} nestedScrollEnabled keyboardShouldPersistTaps="handled">
              {option("none", selectedAPId === "", () => setSelectedAPId(""), "None (remove head)", undefined, theme.textSecondary)}
              {associatePartners
                .filter((ap) => !teamHeadSearch || (ap.name ?? "").toLowerCase().includes(teamHeadSearch.toLowerCase()))
                .map((ap) => option(ap.id, selectedAPId === ap.id, () => setSelectedAPId(ap.id), ap.name,
                  `Associate Partner${ap.team ? ` · ${ap.team}` : ""}`))}
              {associatePartners.length === 0 ? (
                <ThemedText style={{ color: theme.textSecondary, padding: 12, fontStyle: "italic", fontSize: 12 }}>No Associate Partners found</ThemedText>
              ) : null}
            </ScrollView>
            <Spacer height={Spacing.md} />
            <Pressable style={[s.saveBtn, { backgroundColor: theme.primary, opacity: saving ? 0.7 : 1 }]} onPress={handleSetTeamHead} disabled={saving}>
              <ThemedText style={{ color: theme.buttonText, fontWeight: "700" }} numberOfLines={1}>
                {saving ? "Saving..." : selectedAPId ? `Assign all to ${model.byId.get(selectedAPId)?.name ?? ""}` : "Remove head assignment"}
              </ThemedText>
            </Pressable>
          </View>
        </View>
      </Modal>

      {/* ── Change Manager Modal ── */}
      <Modal visible={assignModal} transparent animationType="slide" onRequestClose={() => setAssignModal(false)}>
        <View style={s.overlay}>
          <Pressable style={StyleSheet.absoluteFill} onPress={() => setAssignModal(false)} />
          <View style={[s.sheet, { backgroundColor: theme.backgroundDefault }]}>
            <ThemedText type="h3" style={{ marginBottom: 2 }} numberOfLines={2}>Manager for {assignTarget?.name}</ThemedText>
            <ThemedText style={{ color: theme.textSecondary, marginBottom: Spacing.md, fontSize: 12 }}>
              {assignTarget?.name} and the people under them are not listed, so a reporting loop cannot be chosen.
            </ThemedText>
            <View style={[s.inlineSearch, { backgroundColor: theme.backgroundSecondary }]}>
              <Feather name="search" size={14} color={theme.textSecondary} />
              <TextInput
                style={[s.searchInput, { color: theme.text, fontSize: 13 }]}
                placeholder="Name, role, team or emp no..."
                placeholderTextColor={theme.textSecondary}
                value={assignSearch}
                onChangeText={setAssignSearch}
              />
              {assignSearch ? <Pressable onPress={() => setAssignSearch("")}><Feather name="x" size={14} color={theme.textSecondary} /></Pressable> : null}
            </View>
            <ScrollView style={{ maxHeight: 300 }} nestedScrollEnabled keyboardShouldPersistTaps="handled">
              {option("none", assignTo === "", () => setAssignTo(""), "None (no manager)", undefined, theme.textSecondary)}
              {filteredParents.filter((p) => isAP(p.role)).map((p) =>
                option(p.id, assignTo === p.id, () => setAssignTo(p.id), p.name, `Associate Partner${p.team ? ` · ${p.team}` : ""}`))}
              {filteredParents.filter((p) => isSalesManagerRole(p.role)).map((p) =>
                option(p.id, assignTo === p.id, () => setAssignTo(p.id), p.name,
                  `Sales Manager · manages ${salesManagerDirectReportLabel()}${p.team ? ` · ${p.team}` : ""}`, theme.warning))}
              {filteredParents.filter((p) => isAgent(p.role) && !isSalesManagerRole(p.role)).map((p) =>
                option(p.id, assignTo === p.id, () => setAssignTo(p.id), p.name, `${roleLabel(p.role)}${p.team ? ` · ${p.team}` : ""}`))}
              {filteredParents.length === 0 ? (
                <ThemedText style={{ color: theme.textSecondary, padding: 12, fontStyle: "italic", fontSize: 12 }}>No eligible managers match</ThemedText>
              ) : null}
            </ScrollView>
            <Spacer height={Spacing.md} />
            <Pressable style={[s.saveBtn, { backgroundColor: theme.primary, opacity: saving ? 0.7 : 1 }]} onPress={handleAssignSave} disabled={saving}>
              <ThemedText style={{ color: theme.buttonText, fontWeight: "700" }}>{saving ? "Saving..." : "Save"}</ThemedText>
            </Pressable>
          </View>
        </View>
      </Modal>

      {/* ── Move To Team Modal ── */}
      <Modal visible={teamModal} transparent animationType="slide" onRequestClose={() => setTeamModal(false)}>
        <View style={s.overlay}>
          <Pressable style={StyleSheet.absoluteFill} onPress={() => setTeamModal(false)} />
          <View style={[s.sheet, { backgroundColor: theme.backgroundDefault }]}>
            <ThemedText type="h3" style={{ marginBottom: 2 }} numberOfLines={2}>Team for {teamTarget?.name}</ThemedText>
            <ThemedText style={{ color: theme.textSecondary, marginBottom: Spacing.md, fontSize: 12 }}>
              Changes the team label only; the reporting manager stays the same.
            </ThemedText>
            <View style={[s.inlineSearch, { backgroundColor: theme.backgroundSecondary }]}>
              <Feather name="search" size={14} color={theme.textSecondary} />
              <TextInput
                style={[s.searchInput, { color: theme.text, fontSize: 13 }]}
                placeholder="Find or type a new team name..."
                placeholderTextColor={theme.textSecondary}
                value={teamSearch}
                onChangeText={setTeamSearch}
              />
            </View>
            <ScrollView style={{ maxHeight: 300 }} nestedScrollEnabled keyboardShouldPersistTaps="handled">
              {option("none", teamChoice === "", () => setTeamChoice(""), "No team", undefined, theme.textSecondary)}
              {canCreateTeam ? option("new", teamChoice === teamQ, () => setTeamChoice(teamQ), `New team: "${teamQ}"`, undefined, theme.primary) : null}
              {teamOptions.map((t) => option(t, teamChoice.toLowerCase() === t.toLowerCase(), () => setTeamChoice(t), t))}
            </ScrollView>
            <Spacer height={Spacing.md} />
            <Pressable style={[s.saveBtn, { backgroundColor: theme.primary, opacity: saving ? 0.7 : 1 }]} onPress={handleTeamSave} disabled={saving}>
              <ThemedText style={{ color: theme.buttonText, fontWeight: "700" }}>{saving ? "Saving..." : "Save"}</ThemedText>
            </Pressable>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const s = StyleSheet.create({
  errorBox: { margin: Spacing.md, marginBottom: 0, padding: 10, borderRadius: BorderRadius.sm },
  toolbar: {
    paddingHorizontal: Spacing.md, paddingVertical: Spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth, gap: Spacing.sm,
  },
  searchRow: {
    flexDirection: "row", alignItems: "center", gap: Spacing.sm,
    paddingHorizontal: Spacing.sm, minHeight: 40, borderRadius: BorderRadius.md,
  },
  searchInput: { flex: 1, minWidth: 0, fontSize: 14, paddingVertical: 8 },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  chip: {
    flexDirection: "row", alignItems: "center", gap: 5,
    paddingHorizontal: 10, minHeight: 32, borderRadius: BorderRadius.full, borderWidth: 1,
  },
  card: { borderRadius: BorderRadius.md, borderWidth: 1, overflow: "hidden" },
  cardHeader: { flexDirection: "row", alignItems: "center", gap: Spacing.sm, padding: Spacing.md },
  attnRow: {
    flexDirection: "row", alignItems: "center", gap: Spacing.sm,
    paddingHorizontal: Spacing.md, paddingVertical: 10, borderTopWidth: StyleSheet.hairlineWidth,
  },
  reasonPill: { maxWidth: "45%", paddingHorizontal: 8, paddingVertical: 3, borderRadius: BorderRadius.full },
  smallBtn: {
    flexDirection: "row", alignItems: "center", gap: 4,
    paddingHorizontal: 10, paddingVertical: 5, borderRadius: BorderRadius.full, borderWidth: 1,
  },
  row: {
    flexDirection: "row", alignItems: "center", gap: 6,
    paddingRight: Spacing.sm, paddingVertical: 8, minHeight: 52,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  guide: { position: "absolute", top: 0, bottom: 0, width: 1 },
  chevron: { width: 24, height: 28, alignItems: "center", justifyContent: "center" },
  leafDot: { width: 5, height: 5, borderRadius: 3 },
  avatar: { width: 30, height: 30, borderRadius: 15, alignItems: "center", justifyContent: "center" },
  avatarLg: { width: 44, height: 44, borderRadius: 22, alignItems: "center", justifyContent: "center" },
  sidePanel: { width: 380, borderLeftWidth: StyleSheet.hairlineWidth },
  bottomPanel: {
    borderTopWidth: 1, borderTopLeftRadius: 16, borderTopRightRadius: 16,
    ...(Platform.OS === "web"
      ? { boxShadow: "0 -4px 16px rgba(0,0,0,0.12)" }
      : { elevation: 12, shadowColor: "#000", shadowOffset: { width: 0, height: -2 }, shadowOpacity: 0.15, shadowRadius: 8 }),
  } as any,
  crumbs: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", rowGap: 2 },
  flagBox: { flexDirection: "row", alignItems: "center", gap: 8, padding: 10, borderRadius: BorderRadius.sm },
  infoBox: { borderRadius: BorderRadius.md, padding: Spacing.md, gap: 8 },
  infoLine: { flexDirection: "row", alignItems: "flex-start", gap: 8 },
  actions: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  actionBtn: {
    flexDirection: "row", alignItems: "center", gap: 6,
    paddingHorizontal: 12, minHeight: 36, borderRadius: BorderRadius.md, borderWidth: 1,
  },
  reportRow: {
    flexDirection: "row", alignItems: "center", gap: 8,
    paddingVertical: 8, borderBottomWidth: StyleSheet.hairlineWidth,
  },
  inlineSearch: {
    flexDirection: "row", alignItems: "center", gap: Spacing.sm,
    paddingHorizontal: Spacing.sm, borderRadius: BorderRadius.sm, marginBottom: Spacing.sm,
  },
  empty: { alignItems: "center", justifyContent: "center", paddingVertical: 48, paddingHorizontal: 20 },
  overlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.5)", justifyContent: "flex-end" },
  sheet: {
    borderTopLeftRadius: 20, borderTopRightRadius: 20,
    padding: Spacing.lg, paddingBottom: 32, maxHeight: "85%",
    width: "100%", maxWidth: 640, alignSelf: "center",
  },
  option: {
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    padding: 10, borderRadius: 8, marginBottom: 4, gap: 8,
  },
  saveBtn: { padding: 14, borderRadius: BorderRadius.md, alignItems: "center", justifyContent: "center" },
  treeBox: { padding: Spacing.sm, borderRadius: BorderRadius.sm, minHeight: 80, maxHeight: 280 },
  warningRow: { padding: 8, borderRadius: 6, marginBottom: 4 },
  statChip: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 20 },
  uploadBox: {
    width: "100%", borderWidth: 2, borderStyle: "dashed",
    borderRadius: BorderRadius.lg, paddingVertical: 28,
    alignItems: "center", justifyContent: "center",
  },
});
