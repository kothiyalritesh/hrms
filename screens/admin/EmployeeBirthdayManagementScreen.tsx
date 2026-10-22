import React, { useState, useCallback, useMemo } from "react";
import { View, FlatList, StyleSheet, TouchableOpacity, ActivityIndicator, TextInput, Platform } from "react-native";
import Feather from "@expo/vector-icons/Feather";
import { useFocusEffect } from "@react-navigation/native";
import { supabase } from "@/lib/supabase";
import { PermissionsApi } from "@/services/permissions.service";
import { ThemedText } from "@/components/ThemedText";
import { useTheme } from "@/hooks/useTheme";
import Spacer from "@/components/Spacer";
import { Spacing, BorderRadius, Colors } from "@/constants/theme";
import DateTimePicker from "@react-native-community/datetimepicker";
import { Alert } from "react-native";
import * as DocumentPicker from "expo-document-picker";

type EmployeeDOB = {
  id: string;
  name: string;
  date_of_birth: string | null;
  employee_number: string | null;
};

export default function EmployeeBirthdayManagementScreen() {
  const { theme } = useTheme();
  const [employees, setEmployees] = useState<EmployeeDOB[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  
  // Date Picker State
  const [showPicker, setShowPicker] = useState(false);
  const [selectedEmp, setSelectedEmp] = useState<EmployeeDOB | null>(null);
  const [tempDate, setTempDate] = useState<Date>(new Date());
  const [savingId, setSavingId] = useState<string | null>(null);

  // CSV Import State
  const [importing, setImporting] = useState(false);

  const loadData = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from("profiles")
      .select("id, name, date_of_birth, employee_number")
      .eq("is_active", true)
      .not("is_service_account", "is", true)
      .order("name");
      
    if (!error && data) {
      setEmployees(data);
    }
    setLoading(false);
  }, []);

  useFocusEffect(useCallback(() => { loadData(); }, [loadData]));

  const filtered = useMemo(() => {
    if (!search.trim()) return employees;
    const q = search.toLowerCase();
    return employees.filter(e => e.name.toLowerCase().includes(q) || (e.employee_number || "").toLowerCase().includes(q));
  }, [search, employees]);

  const handleSelectDate = async (event: any, date?: Date) => {
    if (Platform.OS === "android") setShowPicker(false);
    if (event.type === "dismissed" || !date || !selectedEmp) {
      setSelectedEmp(null);
      return;
    }
    
    const dateStr = [
      date.getFullYear(),
      String(date.getMonth() + 1).padStart(2, "0"),
      String(date.getDate()).padStart(2, "0")
    ].join("-");
    
    setSavingId(selectedEmp.id);
    setSelectedEmp(null);
    
    // Saved through the server (birthdays.manage); direct profile updates are not allowed.
    let error: string | null = null;
    try {
      const res = await PermissionsApi.setBirthday(selectedEmp.id, dateStr);
      if (res?.success === false) error = res.message ?? "Not allowed.";
    } catch (e: any) {
      error = e?.message ?? "Could not save birthday.";
    }
    
    if (error) {
      Alert.alert("Could not save birthday", error);
    } else {
      setEmployees(prev => prev.map(e => e.id === selectedEmp.id ? { ...e, date_of_birth: dateStr } : e));
    }
    setSavingId(null);
  };

  const handleUploadCSV = async () => {
    try {
      const res = await DocumentPicker.getDocumentAsync({ type: ["text/csv", "application/vnd.ms-excel"] });
      if (res.canceled || !res.assets || res.assets.length === 0) return;
      
      setImporting(true);
      // Fast CSV parsing
      const fileUri = res.assets[0].uri;
      const resp = await fetch(fileUri);
      const text = await resp.text();
      
      const lines = text.split("\n").map(l => l.trim()).filter(Boolean);
      if (lines.length < 2) throw new Error("File is empty or missing headers.");
      
      const headers = lines[0].toLowerCase().split(",");
      const nameIdx = headers.findIndex(h => h.includes("name"));
      const phoneIdx = headers.findIndex(h => h.includes("phone"));
      const dobIdx = headers.findIndex(h => h.includes("dob") || h.includes("birth"));
      
      if (nameIdx === -1 || dobIdx === -1) {
        throw new Error("CSV must contain 'Name' and 'Date of Birth' columns.");
      }
      
      const rows: { name: string; phone: string | null; date_of_birth: string }[] = [];
      
      for (let i = 1; i < lines.length; i++) {
        const cols = lines[i].split(",");
        const name = cols[nameIdx]?.trim();
        const dobRaw = cols[dobIdx]?.trim();
        const phone = phoneIdx !== -1 ? cols[phoneIdx]?.trim() : null;
        
        if (!name || !dobRaw) continue;
        
        // Parse dd-mm-yyyy or mm/dd/yyyy or yyyy-mm-dd
        let dateStr = "";
        const parts = dobRaw.split(/[\/\-]/);
        if (parts.length === 3) {
          if (parts[0].length === 4) dateStr = `${parts[0]}-${parts[1].padStart(2, '0')}-${parts[2].padStart(2, '0')}`;
          else if (parts[2].length === 4) dateStr = `${parts[2]}-${parts[1].padStart(2, '0')}-${parts[0].padStart(2, '0')}`;
        }
        if (!dateStr || isNaN(new Date(dateStr).getTime())) continue;
        
        rows.push({ name, phone: phone || null, date_of_birth: dateStr });
      }
      
      // The server matches each row to exactly one employee (name, plus phone
      // when given) and skips ambiguous or unknown names.
      const result = await PermissionsApi.importBirthdays(rows);
      const skipped = result.skipped ?? [];
      Alert.alert(
        "Import Complete",
        `Updated ${result.updated} employee records.` +
          (skipped.length
            ? `
Skipped ${skipped.length}: ` + skipped.slice(0, 8).map((r) => `${r.name} (${r.reason})`).join(", ") + (skipped.length > 8 ? "…" : "")
            : ""),
      );
      loadData();
    } catch (e: any) {
      Alert.alert("Import Error", e.message);
    } finally {
      setImporting(false);
    }
  };

  const renderItem = ({ item }: { item: EmployeeDOB }) => {
    const hasDOB = !!item.date_of_birth;
    return (
      <TouchableOpacity 
        style={[styles.card, { backgroundColor: theme.backgroundDefault, borderColor: theme.border }]}
        onPress={() => {
          setSelectedEmp(item);
          setTempDate(item.date_of_birth ? new Date(item.date_of_birth) : new Date());
          setShowPicker(true);
        }}
        disabled={savingId === item.id}
      >
        <View style={styles.cardInfo}>
          <ThemedText style={{ fontWeight: "700", color: theme.text }}>{item.name}</ThemedText>
          <ThemedText type="caption" style={{ color: theme.textSecondary }}>{item.employee_number || "No ID"}</ThemedText>
        </View>
        <View style={[styles.dobBadge, { backgroundColor: hasDOB ? theme.primary + "18" : theme.backgroundSecondary }]}>
          {savingId === item.id ? (
            <ActivityIndicator size="small" color={theme.primary} />
          ) : (
            <ThemedText style={{ color: hasDOB ? theme.primary : theme.textSecondary, fontWeight: "600", fontSize: 13 }}>
              {hasDOB ? new Date(item.date_of_birth!).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" }) : "Not set"}
            </ThemedText>
          )}
        </View>
      </TouchableOpacity>
    );
  };

  return (
    <View style={{ flex: 1, backgroundColor: theme.backgroundRoot }}>
      <View style={[styles.toolbar, { backgroundColor: theme.backgroundDefault, borderBottomColor: theme.border }]}>
        <View style={[styles.searchBox, { backgroundColor: theme.backgroundSecondary }]}>
          <Feather name="search" size={16} color={theme.textSecondary} />
          <TextInput
            style={{ flex: 1, color: theme.text, marginLeft: Spacing.sm }}
            placeholder="Search employees..."
            placeholderTextColor={theme.textSecondary}
            value={search}
            onChangeText={setSearch}
          />
        </View>
        <TouchableOpacity 
          style={[styles.importBtn, { backgroundColor: theme.backgroundSecondary }]}
          onPress={handleUploadCSV}
          disabled={importing}
        >
          {importing ? <ActivityIndicator size="small" color={theme.primary} /> : <Feather name="upload" size={18} color={theme.primary} />}
        </TouchableOpacity>
      </View>

      {loading ? (
        <View style={styles.centered}><ActivityIndicator size="large" color={theme.primary} /></View>
      ) : (
        <FlatList
          data={filtered}
          keyExtractor={item => item.id}
          contentContainerStyle={{ padding: Spacing.md }}
          renderItem={renderItem}
          ItemSeparatorComponent={() => <Spacer height={Spacing.sm} />}
        />
      )}

      {showPicker && (
        <DateTimePicker
          value={tempDate}
          mode="date"
          display="default"
          onChange={handleSelectDate}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  centered: { flex: 1, justifyContent: "center", alignItems: "center" },
  toolbar: { flexDirection: "row", padding: Spacing.md, gap: Spacing.md, borderBottomWidth: 1 },
  searchBox: { flex: 1, flexDirection: "row", alignItems: "center", paddingHorizontal: Spacing.md, borderRadius: BorderRadius.md, height: 44 },
  importBtn: { width: 44, height: 44, borderRadius: BorderRadius.md, justifyContent: "center", alignItems: "center" },
  card: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", padding: Spacing.md, borderRadius: BorderRadius.md, borderWidth: 1 },
  cardInfo: { flex: 1 },
  dobBadge: { paddingHorizontal: Spacing.md, paddingVertical: Spacing.sm, borderRadius: BorderRadius.full },
});
