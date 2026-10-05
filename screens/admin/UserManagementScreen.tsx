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
  Platform,
} from "react-native";
import { Picker } from "@react-native-picker/picker";
import Feather from "@expo/vector-icons/Feather";
import { useFocusEffect } from "@react-navigation/native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { ThemedText } from "@/components/ThemedText";
import { PermissionGate } from "@/components/PermissionGate";
import { toTitleCase } from "@/utils/format";
import { ThemedView } from "@/components/ThemedView";
import { Button } from "@/components/Button";
import { PageHeader } from "@/components/PageHeader";
import { useTheme } from "@/hooks/useTheme";
import { Spacing, BorderRadius, Colors } from "@/constants/theme";
import Spacer from "@/components/Spacer";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/contexts/AuthContext";
import { fetchAllPages } from "@/utils/supabasePagination";
import { firstRpcRow } from "@/utils/supabaseRpc";
import { normalizeUserRole } from "@/utils/userRole";
import {
  isSalesManagerRole,
  salesManagerDirectReportLabel,
} from "@/utils/salesHierarchy";

interface Employee {
  id: string;
  name: string;
  email: string | null;
  phone?: string;
  employee_number?: string;
  role_id?: string | null;
  office_id?: string | null;
  role_name: string;
  office_name: string;
  gender?: string;
  date_of_joining?: string;
  weekly_off_day?: number | null;
  team?: string | null;
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

interface BulkPreviewRow {
  row_number: string;
  name: string;
  phone: string;
  team: string | null;
  role_id: string;
  role_name: string;
  office_id: string;
  office_name: string;
  gender?: string;
  date_of_joining?: string;
}

const EMPTY_FORM = {
  name: "",
  email: "",
  phone: "",
  employee_number: "",
  role_id: "",
  office_id: "",
  gender: "MALE",
  date_of_joining: "",
  team: "",
  weekly_off_day: -1 as number | null,
};

const ADMIN_ROLES = ["SYSTEM_ADMIN", "ADMIN", "HR", "HRD"];
const EMPLOYEE_PAGE_SIZE = 100;

export default function UserManagementScreen() {
  const { theme } = useTheme();
  const insets = useSafeAreaInsets();
  const { user } = useAuth();
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [roles, setRoles] = useState<Role[]>([]);
  const [offices, setOffices] = useState<Office[]>([]);
  const [loading, setLoading] = useState(true);
  const [employeeLoadError, setEmployeeLoadError] = useState<string | null>(null);
  const [employeeMetadataError, setEmployeeMetadataError] = useState<string | null>(null);
  const [showModal, setShowModal] = useState(false);
  // Retained only to keep the legacy modal closed while old custom-password
  // credentials are removed from existing deployments.
  const [showCredentialsModal, setShowCredentialsModal] = useState(false);
  const [editingEmployee, setEditingEmployee] = useState<Employee | null>(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [generatedCredentials, setGeneratedCredentials] = useState<any>(null);
  const [bulkUploading, setBulkUploading] = useState(false);
  const [bulkResult, setBulkResult] = useState<{ inserted: number; updated: number; skipped: number; errors: string[] } | null>(null);
  const [showBulkResult, setShowBulkResult] = useState(false);
  const [bulkPreview, setBulkPreview] = useState<{
    batchId: string;
    rows: BulkPreviewRow[];
  } | null>(null);
  const [showBulkPreview, setShowBulkPreview] = useState(false);
  const [search, setSearch] = useState("");
  const [employeePage, setEmployeePage] = useState(0);
  const [newEmployeeSuccess, setNewEmployeeSuccess] = useState<{ name: string; phone: string; role: string } | null>(null);
  const [updateSuccess, setUpdateSuccess] = useState<string | null>(null);

  const [showAdminModal, setShowAdminModal] = useState(false);
  const [adminForm, setAdminForm] = useState({ name: "", phone: "", role: "ADMIN" as string });
  const [savingAdmin, setSavingAdmin] = useState(false);

  const copyToClipboard = async (text: string) => {
    Alert.alert("Copied", text);
  };

  const downloadSampleCSV = () => {
    // Phase 4: Expanded Sample CSV with all fields (backward compatible)
    const sample = [
      "SN,name,phone,email,role,office,employee_number,team,date_of_birth,gender,joining_date,weekly_off",
      "1,Neha Kapoor,9876543201,neha@example.com,SALES_MANAGER,Noida Office,EMP001,Noida Sales,1990-05-15,FEMALE,2023-01-10,Sunday",
      "2,Rahul Verma,9876543202,rahul@example.com,SALES_EXECUTIVE,Gurgaon Office,EMP002,,1992-08-22,MALE,2023-02-15,"
    ].join("\n");
    const blob = new Blob([sample], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "employee_bulk_upload_sample.csv";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const handleBulkUpload = () => {
    if (Platform.OS !== "web") {
      Alert.alert("Web Only", "Bulk upload is only available on the web version.");
      return;
    }
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".csv,.txt,.xls,.xlsx";
    input.onchange = async (e: any) => {
      const file = e.target.files?.[0];
      if (!file) return;

      setBulkUploading(true);
      try {
        const XLSX = await import("xlsx");
        const arrayBuffer = await file.arrayBuffer();
        const workbook = XLSX.read(arrayBuffer, { type: "array" });
        const sheetName = workbook.SheetNames[0];
        const sheet = workbook.Sheets[sheetName];
        const rawData: any[][] = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: "" });

        if (rawData.length < 2) {
          window.alert("File appears empty. Make sure it has a header row and at least one data row.");
          setBulkUploading(false);
          return;
        }

        const rawHeaders: string[] = rawData[0].map((h: any) => String(h ?? ""));
        const headers = rawHeaders.map((h) => h.toLowerCase().replace(/[^a-z0-9]/g, ""));

        const findExact = (...aliases: string[]) => {
          const accepted = new Set(
            aliases.map((alias) => alias.toLowerCase().replace(/[^a-z0-9]/g, "")),
          );
          return headers.findIndex((header) => accepted.has(header));
        };

        const snIdx = findExact("sn", "sr no", "sl no", "serial no");
        const nameIdx = findExact(
          "emp name",
          "employee name",
          "employee full name",
          "full name",
        );
        const phoneIdx = findExact(
          "contact",
          "contact number",
          "phone",
          "phone number",
          "mobile",
          "mobile number",
        );
        const teamIdx = findExact("team", "team name");
        const roleIdx = findExact("designation", "employee role", "role", "position");
        const officeIdx = findExact("office", "office name", "assigned office");

        if ([nameIdx, phoneIdx, roleIdx, officeIdx].some((index) => index < 0)) {
          window.alert(
            "Required columns were not found using exact header aliases.\n\n" +
            "Required: Emp Name, Contact, Designation, Office\n\n" +
            `Detected columns: ${rawHeaders.join(", ")}\n\n` +
            "Download the sample CSV to use the supported format.",
          );
          setBulkUploading(false);
          return;
        }

        const emailIdx = findExact("email", "email address");
          const empNumIdx = findExact("employee number", "emp no", "emp id", "employee id");
          const dobIdx = findExact("date of birth", "dob", "birth date");
          const genderIdx = findExact("gender", "sex");
          const joiningDateIdx = findExact("joining date", "date of joining", "doj");
          const weeklyOffIdx = findExact("weekly off", "week off", "day off");

          const rows = rawData.slice(1)
            .map((cols: any[], i: number) => ({
              sn:          snIdx >= 0     ? String(cols[snIdx] ?? i + 1)     : String(i + 1),
              name:        String(cols[nameIdx] ?? "").trim(),
              phone:       phoneIdx >= 0  ? String(cols[phoneIdx] ?? "")    : "",
              email:       emailIdx >= 0  ? String(cols[emailIdx] ?? "")    : null,
              team:        teamIdx >= 0   ? String(cols[teamIdx] ?? "")     : null,
              designation: roleIdx >= 0   ? String(cols[roleIdx] ?? "")     : "",
              office:      officeIdx >= 0 ? String(cols[officeIdx] ?? "")   : "",
              employee_number: empNumIdx >= 0 ? String(cols[empNumIdx] ?? "") : null,
              date_of_birth: dobIdx >= 0 ? String(cols[dobIdx] ?? "") : null,
              gender: genderIdx >= 0 ? String(cols[genderIdx] ?? "") : null,
              joining_date: joiningDateIdx >= 0 ? String(cols[joiningDateIdx] ?? "") : null,
              weekly_off_day: weeklyOffIdx >= 0 ? String(cols[weeklyOffIdx] ?? "") : null,
            }))
            .filter((r) => r.name.length > 0);

        if (!rows.length) {
          window.alert("No data rows found after the header row.");
          setBulkUploading(false);
          return;
        }

        const normalizedRows = rows.map((row) => {
          const designation = row.designation.trim();
          const office = row.office.trim();
          const phone = row.phone.replace(/\D/g, "").slice(-10);
          if (!designation) {
            throw new Error(`Row ${row.sn} (${row.name}): designation is required.`);
          }
          if (!office) {
            throw new Error(`Row ${row.sn} (${row.name}): office is required.`);
          }
          if (phone.length !== 10) {
            throw new Error(`Row ${row.sn} (${row.name}): a valid 10-digit phone is required.`);
          }

          const roleTerm = designation.toLowerCase();
          const matchedRoles = roles.filter((role) => {
            const candidate = role.name.toLowerCase();
            return candidate === roleTerm ||
              candidate.includes(roleTerm) ||
              roleTerm.includes(candidate);
          });
          if (matchedRoles.length !== 1) {
            throw new Error(
              `Row ${row.sn} (${row.name}): designation "${designation}" ${
                matchedRoles.length ? "is ambiguous" : "does not match a configured role"
              }.`,
            );
          }

          const officeTerm = office.toLowerCase();
          const matchedOffices = offices.filter((candidate) => {
            const name = candidate.name.toLowerCase();
            return name === officeTerm ||
              name.includes(officeTerm) ||
              officeTerm.includes(name);
          });
          if (matchedOffices.length !== 1) {
            throw new Error(
              `Row ${row.sn} (${row.name}): office "${office}" ${
                matchedOffices.length ? "is ambiguous" : "does not match an active office"
              }.`,
            );
          }

          const weeklyOffStr = String(row.weekly_off_day || '').trim().toLowerCase();
          let weeklyOffParsed: number | null = null;
          if (weeklyOffStr.startsWith('mon')) weeklyOffParsed = 1;
          else if (weeklyOffStr.startsWith('tue')) weeklyOffParsed = 2;
          else if (weeklyOffStr.startsWith('wed')) weeklyOffParsed = 3;
          else if (weeklyOffStr.startsWith('thu')) weeklyOffParsed = 4;
          else if (weeklyOffStr.startsWith('fri')) weeklyOffParsed = 5;
          else if (weeklyOffStr.startsWith('sat')) weeklyOffParsed = 6;
          else if (weeklyOffStr.startsWith('sun')) weeklyOffParsed = 0;

          return {
            row_number: row.sn,
            name: row.name,
            phone,
            team: (row.team || "").trim() || null,
            role_id: matchedRoles[0].id,
            role_name: matchedRoles[0].name,
            office_id: matchedOffices[0].id,
            office_name: matchedOffices[0].name,
            weekly_off_day: weeklyOffParsed,
          };
        });

        const duplicatePhones = new Set<string>();
        const seenPhones = new Set<string>();
        for (const row of normalizedRows) {
          if (seenPhones.has(row.phone)) duplicatePhones.add(row.phone);
          seenPhones.add(row.phone);
        }
        if (duplicatePhones.size) {
          throw new Error(
            `Duplicate phone number(s) in import: ${Array.from(duplicatePhones).join(", ")}`,
          );
        }

        setBulkPreview({
          batchId: crypto.randomUUID(),
          rows: normalizedRows,
        });
        setShowBulkPreview(true);
      } catch (err: any) {
        window.alert(
          "Bulk import preparation failed. Nothing was sent to the server.\n\n" +
          (err?.message || "Unknown import error"),
        );
      } finally {
        setBulkUploading(false);
      }
    };
    input.click();
  };

  const confirmBulkImport = async () => {
    if (!bulkPreview) return;
    setBulkUploading(true);
    try {
      const rpcRows = bulkPreview.rows.map(
        ({ role_name: _roleName, office_name: _officeName, ...row }) => row,
      );
      const { data, error } = await supabase.rpc(
        "rpc_admin_import_employee_profiles_v2",
        {
          p_batch_id: bulkPreview.batchId,
          p_rows: rpcRows,
        },
      );
      if (error) throw error;
      const response = firstRpcRow<any>(data);
      const processed = Number(response?.processed);
      const inserted = Number(response?.inserted);
      const updated = Number(response?.updated);
      if (
        response?.success !== true ||
        response?.batch_id !== bulkPreview.batchId ||
        !Number.isInteger(processed) ||
        processed !== rpcRows.length ||
        !Number.isInteger(inserted) ||
        !Number.isInteger(updated) ||
        inserted + updated !== processed
      ) {
        throw new Error("Server did not confirm the complete employee import.");
      }

      setShowBulkPreview(false);
      setBulkPreview(null);
      setBulkResult({ inserted, updated, skipped: 0, errors: [] });
      setShowBulkResult(true);
      await loadEmployees();
    } catch (err: any) {
      window.alert(
        "Import was not confirmed. The same batch ID has been preserved.\n\n" +
        "Press Retry Import to safely check or complete this exact batch without applying it twice.\n\n" +
        (err?.message || "Unknown import error"),
      );
    } finally {
      setBulkUploading(false);
    }
  };

  const isSystemAdmin = user?.role === "SYSTEM_ADMIN";
  const isStrictAdmin = user?.role === "SYSTEM_ADMIN" || user?.role === "ADMIN" || user?.role === "HR" || user?.role === "HRD";

  const loadEmployees = useCallback(async () => {
    try {
      const { data, error } = await fetchAllPages<any>((from, to) =>
        supabase.from("profiles").select(`
          id,
          name,
          email,
          phone,
          employee_number,
          role,
          role_id,
          office_id,
          team,
          reports_to,
          is_active,
          username,
          gender,
          date_of_joining,
          weekly_off_day,
          roles(name),
          offices(name)
        `)
          .order("team", { ascending: true, nullsFirst: false })
          .order("name", { ascending: true })
          .order("id", { ascending: true })
          .range(from, to),
      );

      if (error) {
        throw error;
      } else {
        const managerIds = [
          ...new Set((data ?? []).map((emp: any) => emp.reports_to).filter(Boolean)),
        ] as string[];
        let managerNames = new Map<string, string>();
        if (managerIds.length > 0) {
          const managerResult = await fetchAllPages<any>((from, to) =>
            supabase.from("profiles")
              .select("id,name")
              .in("id", managerIds)
              .order("id")
              .range(from, to),
          );
          if (managerResult.error) throw managerResult.error;
          managerNames = new Map(
            (managerResult.data ?? []).map((manager: any) => [
              manager.id,
              toTitleCase(manager.name),
            ]),
          );
        }
        const formattedData =
          data?.map((emp: any) => ({
            id: emp.id,
            name: toTitleCase(emp.name),
            email: emp.email,
            phone: emp.phone,
            employee_number: emp.employee_number,
            role_id: emp.role_id,
            office_id: emp.office_id,
            team: (emp as any).team ?? null,
            // profiles.role is the permission source used by authentication.
            // The joined role can lag behind when an old import left role_id
            // stale, so it is only a fallback for legacy blank profiles.
            role_name: emp.role || (emp as any).roles?.name || "No Role",
            office_name: (emp as any).offices?.name || "No Office",
            is_active: emp.is_active,
            reporting_manager_name: emp.reports_to
              ? managerNames.get(emp.reports_to) || "Manager unavailable"
              : undefined,
            username: emp.username,
            gender: emp.gender,
            date_of_joining: emp.date_of_joining,
            weekly_off_day: emp.weekly_off_day,
          })) || [];
        setEmployees(formattedData);
        setEmployeeLoadError(null);
      }
    } catch (err: any) {
      console.error("Exception loading employees:", err);
      setEmployeeLoadError(
        err?.message ||
          "Employees could not be loaded. The previous list has been preserved.",
      );
    } finally {
      setLoading(false);
    }
  }, []);

  const loadRolesAndOffices = useCallback(async () => {
    try {
      const [rolesRes, officesRes] = await Promise.all([
        supabase.from("roles").select("id, name").order("name"),
        supabase.from("offices").select("id, name").order("name"),
      ]);

      if (rolesRes.error) throw rolesRes.error;
      if (officesRes.error) throw officesRes.error;
      if (!rolesRes.error && rolesRes.data) {
        setRoles(rolesRes.data);
      }
      if (!officesRes.error && officesRes.data) {
        setOffices(officesRes.data);
      }
      setEmployeeMetadataError(null);
    } catch (err: any) {
      console.error("Exception loading roles/offices:", err);
      setEmployeeMetadataError(
        err?.message ||
          "Roles or offices could not be loaded. Employee editing is temporarily unavailable.",
      );
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      loadEmployees();
      loadRolesAndOffices();
    }, [loadEmployees, loadRolesAndOffices]),
  );

  const openAddModal = () => {
    setEditingEmployee(null);
    setForm(EMPTY_FORM);
    setShowModal(true);
  };

  const openEditModal = (emp: Employee) => {
    setEditingEmployee(emp);
    const matchedRole = roles.find(
      (role) =>
        role.id === emp.role_id ||
        normalizeUserRole(role.name) === normalizeUserRole(emp.role_name),
    );
    const matchedOffice = offices.find(
      (office) =>
        office.id === emp.office_id || office.name === emp.office_name,
    );
    setForm({
      name: emp.name,
      email: emp.email || "",
      phone: emp.phone || "",
      employee_number: emp.employee_number || "",
      role_id: matchedRole?.id || "",
      office_id: matchedOffice?.id || "",
      gender: emp.gender || "MALE",
      date_of_joining: emp.date_of_joining || "",
      team: emp.team || "",
      weekly_off_day: emp.weekly_off_day ?? -1,
    });
    setShowModal(true);
  };

  const handleSave = async () => {
    if (!form.name.trim()) {
      if (typeof window !== "undefined") window.alert("Name is required");
      else Alert.alert("Error", "Name is required");
      return;
    }
    if (!editingEmployee && !form.employee_number.trim()) {
      if (typeof window !== "undefined") window.alert("Employee number is required");
      else Alert.alert("Error", "Employee number is required");
      return;
    }

    setSaving(true);
    try {
      if (editingEmployee) {
        const roleObj = roles.find((r) => r.id === form.role_id);
        const { data, error } = await supabase.rpc("rpc_admin_save_profile", {
          p_profile_id: editingEmployee.id,
          p_values: {
            name: form.name,
            email: form.email || null,
            phone: form.phone || null,
            employee_number: form.employee_number,
            role: roleObj?.name || null,
            role_id: form.role_id || null,
            office_id: form.office_id || null,
            team: form.team || null,
              gender: form.gender,
              date_of_joining: form.date_of_joining || null,
            weekly_off_day: form.weekly_off_day !== -1 ? form.weekly_off_day : null,
          },
        });
        const response = firstRpcRow<any>(data);

        if (error) {
          console.warn("Update error:", error);
          const message =
            error?.status === 401
              ? "Your session has expired. Nothing was saved. Please sign in again."
              : "Failed to update employee: " + error.message;
          if (typeof window !== "undefined") window.alert(message);
          else Alert.alert("Update not saved", message);
        } else if (response?.success === true && response?.profile_id === editingEmployee.id) {
          setShowModal(false);
          await loadEmployees();
          setUpdateSuccess(form.name);
        } else {
          const message = "The server did not confirm this update. Nothing was reported as saved.";
          if (typeof window !== "undefined") window.alert(message);
          else Alert.alert("Update not confirmed", message);
        }
      } else {
        if (!user?.id) {
          const message =
            "You must be signed in to create an employee. Nothing was saved; the form has been kept open.";
          if (typeof window !== "undefined") window.alert(message);
          else Alert.alert("Authentication required", message);
          return;
        }

        const roleObj = roles.find((r) => r.id === form.role_id);
        const { data, error } = await supabase.rpc(
          "rpc_admin_save_profile",
          {
            p_profile_id: null,
            p_values: {
            name: form.name,
            email: form.email || null,
            phone: form.phone || null,
            employee_number: form.employee_number,
            role: roleObj?.name || null,
            role_id: form.role_id || null,
            office_id: form.office_id || null,
            team: form.team || null,
              gender: form.gender,
              date_of_joining: form.date_of_joining || null,
            is_active: true,
            },
          },
        );
        const response = firstRpcRow<any>(data);

        if (error) {
          console.warn("Insert error:", error);
          if (error?.status === 401) {
            const message =
              "Your session has expired. Nothing was saved; the form has been kept open.";
            if (typeof window !== "undefined") window.alert(message);
            else Alert.alert("Authentication required", message);
          } else if (error?.code === "23505" || error?.status === 409) {
            Alert.alert(
              "Duplicate Entry",
              `A user with this ${error.details?.includes("phone") ? "phone number" : error.details?.includes("email") ? "email" : "employee number"} already exists. Please use a different value.`,
            );
          } else {
            Alert.alert("Error", "Failed to add employee: " + error.message);
          }
        } else if (response?.success === true && response?.profile_id) {
          setShowModal(false);
          setForm(EMPTY_FORM);
          const roleObj2 = roles.find((r) => r.id === form.role_id);
          setNewEmployeeSuccess({
            name: form.name,
            phone: form.phone,
            role: roleObj2?.name || form.role_id || "\u2014",
          });
          await loadEmployees();
        } else {
          const message = "The server did not confirm employee creation. Nothing was reported as saved.";
          if (typeof window !== "undefined") window.alert(message);
          else Alert.alert("Creation not confirmed", message);
        }
      }
    } catch (error) {
      console.error("Exception in handleSave:", error);
      Alert.alert("Error", String(error));
    } finally {
      setSaving(false);
    }
  };

  const toggleEmployeeStatus = async (employeeId: string, currentStatus: boolean) => {
    const newStatus = !currentStatus;
    const action = newStatus ? "activate" : "deactivate";
    const confirmed = typeof window !== "undefined"
      ? window.confirm(`Are you sure you want to ${action} this employee?`)
      : await new Promise<boolean>((resolve) =>
          Alert.alert(
            `${action.charAt(0).toUpperCase() + action.slice(1)} Employee`,
            `Are you sure you want to ${action} this employee?`,
            [{ text: "Cancel", style: "cancel", onPress: () => resolve(false) },
             { text: action.charAt(0).toUpperCase() + action.slice(1), onPress: () => resolve(true) }]
          )
        );
    if (!confirmed) return;
    const { data, error } = await supabase.rpc("rpc_admin_set_profile_active", {
      p_profile_id: employeeId,
      p_is_active: newStatus,
    });
    const response = firstRpcRow<any>(data);
    if (
      error ||
      response?.success !== true ||
      response?.profile_id !== employeeId
    ) {
      const message =
        error?.message || response?.message || `Server did not confirm employee ${action}.`;
      if (typeof window !== "undefined") window.alert(message);
      else Alert.alert("Status change failed", message);
    } else {
      await loadEmployees();
    }
  };

  const deleteEmployee = async (employeeId: string, name: string) => {
    const confirmed = typeof window !== "undefined"
      ? window.confirm(`Deactivate ${name}? Their historical HR records will be retained.`)
      : await new Promise<boolean>((resolve) =>
          Alert.alert(
            "Deactivate Employee",
            `Deactivate ${name}? Their historical HR records will be retained.`,
            [{ text: "Cancel", style: "cancel", onPress: () => resolve(false) },
             { text: "Deactivate", style: "destructive", onPress: () => resolve(true) }]
          )
        );
    if (!confirmed) return;
    const { data, error } = await supabase.rpc("rpc_admin_set_profile_active", {
      p_profile_id: employeeId,
      p_is_active: false,
    });
    const response = firstRpcRow<any>(data);
    if (
      error ||
      response?.success !== true ||
      response?.profile_id !== employeeId
    ) {
      const message =
        error?.message || response?.message || "Server did not confirm deactivation.";
      if (typeof window !== "undefined") window.alert("Failed to deactivate: " + message);
      else Alert.alert("Deactivation failed", message);
    } else {
      await loadEmployees();
    }
  };

  const handleSaveAdmin = async () => {
    if (!adminForm.name.trim() || !adminForm.phone.trim()) {
      Alert.alert("Required", "Name and phone are required.");
      return;
    }
    setSavingAdmin(true);
    const { data, error } = await supabase.rpc("rpc_admin_save_profile", {
      p_profile_id: null,
      p_values: {
        name: adminForm.name.trim(),
        phone: adminForm.phone.trim(),
        role: adminForm.role,
        is_active: true,
      },
    });
    const response = firstRpcRow<any>(data);
    setSavingAdmin(false);
    if (error) {
      Alert.alert("Error", error.message);
    } else if (response?.success === true && response?.profile_id) {
      setShowAdminModal(false);
      setAdminForm({ name: "", phone: "", role: "ADMIN" });
      loadEmployees();
      Alert.alert("Success", `Admin user created. They can log in with their phone number.`);
    } else {
      Alert.alert(
        "Creation not confirmed",
        "The server did not confirm the admin account. Nothing was reported as saved.",
      );
    }
  };

  const renderEmployee = ({ item }: { item: Employee }) => (
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
          {item.email ? (
            <ThemedText type="caption" style={{ color: theme.textSecondary }}>
              {item.email}
            </ThemedText>
          ) : null}
          {item.phone && (
            <ThemedText type="caption" style={{ color: theme.textSecondary }}>
              {item.phone}
            </ThemedText>
          )}
          {item.employee_number && (
            <ThemedText type="caption" style={{ color: theme.textSecondary }}>
              {"Emp #: " + item.employee_number}
            </ThemedText>
          )}
          <ThemedText type="caption" style={{ color: theme.textSecondary }}>
            {item.role_name + " \u2022 " + item.office_name}
          </ThemedText>
          {item.team ? (
            <ThemedText type="caption" style={{ color: theme.primary, fontWeight: "600" }}>
              {"\uD83D\uDC65 " + item.team}
            </ThemedText>
          ) : null}
          {item.username && (
            <ThemedText
              type="caption"
              style={{ color: Colors.light.success, fontWeight: "600" }}
            >
              {"\u2713 Username: " + item.username}
            </ThemedText>
          )}
          {item.reporting_manager_name && (
            <ThemedText type="caption" style={{ color: theme.textSecondary }}>
              {"Reports to: " + item.reporting_manager_name}
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
            {isStrictAdmin && (
              <Pressable
                style={[styles.actionButton, { backgroundColor: theme.backgroundRoot }]}
                onPress={() => openEditModal(item)}
              >
                <Feather name="edit-2" size={16} color={Colors.light.info} />
              </Pressable>
            )}
            {isStrictAdmin && (
              <Pressable
                style={[styles.actionButton, { backgroundColor: theme.backgroundRoot }]}
                onPress={() => toggleEmployeeStatus(item.id, item.is_active)}
              >
                <Feather name={item.is_active ? "user-x" : "user-check"} size={16} color={item.is_active ? Colors.light.error : Colors.light.success} />
              </Pressable>
            )}
            {isStrictAdmin && (
              <Pressable
                style={[styles.actionButton, { backgroundColor: Colors.light.error + "15" }]}
                onPress={() => deleteEmployee(item.id, item.name)}
              >
                <Feather name="trash-2" size={16} color={Colors.light.error} />
              </Pressable>
            )}
          </View>
        </View>
      </View>
    </View>
  );

  if (loading) {
    return (
      <View style={styles.centered}>
        <ThemedText>Loading employees...</ThemedText>
      </View>
    );
  }

  return (
    <View style={[styles.container, { backgroundColor: theme.backgroundRoot }]}>
      <PageHeader
        title="Employee Management"
        subtitle={`${employees.length} employees`}
        rightIcon="user-plus"
        rightLabel="Add"
        onRightPress={isStrictAdmin ? openAddModal : undefined}
        forceShowButton={true}
      />

      {employeeLoadError || employeeMetadataError ? (
        <View
          style={{
            marginTop: Spacing.sm,
            padding: Spacing.md,
            borderRadius: BorderRadius.md,
            borderWidth: 1,
            borderColor: Colors.light.error,
            backgroundColor: `${Colors.light.error}10`,
            flexDirection: "row",
            alignItems: "center",
            gap: Spacing.sm,
          }}
        >
          <Feather name="alert-triangle" size={18} color={Colors.light.error} />
          <ThemedText style={{ color: Colors.light.error, flex: 1 }}>
            Employee data unavailable: {employeeLoadError || employeeMetadataError}
          </ThemedText>
          <Pressable
            onPress={() => {
              setLoading(true);
              void loadEmployees();
              void loadRolesAndOffices();
            }}
          >
            <ThemedText style={{ color: Colors.light.error, fontWeight: "700" }}>
              Retry
            </ThemedText>
          </Pressable>
        </View>
      ) : null}

      {isSystemAdmin && (
        <>
          <Spacer height={Spacing.sm} />
          <Pressable style={[styles.addButtonFull, { backgroundColor: "#7C3AED" }]} onPress={() => setShowAdminModal(true)}>
            <Feather name="shield" size={20} color="#FFFFFF" />
            <ThemedText style={styles.addButtonText}>Add Admin / HR User</ThemedText>
          </Pressable>
        </>
      )}

      {isStrictAdmin && (
        <>
          <Spacer height={Spacing.sm} />
          <View style={{ flexDirection: "row", gap: Spacing.sm }}>
            <PermissionGate permission="employee.create">
              <Pressable
                style={[styles.addButtonHalf, { backgroundColor: "#6D1B6D", flex: 1 }]}
                onPress={openAddModal}
              >
                <Feather name="user-plus" size={20} color="#FFFFFF" />
                <ThemedText style={styles.addButtonText}>Add Employee</ThemedText>
              </Pressable>
            </PermissionGate>
            <Pressable
              style={[styles.addButtonHalf, { backgroundColor: "#10B981", flex: 1, opacity: bulkUploading ? 0.7 : 1 }]}
              onPress={handleBulkUpload}
              disabled={bulkUploading}>
              <Feather name="upload" size={20} color="#FFFFFF" />
              <ThemedText style={styles.addButtonText}>
                {bulkUploading ? "Uploading..." : "Bulk Upload"}
              </ThemedText>
            </Pressable>
          </View>
          <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginTop: 6 }}>
            <ThemedText type="caption" style={{ color: theme.textSecondary, flex: 1 }}>
              Columns: name, phone, email, role, office, employee_number, team, date_of_birth, gender, joining_date, weekly_off
            </ThemedText>
            <Pressable
              onPress={downloadSampleCSV}
              style={{ flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 10, paddingVertical: 4, backgroundColor: "#EFF6FF", borderRadius: 6 }}
            >
              <Feather name="download" size={13} color="#3B82F6" />
              <ThemedText type="caption" style={{ color: "#3B82F6", fontWeight: "600" }}>Sample</ThemedText>
            </Pressable>
          </View>
        </>
      )}

      <Spacer height={Spacing.lg} />

      <View style={[styles.searchBar, { backgroundColor: theme.backgroundDefault }]}>
        <Feather name="search" size={16} color={theme.textSecondary} />
        <TextInput
          style={[styles.searchInput, { color: theme.text }]}
          placeholder={`Search ${employees.length} employees...`}
          placeholderTextColor={theme.textSecondary}
          value={search}
          onChangeText={(value) => {
            setSearch(value);
            setEmployeePage(0);
          }}
        />
        {search ? (
          <Pressable onPress={() => setSearch("")}>
            <Feather name="x" size={16} color={theme.textSecondary} />
          </Pressable>
        ) : null}
      </View>

      <Spacer height={Spacing.sm} />

      {(() => {
        const filtered = search
          ? employees.filter((e) => {
              const q = search.toLowerCase().trim();
              const qDigits = search.replace(/\D/g, "");
              return (
                e.name.toLowerCase().includes(q) ||
                (e.email ?? "").toLowerCase().includes(q) ||
                (qDigits.length > 0 && (e.phone ?? "").replace(/\D/g, "").includes(qDigits)) ||
                (e.employee_number ?? "").toLowerCase().includes(q) ||
                e.role_name.toLowerCase().includes(q)
              );
            })
          : employees;
        return filtered.length === 0 ? (
          <View style={styles.centered}>
            <Feather name="users" size={48} color={theme.textSecondary} />
            <Spacer height={Spacing.md} />
            <ThemedText type="body" style={{ color: theme.textSecondary }}>
              {search ? `No results for "${search}"` : "No employees yet"}
            </ThemedText>
          </View>
        ) : (
          <FlatList
            data={filtered.slice(
              employeePage * EMPLOYEE_PAGE_SIZE,
              (employeePage + 1) * EMPLOYEE_PAGE_SIZE,
            )}
            keyExtractor={(item) => item.id}
            renderItem={renderEmployee}
            contentContainerStyle={styles.list}
            showsVerticalScrollIndicator={false}
            ListFooterComponent={
              filtered.length > EMPLOYEE_PAGE_SIZE ? (
                <View style={styles.paginationRow}>
                  <Button
                    title="Previous"
                    onPress={() => setEmployeePage((page) => Math.max(0, page - 1))}
                    disabled={employeePage === 0}
                  />
                  <ThemedText type="caption">
                    Page {employeePage + 1} of{" "}
                    {Math.ceil(filtered.length / EMPLOYEE_PAGE_SIZE)}
                  </ThemedText>
                  <Button
                    title="Next"
                    onPress={() =>
                      setEmployeePage((page) =>
                        Math.min(
                          Math.ceil(filtered.length / EMPLOYEE_PAGE_SIZE) - 1,
                          page + 1,
                        ),
                      )
                    }
                    disabled={
                      employeePage >=
                      Math.ceil(filtered.length / EMPLOYEE_PAGE_SIZE) - 1
                    }
                  />
                </View>
              ) : null
            }
          />
        );
      })()}

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
                <ThemedText type="small" style={styles.inputLabel}>Weekly Off Day (Optional)</ThemedText>
                <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6, marginTop: 4 }}>
                  {[
                    { label: "Sun", value: 0 },
                    { label: "Mon", value: 1 },
                    { label: "Tue", value: 2 },
                    { label: "Wed", value: 3 },
                    { label: "Thu", value: 4 },
                    { label: "Fri", value: 5 },
                    { label: "Sat", value: 6 },
                  ].map((d) => {
                    const isSelected = form.weekly_off_day === d.value;
                    return (
                      <Pressable
                        key={d.value}
                        onPress={() => setForm({ ...form, weekly_off_day: isSelected ? -1 : d.value })}
                        style={{
                          paddingHorizontal: 12,
                          paddingVertical: 6,
                          borderRadius: 8,
                          borderWidth: 1,
                          borderColor: isSelected ? theme.primary : theme.border,
                          backgroundColor: isSelected ? theme.primary + "15" : theme.backgroundSecondary,
                        }}
                      >
                        <ThemedText type="caption" style={{ color: isSelected ? theme.primary : theme.textSecondary, fontWeight: "600" }}>
                          {d.label}
                        </ThemedText>
                      </Pressable>
                    );
                  })}
                </View>
              <Spacer height={Spacing.md} />

              <ThemedText type="small" style={styles.inputLabel}>
                Email
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
                placeholder="Email address (optional)"
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
                Gender
              </ThemedText>
              <View
                style={[
                  styles.pickerContainer,
                  { backgroundColor: theme.backgroundSecondary },
                ]}
              >
                <Picker
                  selectedValue={form.gender}
                  onValueChange={(value) =>
                    setForm({ ...form, gender: value })
                  }
                  style={{ color: theme.text, backgroundColor: Platform.OS === "web" ? theme.backgroundSecondary : "transparent" }} dropdownIconColor={theme.text}
                >
                  <Picker.Item label="Male" value="MALE" />
                  <Picker.Item label="Female" value="FEMALE" />
                </Picker>
              </View>

              <Spacer height={Spacing.md} />

              <ThemedText type="small" style={styles.inputLabel}>
                Date of Joining
              </ThemedText>
              <TextInput
                style={[
                  styles.modalInput,
                  {
                    backgroundColor: theme.backgroundSecondary,
                    color: theme.text,
                  },
                ]}
                value={form.date_of_joining}
                onChangeText={(t) => setForm({ ...form, date_of_joining: t })}
                placeholder="YYYY-MM-DD"
                placeholderTextColor={theme.textSecondary}
              />

              <Spacer height={Spacing.md} />

              <ThemedText type="small" style={styles.inputLabel}>
                Role
              </ThemedText>
              {roles.length > 0 ? (
                <View
                  style={[
                    styles.pickerContainer,
                    { backgroundColor: theme.backgroundSecondary },
                  ]}
                >
                  <Picker
                    selectedValue={form.role_id}
                    onValueChange={(value) =>
                      setForm({ ...form, role_id: value })
                    }
                    style={{ color: theme.text, backgroundColor: Platform.OS === "web" ? theme.backgroundSecondary : "transparent" }} dropdownIconColor={theme.text}
                  >
                    <Picker.Item label="Select Role" value="" />
                    {roles.map((role) => (
                      <Picker.Item
                        key={role.id}
                        label={role.name}
                        value={role.id}
                      />
                    ))}
                  </Picker>
                </View>
              ) : (
                <ThemedText
                  type="caption"
                  style={{ color: theme.textSecondary }}
                >
                  No roles available
                </ThemedText>
              )}
              {isSalesManagerRole(
                roles.find((role) => role.id === form.role_id)?.name,
              ) ? (
                <ThemedText
                  type="caption"
                  style={{ color: Colors.light.warning, marginTop: 6, fontWeight: "700" }}
                >
                  Sales Manager can directly manage {salesManagerDirectReportLabel()}.
                </ThemedText>
              ) : null}
              <Spacer height={Spacing.md} />

              <ThemedText type="small" style={styles.inputLabel}>
                Office
              </ThemedText>
              {offices.length > 0 ? (
                <View
                  style={[
                    styles.pickerContainer,
                    { backgroundColor: theme.backgroundSecondary },
                  ]}
                >
                  <Picker
                    selectedValue={form.office_id}
                    onValueChange={(value) =>
                      setForm({ ...form, office_id: value })
                    }
                    style={{ color: theme.text, backgroundColor: Platform.OS === "web" ? theme.backgroundSecondary : "transparent" }} dropdownIconColor={theme.text}
                  >
                    <Picker.Item label="Select Office" value="" />
                    {offices.map((office) => (
                      <Picker.Item
                        key={office.id}
                        label={office.name}
                        value={office.id}
                      />
                    ))}
                  </Picker>
                </View>
              ) : (
                <ThemedText
                  type="caption"
                  style={{ color: theme.textSecondary }}
                >
                  No offices available
                </ThemedText>
              )}
              <Spacer height={Spacing.md} />
              <ThemedText type="small" style={styles.inputLabel}>Team</ThemedText>
              <TextInput
                style={[styles.modalInput, { backgroundColor: theme.backgroundSecondary, color: theme.text }]}
                value={form.team}
                onChangeText={(t) => setForm({ ...form, team: t })}
                placeholder="e.g. Sector 63, Gurugram"
                placeholderTextColor={theme.textSecondary}
              />
              <Spacer height={Spacing.xl} />
            </ScrollView>
            <View style={{ padding: Spacing.lg, paddingTop: 0 }}>
              <Button onPress={handleSave}>
                {saving
                  ? "Saving..."
                  : editingEmployee
                    ? "Save Changes"
                    : "Add Employee"}
              </Button>
            </View>
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

      {/* Bulk import preview: nothing is sent until the administrator confirms. */}
      <Modal
        visible={showBulkPreview}
        transparent
        animationType="fade"
        onRequestClose={() => {
          if (!bulkUploading) setShowBulkPreview(false);
        }}
      >
        <View style={styles.modalOverlay}>
          <ThemedView
            style={[
              styles.modalContainer,
              {
                paddingBottom: insets.bottom + Spacing.lg,
                maxHeight: "85%",
                maxWidth: 900,
              },
            ]}
          >
            <View style={styles.modalHeader}>
              <View style={{ flex: 1 }}>
                <ThemedText type="h3">Review Employee Import</ThemedText>
                <ThemedText type="caption" style={{ color: theme.textSecondary }}>
                  {bulkPreview?.rows.length ?? 0} rows · verify every mapping before saving
                </ThemedText>
              </View>
              <Pressable
                disabled={bulkUploading}
                onPress={() => setShowBulkPreview(false)}
              >
                <Feather name="x" size={24} color={theme.text} />
              </Pressable>
            </View>
            <ScrollView style={styles.modalContent}>
              {(bulkPreview?.rows ?? []).map((row) => (
                <View
                  key={`${row.row_number}-${row.phone}`}
                  style={{
                    borderBottomWidth: 1,
                    borderBottomColor: theme.border,
                    paddingVertical: Spacing.sm,
                  }}
                >
                  <ThemedText style={{ fontWeight: "700" }}>
                    Row {row.row_number}: {row.name}
                  </ThemedText>
                  <ThemedText type="caption" style={{ color: theme.textSecondary }}>
                    {row.phone} · {row.role_name} · {row.office_name}
                    {row.team ? ` · ${row.team}` : ""}
                  </ThemedText>
                </View>
              ))}
              <Spacer height={Spacing.lg} />
              <ThemedText type="caption" style={{ color: theme.textSecondary }}>
                Batch ID: {bulkPreview?.batchId}
              </ThemedText>
              <Spacer height={Spacing.md} />
              <Button onPress={() => void confirmBulkImport()} disabled={bulkUploading}>
                {bulkUploading ? "Importing..." : "Confirm Import"}
              </Button>
              <Spacer height={Spacing.sm} />
              <Button
                variant="outline"
                onPress={() => setShowBulkPreview(false)}
                disabled={bulkUploading}
              >
                Cancel
              </Button>
            </ScrollView>
          </ThemedView>
        </View>
      </Modal>

      {/* Bulk Upload Result Modal */}
      <Modal visible={showBulkResult} transparent animationType="fade" onRequestClose={() => setShowBulkResult(false)}>
        <View style={styles.modalOverlay}>
          <ThemedView style={[styles.modalContainer, { paddingBottom: insets.bottom + Spacing.lg, maxHeight: "70%" }]}>
            <View style={styles.modalHeader}>
              <ThemedText type="h3">Bulk Upload Result</ThemedText>
              <Pressable onPress={() => setShowBulkResult(false)}>
                <Feather name="x" size={24} color={theme.text} />
              </Pressable>
            </View>
            <ScrollView style={styles.modalContent}>
              <View style={[styles.credentialBox, { backgroundColor: Colors.light.success + "10", borderColor: Colors.light.success }]}>
                <Feather name="check-circle" size={24} color={Colors.light.success} />
                <ThemedText type="body" style={{ marginLeft: Spacing.md, fontWeight: "600" }}>
                  {(bulkResult?.inserted ?? 0) + " new employees added"}
                </ThemedText>
              </View>
              {(bulkResult?.updated ?? 0) > 0 && (
                <>
                  <Spacer height={Spacing.md} />
                  <View style={[styles.credentialBox, { backgroundColor: Colors.light.info + "10", borderColor: Colors.light.info }]}>
                    <Feather name="refresh-cw" size={20} color={Colors.light.info} />
                    <ThemedText type="body" style={{ marginLeft: Spacing.md, fontWeight: "600", color: Colors.light.info }}>
                      {(bulkResult?.updated) + " existing profiles updated (name / role / team)"}
                    </ThemedText>
                  </View>
                </>
              )}
              {(bulkResult?.skipped ?? 0) > 0 && (
                <>
                  <Spacer height={Spacing.md} />
                  <ThemedText type="caption" style={{ color: Colors.light.warning }}>
                    {"⚠ " + bulkResult?.skipped + " rows unchanged (already up to date)"}
                  </ThemedText>
                </>
              )}
              {(bulkResult?.errors?.length ?? 0) > 0 && (
                <>
                  <Spacer height={Spacing.md} />
                  <ThemedText type="caption" style={{ color: Colors.light.error, fontWeight: "600" }}>Errors:</ThemedText>
                  {bulkResult?.errors.map((e, i) => (
                    <ThemedText key={i} type="caption" style={{ color: Colors.light.error }}>{e}</ThemedText>
                  ))}
                </>
              )}
              <Spacer height={Spacing.xl} />
              <Button onPress={() => setShowBulkResult(false)}>Done</Button>
            </ScrollView>
          </ThemedView>
        </View>
      </Modal>

      {/* Add Admin User Modal */}
      <Modal visible={showAdminModal} animationType="slide" transparent onRequestClose={() => setShowAdminModal(false)}>
        <View style={styles.modalOverlay}>
          <ThemedView style={[styles.modalContainer, { paddingBottom: insets.bottom + Spacing.lg }]}>
            <View style={styles.modalHeader}>
              <ThemedText type="h3">Add Admin / HR User</ThemedText>
              <Pressable onPress={() => setShowAdminModal(false)}>
                <Feather name="x" size={24} color={theme.text} />
              </Pressable>
            </View>
            <ScrollView style={styles.modalContent} keyboardShouldPersistTaps="handled">
              <ThemedText type="small" style={styles.inputLabel}>Name *</ThemedText>
              <TextInput
                style={[styles.modalInput, { backgroundColor: theme.backgroundSecondary, color: theme.text }]}
                value={adminForm.name}
                onChangeText={(t) => setAdminForm({ ...adminForm, name: t })}
                placeholder="Full name"
                placeholderTextColor={theme.textSecondary}
              />
              <Spacer height={Spacing.md} />
              <ThemedText type="small" style={styles.inputLabel}>Phone *</ThemedText>
              <TextInput
                style={[styles.modalInput, { backgroundColor: theme.backgroundSecondary, color: theme.text }]}
                value={adminForm.phone}
                onChangeText={(t) => setAdminForm({ ...adminForm, phone: t })}
                placeholder="Phone number (used to log in)"
                placeholderTextColor={theme.textSecondary}
                keyboardType="phone-pad"
              />
              <Spacer height={Spacing.md} />
              <ThemedText type="small" style={styles.inputLabel}>Admin Role</ThemedText>
              <View style={[styles.pickerContainer, { backgroundColor: theme.backgroundSecondary }]}>
                <Picker
                  selectedValue={adminForm.role}
                  onValueChange={(v) => setAdminForm({ ...adminForm, role: v })}
                  style={{ color: theme.text, backgroundColor: Platform.OS === "web" ? theme.backgroundSecondary : "transparent" }} dropdownIconColor={theme.text}
                >
                  {ADMIN_ROLES.map((r) => (
                    <Picker.Item key={r} label={r.replace(/_/g, " ")} value={r} />
                  ))}
                </Picker>
              </View>
              <Spacer height={Spacing.xl} />
              <Button onPress={handleSaveAdmin}>{savingAdmin ? "Creating..." : "Create Admin User"}</Button>
            </ScrollView>
          </ThemedView>
        </View>
      </Modal>

      {/* Update Success Modal */}
      <Modal visible={!!updateSuccess} transparent animationType="fade" onRequestClose={() => setUpdateSuccess(null)}>
        <View style={styles.modalOverlay}>
          <View style={[styles.successSheet, { backgroundColor: theme.backgroundDefault }]}>
            <View style={styles.successIcon}>
              <Feather name="check-circle" size={36} color={Colors.light.success} />
            </View>
            <ThemedText type="h3" style={{ textAlign: "center", marginTop: Spacing.md }}>User Updated ✅</ThemedText>
            <Spacer height={Spacing.sm} />
            <ThemedText type="body" style={{ textAlign: "center", fontWeight: "700", fontSize: 18 }}>
              {updateSuccess}
            </ThemedText>
            <ThemedText type="caption" style={{ color: theme.textSecondary, textAlign: "center", marginTop: 4 }}>
              Changes saved successfully.
            </ThemedText>
            <Spacer height={Spacing.xl} />
            <Pressable
              style={[styles.successBtn, { backgroundColor: theme.primary, alignSelf: "stretch", justifyContent: "center" }]}
              onPress={() => setUpdateSuccess(null)}
            >
              <Feather name="check" size={16} color="#fff" />
              <ThemedText type="caption" style={{ color: "#fff", fontWeight: "600" }}>Done</ThemedText>
            </Pressable>
          </View>
        </View>
      </Modal>

      {/* New Employee Success Modal */}
      <Modal visible={!!newEmployeeSuccess} transparent animationType="fade" onRequestClose={() => setNewEmployeeSuccess(null)}>
        <View style={styles.modalOverlay}>
          <View style={[styles.successSheet, { backgroundColor: theme.backgroundDefault }]}>
            <View style={styles.successIcon}>
              <Feather name="user-check" size={36} color={Colors.light.success} />
            </View>
            <ThemedText type="h3" style={{ textAlign: "center", marginTop: Spacing.md }}>Employee Added! 🎉</ThemedText>
            <Spacer height={Spacing.sm} />
            <ThemedText type="body" style={{ textAlign: "center", fontWeight: "700", fontSize: 18 }}>
              {newEmployeeSuccess?.name}
            </ThemedText>
            <ThemedText type="caption" style={{ color: theme.textSecondary, textAlign: "center", marginTop: 4 }}>
              {newEmployeeSuccess?.role}
            </ThemedText>
            {newEmployeeSuccess?.phone ? (
              <View style={[styles.phoneChip, { backgroundColor: theme.backgroundSecondary }]}>
                <Feather name="phone" size={14} color={theme.primary} />
                <ThemedText type="body" style={{ color: theme.primary, fontWeight: "600" }}>
                  {newEmployeeSuccess.phone}
                </ThemedText>
              </View>
            ) : null}
            <ThemedText type="caption" style={{ color: theme.textSecondary, textAlign: "center", marginTop: Spacing.md, lineHeight: 18 }}>
              {"The employee can now log in using their employee number.\nOTP will be sent to their registered phone."}
            </ThemedText>
            <Spacer height={Spacing.xl} />
            <View style={{ flexDirection: "row", gap: Spacing.md }}>
              <Pressable
                style={[styles.successBtn, { backgroundColor: theme.backgroundSecondary, flex: 1 }]}
                onPress={() => { setNewEmployeeSuccess(null); openAddModal(); }}
              >
                <Feather name="user-plus" size={16} color={theme.primary} />
                <ThemedText type="caption" style={{ color: theme.primary, fontWeight: "600" }}>Add Another</ThemedText>
              </Pressable>
              <Pressable
                style={[styles.successBtn, { backgroundColor: theme.primary, flex: 1 }]}
                onPress={() => setNewEmployeeSuccess(null)}
              >
                <Feather name="check" size={16} color="#fff" />
                <ThemedText type="caption" style={{ color: "#fff", fontWeight: "600" }}>Done</ThemedText>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  centered: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  header: { flexDirection: "row", justifyContent: "flex-start", alignItems: "center" },
  addButton: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    borderRadius: BorderRadius.sm,
    gap: Spacing.xs,
  },
  addButtonFull: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: Spacing.xl,
    paddingVertical: Spacing.md,
    borderRadius: BorderRadius.md,
    gap: Spacing.sm,
  },
  addButtonHalf: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.md,
    borderRadius: BorderRadius.md,
    gap: Spacing.xs,
  },
  addButtonText: {
    color: "#FFFFFF",
    fontWeight: "600",
    fontSize: 16,
  },
  list: { gap: Spacing.sm, padding: Spacing.lg, paddingTop: Spacing.md },
  employeeCard: {
    padding: Spacing.lg,
    borderRadius: 14,
    ...(Platform.OS === "web"
      ? { boxShadow: "0 2px 8px rgba(109,27,109,0.07)" }
      : { shadowColor: "#6D1B6D", shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.07, shadowRadius: 8, elevation: 2 }),
  },
  employeeHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
  },
  employeeInfo: {
    flex: 1,
  },
  employeeName: {
    marginBottom: Spacing.xs,
  },
  employeeActions: {
    alignItems: "flex-end",
    gap: Spacing.sm,
  },
  statusBadge: {
    paddingHorizontal: Spacing.sm,
    paddingVertical: Spacing.xs,
    borderRadius: BorderRadius.xs,
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
    backgroundColor: "rgba(0,0,0,0.5)",
    justifyContent: "flex-end",
  },
  modalContainer: {
    borderTopLeftRadius: BorderRadius.xl,
    borderTopRightRadius: BorderRadius.xl,
    maxHeight: "90%",
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
    overflow: "hidden",
    marginBottom: Spacing.sm,
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
  searchBar: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.sm,
    padding: Spacing.md,
    borderRadius: BorderRadius.md,
  },
  searchInput: { flex: 1, fontSize: 14 },
  paginationRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: Spacing.md,
    paddingVertical: Spacing.lg,
  },
  successSheet: {
    margin: Spacing.xl,
    borderRadius: BorderRadius.xl,
    padding: Spacing.xl,
    alignItems: "center",
  },
  successIcon: {
    width: 72, height: 72, borderRadius: 36,
    backgroundColor: Colors.light.success + "15",
    alignItems: "center", justifyContent: "center",
  },
  phoneChip: {
    flexDirection: "row", alignItems: "center", gap: 8,
    paddingHorizontal: Spacing.lg, paddingVertical: Spacing.sm,
    borderRadius: BorderRadius.full, marginTop: Spacing.md,
  },
  successBtn: {
    flexDirection: "row", alignItems: "center", justifyContent: "center",
    gap: 6, padding: Spacing.md, borderRadius: BorderRadius.md,
  },
});



