/**
 * BiometricUserMatchScreen — Admin-only
 *
 * Lists all SmartOffice employee codes that appear in device logs but are NOT yet
 * linked to any HRMS profile. Admin can search for a profile and click "Match" to
 * save the mapping permanently (stored in profiles.smartoffice_employee_code).
 *
 * Once matched, all future (and historical) biometric syncs will automatically
 * map that device code to the correct user — no re-linking needed.
 */
import React, { useState, useCallback } from "react";
import {
  View,
  ScrollView,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
} from "react-native";
import Feather from "@expo/vector-icons/Feather";
import { useFocusEffect } from "@react-navigation/native";
import { ThemedText } from "@/components/ThemedText";
import { useTheme } from "@/hooks/useTheme";
import { Spacing, BorderRadius } from "@/constants/theme";
import { supabase } from "@/lib/supabase";
import { firstRpcRow } from "@/utils/supabaseRpc";
import { toTitleCase } from "@/utils/format";
import { fetchAllPages } from "@/utils/supabasePagination";
import { downloadBrowserBytes } from "@/utils/browserFileDownload";
import {
  formatHrmsDateTime,
  getBusinessDateIST,
} from "@/utils/attendanceTimestamp";

interface UnmatchedCode {
  device_id: string;
  employee_code: string;
  employee_name: string | null;
  punch_count: number;
  first_seen: string;
  last_seen: string;
  mapping_status: "LINKED" | "SUGGESTED" | "UNMAPPED" | "CONFLICT";
  unmapped_reason: string | null;
  suggestion_method: string | null;
  suggested_user_id: string | null;
  suggested_user_name: string | null;
  hrms_employee_id: string | null;
  employee_number: string | null;
  office_name: string | null;
  team: string | null;
  matched_user_id: string | null;
  matched_user_name: string | null;
}

interface HRMSUser {
  id: string;
  name: string;
  employee_number: string | null;
  role: string | null;
  email: string | null;
  phone: string | null;
  office_name: string | null;
  team: string | null;
  smartoffice_employee_code: string | null;
  is_active: boolean;
}

const REASON_LABELS: Record<string, string> = {
  BIOMETRIC_ID_NOT_AVAILABLE_IN_HRMS: "Biometric ID is not available in HRMS",
  HRMS_EMPLOYEE_DOES_NOT_HAVE_BIOMETRIC_ID:
    "HRMS employee does not have a biometric ID",
  DUPLICATE_BIOMETRIC_ID: "Duplicate biometric ID",
  MORE_THAN_ONE_POSSIBLE_EMPLOYEE: "More than one possible employee found",
  EMPLOYEE_INACTIVE: "Employee is inactive",
  EMPLOYEE_DETAILS_DO_NOT_MATCH: "Employee details do not match",
};

function itemKey(item: Pick<UnmatchedCode, "device_id" | "employee_code">) {
  return `${item.device_id}:${item.employee_code}`;
}

async function saveExcelWorkbook(XLSX: any, workbook: any, filename: string) {
  if (
    typeof window === "undefined" ||
    typeof document === "undefined" ||
    typeof Blob === "undefined"
  ) {
    XLSX.writeFile(workbook, filename, { compression: false });
    return;
  }
  const bytes = XLSX.write(workbook, {
    bookType: "xlsx",
    type: "array",
    compression: false,
  });
  await downloadBrowserBytes(
    bytes,
    filename,
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  );
}

