import React, { useState, useCallback } from "react";
import {
  StyleSheet, View, ScrollView, Pressable, Modal,
  TextInput, RefreshControl, Alert, ActivityIndicator, Platform,
} from "react-native";
import Feather from "@expo/vector-icons/Feather";
import { useFocusEffect } from "@react-navigation/native";
import { ThemedText } from "@/components/ThemedText";
import { useTheme } from "@/hooks/useTheme";
import { Spacing, BorderRadius, Colors } from "@/constants/theme";
import Spacer from "@/components/Spacer";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/contexts/AuthContext";
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

interface Profile {
  id: string;
  name: string;
  role: string;
  team: string | null;
  reports_to: string | null;
  phone: string | null;
  employee_number: string | null;
  email: string | null;
}

const ADMIN_ROLES = ["SYSTEM_ADMIN", "ADMIN", "HR", "HRD"];
const AP_ROLE = "ASSOCIATE_PARTNER";

function isAP(role: string) { return normalizeUserRole(role) === AP_ROLE; }
function isAdmin(role: string) { return ADMIN_ROLES.includes(normalizeUserRole(role)); }
function isAgent(role: string) { return !isAP(role) && !isAdmin(role); }

interface TreeNode { profile: Profile; children: TreeNode[]; }

function buildTree(parentId: string, all: Profile[]): TreeNode[] {
  return all
    .filter((p) => p.reports_to === parentId)
    .map((p) => ({ profile: p, children: buildTree(p.id, all) }));
}

