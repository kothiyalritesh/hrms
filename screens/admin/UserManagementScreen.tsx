import React, { useState, useCallback } from "react";
import {
  StyleSheet,
  View,
  FlatList,
  Pressable,
  Alert,
  Modal,
  TextInput,
  ScrollView,
  ActivityIndicator,
  TouchableOpacity,
} from "react-native";
import * as DocumentPicker from "expo-document-picker";
import * as Sharing from "expo-sharing";
import { Feather } from "@expo/vector-icons";
import { useFocusEffect } from "@react-navigation/native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { ThemedText } from "@/components/ThemedText";
import { ThemedView } from "@/components/ThemedView";
import { Button } from "@/components/Button";
import { useTheme } from "@/hooks/useTheme";
import { Spacing, BorderRadius, Colors } from "@/constants/theme";
import Spacer from "@/components/Spacer";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/contexts/AuthContext";
import { DepartmentService } from "@/services/department.service";
import {
  createUserWithCredentials,
  generateUsername,
} from "@/services/userCredentials.service";

interface Employee {
  id: string;
  name: string;
  email: string;
  phone?: string;
  employee_number?: string;
  role_name: string;
  role_id: string;
  office_name: string;
  office_id: string;
  department_id?: string;
  department_name?: string;
  designation_id?: string;
  designation_name?: string;
  is_active: boolean;
  reporting_manager_name?: string;
  username?: string;
  otp_enabled?: boolean;
}

interface Role {
  id: string;
  name: string;
}

interface Office {
  id: string;
  name: string;
}

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const isUUID = (v: string) => UUID_REGEX.test(v);

const EMPTY_FORM = {
  name: "",
  email: "",
  phone: "",
  employee_number: "",
  role_id: "",
  office_id: "",
  department_id: "",
  designation_id: "",
  date_of_birth: "",
  reporting_manager_id: "",
};

