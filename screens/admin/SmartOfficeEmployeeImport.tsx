import React, { useState } from "react";
import {
  View,
  StyleSheet,
  Alert,
  ScrollView,
  Pressable,
  TextInput,
  FlatList,
  Modal,
} from "react-native";
import Feather from "@expo/vector-icons/Feather";
import { ThemedText } from "@/components/ThemedText";
import { ThemedView } from "@/components/ThemedView";
import { Button } from "@/components/Button";
import { PageHeader } from "@/components/PageHeader";
import { useTheme } from "@/hooks/useTheme";
import type { EmployeeMatchResult } from "@/services/attendance-import.service";
import { Colors } from "@/constants/theme";
import { supabase } from "@/lib/supabase";
import { firstRpcRow } from "@/utils/supabaseRpc";
import { fetchAllPages } from "@/utils/supabasePagination";

export function SmartOfficeEmployeeImport() {
  const { theme } = useTheme();
  const [isProcessing, setIsProcessing] = useState(false);
  const [results, setResults] = useState<EmployeeMatchResult[]>([]);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [tab, setTab] = useState<"matched" | "unmatched" | "duplicates">(
    "matched",
  );
  const [search, setSearch] = useState("");

  // Manual match modal state
  const [manualMatchRow, setManualMatchRow] =
    useState<EmployeeMatchResult | null>(null);
  const [systemUsers, setSystemUsers] = useState<
    {
      id: string;
      name: string;
      email: string | null;
      employee_number: string | null;
      is_active: boolean;
    }[]
  >([]);
  const [userSearch, setUserSearch] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveResult, setSaveResult] = useState<{
    saved: number;
    errors: string[];
  } | null>(null);

  const handleFileSelect = (event: any) => {
    const file = event.target.files?.[0];
    if (file) {
      setSelectedFile(file);
      processFile(file);
    }
  };

  const processFile = async (file: File) => {
    setIsProcessing(true);
    try {
      const { attendanceImportService } = await import(
        "@/services/attendance-import.service"
      );
      const records = await attendanceImportService.parseExcelFile(file);
      const matched = await attendanceImportService.matchEmployees(records);
      setResults(matched);
    } catch (error: any) {
      Alert.alert("Error", error.message);
    } finally {
      setIsProcessing(false);
    }
  };

  const openManualMatch = async (row: EmployeeMatchResult) => {
    if (!String(row.smartOfficeCode ?? "").trim()) {
      Alert.alert(
        "Device code required",
        "This row cannot be permanently linked because the spreadsheet does not contain a biometric employee code.",
      );
      return;
    }
    setManualMatchRow(row);
    setUserSearch("");
    if (!systemUsers.length) {
      const { data, error } = await fetchAllPages<{
        id: string;
        name: string;
        email: string | null;
        employee_number: string | null;
        is_active: boolean;
      }>((from, to) =>
        supabase
          .from("profiles")
          .select("id, name, email, employee_number, is_active")
          .order("name")
          .order("id")
          .range(from, to),
      );
      if (error) {
        Alert.alert("Unable to load employees", error.message);
        return;
      }
      setSystemUsers(data || []);
    }
  };

  const confirmManualMatch = async (user: {
    id: string;
    name: string;
    email: string | null;
    employee_number: string | null;
    is_active: boolean;
  }) => {
    if (!manualMatchRow) return;
    const assignedCode = String(manualMatchRow.smartOfficeCode ?? "").trim();
    if (!assignedCode) {
      Alert.alert(
        "Device code required",
        "This spreadsheet row has no biometric employee code. A person's name cannot be saved as a device code.",
      );
      return;
    }
    setSaving(true);
    try {
      // Update employee code in profiles
      const { data, error } = await supabase.rpc(
        "rpc_assign_biometric_employee_code",
        {
          p_profile_id: user.id,
          p_employee_code: assignedCode,
        },
      );
      if (error) throw error;
      const response = firstRpcRow<any>(data);
      if (
        response?.success !== true ||
        response?.profile_id !== user.id ||
        response?.employee_code !== assignedCode
      )
        throw new Error("Server did not confirm the biometric mapping.");

      // Update local results state
      setResults((prev) =>
        prev.map((r) => {
          if (r === manualMatchRow) {
            return {
              ...r,
              matched: true,
              smartOfficeName: r.smartOfficeName,
              smartOfficeCode: assignedCode,
              systemEmployee: {
                ...r.systemEmployee,
                id: user.id,
                name: user.name,
                email: user.email ?? "",
                smartoffice_employee_code: assignedCode,
              },
            };
          }
          return r;
        }),
      );

      setManualMatchRow(null);
      Alert.alert(
        "Matched",
        `Device code "${assignedCode}" linked to ${user.name}.`,
      );
    } catch (err: any) {
      Alert.alert("Error", err.message);
    } finally {
      setSaving(false);
    }
  };

  const handleApplyAll = async () => {
    const toUpdate = results.filter(
      (r) =>
        r.matched &&
        r.systemEmployee.id &&
        r.smartOfficeCode &&
        r.smartOfficeCode !== r.systemEmployee.smartoffice_employee_code,
    );

    if (toUpdate.length === 0) return;

    // Skip rows whose code appears more than once in toUpdate (duplicates must be resolved manually)
    const codeCount = new Map<string, number>();
    for (const r of toUpdate)
      codeCount.set(
        r.smartOfficeCode!.toLowerCase(),
        (codeCount.get(r.smartOfficeCode!.toLowerCase()) ?? 0) + 1,
      );
    const safe = toUpdate.filter(
      (r) => codeCount.get(r.smartOfficeCode!.toLowerCase()) === 1,
    );
    const skippedDups = toUpdate.length - safe.length;

    if (safe.length === 0) {
      setSaveResult({
        saved: 0,
        errors: [
          `All ${skippedDups} pending codes have duplicates. Resolve them in the Duplicates tab first.`,
        ],
      });
      return;
    }

    setIsProcessing(true);
    try {
      const { data, error } = await supabase.rpc(
        "rpc_assign_biometric_employee_codes_batch",
        {
          p_mappings: safe.map((r) => ({
            profile_id: r.systemEmployee.id,
            employee_code: r.smartOfficeCode,
          })),
        },
      );
      if (error) throw error;
      const response = firstRpcRow<any>(data);
      if (
        response?.success !== true ||
        Number(response?.updated) !== safe.length
      ) {
        throw new Error(
          "The server did not confirm the complete mapping batch.",
        );
      }
      const savedCodes = new Map(
        safe.map((r) => [r.systemEmployee.id, r.smartOfficeCode!]),
      );
      setResults((prev) =>
        prev.map((res) =>
          savedCodes.has(res.systemEmployee.id)
            ? {
                ...res,
                systemEmployee: {
                  ...res.systemEmployee,
                  smartoffice_employee_code: savedCodes.get(
                    res.systemEmployee.id,
                  )!,
                },
              }
            : res,
        ),
      );
      const warnings =
        skippedDups > 0
          ? [`${skippedDups} skipped — resolve duplicates tab first.`]
          : [];
      setSaveResult({ saved: safe.length, errors: warnings });
    } catch (err: any) {
      setSaveResult({
        saved: 0,
        errors: [`No mappings were saved: ${err.message}`],
      });
    } finally {
      setIsProcessing(false);
    }
  };

  const removeMatch = (item: EmployeeMatchResult) => {
    setResults((prev) =>
      prev.map((r) =>
        r === item
          ? {
              ...r,
              matched: false,
              systemEmployee: { id: "", name: "", email: "", department: "" },
            }
          : r,
      ),
    );
  };

  // Admin picks which system user keeps the duplicate code — removes the match from all others
  const resolveDuplicate = async (
    dup: { key: string; type: "code" | "name"; rows: EmployeeMatchResult[] },
    kept: EmployeeMatchResult,
  ) => {
    const assignedCode = String(kept.smartOfficeCode ?? "").trim();
    if (!assignedCode) {
      const message =
        "This row has no verified biometric employee code. A name cannot be saved as a device code.";
      setSaveResult({ saved: 0, errors: [message] });
      Alert.alert("Device code required", message);
      return;
    }
    // Save the code to the kept user immediately
    const { data, error } = await supabase.rpc(
      "rpc_assign_biometric_employee_code",
      {
        p_profile_id: kept.systemEmployee.id,
        p_employee_code: assignedCode,
      },
    );
    const response = firstRpcRow<any>(data);
    if (
      error ||
      response?.success !== true ||
      response?.profile_id !== kept.systemEmployee.id ||
      response?.employee_code !== assignedCode
    ) {
      const message =
        error?.message ||
        response?.message ||
        "Server did not confirm duplicate resolution.";
      setSaveResult({ saved: 0, errors: [message] });
      Alert.alert("Duplicate resolution failed", message);
      return;
    }

    // Remove all other rows from the duplicate group from matched list
    const discardIds = dup.rows
      .filter((r) => r.systemEmployee.id !== kept.systemEmployee.id)
      .map((r) => r.systemEmployee.id);
    setResults((prev) =>
      prev.map((r) => {
        if (discardIds.includes(r.systemEmployee.id))
          return {
            ...r,
            matched: false,
            systemEmployee: { id: "", name: "", email: "", department: "" },
          };
        if (r.systemEmployee.id === kept.systemEmployee.id)
          return {
            ...r,
            smartOfficeCode: assignedCode,
            systemEmployee: {
              ...r.systemEmployee,
              smartoffice_employee_code: assignedCode,
            },
          };
        return r;
      }),
    );
    setSaveResult((prev) => ({
      saved: (prev?.saved ?? 0) + 1,
      errors: prev?.errors ?? [],
    }));
  };

  const matched = results.filter((r) => r.matched);
  const unmatched = results.filter((r) => !r.matched);

  // Detect duplicates: same smartOfficeCode OR same smartOfficeName appears in multiple matched results
  const codeSeen = new Map<string, EmployeeMatchResult[]>();
  const nameSeen = new Map<string, EmployeeMatchResult[]>();
  for (const r of matched) {
    if (r.smartOfficeCode) {
      const k = r.smartOfficeCode.toLowerCase();
      codeSeen.set(k, [...(codeSeen.get(k) ?? []), r]);
    }
    if (r.smartOfficeName) {
      const k = r.smartOfficeName.toLowerCase().trim();
      nameSeen.set(k, [...(nameSeen.get(k) ?? []), r]);
    }
  }
  const duplicates: {
    key: string;
    type: "code" | "name";
    rows: EmployeeMatchResult[];
  }[] = [];
  for (const [k, rows] of codeSeen)
    if (rows.length > 1) duplicates.push({ key: k, type: "code", rows });
  for (const [k, rows] of nameSeen)
    if (rows.length > 1 && !codeSeen.has(k))
      duplicates.push({ key: k, type: "name", rows });

  // For unmatched, we need SmartOffice names that have NO system match
  // Get all unique SO names from raw file that didn't match any system user
  const unmatchedSoNames = useUnmatchedSONames(results);

  const displayedMatched = matched.filter((r) => {
    if (!search) return true;
    const s = search.toLowerCase();
    return (
      r.systemEmployee.name.toLowerCase().includes(s) ||
      (r.smartOfficeName?.toLowerCase().includes(s) ?? false)
    );
  });

  const displayedUnmatched = unmatchedSoNames.filter((name) => {
    if (!search) return true;
    return name.toLowerCase().includes(search.toLowerCase());
  });

  const filteredUsers = systemUsers.filter(
    (u) =>
      !userSearch ||
      u.name.toLowerCase().includes(userSearch.toLowerCase()) ||
      (u.email ?? "").toLowerCase().includes(userSearch.toLowerCase()) ||
      (u.employee_number ?? "")
        .toLowerCase()
        .includes(userSearch.toLowerCase()),
  );

  return (
    <ThemedView style={styles.container}>
      <PageHeader title="SmartOffice Attendance Comparison" />
      <ScrollView style={styles.content}>
        {/* Upload */}
        <label htmlFor="so-file-upload" style={{ cursor: "pointer" }}>
          <View
            style={[
              styles.uploadBox,
              {
                backgroundColor: theme.backgroundRoot,
                borderColor: selectedFile
                  ? Colors.light.success
                  : theme.primary,
              },
            ]}
          >
            <Feather
              name="upload-cloud"
              size={32}
              color={selectedFile ? Colors.light.success : theme.primary}
            />
            <ThemedText style={styles.uploadText}>
              {selectedFile
                ? selectedFile.name
                : "Upload SmartOffice Excel file"}
            </ThemedText>
            <ThemedText
              style={[styles.uploadHint, { color: theme.textSecondary }]}
            >
              Supports .xlsx, .xls formats
            </ThemedText>
          </View>
        </label>
        <input
          id="so-file-upload"
          type="file"
          accept=".xlsx,.xls"
          onChange={handleFileSelect}
          style={{ display: "none" }}
        />

        {isProcessing && (
          <View style={styles.processing}>
            <ThemedText style={{ color: theme.textSecondary }}>
              Comparing...
            </ThemedText>
          </View>
        )}

        {results.length > 0 && !isProcessing && (
          <>
            {/* Summary */}
            <View style={styles.summaryRow}>
              <View
                style={[
                  styles.summaryCard,
                  { backgroundColor: Colors.light.success + "15" },
                ]}
              >
                <ThemedText
                  style={[styles.summaryNum, { color: Colors.light.success }]}
                >
                  {matched.length}
                </ThemedText>
                <ThemedText
                  style={[styles.summaryLabel, { color: Colors.light.success }]}
                >
                  Matched
                </ThemedText>
              </View>
              <View
                style={[
                  styles.summaryCard,
                  { backgroundColor: Colors.light.error + "15" },
                ]}
              >
                <ThemedText
                  style={[styles.summaryNum, { color: Colors.light.error }]}
                >
                  {unmatchedSoNames.length}
                </ThemedText>
                <ThemedText
                  style={[styles.summaryLabel, { color: Colors.light.error }]}
                >
                  Unmatched
                </ThemedText>
              </View>
              <View
                style={[
                  styles.summaryCard,
                  { backgroundColor: Colors.light.warning + "15" },
                ]}
              >
                <ThemedText
                  style={[styles.summaryNum, { color: Colors.light.warning }]}
                >
                  {duplicates.length}
                </ThemedText>
                <ThemedText
                  style={[styles.summaryLabel, { color: Colors.light.warning }]}
                >
                  Duplicates
                </ThemedText>
              </View>
            </View>

            {/* Tabs */}
            <View
              style={[
                styles.tabs,
                { borderBottomColor: theme.backgroundDefault },
              ]}
            >
              <Pressable
                style={[
                  styles.tab,
                  tab === "matched" && {
                    borderBottomColor: Colors.light.success,
                  },
                ]}
                onPress={() => {
                  setTab("matched");
                  setSearch("");
                }}
              >
                <ThemedText
                  style={[
                    styles.tabText,
                    {
                      color:
                        tab === "matched"
                          ? Colors.light.success
                          : theme.textSecondary,
                    },
                  ]}
                >
                  Matched ({matched.length})
                </ThemedText>
              </Pressable>
              <Pressable
                style={[
                  styles.tab,
                  tab === "unmatched" && {
                    borderBottomColor: Colors.light.error,
                  },
                ]}
                onPress={() => {
                  setTab("unmatched");
                  setSearch("");
                }}
              >
                <ThemedText
                  style={[
                    styles.tabText,
                    {
                      color:
                        tab === "unmatched"
                          ? Colors.light.error
                          : theme.textSecondary,
                    },
                  ]}
                >
                  Unmatched ({unmatchedSoNames.length})
                </ThemedText>
              </Pressable>
              <Pressable
                style={[
                  styles.tab,
                  tab === "duplicates" && {
                    borderBottomColor: Colors.light.warning,
                  },
                ]}
                onPress={() => {
                  setTab("duplicates");
                  setSearch("");
                }}
              >
                <ThemedText
                  style={[
                    styles.tabText,
                    {
                      color:
                        tab === "duplicates"
                          ? Colors.light.warning
                          : theme.textSecondary,
                    },
                  ]}
                >
                  Duplicates ({duplicates.length})
                </ThemedText>
              </Pressable>
            </View>

            {/* Column headers */}
            <View
              style={[
                styles.colHeader,
                { backgroundColor: theme.backgroundRoot },
              ]}
            >
              <ThemedText
                style={[styles.colLabel, { color: theme.textSecondary }]}
              >
                SMARTOFFICE
              </ThemedText>
              <Feather
                name="arrow-right"
                size={12}
                color={theme.textSecondary}
              />
              <ThemedText
                style={[styles.colLabel, { color: theme.textSecondary }]}
              >
                OUR SYSTEM
              </ThemedText>
            </View>

            {/* Search */}
            <View
              style={[
                styles.searchBox,
                { backgroundColor: theme.backgroundDefault },
              ]}
            >
              <Feather name="search" size={14} color={theme.textSecondary} />
              <TextInput
                style={[styles.searchInput, { color: theme.text }]}
                placeholder="Search name..."
                placeholderTextColor={theme.textSecondary}
                value={search}
                onChangeText={setSearch}
              />
              {search.length > 0 && (
                <Pressable onPress={() => setSearch("")}>
                  <Feather name="x" size={14} color={theme.textSecondary} />
                </Pressable>
              )}
            </View>

            {/* Matched list */}
            {tab === "matched" && (
              <FlatList
                data={displayedMatched}
                keyExtractor={(item) => item.systemEmployee.id}
                scrollEnabled={false}
                contentContainerStyle={styles.list}
                renderItem={({ item }) => (
                  <View
                    style={[
                      styles.row,
                      { backgroundColor: theme.backgroundDefault },
                    ]}
                  >
                    {/* Left: SmartOffice */}
                    <View style={styles.leftCol}>
                      <ThemedText style={styles.soName}>
                        {item.smartOfficeName || "—"}
                      </ThemedText>
                      {item.smartOfficeCode ? (
                        <ThemedText
                          style={[
                            styles.subText,
                            { color: theme.textSecondary },
                          ]}
                        >
                          Code: {item.smartOfficeCode}
                        </ThemedText>
                      ) : null}
                      <ThemedText
                        style={[
                          styles.subText,
                          { color: Colors.light.success },
                        ]}
                      >
                        {item.recordCount} days
                      </ThemedText>
                    </View>

                    {/* Arrow */}
                    <View style={styles.arrowCol}>
                      <Feather
                        name="check"
                        size={16}
                        color={Colors.light.success}
                      />
                    </View>

                    {/* Right: System user + remove button */}
                    <View style={styles.rightCol}>
                      <ThemedText style={styles.sysName}>
                        {item.systemEmployee.name}
                      </ThemedText>
                      <ThemedText
                        style={[styles.subText, { color: theme.textSecondary }]}
                      >
                        {item.systemEmployee.email}
                      </ThemedText>
                      {item.systemEmployee.department ? (
                        <ThemedText
                          style={[
                            styles.subText,
                            { color: theme.textSecondary },
                          ]}
                        >
                          {item.systemEmployee.department}
                        </ThemedText>
                      ) : null}
                      {item.smartOfficeCode &&
                      item.systemEmployee.smartoffice_employee_code ===
                        item.smartOfficeCode ? (
                        <View
                          style={[
                            styles.linkedBadge,
                            { backgroundColor: Colors.light.success + "20" },
                          ]}
                        >
                          <Feather
                            name="link"
                            size={10}
                            color={Colors.light.success}
                          />
                          <ThemedText
                            style={[
                              styles.linkedBadgeText,
                              { color: Colors.light.success },
                            ]}
                          >
                            Already Linked
                          </ThemedText>
                        </View>
                      ) : (
                        <Pressable
                          style={[
                            styles.removeBtn,
                            { borderColor: Colors.light.error + "80" },
                          ]}
                          onPress={() => removeMatch(item)}
                        >
                          <Feather
                            name="x"
                            size={11}
                            color={Colors.light.error}
                          />
                          <ThemedText
                            style={[
                              styles.removeBtnText,
                              { color: Colors.light.error },
                            ]}
                          >
                            Remove
                          </ThemedText>
                        </Pressable>
                      )}
                    </View>
                  </View>
                )}
                ListEmptyComponent={
                  <ThemedText
                    style={[styles.empty, { color: theme.textSecondary }]}
                  >
                    No results
                  </ThemedText>
                }
              />
            )}

            {/* Unmatched list */}
            {tab === "unmatched" && (
              <FlatList
                data={displayedUnmatched}
                keyExtractor={(item) => item}
                scrollEnabled={false}
                contentContainerStyle={styles.list}
                renderItem={({ item: soName }) => (
                  <View
                    style={[
                      styles.row,
                      { backgroundColor: theme.backgroundDefault },
                    ]}
                  >
                    {/* Left: SmartOffice name */}
                    <View style={styles.leftCol}>
                      <ThemedText style={styles.soName}>{soName}</ThemedText>
                      <ThemedText
                        style={[styles.subText, { color: Colors.light.error }]}
                      >
                        Not matched
                      </ThemedText>
                    </View>

                    {/* Arrow */}
                    <View style={styles.arrowCol}>
                      <Feather
                        name="help-circle"
                        size={16}
                        color={Colors.light.warning}
                      />
                    </View>

                    {/* Right: Manual match button */}
                    <View style={styles.rightCol}>
                      <Pressable
                        style={[
                          styles.matchBtn,
                          { borderColor: theme.primary },
                        ]}
                        onPress={() => {
                          const soResult = results.find(
                            (r) =>
                              !r.matched &&
                              !r.systemEmployee.id &&
                              r.smartOfficeName === soName,
                          );
                          if (soResult) openManualMatch(soResult);
                        }}
                      >
                        <Feather
                          name="user-plus"
                          size={13}
                          color={theme.primary}
                        />
                        <ThemedText
                          style={[
                            styles.matchBtnText,
                            { color: theme.primary },
                          ]}
                        >
                          Match to user
                        </ThemedText>
                      </Pressable>
                    </View>
                  </View>
                )}
                ListEmptyComponent={
                  <ThemedText
                    style={[styles.empty, { color: theme.textSecondary }]}
                  >
                    No unmatched entries
                  </ThemedText>
                }
              />
            )}

            {/* Duplicates list */}
            {tab === "duplicates" && (
              <FlatList
                data={duplicates}
                keyExtractor={(item) => item.key}
                scrollEnabled={false}
                contentContainerStyle={styles.list}
                renderItem={({ item: dup }) => (
                  <View
                    style={[
                      styles.dupCard,
                      {
                        backgroundColor: theme.backgroundDefault,
                        borderColor: Colors.light.warning + "60",
                      },
                    ]}
                  >
                    <View style={styles.dupHeader}>
                      <View
                        style={[
                          styles.dupBadge,
                          { backgroundColor: Colors.light.warning + "20" },
                        ]}
                      >
                        <Feather
                          name="alert-triangle"
                          size={12}
                          color={Colors.light.warning}
                        />
                        <ThemedText
                          style={[
                            styles.dupBadgeText,
                            { color: Colors.light.warning },
                          ]}
                        >
                          {dup.type === "code"
                            ? `Same Code: ${dup.rows[0].smartOfficeCode}`
                            : `Same Name: ${dup.rows[0].smartOfficeName}`}
                        </ThemedText>
                      </View>
                      <ThemedText
                        style={[styles.subText, { color: theme.textSecondary }]}
                      >
                        Pick one to keep
                      </ThemedText>
                    </View>
                    {dup.rows.map((r, i) => (
                      <View
                        key={r.systemEmployee.id}
                        style={[
                          styles.dupRow,
                          i < dup.rows.length - 1 && {
                            borderBottomWidth: 1,
                            borderBottomColor: theme.backgroundRoot,
                          },
                        ]}
                      >
                        <View style={styles.leftCol}>
                          <ThemedText style={styles.soName}>
                            {r.smartOfficeName}
                          </ThemedText>
                          <ThemedText
                            style={[
                              styles.subText,
                              { color: theme.textSecondary },
                            ]}
                          >
                            Code: {r.smartOfficeCode} • {r.recordCount} days
                          </ThemedText>
                        </View>
                        <Feather
                          name="arrow-right"
                          size={12}
                          color={theme.textSecondary}
                        />
                        <View style={styles.rightCol}>
                          <ThemedText style={styles.sysName}>
                            {r.systemEmployee.name}
                          </ThemedText>
                          <ThemedText
                            style={[
                              styles.subText,
                              { color: theme.textSecondary },
                            ]}
                          >
                            {r.systemEmployee.email}
                          </ThemedText>
                          <Pressable
                            style={[
                              styles.keepBtn,
                              {
                                backgroundColor: Colors.light.success + "20",
                                borderColor: Colors.light.success + "60",
                              },
                            ]}
                            onPress={() => resolveDuplicate(dup, r)}
                          >
                            <Feather
                              name="check"
                              size={11}
                              color={Colors.light.success}
                            />
                            <ThemedText
                              style={[
                                styles.keepBtnText,
                                { color: Colors.light.success },
                              ]}
                            >
                              Keep This
                            </ThemedText>
                          </Pressable>
                        </View>
                      </View>
                    ))}
                  </View>
                )}
                ListEmptyComponent={
                  <ThemedText
                    style={[styles.empty, { color: theme.textSecondary }]}
                  >
                    No duplicates found
                  </ThemedText>
                }
              />
            )}

            {/* Apply All Changes */}
            {matched.length > 0 &&
              (() => {
                const needsUpdate = matched.filter(
                  (r) =>
                    r.smartOfficeCode &&
                    r.systemEmployee.id &&
                    r.smartOfficeCode !==
                      r.systemEmployee.smartoffice_employee_code,
                );
                return (
                  <View
                    style={[
                      styles.applySection,
                      { backgroundColor: theme.backgroundDefault },
                    ]}
                  >
                    <View style={styles.applyStats}>
                      <View style={styles.applyStat}>
                        <ThemedText
                          style={[
                            styles.applyStatNum,
                            { color: Colors.light.success },
                          ]}
                        >
                          {matched.length}
                        </ThemedText>
                        <ThemedText
                          style={[
                            styles.applyStatLabel,
                            { color: theme.textSecondary },
                          ]}
                        >
                          Total Matched
                        </ThemedText>
                      </View>
                      <View style={styles.applyStat}>
                        <ThemedText
                          style={[
                            styles.applyStatNum,
                            { color: theme.primary },
                          ]}
                        >
                          {needsUpdate.length}
                        </ThemedText>
                        <ThemedText
                          style={[
                            styles.applyStatLabel,
                            { color: theme.textSecondary },
                          ]}
                        >
                          Codes to Save
                        </ThemedText>
                      </View>
                      <View style={styles.applyStat}>
                        <ThemedText
                          style={[
                            styles.applyStatNum,
                            { color: theme.textSecondary },
                          ]}
                        >
                          {matched.length - needsUpdate.length}
                        </ThemedText>
                        <ThemedText
                          style={[
                            styles.applyStatLabel,
                            { color: theme.textSecondary },
                          ]}
                        >
                          Already Linked
                        </ThemedText>
                      </View>
                    </View>

                    {/* Inline result after save */}
                    {saveResult && (
                      <View
                        style={[
                          styles.saveResult,
                          {
                            backgroundColor:
                              saveResult.errors.length === 0
                                ? Colors.light.success + "15"
                                : Colors.light.error + "15",
                          },
                        ]}
                      >
                        <Feather
                          name={
                            saveResult.errors.length === 0
                              ? "check-circle"
                              : "alert-circle"
                          }
                          size={16}
                          color={
                            saveResult.errors.length === 0
                              ? Colors.light.success
                              : Colors.light.error
                          }
                        />
                        <View style={{ flex: 1 }}>
                          <ThemedText
                            style={[
                              styles.saveResultText,
                              {
                                color:
                                  saveResult.errors.length === 0
                                    ? Colors.light.success
                                    : Colors.light.error,
                              },
                            ]}
                          >
                            {saveResult.saved} employee codes saved
                            successfully.
                          </ThemedText>
                          {saveResult.errors.length > 0 && (
                            <ThemedText
                              style={[
                                styles.saveResultSub,
                                { color: Colors.light.error },
                              ]}
                            >
                              {saveResult.errors.slice(0, 3).join("\n")}
                            </ThemedText>
                          )}
                          {saveResult.saved > 0 &&
                            saveResult.errors.length === 0 && (
                              <ThemedText
                                style={[
                                  styles.saveResultSub,
                                  { color: Colors.light.success },
                                ]}
                              >
                                Next: go to Biometric Sync to import their
                                attendance.
                              </ThemedText>
                            )}
                        </View>
                      </View>
                    )}

                    <Button
                      title={
                        isProcessing
                          ? "Saving..."
                          : needsUpdate.length > 0
                            ? `Save Codes for ${needsUpdate.length} Employees`
                            : "All Codes Already Saved ✓"
                      }
                      onPress={handleApplyAll}
                      loading={isProcessing}
                      disabled={needsUpdate.length === 0 || isProcessing}
                    />
                    {needsUpdate.length > 0 && !saveResult && (
                      <ThemedText
                        style={[
                          styles.applyHint,
                          { color: theme.textSecondary },
                        ]}
                      >
                        Saves SmartOffice employee code to each matched user.
                        After this, use Biometric Sync to import attendance.
                      </ThemedText>
                    )}
                  </View>
                );
              })()}
          </>
        )}
      </ScrollView>

      {/* Manual Match Modal */}
      <Modal
        visible={!!manualMatchRow}
        animationType="slide"
        transparent
        onRequestClose={() => setManualMatchRow(null)}
      >
        <View style={styles.modalOverlay}>
          <View
            style={[
              styles.modalContent,
              { backgroundColor: theme.backgroundDefault },
            ]}
          >
            <View style={styles.modalHeader}>
              <ThemedText style={styles.modalTitle}>
                Match "{manualMatchRow?.smartOfficeName}"
              </ThemedText>
              <Pressable onPress={() => setManualMatchRow(null)}>
                <Feather name="x" size={20} color={theme.text} />
              </Pressable>
            </View>
            <ThemedText
              style={[styles.modalSub, { color: theme.textSecondary }]}
            >
              Select the matching employee. Only the spreadsheet's verified
              device code will be saved; names are never used as codes.
            </ThemedText>

            <View
              style={[
                styles.searchBox,
                { backgroundColor: theme.backgroundRoot, marginBottom: 8 },
              ]}
            >
              <Feather name="search" size={14} color={theme.textSecondary} />
              <TextInput
                style={[styles.searchInput, { color: theme.text }]}
                placeholder="Search system users..."
                placeholderTextColor={theme.textSecondary}
                value={userSearch}
                onChangeText={setUserSearch}
                autoFocus
              />
            </View>

            <FlatList
              data={filteredUsers}
              keyExtractor={(u) => u.id}
              style={{ maxHeight: 360 }}
              renderItem={({ item: user }) => (
                <Pressable
                  style={[
                    styles.userRow,
                    { borderBottomColor: theme.backgroundRoot },
                  ]}
                  onPress={() => confirmManualMatch(user)}
                >
                  <View style={styles.userAvatar}>
                    <ThemedText style={styles.userAvatarText}>
                      {user.name.charAt(0).toUpperCase()}
                    </ThemedText>
                  </View>
                  <View style={{ flex: 1 }}>
                    <ThemedText style={styles.userName}>{user.name}</ThemedText>
                    <ThemedText
                      style={[styles.subText, { color: theme.textSecondary }]}
                    >
                      {[
                        user.employee_number
                          ? `#${user.employee_number}`
                          : null,
                        user.email,
                        user.is_active ? "Active" : "Inactive",
                      ]
                        .filter(Boolean)
                        .join(" · ")}
                    </ThemedText>
                  </View>
                  {saving ? null : (
                    <Feather
                      name="chevron-right"
                      size={16}
                      color={theme.textSecondary}
                    />
                  )}
                </Pressable>
              )}
              ListEmptyComponent={
                <ThemedText
                  style={[styles.empty, { color: theme.textSecondary }]}
                >
                  No users found
                </ThemedText>
              }
            />
          </View>
        </View>
      </Modal>
    </ThemedView>
  );
}