export default function BiometricUserMatchScreen() {
  const { theme, isDark } = useTheme();
  const textColor = isDark ? "#FFFFFF" : theme.text;

  const [unmatchedCodes, setUnmatchedCodes] = useState<UnmatchedCode[]>([]);
  const [allProfiles, setAllProfiles] = useState<HRMSUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [saving, setSaving] = useState<string | null>(null); // code currently being saved
  const [exporting, setExporting] = useState(false);

  // Per-code search state: codeKey → search text
  const [searchMap, setSearchMap] = useState<Record<string, string>>({});
  // Per-code dropdown-open state
  const [openSearch, setOpenSearch] = useState<string | null>(null);

  const loadData = useCallback(async () => {
    setLoading(true);
    setLoadError("");
    try {
      // Historical corrections may need a former/inactive employee.
      const { data: profiles, error: profilesError } = await fetchAllPages<any>(
        (from, to) =>
          supabase
            .from("profiles")
            .select(
              "id, name, employee_number, role, email, phone, office_id, team, smartoffice_employee_code, is_active",
            )
            .order("name")
            .order("id")
            .range(from, to),
      );
      if (profilesError) throw profilesError;

      const { data: offices, error: officesError } = await fetchAllPages<any>(
        (from, to) =>
          supabase
            .from("offices")
            .select("id,name")
            .order("id")
            .range(from, to),
      );
      if (officesError) throw officesError;
      const officeNameById = new Map(
        (offices ?? []).map((office: any) => [office.id, office.name]),
      );

      const profileList: HRMSUser[] = (profiles ?? []).map((p: any) => ({
        id: p.id,
        name: toTitleCase(p.name ?? ""),
        employee_number: p.employee_number ?? null,
        role: p.role ?? null,
        email: p.email ?? null,
        phone: p.phone ?? null,
        office_name: p.office_id
          ? (officeNameById.get(p.office_id) ?? null)
          : null,
        team: p.team ?? null,
        smartoffice_employee_code: p.smartoffice_employee_code ?? null,
        is_active: p.is_active === true,
      }));
      setAllProfiles(profileList);

      // Aggregate device codes on the server. Fetching every punch merely to
      // count codes was slow and also depended on a legacy RLS policy that did
      // not recognize SYSTEM_ADMIN/HRD.
      const { data: logCodeResult, error: logCodesError } = await supabase.rpc(
        "rpc_list_unmapped_biometric_employees",
      );
      if (logCodesError) throw logCodesError;
      const logCodePayload = firstRpcRow<any>(logCodeResult);
      if (
        logCodePayload?.success !== true ||
        !Array.isArray(logCodePayload?.employees)
      ) {
        throw new Error(
          "The server returned an invalid biometric employee list.",
        );
      }

      // Aggregate by code
      const result: UnmatchedCode[] = logCodePayload.employees.map(
        (row: any) => ({
          device_id: String(row.device_id ?? "SMARTOFFICE"),
          employee_code: String(row.employee_code ?? "").trim(),
          employee_name: row.employee_name ?? null,
          punch_count: Number(row.punch_count) || 0,
          first_seen: row.first_seen ?? "",
          last_seen: row.last_seen ?? "",
          mapping_status: row.mapping_status ?? "UNMAPPED",
          unmapped_reason: row.unmapped_reason ?? null,
          suggestion_method: row.suggestion_method ?? null,
          suggested_user_id: row.suggested_user_id ?? null,
          suggested_user_name: row.suggested_user_name ?? null,
          hrms_employee_id: row.hrms_employee_id ?? null,
          employee_number: row.employee_number ?? null,
          office_name: row.office_name ?? null,
          team: row.team ?? null,
          matched_user_id: row.mapped_user_id ?? null,
          matched_user_name: row.mapped_user_name ?? null,
        }),
      );

      // Build list — show ALL codes, marking which are already matched
      // Sort: unmatched first, then matched; within each group by last_seen desc
      result.sort((a, b) => {
        if (
          (a.mapping_status === "LINKED") !==
          (b.mapping_status === "LINKED")
        ) {
          return a.mapping_status === "LINKED" ? 1 : -1;
        }
        return (b.last_seen ?? "").localeCompare(a.last_seen ?? "");
      });

      setUnmatchedCodes(result);
    } catch (err: any) {
      console.error("[BiometricMatch] loadData error:", err);
      setUnmatchedCodes([]);
      setAllProfiles([]);
      setLoadError(err?.message || "Unable to load biometric mappings.");
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      loadData();
    }, [loadData]),
  );

  const handleMatch = async (code: UnmatchedCode, profile: HRMSUser) => {
    // Warn if profile already has a different code linked
    if (
      profile.smartoffice_employee_code &&
      profile.smartoffice_employee_code.toLowerCase() !==
        code.employee_code.toLowerCase()
    ) {
      Alert.alert(
        "Replace Existing Link?",
        `${profile.name} is already linked to code "${profile.smartoffice_employee_code}". Replace with "${code.employee_code}"?`,
        [
          { text: "Cancel", style: "cancel" },
          {
            text: "Replace",
            style: "destructive",
            onPress: () => doMatch(code.employee_code, profile),
          },
        ],
      );
      return;
    }
    doMatch(code.employee_code, profile);
  };

  const doMatch = async (employeeCode: string, profile: HRMSUser) => {
    setSaving(employeeCode);
    try {
      // Save and back-fill through one protected operation. The database
      // rejects a code that is already assigned to another HRMS profile.
      const { data, error } = await supabase.rpc(
        "rpc_assign_biometric_employee_code",
        {
          p_profile_id: profile.id,
          p_employee_code: employeeCode,
        },
      );

      if (error) throw error;
      const response = firstRpcRow<any>(data);
      if (
        response?.success !== true ||
        response?.profile_id !== profile.id ||
        response?.employee_code !== employeeCode
      )
        throw new Error("Server did not confirm the biometric mapping.");

      const { data: reprocessData, error: reprocessError } = await supabase.rpc(
        "reprocess_unmatched_biometric_punches",
        { p_limit: 500 },
      );
      if (reprocessError) throw reprocessError;
      const reprocessed = Number(
        firstRpcRow<any>(reprocessData)?.processed || 0,
      );

      Alert.alert(
        "Match Saved",
        `"${employeeCode}" is now permanently linked to ${profile.name}.\n\n${reprocessed} historical unmatched punch${reprocessed === 1 ? " was" : "es were"} reprocessed safely.`,
      );

      // Close search dropdown and refresh
      setOpenSearch(null);
      setSearchMap((prev) => ({ ...prev, [employeeCode]: "" }));
      await loadData();
    } catch (err: any) {
      Alert.alert("Save Failed", err?.message ?? "Unknown error");
    } finally {
      setSaving(null);
    }
  };

  const handleUnlink = async (code: UnmatchedCode) => {
    if (!code.matched_user_id) return;
    Alert.alert(
      "Remove Link?",
      `Unlink "${code.employee_code}" from ${code.matched_user_name}? This will stop biometric syncing for this code until re-linked.`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Unlink",
          style: "destructive",
          onPress: async () => {
            setSaving(code.employee_code);
            try {
              const { data, error } = await supabase.rpc(
                "rpc_unassign_biometric_employee_code",
                { p_profile_id: code.matched_user_id! },
              );
              if (error) throw error;
              const response = firstRpcRow<any>(data);
              if (
                response?.success !== true ||
                response?.profile_id !== code.matched_user_id
              )
                throw new Error(
                  "Server did not confirm removal of the biometric mapping.",
                );
              await loadData();
            } catch (err: any) {
              Alert.alert("Unlink Failed", err?.message ?? "Unknown error");
            } finally {
              setSaving(null);
            }
          },
        },
      ],
    );
  };

  const getFilteredProfiles = (key: string): HRMSUser[] => {
    const q = (searchMap[key] ?? "").toLowerCase().trim();
    if (!q) return allProfiles;
    return allProfiles.filter(
      (p) =>
        p.name.toLowerCase().includes(q) ||
        (p.employee_number ?? "").toLowerCase().includes(q) ||
        (p.role ?? "").toLowerCase().includes(q) ||
        (p.email ?? "").toLowerCase().includes(q) ||
        (p.phone ?? "").toLowerCase().includes(q),
    );
  };

  const unmatched = unmatchedCodes.filter((c) => c.mapping_status !== "LINKED");
  const matched = unmatchedCodes.filter((c) => c.mapping_status === "LINKED");

  const exportUnmapped = async () => {
    if (!unmatched.length) {
      Alert.alert(
        "Nothing to Export",
        "There are no unmapped biometric employees.",
      );
      return;
    }
    setExporting(true);
    try {
      const XLSX = await import("xlsx");
      const rows = unmatched.map((item) => ({
        "Biometric Employee Name":
          item.employee_name ?? "Not provided by device",
        "Biometric Employee ID": item.employee_code,
        "Device ID": item.device_id,
        "Suggested HRMS Employee": item.suggested_user_name ?? "",
        "HRMS Employee ID": item.hrms_employee_id ?? "",
        "Employee Number": item.employee_number ?? "",
        Office: item.office_name ?? "",
        Team: item.team ?? "",
        "Mapping Status": item.mapping_status,
        "Unmapped Reason": item.unmapped_reason
          ? (REASON_LABELS[item.unmapped_reason] ?? item.unmapped_reason)
          : "",
        "Suggestion Method":
          item.suggestion_method ?? "Manual administrator selection",
        "Punch Count": item.punch_count,
        "First Seen (IST)": formatHrmsDateTime(item.first_seen),
        "Last Seen (IST)": formatHrmsDateTime(item.last_seen),
      }));
      const worksheet = XLSX.utils.json_to_sheet(rows);
      worksheet["!cols"] = [
        26, 20, 22, 28, 38, 18, 22, 22, 18, 38, 30, 14, 24, 24,
      ].map((wch) => ({ wch }));
      const workbook = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(workbook, worksheet, "Unmapped Employees");
      await saveExcelWorkbook(
        XLSX,
        workbook,
        `Unmapped_Biometric_Employees_${getBusinessDateIST()}.xlsx`,
      );
    } catch (error: any) {
      Alert.alert(
        "Export Failed",
        error?.message ?? "Could not create Excel file.",
      );
    } finally {
      setExporting(false);
    }
  };

  if (loading) {
    return (
      <View
        style={{
          flex: 1,
          justifyContent: "center",
          alignItems: "center",
          backgroundColor: theme.backgroundRoot,
        }}
      >
        <ActivityIndicator size="large" color={theme.primary} />
        <ThemedText style={{ marginTop: 12, color: theme.textSecondary }}>
          Loading biometric codes...
        </ThemedText>
      </View>
    );
  }

  if (loadError) {
    return (
      <View style={[s.loadError, { backgroundColor: theme.backgroundRoot }]}>
        <Feather name="alert-triangle" size={32} color="#EF4444" />
        <ThemedText style={[s.loadErrorTitle, { color: textColor }]}>
          Biometric mappings failed to load
        </ThemedText>
        <ThemedText style={{ color: theme.textSecondary, textAlign: "center" }}>
          {loadError}
        </ThemedText>
        <TouchableOpacity
          style={[s.retryButton, { backgroundColor: theme.primary }]}
          onPress={() => void loadData()}
        >
          <ThemedText style={{ color: "#FFFFFF", fontWeight: "700" }}>
            Retry
          </ThemedText>
        </TouchableOpacity>
      </View>
    );
  }

  const renderCodeCard = (item: UnmatchedCode) => {
    const key = itemKey(item);
    const isOpen = openSearch === key;
    const isSaving = saving === item.employee_code;
    const filteredProfiles = getFilteredProfiles(key);
    const isLinked = item.mapping_status === "LINKED";
    const suggestedProfile = item.suggested_user_id
      ? (allProfiles.find((profile) => profile.id === item.suggested_user_id) ??
        null)
      : null;
    const borderColor = isLinked
      ? "#10B981"
      : item.mapping_status === "CONFLICT"
        ? "#EF4444"
        : item.mapping_status === "SUGGESTED"
          ? "#3B82F6"
          : "#F59E0B";

    return (
      <View
        key={item.employee_code}
        style={[
          s.card,
          {
            backgroundColor: theme.backgroundDefault,
            borderLeftColor: borderColor,
          },
        ]}
      >
        {/* Header row */}
        <View style={s.cardHeader}>
          <View style={{ flex: 1 }}>
            <View style={s.codeRow}>
              <Feather name="cpu" size={14} color={borderColor} />
              <ThemedText style={[s.codeText, { color: textColor }]}>
                {item.employee_code}
              </ThemedText>
              <View style={[s.badge, { backgroundColor: `${borderColor}20` }]}>
                <ThemedText style={[s.badgeText, { color: borderColor }]}>
                  {item.mapping_status === "SUGGESTED"
                    ? "Suggested"
                    : item.mapping_status === "CONFLICT"
                      ? "Conflict"
                      : isLinked
                        ? "Linked"
                        : "Unmapped"}
                </ThemedText>
              </View>
            </View>
            <ThemedText style={[s.metaText, { color: theme.textSecondary }]}>
              {item.punch_count} punch{item.punch_count !== 1 ? "es" : ""} ·
              last seen {formatHrmsDateTime(item.last_seen, "—")}
            </ThemedText>
            <ThemedText style={[s.machineName, { color: textColor }]}>
              {item.employee_name ?? "Employee name not provided by device"}
            </ThemedText>
            <ThemedText style={[s.metaText, { color: theme.textSecondary }]}>
              Device: {item.device_id}
            </ThemedText>
            {!isLinked && item.unmapped_reason ? (
              <ThemedText style={[s.reasonText, { color: borderColor }]}>
                {REASON_LABELS[item.unmapped_reason] ?? item.unmapped_reason}
              </ThemedText>
            ) : null}
            {!isLinked && item.suggested_user_name ? (
              <View style={[s.suggestionBox, { borderColor: "#3B82F650" }]}>
                <View style={{ flex: 1 }}>
                  <ThemedText
                    style={{ fontSize: 11, color: theme.textSecondary }}
                  >
                    Suggested HRMS employee
                  </ThemedText>
                  <ThemedText
                    style={{
                      fontSize: 13,
                      fontWeight: "700",
                      color: textColor,
                    }}
                  >
                    {item.suggested_user_name}
                  </ThemedText>
                  <ThemedText
                    style={{ fontSize: 11, color: theme.textSecondary }}
                  >
                    {[
                      item.employee_number ? `#${item.employee_number}` : null,
                      item.office_name,
                      item.team,
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  </ThemedText>
                  <ThemedText
                    style={{ fontSize: 10, color: "#3B82F6", marginTop: 2 }}
                  >
                    Suggested by{" "}
                    {item.suggestion_method === "HRMS_EMPLOYEE_NUMBER"
                      ? "exact employee number"
                      : "existing biometric ID"}
                  </ThemedText>
                </View>
                {suggestedProfile ? (
                  <TouchableOpacity
                    style={s.useSuggestionButton}
                    onPress={() => handleMatch(item, suggestedProfile)}
                    disabled={isSaving}
                  >
                    <ThemedText
                      style={{
                        color: "#FFFFFF",
                        fontSize: 11,
                        fontWeight: "700",
                      }}
                    >
                      Map
                    </ThemedText>
                  </TouchableOpacity>
                ) : null}
              </View>
            ) : null}
            {isLinked && (
              <View style={s.linkedRow}>
                <Feather name="user-check" size={12} color="#10B981" />
                <ThemedText
                  style={{ fontSize: 12, color: "#10B981", fontWeight: "600" }}
                >
                  {item.matched_user_name}
                </ThemedText>
              </View>
            )}
          </View>

          <View style={{ flexDirection: "row", gap: 6 }}>
            {isLinked ? (
              <TouchableOpacity
                style={[
                  s.actionBtn,
                  { backgroundColor: "#EF444415", borderColor: "#EF4444" },
                ]}
                onPress={() => handleUnlink(item)}
                disabled={isSaving}
              >
                <Feather name="x" size={12} color="#EF4444" />
                <ThemedText
                  style={{ fontSize: 11, color: "#EF4444", fontWeight: "700" }}
                >
                  Unlink
                </ThemedText>
              </TouchableOpacity>
            ) : null}
            <TouchableOpacity
              style={[
                s.actionBtn,
                {
                  backgroundColor: theme.primary + "15",
                  borderColor: theme.primary,
                },
              ]}
              onPress={() => setOpenSearch(isOpen ? null : key)}
              disabled={isSaving}
            >
              {isSaving ? (
                <ActivityIndicator size={12} color={theme.primary} />
              ) : (
                <>
                  <Feather
                    name={isOpen ? "chevron-up" : "search"}
                    size={12}
                    color={theme.primary}
                  />
                  <ThemedText
                    style={{
                      fontSize: 11,
                      color: theme.primary,
                      fontWeight: "700",
                    }}
                  >
                    {isLinked ? "Re-link" : "Map Employee"}
                  </ThemedText>
                </>
              )}
            </TouchableOpacity>
          </View>
        </View>

        {/* Search + results dropdown */}
        {isOpen && (
          <View
            style={[s.searchPanel, { backgroundColor: theme.backgroundRoot }]}
          >
            <View
              style={[
                s.searchRow,
                { backgroundColor: theme.backgroundDefault },
              ]}
            >
              <Feather name="search" size={14} color={theme.textSecondary} />
              <TextInput
                style={[s.searchInput, { color: theme.text }]}
                placeholder="Search by name, employee ID, or role..."
                placeholderTextColor={theme.textSecondary}
                value={searchMap[key] ?? ""}
                onChangeText={(text) =>
                  setSearchMap((prev) => ({
                    ...prev,
                    [key]: text,
                  }))
                }
                autoFocus
              />
              {(searchMap[key] ?? "") ? (
                <TouchableOpacity
                  onPress={() =>
                    setSearchMap((prev) => ({
                      ...prev,
                      [key]: "",
                    }))
                  }
                >
                  <Feather name="x" size={14} color={theme.textSecondary} />
                </TouchableOpacity>
              ) : null}
            </View>

            <View style={{ maxHeight: 260 }}>
              {filteredProfiles.length === 0 ? (
                <ThemedText
                  style={{
                    padding: 12,
                    color: theme.textSecondary,
                    fontSize: 12,
                    textAlign: "center",
                  }}
                >
                  No employees found
                </ThemedText>
              ) : (
                <ScrollView
                  nestedScrollEnabled
                  showsVerticalScrollIndicator={false}
                >
                  {filteredProfiles.map((profile) => (
                    <TouchableOpacity
                      key={profile.id}
                      style={[
                        s.profileRow,
                        {
                          borderBottomColor: theme.backgroundRoot,
                          backgroundColor:
                            profile.smartoffice_employee_code ===
                            item.employee_code
                              ? "#10B98115"
                              : "transparent",
                        },
                      ]}
                      onPress={() => handleMatch(item, profile)}
                    >
                      <View style={{ flex: 1 }}>
                        <ThemedText
                          style={[s.profileName, { color: textColor }]}
                        >
                          {profile.name}
                        </ThemedText>
                        <ThemedText
                          style={{ fontSize: 11, color: theme.textSecondary }}
                        >
                          {[
                            profile.employee_number
                              ? `#${profile.employee_number}`
                              : null,
                            profile.role,
                            profile.office_name,
                            profile.team,
                            profile.is_active ? "Active" : "Inactive / former",
                          ]
                            .filter(Boolean)
                            .join(" · ")}
                        </ThemedText>
                        {profile.smartoffice_employee_code && (
                          <ThemedText
                            style={{
                              fontSize: 10,
                              color: "#F59E0B",
                              marginTop: 2,
                            }}
                          >
                            Already linked to:{" "}
                            {profile.smartoffice_employee_code}
                          </ThemedText>
                        )}
                      </View>
                      <View style={s.matchChip}>
                        <ThemedText
                          style={{
                            fontSize: 11,
                            color: "#fff",
                            fontWeight: "700",
                          }}
                        >
                          Match
                        </ThemedText>
                      </View>
                    </TouchableOpacity>
                  ))}
                </ScrollView>
              )}
            </View>
          </View>
        )}
      </View>
    );
  };

  return (
    <View style={{ flex: 1, backgroundColor: theme.backgroundRoot }}>
      <ScrollView
        contentContainerStyle={s.container}
        showsVerticalScrollIndicator={false}
      >
        {/* Info banner */}
        <View
          style={[
            s.infoBanner,
            { backgroundColor: "#3B82F615", borderColor: "#3B82F640" },
          ]}
        >
          <Feather name="info" size={14} color="#3B82F6" />
          <ThemedText
            style={{ flex: 1, fontSize: 12, color: "#3B82F6", lineHeight: 18 }}
          >
            Match each biometric device code to an employee. The link is saved
            permanently — future syncs happen automatically without re-linking.
          </ThemedText>
        </View>

        <TouchableOpacity
          style={[
            s.exportButton,
            {
              backgroundColor: unmatched.length
                ? "#15803D"
                : theme.textSecondary,
            },
          ]}
          onPress={() => void exportUnmapped()}
          disabled={exporting || !unmatched.length}
        >
          {exporting ? (
            <ActivityIndicator size="small" color="#FFFFFF" />
          ) : (
            <Feather name="download" size={15} color="#FFFFFF" />
          )}
          <ThemedText style={s.exportButtonText}>
            {exporting
              ? "Preparing Excel..."
              : "Export Unmapped Employees to Excel"}
          </ThemedText>
        </TouchableOpacity>

        {/* Summary */}
        <View style={s.summaryRow}>
          <View style={[s.summaryCard, { backgroundColor: "#F59E0B15" }]}>
            <ThemedText
              style={{ fontSize: 22, fontWeight: "800", color: "#F59E0B" }}
            >
              {unmatched.length}
            </ThemedText>
            <ThemedText
              style={{ fontSize: 11, color: "#F59E0B", marginTop: 2 }}
            >
              Unmatched
            </ThemedText>
          </View>
          <View style={[s.summaryCard, { backgroundColor: "#10B98115" }]}>
            <ThemedText
              style={{ fontSize: 22, fontWeight: "800", color: "#10B981" }}
            >
              {matched.length}
            </ThemedText>
            <ThemedText
              style={{ fontSize: 11, color: "#10B981", marginTop: 2 }}
            >
              Linked
            </ThemedText>
          </View>
          <View
            style={[
              s.summaryCard,
              { backgroundColor: theme.backgroundDefault },
            ]}
          >
            <ThemedText
              style={{ fontSize: 22, fontWeight: "800", color: textColor }}
            >
              {unmatchedCodes.length}
            </ThemedText>
            <ThemedText
              style={{ fontSize: 11, color: theme.textSecondary, marginTop: 2 }}
            >
              Total Codes
            </ThemedText>
          </View>
        </View>

        {/* Unmatched section */}
        {unmatched.length > 0 && (
          <>
            <View style={s.sectionHeader}>
              <Feather name="alert-circle" size={14} color="#F59E0B" />
              <ThemedText
                style={{ fontSize: 13, fontWeight: "700", color: "#F59E0B" }}
              >
                Unmapped Biometric Employees ({unmatched.length})
              </ThemedText>
            </View>
            {unmatched.map(renderCodeCard)}
          </>
        )}

        {/* Matched section */}
        {matched.length > 0 && (
          <>
            <View style={[s.sectionHeader, { marginTop: 20 }]}>
              <Feather name="check-circle" size={14} color="#10B981" />
              <ThemedText
                style={{ fontSize: 13, fontWeight: "700", color: "#10B981" }}
              >
                Linked Codes ({matched.length})
              </ThemedText>
            </View>
            {matched.map(renderCodeCard)}
          </>
        )}

        {unmatchedCodes.length === 0 && (
          <View style={{ alignItems: "center", paddingTop: 60 }}>
            <Feather name="cpu" size={40} color={theme.textSecondary} />
            <ThemedText style={{ color: theme.textSecondary, marginTop: 12 }}>
              No biometric logs found yet.
            </ThemedText>
            <ThemedText
              style={{ color: theme.textSecondary, fontSize: 12, marginTop: 4 }}
            >
              Biometric device codes will appear here once the SmartOffice
              device syncs.
            </ThemedText>
          </View>
        )}

        <View style={{ height: 80 }} />
      </ScrollView>
    </View>
  );
}

const s = StyleSheet.create({
  container: { padding: 16 },
  loadError: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
    padding: 24,
  },
  loadErrorTitle: { fontSize: 17, fontWeight: "700", textAlign: "center" },
  retryButton: {
    marginTop: 8,
    borderRadius: 8,
    paddingHorizontal: 18,
    paddingVertical: 10,
  },
  infoBanner: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 8,
    padding: 12,
    borderRadius: 10,
    borderWidth: 1,
    marginBottom: 16,
  },
  exportButton: {
    minHeight: 44,
    borderRadius: 10,
    marginBottom: 14,
    paddingHorizontal: 14,
    paddingVertical: 11,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
  },
  exportButtonText: { color: "#FFFFFF", fontSize: 13, fontWeight: "700" },
  summaryRow: { flexDirection: "row", gap: 10, marginBottom: 20 },
  summaryCard: {
    flex: 1,
    alignItems: "center",
    padding: 14,
    borderRadius: 12,
  },
  sectionHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingVertical: 8,
    marginBottom: 6,
  },
  card: {
    borderRadius: 10,
    borderLeftWidth: 3,
    marginBottom: 8,
    overflow: "hidden",
  },
  cardHeader: {
    flexDirection: "row",
    alignItems: "flex-start",
    padding: 12,
    gap: 8,
  },
  codeRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    marginBottom: 4,
  },
  codeText: { fontSize: 15, fontWeight: "800", letterSpacing: 0.5 },
  machineName: { fontSize: 13, fontWeight: "600", marginBottom: 2 },
  badge: { paddingHorizontal: 8, paddingVertical: 2, borderRadius: 10 },
  badgeText: { fontSize: 10, fontWeight: "700" },
  metaText: { fontSize: 11 },
  reasonText: { fontSize: 11, fontWeight: "600", marginTop: 4 },
  suggestionBox: {
    borderWidth: 1,
    borderRadius: 8,
    padding: 8,
    marginTop: 8,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  useSuggestionButton: {
    backgroundColor: "#3B82F6",
    borderRadius: 7,
    paddingHorizontal: 12,
    paddingVertical: 7,
  },
  linkedRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    marginTop: 4,
  },
  actionBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
    borderWidth: 1,
  },
  searchPanel: { marginTop: 0, borderTopWidth: 1, borderTopColor: "#E5E7EB" },
  searchRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    padding: 10,
    margin: 10,
    borderRadius: 8,
  },
  searchInput: { flex: 1, fontSize: 13, padding: 0 },
  profileRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderBottomWidth: 1,
  },
  profileName: { fontSize: 13, fontWeight: "600", marginBottom: 2 },
  matchChip: {
    backgroundColor: "#6D1B6D",
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 8,
  },
});