function AgentNode({ node, depth, onAssign, onUnassign, canEdit, theme }: {
  node: TreeNode; depth: number;
  onAssign: (p: Profile) => void;
  onUnassign: (p: Profile) => void;
  canEdit: boolean; theme: any;
}) {
  const [expanded, setExpanded] = useState(true);
  const indent = depth * 14;
  return (
    <View>
      <View style={[s.agentRow, { marginLeft: indent }]}>
        {depth > 0 && <View style={[s.treeLine, { borderColor: theme.primary + "30" }]} />}
        <View style={{ flex: 1 }}>
          <ThemedText type="caption" style={{ fontWeight: "700", color: theme.text }}>{node.profile.name}</ThemedText>
          <ThemedText type="caption" style={{ color: theme.textSecondary, fontSize: 11 }}>
            {node.profile.role?.replace(/_/g, " ")}
            {node.profile.employee_number ? ` · #${node.profile.employee_number}` : ""}
          </ThemedText>
          {isSalesManagerRole(node.profile.role) ? (
            <ThemedText type="caption" style={{ color: theme.primary, fontSize: 10, fontWeight: "700" }}>
              Manages {salesManagerDirectReportLabel()}
            </ThemedText>
          ) : null}
        </View>
        <View style={{ flexDirection: "row", gap: 4 }}>
          {node.children.length > 0 && (
            <Pressable onPress={() => setExpanded((v) => !v)} style={s.iconBtn}>
              <Feather name={expanded ? "chevron-up" : "chevron-down"} size={13} color={theme.textSecondary} />
            </Pressable>
          )}
          {canEdit && (
            <>
              <Pressable style={[s.iconBtn, { backgroundColor: Colors.light.primary + "15" }]} onPress={() => onAssign(node.profile)}>
                <Feather name="user-plus" size={13} color={Colors.light.primary} />
              </Pressable>
              <Pressable style={[s.iconBtn, { backgroundColor: Colors.light.error + "15" }]} onPress={() => onUnassign(node.profile)}>
                <Feather name="user-minus" size={13} color={Colors.light.error} />
              </Pressable>
            </>
          )}
        </View>
      </View>
      {expanded && node.children.map((child) => (
        <AgentNode key={child.profile.id} node={child} depth={depth + 1}
          onAssign={onAssign} onUnassign={onUnassign} canEdit={canEdit} theme={theme} />
      ))}
    </View>
  );
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

// ─── Keyword detection helpers ────────────────────────────────────────────────
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

// ─── Build indented tree text from results ────────────────────────────────────
function buildTreeText(
  rows: ImportResult[],
  _allProfiles: Profile[],
  importRows: ImportRow[]
): string {
  return rows.map((result, index) => {
    const row = importRows[index];
    const ownId = employeeIdentity(row) ?? "missing identity";
    const managerId = managerIdentity(row) ?? "top level";
    return `${result.empName} [${ownId}] → ${result.parentName ?? managerId}`;
  }).join("\n");
}

// ─── Main bulk import logic ───────────────────────────────────────────────────
async function processImportFile(
  rows: ImportRow[],
  allProfiles: Profile[]
): Promise<ImportSummary> {
  const warnings: string[] = [];
  const results: ImportResult[] = [];

  const profileByIdentity = new Map<string, Profile>();
  for (const profile of allProfiles) {
    if (profile.employee_number)
      profileByIdentity.set(
        `number:${profile.employee_number.trim().toLowerCase()}`,
        profile,
      );
    if (profile.email)
      profileByIdentity.set(
        `email:${profile.email.trim().toLowerCase()}`,
        profile,
      );
  }
  const rowByIdentity = new Map<string, ImportRow>();
  const duplicateIdentities = new Set<string>();
  for (const row of rows) {
    for (const identity of [
      row.employeeNumber
        ? `number:${row.employeeNumber.trim().toLowerCase()}`
        : null,
      row.email ? `email:${row.email.trim().toLowerCase()}` : null,
    ].filter(Boolean) as string[]) {
      if (rowByIdentity.has(identity)) duplicateIdentities.add(identity);
      else rowByIdentity.set(identity, row);
    }
  }

  const detectCycle = (
    startIdentity: string,
    currentIdentity: string,
    visited = new Set<string>(),
  ): boolean => {
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

    const isNew = !profileByIdentity.has(identity);
    results.push({
      empName,
      parentName,
      parentId,
      isNew,
      warning: relationshipWarning,
    });
  }

  const treeText = buildTreeText(results, allProfiles, rows);
  return { rows: results, warnings, treeText };
}

export default function TeamHierarchyScreen() {
  const { theme } = useTheme();
  const { user } = useAuth();
  const canEdit = ["SYSTEM_ADMIN", "ADMIN"].includes(user?.role ?? "");

  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [hierarchyError, setHierarchyError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [search, setSearch] = useState("");
  const [saving, setSaving] = useState(false);
  const [quickAssignSearch, setQuickAssignSearch] = useState("");

  // ── Bulk import state ──────────────────────────────────────────────────────
  const [importModal, setImportModal] = useState(false);
  const [importLoading, setImportLoading] = useState(false);
  const [importSummary, setImportSummary] = useState<ImportSummary | null>(null);
  const [importRows, setImportRows] = useState<ImportRow[]>([]);
  const [importBatchId, setImportBatchId] = useState<string | null>(null);
  const [importCommitting, setImportCommitting] = useState(false);
  const [importDone, setImportDone] = useState<{ success: number; warnings: number } | null>(null);

  // Set team head modal
  const [teamHeadModal, setTeamHeadModal] = useState(false);
  const [teamHeadTarget, setTeamHeadTarget] = useState<{ teamName: string; currentHeadId: string | null } | null>(null);
  const [teamHeadSearch, setTeamHeadSearch] = useState("");
  const [selectedAPId, setSelectedAPId] = useState<string>("");

  // Individual assign modal
  const [assignModal, setAssignModal] = useState(false);
  const [assignTarget, setAssignTarget] = useState<Profile | null>(null);
  const [assignTo, setAssignTo] = useState<string>("");
  const [assignSearch, setAssignSearch] = useState("");

  // ── Excel file picker & parser ─────────────────────────────────────────────
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

      const uri = result.assets[0].uri;
      // Read file - use fetch for both web and native (Expo handles file:// URIs)
      const resp = await fetch(uri);
      const ab = await resp.arrayBuffer();
      const XLSX = await import("xlsx");
      const workbook = XLSX.read(ab, { type: "array" });

      const sheet = workbook.Sheets[workbook.SheetNames[0]];
      const raw: any[][] = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: "" });
      if (raw.length < 2) { setImportLoading(false); Alert.alert("Error", "File appears empty."); return; }

      // Find header row (first non-empty row)
      const header: string[] = (raw[0] as string[]).map((h: string) => (h ?? "").toString().trim().toLowerCase());

      const headerKey = (value: string) =>
        value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
      const colIdx = (aliases: string[]): number => {
        const allowed = new Set(aliases.map(headerKey));
        return header.findIndex((value) => allowed.has(headerKey(value)));
      };

      const empCol = colIdx(["employee name", "emp name", "empname"]);
      const employeeNumberCol = colIdx([
        "employee number", "employee no", "emp no", "emp code",
      ]);
      const emailCol = colIdx(["employee email", "email"]);
      const managerEmployeeNumberCol = colIdx([
        "manager employee number", "manager employee no",
        "reporting manager employee number", "reporting manager emp no",
      ]);
      const managerEmailCol = colIdx([
        "manager email", "reporting manager email",
      ]);
      const teamCol = colIdx(["team", "department"]);
      const desigCol = colIdx(["designation", "role"]);
      const contactCol = colIdx(["contact", "phone", "mobile"]);
      const locCol = colIdx(["location", "office"]);

      const missing: string[] = [];
      if (empCol === -1) missing.push("Emp Name");
      if (desigCol === -1) missing.push("DESIGNATION");
      if (employeeNumberCol === -1 && emailCol === -1)
        missing.push("Employee Number or Employee Email");
      if (managerEmployeeNumberCol === -1 && managerEmailCol === -1)
        missing.push("Manager Employee Number or Manager Email");
      if (missing.length) {
        setImportLoading(false);
        Alert.alert("Missing Columns", `Missing required column(s): ${missing.join(", ")}. Please check your file.`);
        return;
      }

      const parsed: ImportRow[] = [];
      for (let i = 1; i < raw.length; i++) {
        const row = raw[i] as string[];
        const empName = (row[empCol] ?? "").toString().trim();
        if (!empName) continue; // skip blank rows
        parsed.push({
          empName,
          employeeNumber:
            employeeNumberCol >= 0
              ? (row[employeeNumberCol] ?? "").toString().trim()
              : "",
          email:
            emailCol >= 0
              ? (row[emailCol] ?? "").toString().trim().toLowerCase()
              : "",
          managerEmployeeNumber:
            managerEmployeeNumberCol >= 0
              ? (row[managerEmployeeNumberCol] ?? "").toString().trim()
              : "",
          managerEmail:
            managerEmailCol >= 0
              ? (row[managerEmailCol] ?? "").toString().trim().toLowerCase()
              : "",
          contact: contactCol >= 0 ? (row[contactCol] ?? "").toString().trim() : "",
          team: teamCol >= 0 ? (row[teamCol] ?? "").toString().trim() : "",
          designation: desigCol >= 0 ? (row[desigCol] ?? "").toString().trim() : "",
          location: locCol >= 0 ? (row[locCol] ?? "").toString().trim() : "",
        });
      }

      const invalidIdentity = parsed.find(
        (row) => !row.employeeNumber && !row.email,
      );
      if (invalidIdentity) {
        setImportLoading(false);
        Alert.alert(
          "Employee identity required",
          `${invalidIdentity.empName} has neither an employee number nor an email. Names are never used as identifiers.`,
        );
        return;
      }
      setImportBatchId(Crypto.randomUUID());
      setImportRows(parsed);
      const summary = await processImportFile(parsed, profiles);
      setImportSummary(summary);
      setImportLoading(false);
    } catch (e: any) {
      setImportLoading(false);
      Alert.alert("Error reading file", e?.message ?? "Unknown error");
    }
  };

  // ── Commit hierarchy to database ──────────────────────────────────────────
  const handleCommitImport = async () => {
    if (!importSummary || !importBatchId) return;
    if (importSummary.warnings.length > 0) {
      Alert.alert(
        "Resolve import warnings",
        "No changes were applied. Every identity and manager relationship must be valid before the transactional import can run.",
      );
      return;
    }
    setImportCommitting(true);
    try {
      const rows = importRows.map((row) => ({
        name: row.empName,
        employee_number: row.employeeNumber || null,
        email: row.email || null,
        manager_employee_number: row.managerEmployeeNumber || null,
        manager_email: row.managerEmail || null,
        phone: row.contact || null,
        role: row.designation || "Agent",
        team: row.team || null,
      }));
      const { data, error } = await supabase.rpc(
        "rpc_admin_apply_hierarchy_import",
        { p_batch_id: importBatchId, p_rows: rows },
      );
      if (error) throw error;
      const response = firstRpcRow<any>(data);
      if (
        response?.success !== true ||
        response?.batch_id !== importBatchId ||
        Number(response?.processed) !== rows.length ||
        Number(response?.updated) !== rows.length
      ) throw new Error("The server did not confirm the complete hierarchy transaction.");

      setImportDone({ success: rows.length, warnings: 0 });
      setImportSummary(null);
      await loadData();
    } catch (e: any) {
      Alert.alert(
        "Import not confirmed",
        `${e?.message ?? "Unknown error."}\n\nThe same batch ID is preserved. Retry safely checks the exact transaction without applying it twice.`,
      );
    } finally {
      setImportCommitting(false);
    }
  };

  const loadData = useCallback(async () => {
    const result = await fetchAllPages<Profile>((from, to) =>
      supabase
        .from("profiles")
        .select("id, name, role, team, reports_to, phone, employee_number, email")
        .eq("is_active", true)
        .order("name")
        .order("id")
        .range(from, to),
    );
    if (result.error) {
      setHierarchyError(result.error.message);
      throw result.error;
    }
    setProfiles(result.data || []);
    setHierarchyError(null);
  }, []);

  useFocusEffect(useCallback(() => { loadData(); }, [loadData]));
  const onRefresh = async () => { setRefreshing(true); await loadData(); setRefreshing(false); };

  const associatePartners = profiles.filter((p) => isAP(p.role));
  const agents = profiles.filter((p) => isAgent(p.role));

  const teamNames = Array.from(
    new Set(agents.map((p) => p.team?.trim()).filter(Boolean) as string[])
  ).sort();

  // Determine the AP head of a team by finding which AP most members report to
  const getTeamHeadId = (teamName: string): string | null => {
    const members = agents.filter((p) => p.team?.trim().toLowerCase() === teamName.trim().toLowerCase());
    const counts: Record<string, number> = {};
    for (const m of members) {
      if (m.reports_to) {
        const ap = profiles.find((p) => p.id === m.reports_to && isAP(p.role));
        if (ap) counts[ap.id] = (counts[ap.id] || 0) + 1;
      }
    }
    const entries = Object.entries(counts);
    if (!entries.length) return null;
    return entries.sort((a, b) => b[1] - a[1])[0][0];
  };

  const openTeamHeadModal = (teamName: string) => {
    const headId = getTeamHeadId(teamName);
    setTeamHeadTarget({ teamName, currentHeadId: headId });
    setSelectedAPId(headId ?? "");
    setTeamHeadSearch("");
    setTeamHeadModal(true);
  };

  const applyHierarchyUpdates = async (
    updates: Array<Record<string, unknown>>,
  ) => {
    const { data, error } = await supabase.rpc(
      "rpc_admin_update_hierarchy_v2",
      { p_updates: updates },
    );
    if (error) throw error;
    const response = firstRpcRow<any>(data);
    if (
      response?.success !== true ||
      Number(response?.updated) !== updates.length
    ) throw new Error("The server did not confirm every hierarchy update.");
  };

  // Assign ALL members of a team under the selected AP
  const handleSetTeamHead = async () => {
    if (!teamHeadTarget) return;
    setSaving(true);
    const members = agents.filter(
      (p) => p.team?.trim().toLowerCase() === teamHeadTarget.teamName.trim().toLowerCase()
    );
    try {
      await applyHierarchyUpdates(members.map((member) => ({
        id: member.id,
        reports_to: selectedAPId || null,
      })));
      setTeamHeadModal(false);
      await loadData();
    } catch (error: any) {
      Alert.alert("Assignment failed", error?.message || "Nothing was confirmed.");
    } finally {
      setSaving(false);
    }
  };

  const openAssignModal = (agent: Profile) => {
    setAssignTarget(agent);
    setAssignTo(agent.reports_to ?? "");
    setAssignSearch("");
    setAssignModal(true);
  };

  const handleUnassign = async (agent: Profile) => {
    const ok = typeof window !== "undefined"
      ? window.confirm(`Remove ${agent.name} from their current assignment?`)
      : false;
    if (!ok) return;
    try {
      await applyHierarchyUpdates([{ id: agent.id, reports_to: null }]);
      await loadData();
    } catch (error: any) {
      Alert.alert("Unassign failed", error?.message || "Nothing was confirmed.");
    }
  };

  const handleAssignSave = async () => {
    if (!assignTarget) return;
    const manager = assignTo
      ? profiles.find((profile) => profile.id === assignTo)
      : null;
    if (manager && !canAssignReportingManager(assignTarget.role, manager.role)) {
      Alert.alert(
        "Role cannot report to Sales Manager",
        `Only ${salesManagerDirectReportLabel()} can be assigned directly under a Sales Manager.`,
      );
      return;
    }
    setSaving(true);
    try {
      await applyHierarchyUpdates([
        { id: assignTarget.id, reports_to: assignTo || null },
      ]);
      setAssignModal(false);
      await loadData();
    } catch (error: any) {
      Alert.alert("Assignment failed", error?.message || "Nothing was confirmed.");
    } finally {
      setSaving(false);
    }
  };

  const getDescendantIds = (id: string): Set<string> => {
    const result = new Set<string>();
    const queue = [id];
    while (queue.length) {
      const cur = queue.shift()!;
      profiles.filter((p) => p.reports_to === cur).forEach((p) => { result.add(p.id); queue.push(p.id); });
    }
    return result;
  };

  const validParents = assignTarget
    ? profiles.filter((p) => {
        if (p.id === assignTarget.id) return false;
        if (getDescendantIds(assignTarget.id).has(p.id)) return false;
        if (!canAssignReportingManager(assignTarget.role, p.role)) return false;
        return isAP(p.role) || isAgent(p.role);
      })
    : [];

  const filteredParents = assignSearch
    ? validParents.filter((p) =>
        p.name.toLowerCase().includes(assignSearch.toLowerCase()) ||
        (p.role ?? "").toLowerCase().includes(assignSearch.toLowerCase())
      )
    : validParents;

    const matchSearch = (p: Profile) =>
    !search ||
    p.name.toLowerCase().includes(search.toLowerCase()) ||
    (p.team ?? "").toLowerCase().includes(search.toLowerCase()) ||
    (p.role ?? "").toLowerCase().includes(search.toLowerCase());

  // Function to filter a tree: keep a node if it matches, or if any descendants match.
  // We don't filter out ancestors of matched nodes.
  function filterTree(nodes: TreeNode[]): TreeNode[] {
    if (!search) return nodes;
    const filtered: TreeNode[] = [];
    for (const node of nodes) {
      const children = filterTree(node.children);
      if (children.length > 0 || matchSearch(node.profile)) {
        filtered.push({ ...node, children });
      }
    }
    return filtered;
  }

  const filteredTeams = teamNames.filter((t) =>
    !search ||
    t.toLowerCase().includes(search.toLowerCase()) ||
    agents.filter((a) => a.team?.trim().toLowerCase() === t.toLowerCase()).some(matchSearch)
  );

  const noTeamAgents = agents.filter((p) => !p.team?.trim() && matchSearch(p));
  const visibleSalesManagers = profiles.filter(
    (profile) => isSalesManagerRole(profile.role) && matchSearch(profile),
  );

  return (
    <View style={{ flex: 1, backgroundColor: theme.backgroundRoot }}>
      {hierarchyError ? (
        <View style={{ margin: 12, padding: 10, borderRadius: 8, backgroundColor: "#FEE2E2" }}>
          <ThemedText style={{ color: "#991B1B", fontWeight: "700" }}>
            Hierarchy data unavailable: {hierarchyError}
          </ThemedText>
        </View>
      ) : null}

      {/* BULK IMPORT BUTTON — always visible at top, high zIndex */}
      {canEdit && (
        <Pressable
          style={[
            s.floatingImportBtn,
            { backgroundColor: "#7C3AED" },
          ]}
          onPress={() => { setImportModal(true); setImportSummary(null); setImportDone(null); }}
        >
          <Feather name="upload" size={16} color="#fff" />
          <ThemedText style={{ color: "#fff", fontWeight: "800", marginLeft: 8, fontSize: 14 }}>
            📂 Bulk Import Hierarchy (Excel / CSV)
          </ThemedText>
        </Pressable>
      )}

      {/* Search bar - moved below bulk import button */}
      <View style={[s.topBar, { backgroundColor: theme.backgroundDefault, borderBottomColor: theme.border ?? "#E5E7EB" }]}>
        <View style={[s.searchRow, { backgroundColor: theme.backgroundRoot }]}>
          <Feather name="search" size={16} color={theme.textSecondary} />
          <TextInput
            style={[s.searchInput, { color: theme.text }]}
            placeholder="Search name, team or role..."
            placeholderTextColor={theme.textSecondary}
            value={search}
            onChangeText={setSearch}
          />
          {search ? <Pressable onPress={() => setSearch("")}><Feather name="x" size={16} color={theme.textSecondary} /></Pressable> : null}
        </View>
      </View>

      {/* ── Quick Assign: search the person to assign ── */}
      {canEdit && (
        <View style={[s.quickAssignBox, { backgroundColor: theme.backgroundDefault }]}>
          <ThemedText type="caption" style={{ color: theme.textSecondary, fontWeight: "700", marginBottom: 6 }}>
            🔍 Quick Assign — find person to assign
          </ThemedText>
          <View style={[s.inlineSearch, { backgroundColor: theme.backgroundRoot }]}>
            <Feather name="user" size={14} color={theme.textSecondary} />
            <TextInput
              style={[s.searchInput, { color: theme.text, fontSize: 13 }]}
              placeholder="Type name or role..."
              placeholderTextColor={theme.textSecondary}
              value={quickAssignSearch}
              onChangeText={setQuickAssignSearch}
            />
            {quickAssignSearch ? <Pressable onPress={() => setQuickAssignSearch("")}><Feather name="x" size={14} color={theme.textSecondary} /></Pressable> : null}
          </View>
          {quickAssignSearch.trim().length > 0 && (
            <ScrollView style={{ maxHeight: 200 }} nestedScrollEnabled keyboardShouldPersistTaps="handled">
              {agents
                .filter((p) =>
                  p.name.toLowerCase().includes(quickAssignSearch.toLowerCase()) ||
                  (p.role ?? "").toLowerCase().includes(quickAssignSearch.toLowerCase())
                )
                .slice(0, 15)
                .map((p) => {
                  const reportsTo = p.reports_to ? profiles.find((x) => x.id === p.reports_to) : null;
                  return (
                    <Pressable
                      key={p.id}
                      style={[s.quickAssignRow, { borderBottomColor: theme.border ?? "#E5E7EB" }]}
                      onPress={() => { setQuickAssignSearch(""); openAssignModal(p); }}
                    >
                      <View style={{ flex: 1 }}>
                        <ThemedText type="caption" style={{ fontWeight: "700" }}>{p.name}</ThemedText>
                        <ThemedText type="caption" style={{ color: theme.textSecondary, fontSize: 11 }}>
                          {p.role?.replace(/_/g, " ")}{p.team ? ` · ${p.team}` : ""}
                        </ThemedText>
                        {reportsTo && (
                          <ThemedText type="caption" style={{ color: theme.primary, fontSize: 11 }}>
                            Reports to: {reportsTo.name}
                          </ThemedText>
                        )}
                      </View>
                      <View style={[s.iconBtn, { backgroundColor: Colors.light.primary + "15" }]}>
                        <Feather name="user-plus" size={13} color={Colors.light.primary} />
                      </View>
                    </Pressable>
                  );
                })}
              {agents.filter((p) =>
                p.name.toLowerCase().includes(quickAssignSearch.toLowerCase()) ||
                (p.role ?? "").toLowerCase().includes(quickAssignSearch.toLowerCase())
              ).length === 0 && (
                <ThemedText type="caption" style={{ color: theme.textSecondary, padding: 10, fontStyle: "italic" }}>
                  No employees found
                </ThemedText>
              )}
            </ScrollView>
          )}
        </View>
      )}

      <ScrollView
        contentContainerStyle={{ padding: Spacing.md, gap: Spacing.md, paddingBottom: 80 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={theme.primary} />}
      >
        <View style={[s.teamCard, { backgroundColor: theme.backgroundDefault }]}>
          <View style={[s.teamHeader, { backgroundColor: Colors.light.warning + "12" }]}>
            <View style={[s.teamAvatar, { backgroundColor: Colors.light.warning + "22" }]}>
              <Feather name="briefcase" size={16} color={Colors.light.warning} />
            </View>
            <View style={{ flex: 1 }}>
              <ThemedText type="body" style={{ fontWeight: "800" }}>
                Sales Manager Positions
              </ThemedText>
              <ThemedText type="caption" style={{ color: theme.textSecondary }}>
                Direct reports: {salesManagerDirectReportLabel()}
              </ThemedText>
            </View>
          </View>
          <View style={{ padding: Spacing.sm, gap: 4 }}>
            {visibleSalesManagers.length === 0 ? (
              <ThemedText type="caption" style={{ color: theme.textSecondary, fontStyle: "italic", padding: 8 }}>
                No Sales Manager has been created yet. Add one in User Management, then assign Sales Executives, Telecallers or Agents here.
              </ThemedText>
            ) : visibleSalesManagers.map((manager) => {
              const directReports = profiles.filter(
                (profile) =>
                  profile.reports_to === manager.id &&
                  canReportToSalesManager(profile.role),
              );
              return (
                <View key={manager.id} style={s.agentRow}>
                  <View style={{ flex: 1 }}>
                    <ThemedText type="caption" style={{ fontWeight: "800", color: Colors.light.warning }}>
                      {manager.name}
                    </ThemedText>
                    <ThemedText type="caption" style={{ color: theme.textSecondary, fontSize: 11 }}>
                      Sales Manager{manager.team ? ` · ${manager.team}` : ""} · {directReports.length} direct report{directReports.length !== 1 ? "s" : ""}
                    </ThemedText>
                  </View>
                  {canEdit ? (
                    <Pressable
                      style={[s.iconBtn, { backgroundColor: Colors.light.warning + "18" }]}
                      onPress={() => openAssignModal(manager)}
                    >
                      <Feather name="git-branch" size={13} color={Colors.light.warning} />
                    </Pressable>
                  ) : null}
                </View>
              );
            })}
          </View>
        </View>

                  {filteredTeams.map((teamName) => {
            // Get all agents for this team (unfiltered by search to build full tree first)
            const allTeamMembers = agents.filter(
              (a) => a.team?.trim().toLowerCase() === teamName.trim().toLowerCase()
            );
            const headId = getTeamHeadId(teamName);
            const head = headId ? profiles.find((p) => p.id === headId) : null;
            
            // Build full tree first
            const fullTree = headId ? buildTree(headId, allTeamMembers) : [];
            
            // Then filter tree preserving paths to matches
            const tree = filterTree(fullTree);

            // Unrooted members (those whose chain doesn't lead to headId)
            const allUnrooted = headId
              ? allTeamMembers.filter((m) => {
                  let cur: Profile | undefined = m;
                  while (cur && cur.reports_to) {
                    if (cur.reports_to === headId) return false;
                    cur = profiles.find((p) => p.id === cur!.reports_to);
                  }
                  return true;
                })
              : allTeamMembers;
              
            const unrooted = allUnrooted.filter(matchSearch);

          return (
            <View key={teamName} style={[s.teamCard, { backgroundColor: theme.backgroundDefault }]}>
              {/* Team header row */}
              <View style={[s.teamHeader, { backgroundColor: theme.primary + "10" }]}>
                <View style={[s.teamAvatar, { backgroundColor: theme.primary + "20" }]}>
                  <Feather name="users" size={16} color={theme.primary} />
                </View>
                <View style={{ flex: 1 }}>
                  <ThemedText type="body" style={{ fontWeight: "800" }}>{teamName}</ThemedText>
                  <ThemedText type="caption" style={{ color: theme.textSecondary }}>
                    {teamMembers.length} member{teamMembers.length !== 1 ? "s" : ""}
                    {head ? ` · Head: ${head.name}` : " · No head set"}
                  </ThemedText>
                </View>
                {canEdit && (
                  <Pressable
                    style={[s.setHeadBtn, { borderColor: theme.primary }]}
                    onPress={() => openTeamHeadModal(teamName)}
                  >
                    <Feather name="star" size={13} color={theme.primary} />
                    <ThemedText type="caption" style={{ color: theme.primary, fontWeight: "700", fontSize: 11 }}>
                      {head ? "Change Head" : "Set Head"}
                    </ThemedText>
                  </Pressable>
                )}
              </View>

              {/* AP head banner */}
              {head && (
                <View style={[s.headBanner, { backgroundColor: theme.primary + "08" }]}>
                  <View style={[s.starBadge, { backgroundColor: theme.primary + "20" }]}>
                    <Feather name="star" size={12} color={theme.primary} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <ThemedText type="caption" style={{ fontWeight: "800", color: theme.primary }}>{head.name}</ThemedText>
                    <ThemedText type="caption" style={{ color: theme.primary + "80", fontSize: 11 }}>Associate Partner · Team Head</ThemedText>
                  </View>
                </View>
              )}

              {/* Tree */}
              <View style={{ paddingHorizontal: Spacing.sm, paddingBottom: Spacing.sm }}>
                {tree.length === 0 && unrooted.length === 0 && (
                  <ThemedText type="caption" style={{ color: theme.textSecondary, fontStyle: "italic", padding: 8 }}>
                    No members assigned yet
                  </ThemedText>
                )}
                {tree.map((node) => (
                  <AgentNode key={node.profile.id} node={node} depth={0}
                    onAssign={openAssignModal} onUnassign={handleUnassign}
                    canEdit={canEdit} theme={theme} />
                ))}

                {unrooted.length > 0 && (
                  <>
                    {headId && tree.length > 0 && (
                      <View style={s.divider}>
                        <ThemedText type="caption" style={{ color: "#F59E0B", fontSize: 10, fontWeight: "700" }}>
                          NOT YET UNDER TEAM HEAD
                        </ThemedText>
                      </View>
                    )}
                    {unrooted.map((agent) => (
                      <View key={agent.id} style={s.agentRow}>
                        <View style={{ flex: 1 }}>
                          <ThemedText type="caption" style={{ fontWeight: "600" }}>{agent.name}</ThemedText>
                          <ThemedText type="caption" style={{ color: theme.textSecondary, fontSize: 11 }}>
                            {agent.role?.replace(/_/g, " ")}
                            {agent.employee_number ? ` · #${agent.employee_number}` : ""}
                          </ThemedText>
                        </View>
                        {canEdit && (
                          <Pressable style={[s.iconBtn, { backgroundColor: Colors.light.primary + "15" }]} onPress={() => openAssignModal(agent)}>
                            <Feather name="user-plus" size={13} color={Colors.light.primary} />
                          </Pressable>
                        )}
                      </View>
                    ))}
                  </>
                )}
              </View>
            </View>
          );
        })}

        {/* No-team agents */}
        {noTeamAgents.length > 0 && (
          <View style={[s.teamCard, { backgroundColor: theme.backgroundDefault }]}>
            <View style={[s.teamHeader, { backgroundColor: "#9CA3AF10" }]}>
              <View style={[s.teamAvatar, { backgroundColor: "#9CA3AF25" }]}>
                <Feather name="user" size={16} color="#9CA3AF" />
              </View>
              <View style={{ flex: 1 }}>
                <ThemedText type="body" style={{ fontWeight: "700", color: "#6B7280" }}>No Team Assigned</ThemedText>
                <ThemedText type="caption" style={{ color: "#9CA3AF" }}>
                  {noTeamAgents.length} agent{noTeamAgents.length !== 1 ? "s" : ""}
                </ThemedText>
              </View>
            </View>
            <View style={{ padding: Spacing.sm, gap: 4 }}>
              {noTeamAgents.map((agent) => (
                <View key={agent.id} style={s.agentRow}>
                  <View style={{ flex: 1 }}>
                    <ThemedText type="caption" style={{ fontWeight: "600" }}>{agent.name}</ThemedText>
                    <ThemedText type="caption" style={{ color: theme.textSecondary, fontSize: 11 }}>
                      {agent.role?.replace(/_/g, " ")}
                      {agent.employee_number ? ` · #${agent.employee_number}` : ""}
                    </ThemedText>
                  </View>
                  {canEdit && (
                    <Pressable style={[s.iconBtn, { backgroundColor: Colors.light.primary + "15" }]} onPress={() => openAssignModal(agent)}>
                      <Feather name="user-plus" size={13} color={Colors.light.primary} />
                    </Pressable>
                  )}
                </View>
              ))}
            </View>
          </View>
        )}

        {teamNames.length === 0 && noTeamAgents.length === 0 && (
          <View style={s.empty}>
            <Feather name="users" size={40} color={theme.textSecondary} />
            <Spacer height={Spacing.md} />
            <ThemedText type="body" style={{ color: theme.textSecondary }}>No teams found</ThemedText>
          </View>
        )}
      </ScrollView>

      {/* ── Bulk Import Modal ── */}
      <Modal visible={importModal} transparent animationType="slide" onRequestClose={() => setImportModal(false)}>
        <View style={s.overlay}>
          <Pressable style={StyleSheet.absoluteFill} onPress={() => setImportModal(false)} />
          <View style={[s.sheet, { backgroundColor: theme.backgroundDefault, maxHeight: "92%" }]}>
            <View style={{ flexDirection: "row", alignItems: "center", marginBottom: Spacing.sm }}>
              <ThemedText type="h3" style={{ flex: 1 }}>📂 Bulk Hierarchy Import</ThemedText>
              <Pressable onPress={() => setImportModal(false)}>
                <Feather name="x" size={20} color={theme.textSecondary} />
              </Pressable>
            </View>
            <ThemedText type="caption" style={{ color: theme.textSecondary, marginBottom: Spacing.md }}>
              Upload an Excel (.xlsx) or CSV file with columns: Emp Name, TEAM, DESIGNATION, CONTACT, LOCATION.
            </ThemedText>

            {importDone ? (
              <View style={{ alignItems: "center", padding: Spacing.xl }}>
                <Feather name="check-circle" size={40} color="#10B981" />
                <Spacer height={12} />
                <ThemedText type="h3" style={{ color: "#10B981" }}>Import Complete!</ThemedText>
                <ThemedText type="caption" style={{ color: theme.textSecondary, marginTop: 6 }}>
                  {importDone.success} employees assigned · {importDone.warnings} warning{importDone.warnings !== 1 ? "s" : ""}
                </ThemedText>
                <Spacer height={Spacing.lg} />
                <Pressable style={[s.saveBtn, { backgroundColor: theme.primary }]} onPress={() => { setImportModal(false); setImportDone(null); }}>
                  <ThemedText type="body" style={{ color: "#fff", fontWeight: "700" }}>Close</ThemedText>
                </Pressable>
              </View>
            ) : importLoading ? (
              <View style={{ alignItems: "center", padding: Spacing.xl }}>
                <ActivityIndicator color={theme.primary} size="large" />
                <ThemedText type="caption" style={{ color: theme.textSecondary, marginTop: 12 }}>Parsing file…</ThemedText>
              </View>
            ) : importSummary ? (
              <ScrollView showsVerticalScrollIndicator={false} nestedScrollEnabled>
                {/* Summary counts */}
                <View style={{ flexDirection: "row", gap: 8, marginBottom: Spacing.sm, flexWrap: "wrap" }}>
                  <View style={[s.statChip, { backgroundColor: "#10B98120" }]}>
                    <ThemedText type="caption" style={{ color: "#10B981", fontWeight: "700" }}>
                      ✅ {importSummary.rows.filter(r => !r.warning).length} Ready
                    </ThemedText>
                  </View>
                  <View style={[s.statChip, { backgroundColor: "#3B82F620" }]}>
                    <ThemedText type="caption" style={{ color: "#3B82F6", fontWeight: "700" }}>
                      🆕 {importSummary.rows.filter(r => r.isNew && !r.warning).length} New
                    </ThemedText>
                  </View>
                  <View style={[s.statChip, { backgroundColor: "#F59E0B20" }]}>
                    <ThemedText type="caption" style={{ color: "#F59E0B", fontWeight: "700" }}>
                      ⚠️ {importSummary.warnings.length} Warnings
                    </ThemedText>
                  </View>
                </View>

                {/* Tree preview */}
                <ThemedText type="caption" style={{ fontWeight: "700", color: theme.text, marginBottom: 4 }}>Hierarchy Preview</ThemedText>
                <View style={[s.treeBox, { backgroundColor: theme.backgroundRoot }]}>
                  <ThemedText type="caption" style={{ fontFamily: "monospace", color: theme.text, fontSize: 11, lineHeight: 18 }}>
                    {importSummary.treeText || "(empty)"}
                  </ThemedText>
                </View>

                {/* Warnings */}
                {importSummary.warnings.length > 0 && (
                  <>
                    <ThemedText type="caption" style={{ fontWeight: "700", color: "#F59E0B", marginTop: Spacing.md, marginBottom: 4 }}>
                      ⚠️ Warnings ({importSummary.warnings.length})
                    </ThemedText>
                    {importSummary.warnings.map((w, i) => (
                      <View key={i} style={[s.warningRow, { backgroundColor: "#FEF3C7" }]}>
                        <ThemedText type="caption" style={{ color: "#92400E", fontSize: 11 }}>{w}</ThemedText>
                      </View>
                    ))}
                  </>
                )}

                <Spacer height={Spacing.lg} />
                <View style={{ flexDirection: "row", gap: 8 }}>
                  <Pressable
                    style={[s.saveBtn, { flex: 1, backgroundColor: theme.backgroundSecondary ?? "#E5E7EB" }]}
                    onPress={() => { setImportSummary(null); }}
                  >
                    <ThemedText type="caption" style={{ fontWeight: "700" }}>Re-upload</ThemedText>
                  </Pressable>
                  <Pressable
                    style={[s.saveBtn, {
                      flex: 2,
                      backgroundColor: "#7C3AED",
                      opacity:
                        importCommitting || importSummary.warnings.length > 0
                          ? 0.5
                          : 1,
                    }]}
                    onPress={handleCommitImport}
                    disabled={importCommitting || importSummary.warnings.length > 0}
                  >
                    <ThemedText type="body" style={{ color: "#fff", fontWeight: "700" }}>
                      {importCommitting ? "Applying…" : "✅ Confirm & Apply Hierarchy"}
                    </ThemedText>
                  </Pressable>
                </View>
                <Spacer height={8} />
              </ScrollView>
            ) : (
              <View style={{ alignItems: "center", padding: Spacing.xl, gap: Spacing.lg }}>
                <View style={[s.uploadBox, { borderColor: theme.primary }]}>
                  <Feather name="file-text" size={36} color={theme.primary} />
                  <Spacer height={8} />
                  <ThemedText type="body" style={{ color: theme.text, fontWeight: "600", textAlign: "center" }}>
                    Select Excel or CSV File
                  </ThemedText>
                  <ThemedText type="caption" style={{ color: theme.textSecondary, textAlign: "center", marginTop: 4 }}>
                    Supported: .xlsx, .csv
                  </ThemedText>
                </View>
                <Pressable
                  style={[s.saveBtn, { backgroundColor: "#7C3AED", width: "100%" }]}
                  onPress={handlePickFile}
                >
                  <ThemedText type="body" style={{ color: "#fff", fontWeight: "700" }}>📂 Browse File</ThemedText>
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
            <ThemedText type="h3" style={{ marginBottom: 2 }}>
              Set Head for "{teamHeadTarget?.teamName}"
            </ThemedText>
            <ThemedText type="caption" style={{ color: theme.textSecondary, marginBottom: Spacing.md }}>
              All members of this team will be assigned under the selected Associate Partner
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
              <Pressable
                style={[s.option, selectedAPId === "" && { backgroundColor: theme.primary + "15" }]}
                onPress={() => setSelectedAPId("")}
              >
                <ThemedText type="caption" style={{ color: selectedAPId === "" ? theme.primary : theme.textSecondary, fontStyle: "italic" }}>
                  — None (remove head) —
                </ThemedText>
                {selectedAPId === "" && <Feather name="check" size={14} color={theme.primary} />}
              </Pressable>

              {associatePartners
                .filter((ap) => !teamHeadSearch || ap.name.toLowerCase().includes(teamHeadSearch.toLowerCase()))
                .map((ap) => (
                  <Pressable
                    key={ap.id}
                    style={[s.option, selectedAPId === ap.id && { backgroundColor: theme.primary + "15" }]}
                    onPress={() => setSelectedAPId(ap.id)}
                  >
                    <View style={{ flex: 1 }}>
                      <ThemedText type="caption" style={{ fontWeight: "700", color: selectedAPId === ap.id ? theme.primary : theme.text }}>
                        {ap.name}
                      </ThemedText>
                      <ThemedText type="caption" style={{ color: theme.textSecondary, fontSize: 11 }}>
                        Associate Partner{ap.team ? ` · ${ap.team}` : ""}
                      </ThemedText>
                    </View>
                    {selectedAPId === ap.id && <Feather name="check" size={14} color={theme.primary} />}
                  </Pressable>
                ))}

              {associatePartners.filter((ap) => !teamHeadSearch || ap.name.toLowerCase().includes(teamHeadSearch.toLowerCase())).length === 0 && (
                <ThemedText type="caption" style={{ color: theme.textSecondary, padding: 12, fontStyle: "italic" }}>
                  No Associate Partners found
                </ThemedText>
              )}
            </ScrollView>

            <Spacer height={Spacing.md} />
            <Pressable
              style={[s.saveBtn, { backgroundColor: theme.primary, opacity: saving ? 0.7 : 1 }]}
              onPress={handleSetTeamHead}
              disabled={saving}
            >
              <ThemedText type="body" style={{ color: "#fff", fontWeight: "700" }}>
                {saving
                  ? "Saving..."
                  : selectedAPId
                  ? `Assign All to ${profiles.find((p) => p.id === selectedAPId)?.name}`
                  : "Remove Head Assignment"}
              </ThemedText>
            </Pressable>
          </View>
        </View>
      </Modal>

      {/* ── Individual Assign Modal ── */}
      <Modal visible={assignModal} transparent animationType="slide" onRequestClose={() => setAssignModal(false)}>
        <View style={s.overlay}>
          <Pressable style={StyleSheet.absoluteFill} onPress={() => setAssignModal(false)} />
          <View style={[s.sheet, { backgroundColor: theme.backgroundDefault }]}>
            <ThemedText type="h3" style={{ marginBottom: 2 }}>Assign {assignTarget?.name}</ThemedText>
            <ThemedText type="caption" style={{ color: theme.textSecondary, marginBottom: Spacing.md }}>
              Select who this person reports to
            </ThemedText>

            <ThemedText type="caption" style={{ color: theme.textSecondary, fontWeight: "700", marginBottom: 4 }}>
              Search who they report to
            </ThemedText>
            <View style={[s.inlineSearch, { backgroundColor: theme.backgroundSecondary }]}>
              <Feather name="search" size={14} color={theme.textSecondary} />
              <TextInput
                style={[s.searchInput, { color: theme.text, fontSize: 13 }]}
                placeholder="Type name or role..."
                placeholderTextColor={theme.textSecondary}
                value={assignSearch}
                onChangeText={setAssignSearch}
              />
              {assignSearch ? <Pressable onPress={() => setAssignSearch("")}><Feather name="x" size={14} color={theme.textSecondary} /></Pressable> : null}
            </View>

            <ScrollView style={{ maxHeight: 300 }} nestedScrollEnabled keyboardShouldPersistTaps="handled">
              <Pressable
                style={[s.option, assignTo === "" && { backgroundColor: theme.primary + "15" }]}
                onPress={() => setAssignTo("")}
              >
                <ThemedText type="caption" style={{ color: assignTo === "" ? theme.primary : theme.textSecondary, fontStyle: "italic" }}>
                  — None (unassign) —
                </ThemedText>
                {assignTo === "" && <Feather name="check" size={14} color={theme.primary} />}
              </Pressable>

              {filteredParents.filter((p) => isAP(p.role)).map((p) => (
                <Pressable key={p.id} style={[s.option, assignTo === p.id && { backgroundColor: theme.primary + "15" }]} onPress={() => setAssignTo(p.id)}>
                  <View style={{ flex: 1 }}>
                    <ThemedText type="caption" style={{ fontWeight: "700", color: assignTo === p.id ? theme.primary : theme.text }}>
                      {p.name}
                    </ThemedText>
                    <ThemedText type="caption" style={{ color: theme.textSecondary, fontSize: 11 }}>
                      Associate Partner{p.team ? ` · ${p.team}` : ""}
                    </ThemedText>
                  </View>
                  {assignTo === p.id && <Feather name="check" size={14} color={theme.primary} />}
                </Pressable>
              ))}

              {filteredParents.filter((p) => isSalesManagerRole(p.role)).map((p) => (
                <Pressable key={p.id} style={[s.option, assignTo === p.id && { backgroundColor: theme.primary + "15" }]} onPress={() => setAssignTo(p.id)}>
                  <View style={{ flex: 1 }}>
                    <ThemedText type="caption" style={{ fontWeight: "800", color: assignTo === p.id ? theme.primary : Colors.light.warning }}>
                      {p.name}
                    </ThemedText>
                    <ThemedText type="caption" style={{ color: theme.textSecondary, fontSize: 11 }}>
                      Sales Manager · manages {salesManagerDirectReportLabel()}{p.team ? ` · ${p.team}` : ""}
                    </ThemedText>
                  </View>
                  {assignTo === p.id && <Feather name="check" size={14} color={theme.primary} />}
                </Pressable>
              ))}

              {filteredParents.filter((p) => isAgent(p.role) && !isSalesManagerRole(p.role)).map((p) => (
                <Pressable key={p.id} style={[s.option, assignTo === p.id && { backgroundColor: theme.primary + "15" }]} onPress={() => setAssignTo(p.id)}>
                  <View style={{ flex: 1 }}>
                    <ThemedText type="caption" style={{ fontWeight: "600", color: assignTo === p.id ? theme.primary : theme.text }}>
                      {p.name}
                    </ThemedText>
                    <ThemedText type="caption" style={{ color: theme.textSecondary, fontSize: 11 }}>
                      {p.role?.replace(/_/g, " ")}{p.team ? ` · ${p.team}` : ""}
                    </ThemedText>
                  </View>
                  {assignTo === p.id && <Feather name="check" size={14} color={theme.primary} />}
                </Pressable>
              ))}
            </ScrollView>

            <Spacer height={Spacing.md} />
            <Pressable
              style={[s.saveBtn, { backgroundColor: theme.primary, opacity: saving ? 0.7 : 1 }]}
              onPress={handleAssignSave}
              disabled={saving}
            >
              <ThemedText type="body" style={{ color: "#fff", fontWeight: "700" }}>
                {saving ? "Saving..." : "Save"}
              </ThemedText>
            </Pressable>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const s = StyleSheet.create({
  floatingImportBtn: {
    position: "absolute",
    top: 60,
    left: Spacing.md,
    right: Spacing.md,
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderRadius: BorderRadius.md,
    zIndex: 1000,
    ...(Platform.OS === "web"
      ? { boxShadow: "0 2px 8px rgba(0,0,0,0.25)" }
      : { elevation: 8, shadowColor: "#000", shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.25, shadowRadius: 3.84 }),
  },
  topBar: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.sm,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    borderBottomWidth: 1,
    marginTop: 60, // Add margin to avoid overlap with floating button
  },
  searchRow: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.sm,
    paddingHorizontal: Spacing.sm,
    paddingVertical: 8,
    borderRadius: BorderRadius.md,
  },
  searchBar: {
    flexDirection: "row", alignItems: "center", gap: Spacing.sm,
    margin: Spacing.md, padding: Spacing.md, borderRadius: BorderRadius.md,
  },
  inlineSearch: {
    flexDirection: "row", alignItems: "center", gap: Spacing.sm,
    padding: Spacing.sm, borderRadius: BorderRadius.sm, marginBottom: Spacing.sm,
  },
  searchInput: { flex: 1, fontSize: 14 },
  teamCard: { borderRadius: BorderRadius.lg, overflow: "hidden" },
  teamHeader: { flexDirection: "row", alignItems: "center", gap: Spacing.sm, padding: Spacing.md },
  teamAvatar: { width: 36, height: 36, borderRadius: 18, alignItems: "center", justifyContent: "center" },
  setHeadBtn: {
    flexDirection: "row", alignItems: "center", gap: 4,
    paddingHorizontal: 10, paddingVertical: 5,
    borderRadius: BorderRadius.full, borderWidth: 1.5,
  },
  headBanner: {
    flexDirection: "row", alignItems: "center", gap: Spacing.sm,
    paddingHorizontal: Spacing.md, paddingVertical: 10,
    borderBottomWidth: 1, borderBottomColor: "rgba(0,0,0,0.04)",
  },
  starBadge: { width: 28, height: 28, borderRadius: 14, alignItems: "center", justifyContent: "center" },
  agentRow: {
    flexDirection: "row", alignItems: "center", gap: Spacing.sm,
    paddingHorizontal: Spacing.xs, paddingVertical: 8,
    borderRadius: BorderRadius.sm, marginBottom: 2,
  },
  treeLine: {
    width: 12, height: 12,
    borderLeftWidth: 1.5, borderBottomWidth: 1.5,
    borderBottomLeftRadius: 4, marginRight: 4, marginTop: -4,
  },
  divider: {
    paddingVertical: 6, paddingHorizontal: 4,
    borderTopWidth: 1, borderTopColor: "#FEF3C7",
    marginTop: 4, marginBottom: 2,
  },
  iconBtn: { width: 28, height: 28, borderRadius: 6, alignItems: "center", justifyContent: "center" },
  empty: { alignItems: "center", paddingTop: 60, paddingHorizontal: 20 },
  overlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.5)", justifyContent: "flex-end" },
  sheet: {
    borderTopLeftRadius: 20, borderTopRightRadius: 20,
    padding: Spacing.xl, paddingBottom: 40, maxHeight: "85%",
  },
  option: {
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    padding: 10, borderRadius: 8, marginBottom: 4,
  },
  saveBtn: { padding: 14, borderRadius: BorderRadius.md, alignItems: "center", justifyContent: "center" },
  quickAssignBox: {
    marginHorizontal: Spacing.md,
    marginBottom: Spacing.sm,
    padding: Spacing.md,
    borderRadius: BorderRadius.md,
  },
  quickAssignRow: {
    flexDirection: "row", alignItems: "center", gap: Spacing.sm,
    paddingVertical: 8, borderBottomWidth: StyleSheet.hairlineWidth,
  },
  importBanner: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: Spacing.lg,
    paddingVertical: 14,
    margin: Spacing.md,
    marginBottom: 4,
    borderRadius: BorderRadius.md,
  },
  importBtn: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 12,
    paddingVertical: 9,
    borderRadius: BorderRadius.md,
  },
  treeBox: {
    padding: Spacing.sm, borderRadius: BorderRadius.sm,
    minHeight: 80, maxHeight: 280,
  },
  warningRow: {
    padding: 8, borderRadius: 6, marginBottom: 4,
  },
  statChip: {
    paddingHorizontal: 10, paddingVertical: 4, borderRadius: 20,
  },
  uploadBox: {
    width: "100%", borderWidth: 2, borderStyle: "dashed",
    borderRadius: BorderRadius.lg, paddingVertical: 32,
    alignItems: "center", justifyContent: "center",
  },
});