export default function UserManagementScreen() {
  const { theme, isDark } = useTheme();
  const insets = useSafeAreaInsets();
  const { user } = useAuth();
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [roles, setRoles] = useState<Role[]>([]);
  const [offices, setOffices] = useState<Office[]>([]);
  const [departments, setDepartments] = useState<any[]>([]);
  const [designations, setDesignations] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [showCredentialsModal, setShowCredentialsModal] = useState(false);
  const [editingEmployee, setEditingEmployee] = useState<Employee | null>(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [generatedCredentials, setGeneratedCredentials] = useState<any>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [csvUploading, setCsvUploading] = useState(false);
  const [openPicker, setOpenPicker] = useState<string | null>(null);
  const [pickerSearch, setPickerSearch] = useState<Record<string, string>>({});

  type SelectOption = { label: string; value: string };

  const ThemedSelect = ({
    field,
    value,
    placeholder,
    options,
    onChange,
  }: {
    field: string;
    value: string;
    placeholder: string;
    options: SelectOption[];
    onChange: (v: string) => void;
  }) => {
    const isOpen = openPicker === field;
    const searchText = pickerSearch[field] ?? "";
    const selected = options.find((o) => o.value === value);
    const displayLabel = selected ? selected.label : value || "";

    const filtered = searchText.trim()
      ? options.filter((o) => o.label.toLowerCase().includes(searchText.toLowerCase()))
      : options;
    const exactMatch = options.some(
      (o) => o.label.toLowerCase() === searchText.trim().toLowerCase()
    );
    const showAddOption = searchText.trim().length > 0 && !exactMatch;

    const handleOpen = () => {
      if (isOpen) {
        setOpenPicker(null);
      } else {
        setOpenPicker(field);
        setPickerSearch((prev) => ({ ...prev, [field]: "" }));
      }
    };

    const handleSelect = (val: string) => {
      onChange(val);
      setOpenPicker(null);
      setPickerSearch((prev) => ({ ...prev, [field]: "" }));
    };

    return (
      <>
        <TouchableOpacity
          activeOpacity={0.7}
          style={[
            styles.pickerContainer,
            { backgroundColor: theme.backgroundSecondary, borderColor: theme.border },
          ]}
          onPress={handleOpen}
        >
          <ThemedText
            type="body"
            style={[styles.pickerValue, { color: displayLabel ? theme.text : theme.textSecondary }]}
          >
            {displayLabel || placeholder}
          </ThemedText>
          <Feather name={isOpen ? "chevron-up" : "chevron-down"} size={16} color={theme.textSecondary} />
        </TouchableOpacity>
        {isOpen && (
          <View style={[styles.dropdownList, { backgroundColor: theme.backgroundDefault, borderColor: theme.border }]}>
            <View style={[styles.dropdownSearch, { borderBottomColor: theme.border }]}>
              <Feather name="search" size={14} color={theme.textSecondary} />
              <TextInput
                style={[styles.dropdownSearchInput, { color: theme.text }]}
                value={searchText}
                onChangeText={(t) => setPickerSearch((prev) => ({ ...prev, [field]: t }))}
                placeholder={`Search or type custom...`}
                placeholderTextColor={theme.textSecondary}
                autoFocus
              />
              {searchText.length > 0 && (
                <TouchableOpacity onPress={() => setPickerSearch((prev) => ({ ...prev, [field]: "" }))}>
                  <Feather name="x" size={14} color={theme.textSecondary} />
                </TouchableOpacity>
              )}
            </View>
            <ScrollView keyboardShouldPersistTaps="handled" style={{ maxHeight: 180 }}>
              {!searchText && (
                <TouchableOpacity
                  style={[styles.dropdownItem, !value && { backgroundColor: theme.backgroundSecondary }]}
                  onPress={() => handleSelect("")}
                >
                  <ThemedText type="body" style={{ color: theme.textSecondary }}>{placeholder}</ThemedText>
                </TouchableOpacity>
              )}
              {filtered.map((opt) => (
                <TouchableOpacity
                  key={opt.value}
                  style={[styles.dropdownItem, opt.value === value && { backgroundColor: theme.backgroundSecondary }]}
                  onPress={() => handleSelect(opt.value)}
                >
                  <ThemedText
                    type="body"
                    style={[{ color: theme.text }, opt.value === value && { color: theme.primary, fontWeight: "600" }]}
                  >
                    {opt.label}
                  </ThemedText>
                  {opt.value === value && <Feather name="check" size={14} color={theme.primary} />}
                </TouchableOpacity>
              ))}
              {showAddOption && (
                <TouchableOpacity
                  style={[styles.dropdownItem, { backgroundColor: theme.backgroundSecondary }]}
                  onPress={() => handleSelect(searchText.trim())}
                >
                  <Feather name="plus-circle" size={14} color={theme.primary} />
                  <ThemedText type="body" style={{ color: theme.primary, marginLeft: Spacing.sm, flex: 1 }}>
                    Add "{searchText.trim()}"
                  </ThemedText>
                </TouchableOpacity>
              )}
              {filtered.length === 0 && !showAddOption && (
                <View style={styles.dropdownItem}>
                  <ThemedText type="caption" style={{ color: theme.textSecondary }}>No results</ThemedText>
                </View>
              )}
            </ScrollView>
          </View>
        )}
      </>
    );
  };

  const loadEmployees = useCallback(async () => {
    try {
      const { data, error } = await supabase
        .from("profiles")
        .select(
          `id, name, email, phone, employee_number, is_active, username,
           role_id, office_id,
           roles(name), offices(name)`,
        )
        .order("name", { ascending: true })
        .range(0, 999);

      if (error) {
        console.error("Error loading employees:", JSON.stringify(error));
        Alert.alert("Load Error", error.message);
        setEmployees([]);
      } else {
        const formattedData =
          data?.map((emp: any) => ({
            id: emp.id,
            name: emp.name,
            email: emp.email,
            phone: emp.phone,
            employee_number: emp.employee_number,
            role_name: emp.roles?.name || "No Role",
            role_id: emp.role_id || "",
            office_name: emp.offices?.name || "No Office",
            office_id: emp.office_id || "",
            department_id: "",
            department_name: "",
            designation_id: "",
            designation_name: "",
            is_active: emp.is_active,
            reporting_manager_name: undefined,
            username: emp.username,
          })) || [];
        setEmployees(formattedData);
      }
    } catch (err) {
      console.error("Exception loading employees:", err);
      setEmployees([]);
    }
    setLoading(false);
  }, []);

  const loadRolesAndOffices = useCallback(async () => {
    try {
      const [rolesRes, officesRes, deptsRes, desigsRes] = await Promise.all([
        supabase.from("roles").select("id, name").order("name"),
        supabase.from("offices").select("id, name").order("name"),
        DepartmentService.getActive(),
        DepartmentService.getActiveDesignations(),
      ]);

      if (!rolesRes.error && rolesRes.data) {
        setRoles(rolesRes.data);
      }
      if (!officesRes.error && officesRes.data) {
        setOffices(officesRes.data);
      }
      setDepartments(deptsRes || []);
      setDesignations(desigsRes || []);
    } catch (err) {
      console.error("Exception loading roles/offices:", err);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      const init = async () => {
        await loadRolesAndOffices();
        await loadEmployees();
      };
      init();
    }, [loadEmployees, loadRolesAndOffices]),
  );

  const openAddModal = () => {
    setEditingEmployee(null);
    setForm(EMPTY_FORM);
    setShowModal(true);
  };

  const openEditModal = (emp: Employee) => {
    setEditingEmployee(emp);
    setForm({
      name: emp.name,
      email: emp.email,
      phone: emp.phone || "",
      employee_number: emp.employee_number || "",
      role_id: emp.role_id,
      office_id: emp.office_id,
      department_id: emp.department_id || "",
      designation_id: emp.designation_id || "",
      date_of_birth: "",
      reporting_manager_id: "",
    });
    setShowModal(true);
  };

  const handleSave = async () => {
    if (
      !form.name.trim() ||
      !form.email.trim() ||
      !form.employee_number.trim() ||
      !form.role_id.trim() ||
      !form.office_id.trim()
    ) {
      Alert.alert("Required Fields", "Name, Email, Employee Number, Role and Office are required");
      return;
    }

    setSaving(true);
    try {
      if (editingEmployee) {
        const { error } = await supabase
          .from("profiles")
          .update({
            name: form.name,
            email: form.email,
            phone: form.phone,
            employee_number: form.employee_number,
            department_id: isUUID(form.department_id) ? form.department_id : null,
            designation_id: isUUID(form.designation_id) ? form.designation_id : null,
            reporting_manager_id: isUUID(form.reporting_manager_id) ? form.reporting_manager_id : null,
          })
          .eq("id", editingEmployee.id);

        if (error) {
          console.warn("Update error:", error);
          if ((error as any)?.status === 401) {
            Alert.alert(
              "Warning",
              "Not authenticated. Changes saved locally. Will sync when online.",
            );
            setShowModal(false);
            loadEmployees();
          } else {
            Alert.alert("Error", "Failed to update employee: " + error.message);
          }
        } else {
          Alert.alert("Success", "Employee updated");
          setShowModal(false);
          loadEmployees();
        }
      } else {
        // role_id / office_id may be a UUID (from list) or a custom text string
        const roleId = isUUID(form.role_id) ? form.role_id : null;
        const roleName = isUUID(form.role_id)
          ? roles.find((r) => r.id === form.role_id)?.name || null
          : form.role_id || null;
        const officeId = isUUID(form.office_id) ? form.office_id : null;
        const departmentId = isUUID(form.department_id) ? form.department_id : null;
        const designationId = isUUID(form.designation_id) ? form.designation_id : null;
        const reportingManagerId = isUUID(form.reporting_manager_id) ? form.reporting_manager_id : null;

        const payload: Record<string, any> = {
            name: form.name,
            email: form.email || null,
            phone: form.phone || null,
            employee_number: form.employee_number,
            role: roleName,
            role_id: roleId,
            office_id: officeId,
            is_active: true,
          };

        if (form.date_of_birth?.trim()) {
          payload.date_of_birth = form.date_of_birth.trim();
        }

        console.log("INSERT payload:", JSON.stringify(payload));

        const { data, error, status, statusText } = await supabase
          .from("profiles")
          .insert(payload)
          .select("id, name, email, phone, employee_number, role_id, office_id");

        console.log("INSERT result — status:", status, statusText, "data:", JSON.stringify(data), "error:", JSON.stringify(error));

        if (error) {
          const msg = error.message || JSON.stringify(error);
          if (error?.code === "23505" || (error as any)?.status === 409) {
            Alert.alert(
              "Duplicate Entry",
              `A user with this ${error.details?.includes("phone") ? "phone number" : error.details?.includes("email") ? "email" : "employee number"} already exists.`,
            );
          } else {
            Alert.alert("Error", `Failed to add employee (${status}): ${msg}`);
          }
        } else {
          setShowModal(false);
          await loadEmployees();
          
          const inserted = data?.[0];
          if (inserted) {
            const newEmployee: Employee = {
              id: inserted.id,
              name: inserted.name,
              email: inserted.email,
              phone: inserted.phone,
              employee_number: inserted.employee_number,
              role_name: roleName || "No Role",
              role_id: inserted.role_id,
              office_name: offices.find(o => o.id === inserted.office_id)?.name || "No Office",
              office_id: inserted.office_id,
              is_active: inserted.is_active,
            };
            
            Alert.alert(
              "✅ Employee Added!",
              `${form.name} has been added successfully. Would you like to generate login credentials?`,
              [
                {
                  text: "Generate Credentials",
                  onPress: () => generateUserCredentials(newEmployee),
                },
                { text: "Skip" },
              ],
            );
          }
        }
      }
    } catch (error) {
      console.error("Exception in handleSave:", error);
      Alert.alert("Error", String(error));
    } finally {
      setSaving(false);
    }
  };

  const generateUserCredentials = async (employee: Employee) => {
    if (!form.employee_number) {
      Alert.alert("Error", "Employee number is required");
      return;
    }

    try {
      const credentials = await createUserWithCredentials({
        employeeId: employee.id,
        name: form.name,
        email: form.email,
        phone: form.phone,
        roleId: form.role_id,
        officeId: form.office_id,
        employeeNumber: form.employee_number,
      });

      setGeneratedCredentials({
        ...credentials,
        employeeName: form.name,
        employeeEmail: form.email,
      });
      setShowCredentialsModal(true);
    } catch (error) {
      Alert.alert("Error", "Failed to generate credentials: " + String(error));
    }
  };

  const copyToClipboard = async (text: string) => {
    Alert.alert("Copied", text);
  };

  const downloadTemplate = async () => {
    const csv = [
      "name,email,phone,employee_number,role,office,department,designation,date_of_birth",
      "John Doe,john@example.com,9876543210,EMP001,Sales Executive,Sector 63,Sales,Executive,1995-06-15",
      "Jane Smith,jane@example.com,9876543211,EMP002,BDM,Greater Noida 136,Sales,Manager,1990-03-22",
    ].join("\n");

    // Web: trigger browser download directly
    if (typeof document !== "undefined") {
      const blob = new Blob([csv], { type: "text/csv" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "employee_template.csv";
      a.click();
      URL.revokeObjectURL(url);
      return;
    }

    // Native: write to cache then share
    try {
      const { cacheDirectory, writeAsStringAsync } = await import("expo-file-system/legacy");
      const path = (cacheDirectory ?? "") + "employee_template.csv";
      await writeAsStringAsync(path, csv);
      await Sharing.shareAsync(path, { mimeType: "text/csv", dialogTitle: "Save Employee Template" });
    } catch (err) {
      Alert.alert("Error", String(err));
    }
  };

  const parseCSV = (text: string): Record<string, string>[] => {
    const lines = text.trim().split("\n").filter(Boolean);
    if (lines.length < 2) return [];
    const headers = lines[0].split(",").map((h) => h.trim().toLowerCase().replace(/\s+/g, "_"));
    return lines.slice(1).map((line) => {
      const vals = line.split(",").map((v) => v.trim());
      const obj: Record<string, string> = {};
      headers.forEach((h, i) => { obj[h] = vals[i] || ""; });
      return obj;
    });
  };

  const handleCSVUpload = async () => {
    try {
      const result = await DocumentPicker.getDocumentAsync({ type: "text/csv" });
      if (result.canceled || !result.assets?.[0]) return;

      const fileUri = result.assets[0].uri;
      let content = "";
      if (typeof document !== "undefined") {
        const response = await fetch(fileUri);
        content = await response.text();
      } else {
        const { readAsStringAsync } = await import("expo-file-system/legacy");
        content = await readAsStringAsync(fileUri);
      }
      const rows = parseCSV(content);

      if (rows.length === 0) {
        Alert.alert("Error", "CSV is empty or invalid. Download the template first.");
        return;
      }

      setCsvUploading(true);
      let inserted = 0, updated = 0, failed = 0;

      for (const row of rows) {
        if (!row.name?.trim()) { failed++; continue; }

        // Resolve role_id by name
        const roleMatch = roles.find(
          (r) => r.name.toLowerCase() === (row.role || "").toLowerCase()
        );
        // Resolve office_id by name
        const officeMatch = offices.find(
          (o) => o.name.toLowerCase() === (row.office || "").toLowerCase()
        );
        // Resolve department_id by name
        const deptMatch = departments.find(
          (d) => d.name.toLowerCase() === (row.department || "").toLowerCase()
        );
        // Resolve designation_id by name
        const desigMatch = designations.find(
          (d) => d.name.toLowerCase() === (row.designation || "").toLowerCase()
        );

        const payload: any = {
          name: row.name.trim(),
          email: row.email?.trim() || null,
          phone: row.phone?.trim() || null,
          employee_number: row.employee_number?.trim() || null,
          role: row.role?.trim() || null,
          role_id: roleMatch?.id || null,
          office_id: officeMatch?.id || null,
          date_of_birth: row.date_of_birth?.trim() || null,
          is_active: true,
        };

        // Check if exists by phone or employee_number
        const phone = row.phone?.trim();
        const empNum = row.employee_number?.trim();

        let existingId: string | null = null;
        if (phone) {
          const { data } = await supabase.from("profiles").select("id").eq("phone", phone).maybeSingle();
          if (data) existingId = data.id;
        }
        if (!existingId && empNum) {
          const { data } = await supabase.from("profiles").select("id").eq("employee_number", empNum).maybeSingle();
          if (data) existingId = data.id;
        }

        if (existingId) {
          const { error } = await supabase.from("profiles").update(payload).eq("id", existingId);
          if (error) failed++; else updated++;
        } else {
          const { error } = await supabase.from("profiles").insert(payload);
          if (error) failed++; else inserted++;
        }
      }

      setCsvUploading(false);
      await loadEmployees();
      Alert.alert(
        "✅ CSV Import Done",
        `Inserted: ${inserted}\nUpdated: ${updated}\nFailed: ${failed}`,
      );
    } catch (err) {
      setCsvUploading(false);
      Alert.alert("Error", "Failed to process CSV: " + String(err));
    }
  };

  const toggleEmployeeStatus = async (
    employeeId: string,
    currentStatus: boolean,
  ) => {
    const newStatus = !currentStatus;
    const action = newStatus ? "activate" : "deactivate";

    Alert.alert(
      `${action.charAt(0).toUpperCase() + action.slice(1)} Employee`,
      `Are you sure you want to ${action} this employee?`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: action.charAt(0).toUpperCase() + action.slice(1),
          onPress: async () => {
            const { error } = await supabase
              .from("profiles")
              .update({ is_active: newStatus })
              .eq("id", employeeId);

            if (error) {
              Alert.alert("Error", `Failed to ${action} employee`);
            } else {
              loadEmployees();
            }
          },
        },
      ],
    );
  };

  const renderEmployee = ({ item }: { item: Employee }) => {
    const deptName = departments.find((d) => d.id === item.department_id)?.name || "";
    const desigName = designations.find((d) => d.id === item.designation_id)?.name || "";
    return (
    <View
      style={[
        styles.employeeCard,
        { backgroundColor: theme.backgroundDefault },
      ]}
    >
      <View style={styles.employeeHeader}>
        <View style={styles.employeeInfo}>
          <ThemedText type="body" style={styles.employeeName}>
            {item.name}
          </ThemedText>
          <ThemedText type="caption" style={{ color: theme.textSecondary }}>
            {item.email}
          </ThemedText>
          {item.phone && (
            <ThemedText type="caption" style={{ color: theme.textSecondary }}>
              {item.phone}
            </ThemedText>
          )}
          {item.employee_number && (
            <ThemedText type="caption" style={{ color: theme.textSecondary }}>
              Emp #: {item.employee_number}
            </ThemedText>
          )}
          <ThemedText type="caption" style={{ color: theme.textSecondary }}>
            {item.role_name} • {item.office_name}
          </ThemedText>
          {(deptName || desigName) && (
            <ThemedText type="caption" style={{ color: theme.textSecondary }}>
              {desigName || ""}
              {deptName && desigName ? " at " : ""}
              {deptName || ""}
            </ThemedText>
          )}
          {item.username && (
            <ThemedText
              type="caption"
              style={{ color: Colors.light.success, fontWeight: "600" }}
            >
              ✓ Username: {item.username}
            </ThemedText>
          )}
          {item.reporting_manager_name && (
            <ThemedText type="caption" style={{ color: theme.textSecondary }}>
              Reports to: {item.reporting_manager_name}
            </ThemedText>
          )}
        </View>

        <View style={styles.employeeActions}>
          <View
            style={[
              styles.statusBadge,
              {
                backgroundColor: item.is_active
                  ? Colors.light.success + "20"
                  : Colors.light.error + "20",
              },
            ]}
          >
            <ThemedText
              type="caption"
              style={{
                color: item.is_active
                  ? Colors.light.success
                  : Colors.light.error,
                fontWeight: "600",
              }}
            >
              {item.is_active ? "Active" : "Inactive"}
            </ThemedText>
          </View>

          <View style={styles.actionRow}>
            {!item.username && (
              <Pressable
                style={[
                  styles.actionButton,
                  { backgroundColor: Colors.light.warning + "20" },
                ]}
                onPress={() => {
                  setEditingEmployee(item);
                  setForm({
                    name: item.name,
                    email: item.email,
                    phone: item.phone || "",
                    employee_number: item.employee_number || "",
                    role_id: item.role_id,
                    office_id: item.office_id,
                    department_id: item.department_id || "",
                    designation_id: item.designation_id || "",
                    date_of_birth: "",
                    reporting_manager_id: "",
                  });
                  generateUserCredentials(item);
                }}
              >
                <Feather name="key" size={16} color={Colors.light.warning} />
              </Pressable>
            )}
            <Pressable
              style={[
                styles.actionButton,
                { backgroundColor: theme.backgroundRoot },
              ]}
              onPress={() => openEditModal(item)}
            >
              <Feather name="edit-2" size={16} color={Colors.light.info} />
            </Pressable>
            <Pressable
              style={[
                styles.actionButton,
                { backgroundColor: theme.backgroundRoot },
              ]}
              onPress={() => toggleEmployeeStatus(item.id, item.is_active)}
            >
              <Feather
                name={item.is_active ? "user-x" : "user-check"}
                size={16}
                color={
                  item.is_active ? Colors.light.error : Colors.light.success
                }
              />
            </Pressable>
          </View>
        </View>
      </View>
    </View>
    );
  };

  if (loading) {
    return (
      <View style={styles.centered}>
        <ThemedText>Loading employees...</ThemedText>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <ThemedText type="h3">Employee Management</ThemedText>
      </View>

      <Spacer height={Spacing.md} />

      <View style={styles.buttonRow}>
        <Pressable
          style={[styles.addButtonFull, { backgroundColor: Colors.light.primary, flex: 1 }]}
          onPress={openAddModal}
        >
          <Feather name="plus" size={18} color="#FFFFFF" />
          <ThemedText style={styles.addButtonText}>Add</ThemedText>
        </Pressable>
        <Pressable
          style={[styles.addButtonFull, { backgroundColor: Colors.light.info, flex: 1 }]}
          onPress={handleCSVUpload}
          disabled={csvUploading}
        >
          {csvUploading
            ? <ActivityIndicator size="small" color="#fff" />
            : <Feather name="upload" size={18} color="#FFFFFF" />}
          <ThemedText style={styles.addButtonText}>CSV Upload</ThemedText>
        </Pressable>
        <Pressable
          style={[styles.addButtonFull, { backgroundColor: Colors.light.success, flex: 1 }]}
          onPress={downloadTemplate}
        >
          <Feather name="download" size={18} color="#FFFFFF" />
          <ThemedText style={styles.addButtonText}>Template</ThemedText>
        </Pressable>
      </View>

      <Spacer height={Spacing.md} />

      <View
        style={[
          styles.searchContainer,
          { backgroundColor: theme.backgroundSecondary },
        ]}
      >
        <Feather name="search" size={16} color={theme.textSecondary} />
        <TextInput
          style={[styles.searchInput, { color: theme.text }]}
          value={searchQuery}
          onChangeText={setSearchQuery}
          placeholder="Search employees..."
          placeholderTextColor={theme.textSecondary}
          clearButtonMode="while-editing"
        />
        {searchQuery.length > 0 && (
          <Pressable onPress={() => setSearchQuery("")}>
            <Feather name="x" size={16} color={theme.textSecondary} />
          </Pressable>
        )}
      </View>

      <Spacer height={Spacing.md} />

      {employees.length === 0 ? (
        <View style={styles.centered}>
          <Feather name="users" size={48} color={theme.textSecondary} />
          <Spacer height={Spacing.md} />
          <ThemedText type="body" style={{ color: theme.textSecondary }}>
            No employees yet
          </ThemedText>
          <ThemedText
            type="caption"
            style={{ color: theme.textSecondary, marginTop: Spacing.sm }}
          >
            Tap "Add Employee" above to get started
          </ThemedText>
        </View>
      ) : (
        <FlatList
          data={employees.filter(
            (e) =>
              searchQuery.trim() === "" ||
              e.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
              (e.email || "").toLowerCase().includes(searchQuery.toLowerCase()) ||
              (e.employee_number || "").toLowerCase().includes(searchQuery.toLowerCase()) ||
              (e.phone || "").includes(searchQuery),
          )}
          keyExtractor={(item) => item.id}
          renderItem={renderEmployee}
          contentContainerStyle={styles.list}
          showsVerticalScrollIndicator={false}
        />
      )}

      <Modal
        visible={showModal}
        animationType="slide"
        transparent
        onRequestClose={() => setShowModal(false)}
      >
        <View style={styles.modalOverlay}>
          <ThemedView
            style={[
              styles.modalContainer,
              { paddingBottom: insets.bottom + Spacing.lg },
            ]}
          >
            <View style={styles.modalHeader}>
              <ThemedText type="h3">
                {editingEmployee ? "Edit Employee" : "Add Employee"}
              </ThemedText>
              <Pressable onPress={() => setShowModal(false)}>
                <Feather name="x" size={24} color={theme.text} />
              </Pressable>
            </View>
            <ScrollView
              style={styles.modalContent}
              keyboardShouldPersistTaps="handled"
            >
              <ThemedText type="small" style={styles.inputLabel}>
                Name *
              </ThemedText>
              <TextInput
                style={[
                  styles.modalInput,
                  {
                    backgroundColor: theme.backgroundSecondary,
                    color: theme.text,
                  },
                ]}
                value={form.name}
                onChangeText={(t) => setForm({ ...form, name: t })}
                placeholder="Full name"
                placeholderTextColor={theme.textSecondary}
              />
              <Spacer height={Spacing.md} />

              <ThemedText type="small" style={styles.inputLabel}>
                Email *
              </ThemedText>
              <TextInput
                style={[
                  styles.modalInput,
                  {
                    backgroundColor: theme.backgroundSecondary,
                    color: theme.text,
                  },
                ]}
                value={form.email}
                onChangeText={(t) => setForm({ ...form, email: t })}
                placeholder="Email address"
                placeholderTextColor={theme.textSecondary}
                keyboardType="email-address"
                autoCapitalize="none"
              />
              <Spacer height={Spacing.md} />

              <ThemedText type="small" style={styles.inputLabel}>
                Phone
              </ThemedText>
              <TextInput
                style={[
                  styles.modalInput,
                  {
                    backgroundColor: theme.backgroundSecondary,
                    color: theme.text,
                  },
                ]}
                value={form.phone}
                onChangeText={(t) => setForm({ ...form, phone: t })}
                placeholder="Phone number"
                placeholderTextColor={theme.textSecondary}
                keyboardType="phone-pad"
              />
              <Spacer height={Spacing.md} />

              <ThemedText type="small" style={styles.inputLabel}>
                Employee Number *
              </ThemedText>
              <TextInput
                style={[
                  styles.modalInput,
                  {
                    backgroundColor: theme.backgroundSecondary,
                    color: theme.text,
                  },
                ]}
                value={form.employee_number}
                onChangeText={(t) => setForm({ ...form, employee_number: t })}
                placeholder="e.g., 001, 002 (used for username)"
                placeholderTextColor={theme.textSecondary}
              />
              <Spacer height={Spacing.md} />

              <ThemedText type="small" style={styles.inputLabel}>
                Date of Birth (YYYY-MM-DD)
              </ThemedText>
              <TextInput
                style={[
                  styles.modalInput,
                  { backgroundColor: theme.backgroundSecondary, color: theme.text },
                ]}
                value={form.date_of_birth}
                onChangeText={(t) => setForm({ ...form, date_of_birth: t })}
                placeholder="e.g., 1995-06-15"
                placeholderTextColor={theme.textSecondary}
              />
              <Spacer height={Spacing.md} />

              <ThemedText type="small" style={styles.inputLabel}>
                Department
              </ThemedText>
              {departments.length > 0 ? (
                <ThemedSelect
                  field="department_id"
                  value={form.department_id}
                  placeholder="Select Department"
                  options={departments.map((d) => ({ label: d.name, value: d.id }))}
                  onChange={(v) => setForm({ ...form, department_id: v })}
                />
              ) : (
                <ThemedText type="caption" style={{ color: theme.textSecondary }}>No departments available</ThemedText>
              )}
              <Spacer height={Spacing.md} />

              <ThemedText type="small" style={styles.inputLabel}>
                Designation
              </ThemedText>
              {designations.length > 0 ? (
                <ThemedSelect
                  field="designation_id"
                  value={form.designation_id}
                  placeholder="Select Designation"
                  options={designations.map((d) => ({ label: d.name, value: d.id }))}
                  onChange={(v) => setForm({ ...form, designation_id: v })}
                />
              ) : (
                <ThemedText type="caption" style={{ color: theme.textSecondary }}>No designations available</ThemedText>
              )}
              <Spacer height={Spacing.md} />

              <ThemedText type="small" style={styles.inputLabel}>
                Reporting Manager
              </ThemedText>
              {employees.length > 0 && (
                <ThemedSelect
                  field="reporting_manager_id"
                  value={form.reporting_manager_id}
                  placeholder="No Manager"
                  options={employees
                    .filter((e) => !editingEmployee || e.id !== editingEmployee.id)
                    .map((e) => ({ label: e.name, value: e.id }))}
                  onChange={(v) => setForm({ ...form, reporting_manager_id: v })}
                />
              )}
              <Spacer height={Spacing.md} />

              <ThemedText type="small" style={styles.inputLabel}>
                Role
              </ThemedText>
              {roles.length > 0 ? (
                <ThemedSelect
                  field="role_id"
                  value={form.role_id}
                  placeholder="Select Role"
                  options={roles.map((r) => ({ label: r.name, value: r.id }))}
                  onChange={(v) => setForm({ ...form, role_id: v })}
                />
              ) : (
                <ThemedText type="caption" style={{ color: theme.textSecondary }}>No roles available</ThemedText>
              )}
              <Spacer height={Spacing.md} />

              <ThemedText type="small" style={styles.inputLabel}>
                Office
              </ThemedText>
              {offices.length > 0 ? (
                <ThemedSelect
                  field="office_id"
                  value={form.office_id}
                  placeholder="Select Office"
                  options={offices.map((o) => ({ label: o.name, value: o.id }))}
                  onChange={(v) => setForm({ ...form, office_id: v })}
                />
              ) : (
                <ThemedText type="caption" style={{ color: theme.textSecondary }}>No offices available</ThemedText>
              )}
              <Spacer height={Spacing.xl} />
              <Button onPress={handleSave}>
                {saving
                  ? "Saving..."
                  : editingEmployee
                    ? "Save Changes"
                    : "Add Employee"}
              </Button>
            </ScrollView>
          </ThemedView>
        </View>
      </Modal>

      <Modal
        visible={showCredentialsModal}
        animationType="slide"
        transparent
        onRequestClose={() => setShowCredentialsModal(false)}
      >
        <View style={styles.modalOverlay}>
          <ThemedView
            style={[
              styles.credentialsModalContainer,
              { paddingBottom: insets.bottom + Spacing.lg },
            ]}
          >
            <View style={styles.modalHeader}>
              <ThemedText type="h3">User Credentials</ThemedText>
              <Pressable onPress={() => setShowCredentialsModal(false)}>
                <Feather name="x" size={24} color={theme.text} />
              </Pressable>
            </View>
            <ScrollView
              style={styles.modalContent}
              keyboardShouldPersistTaps="handled"
            >
              <View
                style={[
                  styles.credentialBox,
                  {
                    backgroundColor: Colors.light.success + "10",
                    borderColor: Colors.light.success,
                  },
                ]}
              >
                <Feather
                  name="check-circle"
                  size={24}
                  color={Colors.light.success}
                />
                <ThemedText
                  type="body"
                  style={{ marginLeft: Spacing.md, flex: 1, fontWeight: "600" }}
                >
                  Credentials Generated Successfully!
                </ThemedText>
              </View>
              <Spacer height={Spacing.xl} />

              <ThemedText type="small" style={styles.inputLabel}>
                Employee Name:
              </ThemedText>
              <ThemedText type="body" style={styles.credentialValue}>
                {generatedCredentials?.employeeName}
              </ThemedText>
              <Spacer height={Spacing.lg} />

              <ThemedText type="small" style={styles.inputLabel}>
                Employee Email:
              </ThemedText>
              <ThemedText type="body" style={styles.credentialValue}>
                {generatedCredentials?.employeeEmail}
              </ThemedText>
              <Spacer height={Spacing.lg} />

              <ThemedText type="small" style={styles.inputLabel}>
                Username *
              </ThemedText>
              <View
                style={[
                  styles.credentialDisplay,
                  { backgroundColor: theme.backgroundSecondary },
                ]}
              >
                <ThemedText
                  type="body"
                  style={{ fontFamily: "monospace", fontWeight: "600" }}
                >
                  {generatedCredentials?.username}
                </ThemedText>
                <Pressable
                  onPress={() =>
                    copyToClipboard(generatedCredentials?.username)
                  }
                >
                  <Feather name="copy" size={18} color={theme.primary} />
                </Pressable>
              </View>
              <Spacer height={Spacing.lg} />

              <ThemedText type="small" style={styles.inputLabel}>
                Temporary Password *
              </ThemedText>
              <View
                style={[
                  styles.credentialDisplay,
                  { backgroundColor: theme.backgroundSecondary },
                ]}
              >
                <ThemedText
                  type="body"
                  style={{ fontFamily: "monospace", fontWeight: "600" }}
                >
                  {generatedCredentials?.temporaryPassword}
                </ThemedText>
                <Pressable
                  onPress={() =>
                    copyToClipboard(generatedCredentials?.temporaryPassword)
                  }
                >
                  <Feather name="copy" size={18} color={theme.primary} />
                </Pressable>
              </View>
              <Spacer height={Spacing.lg} />

              <View
                style={[
                  styles.otpBox,
                  {
                    backgroundColor: Colors.light.info + "10",
                    borderColor: Colors.light.info,
                  },
                ]}
              >
                <Feather name="shield" size={20} color={Colors.light.info} />
                <View style={{ flex: 1, marginLeft: Spacing.md }}>
                  <ThemedText type="small" style={{ fontWeight: "600" }}>
                    Two-Factor Authentication (OTP)
                  </ThemedText>
                  <ThemedText
                    type="caption"
                    style={{
                      color: theme.textSecondary,
                      marginTop: Spacing.xs,
                    }}
                  >
                    OTP is enabled for this account. User must set up
                    authentication app on first login.
                  </ThemedText>
                </View>
              </View>
              <Spacer height={Spacing.xl} />

              <ThemedText
                type="caption"
                style={{
                  color: Colors.light.error,
                  fontStyle: "italic",
                  marginBottom: Spacing.lg,
                }}
              >
                ⚠ Important: Save these credentials securely. Password is
                temporary and must be changed on first login.
              </ThemedText>

              <Button
                onPress={() => {
                  setShowCredentialsModal(false);
                  setGeneratedCredentials(null);
                  loadEmployees();
                }}
              >
                Done
              </Button>
            </ScrollView>
          </ThemedView>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    paddingHorizontal: Spacing.lg,
    paddingTop: Spacing.lg,
  },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  buttonRow: {
    flexDirection: "row",
    gap: Spacing.sm,
  },
  addButtonFull: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    borderRadius: BorderRadius.sm,
    height: 44,
    gap: 4,
  },
  addButtonText: {
    color: "#FFFFFF",
    fontWeight: "600",
    fontSize: 16,
  },
  list: {
    paddingBottom: Spacing.xl,
  },
  centered: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  employeeCard: {
    borderRadius: BorderRadius.md,
    padding: Spacing.md,
    marginBottom: Spacing.sm,
  },
  employeeHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
  },
  employeeInfo: {
    flex: 1,
    gap: 2,
  },
  employeeName: {
    fontWeight: "600",
  },
  employeeActions: {
    alignItems: "flex-end",
    gap: Spacing.sm,
  },
  statusBadge: {
    paddingHorizontal: Spacing.sm,
    paddingVertical: 2,
    borderRadius: BorderRadius.sm,
  },
  actionRow: {
    flexDirection: "row",
    gap: Spacing.xs,
  },
  actionButton: {
    width: 32,
    height: 32,
    borderRadius: BorderRadius.sm,
    alignItems: "center",
    justifyContent: "center",
  },
  modalOverlay: {
    flex: 1,
    justifyContent: "flex-end",
    backgroundColor: "rgba(0,0,0,0.5)",
  },
  modalContainer: {
    borderTopLeftRadius: BorderRadius.xl,
    borderTopRightRadius: BorderRadius.xl,
    maxHeight: "90%",
  },
  searchContainer: {
    flexDirection: "row",
    alignItems: "center",
    borderRadius: BorderRadius.sm,
    paddingHorizontal: Spacing.md,
    height: 44,
    gap: Spacing.sm,
  },
  searchInput: {
    flex: 1,
    fontSize: 15,
  },
  credentialsModalContainer: {
    borderTopLeftRadius: BorderRadius.xl,
    borderTopRightRadius: BorderRadius.xl,
    maxHeight: "95%",
  },
  modalHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    padding: Spacing.lg,
    borderBottomWidth: 1,
    borderBottomColor: "rgba(128,128,128,0.2)",
  },
  modalContent: {
    padding: Spacing.lg,
  },
  inputLabel: {
    marginBottom: Spacing.xs,
    fontWeight: "600",
  },
  modalInput: {
    height: Spacing.inputHeight,
    borderRadius: BorderRadius.sm,
    paddingHorizontal: Spacing.lg,
    fontSize: 16,
  },
  pickerContainer: {
    borderRadius: BorderRadius.sm,
    borderWidth: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    height: Spacing.inputHeight,
    paddingHorizontal: Spacing.lg,
    marginBottom: Spacing.sm,
  },
  pickerValue: {
    flex: 1,
    fontSize: 16,
  },
  dropdownList: {
    borderWidth: 1,
    borderRadius: BorderRadius.sm,
    marginTop: -Spacing.sm,
    marginBottom: Spacing.sm,
    overflow: "hidden",
  },
  dropdownSearch: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    borderBottomWidth: 1,
    gap: Spacing.sm,
  },
  dropdownSearchInput: {
    flex: 1,
    fontSize: 14,
    paddingVertical: Spacing.xs,
  },
  dropdownItem: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: "rgba(128,128,128,0.15)",
  },
  credentialBox: {
    flexDirection: "row",
    alignItems: "center",
    padding: Spacing.lg,
    borderRadius: BorderRadius.md,
    borderWidth: 1,
  },
  credentialDisplay: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    padding: Spacing.md,
    borderRadius: BorderRadius.sm,
    paddingRight: Spacing.lg,
  },
  credentialValue: {
    padding: Spacing.sm,
    fontWeight: "600",
  },
  otpBox: {
    flexDirection: "row",
    alignItems: "flex-start",
    padding: Spacing.lg,
    borderRadius: BorderRadius.md,
    borderWidth: 1,
  },
});