// Unmatched = SmartOffice entries with no system user (systemEmployee.id is empty)
function useUnmatchedSONames(results: EmployeeMatchResult[]): string[] {
  const seen = new Set<string>();
  const names: string[] = [];
  for (const r of results) {
    if (!r.matched && !r.systemEmployee.id && r.smartOfficeName) {
      if (!seen.has(r.smartOfficeName)) {
        seen.add(r.smartOfficeName);
        names.push(r.smartOfficeName);
      }
    }
  }
  return names;
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  content: { flex: 1, padding: 16 },
  uploadBox: {
    borderWidth: 2,
    borderStyle: "dashed",
    borderRadius: 12,
    padding: 20,
    alignItems: "center",
    marginBottom: 16,
  },
  uploadText: { fontSize: 14, fontWeight: "500", marginTop: 8 },
  uploadHint: { fontSize: 12, marginTop: 4 },
  processing: { padding: 24, alignItems: "center" },
  summaryRow: { flexDirection: "row", gap: 12, marginBottom: 16 },
  summaryCard: { flex: 1, borderRadius: 12, padding: 14, alignItems: "center" },
  summaryNum: { fontSize: 28, fontWeight: "700" },
  summaryLabel: { fontSize: 12, marginTop: 4 },
  tabs: { flexDirection: "row", borderBottomWidth: 1, marginBottom: 12 },
  tab: {
    flex: 1,
    paddingVertical: 10,
    alignItems: "center",
    borderBottomWidth: 2,
    borderBottomColor: "transparent",
  },
  tabText: { fontSize: 13, fontWeight: "600" },
  colHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 6,
    marginBottom: 8,
    gap: 8,
  },
  colLabel: { flex: 1, fontSize: 11, fontWeight: "700", letterSpacing: 0.5 },
  searchBox: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    padding: 10,
    borderRadius: 10,
    marginBottom: 10,
  },
  searchInput: { flex: 1, fontSize: 14 },
  list: { gap: 6 },
  row: {
    flexDirection: "row",
    alignItems: "center",
    borderRadius: 10,
    padding: 12,
    gap: 8,
  },
  leftCol: { flex: 1 },
  arrowCol: { width: 24, alignItems: "center" },
  rightCol: { flex: 1, alignItems: "flex-end" },
  soName: { fontSize: 13, fontWeight: "600" },
  sysName: { fontSize: 13, fontWeight: "600", textAlign: "right" },
  subText: { fontSize: 11, marginTop: 2 },
  matchBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  matchBtnText: { fontSize: 12, fontWeight: "500" },
  applySection: {
    borderRadius: 12,
    padding: 16,
    marginTop: 24,
    marginBottom: 48,
    gap: 12,
  },
  applyStats: { flexDirection: "row", gap: 8, marginBottom: 4 },
  applyStat: { flex: 1, alignItems: "center" },
  applyStatNum: { fontSize: 22, fontWeight: "700" },
  applyStatLabel: { fontSize: 11, marginTop: 2, textAlign: "center" },
  applyHint: { fontSize: 11, textAlign: "center", lineHeight: 16 },
  linkedBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    borderRadius: 6,
    paddingHorizontal: 7,
    paddingVertical: 3,
    marginTop: 6,
    alignSelf: "flex-end",
  },
  linkedBadgeText: { fontSize: 10, fontWeight: "600" },
  keepBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    borderWidth: 1,
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 4,
    marginTop: 6,
    alignSelf: "flex-end",
  },
  keepBtnText: { fontSize: 11, fontWeight: "600" },
  saveResult: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 10,
    padding: 12,
    borderRadius: 10,
  },
  saveResultText: { fontSize: 13, fontWeight: "600" },
  saveResultSub: { fontSize: 11, marginTop: 3, lineHeight: 16 },
  removeBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    borderWidth: 1,
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 4,
    marginTop: 6,
    alignSelf: "flex-end",
  },
  removeBtnText: { fontSize: 11, fontWeight: "500" },
  empty: { textAlign: "center", padding: 24, fontSize: 13 },
  dupCard: {
    borderRadius: 10,
    borderWidth: 1,
    overflow: "hidden",
    marginBottom: 2,
  },
  dupHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    padding: 10,
  },
  dupBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
  },
  dupBadgeText: { fontSize: 11, fontWeight: "700" },
  dupRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  // Modal
  modalOverlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.5)",
    justifyContent: "flex-end",
  },
  modalContent: {
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    padding: 20,
    maxHeight: "80%",
  },
  modalHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 8,
  },
  modalTitle: { fontSize: 16, fontWeight: "700" },
  modalSub: { fontSize: 13, marginBottom: 16 },
  userRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingVertical: 12,
    borderBottomWidth: 1,
  },
  userAvatar: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: Colors.light.primary + "30",
    alignItems: "center",
    justifyContent: "center",
  },
  userAvatarText: {
    fontSize: 14,
    fontWeight: "700",
    color: Colors.light.primary,
  },
  userName: { fontSize: 14, fontWeight: "600" },
});
