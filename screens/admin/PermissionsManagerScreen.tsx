import React, { useState, useEffect, useMemo } from "react";
import { 
  View, StyleSheet, ActivityIndicator, Alert, ScrollView, Switch, 
  TouchableOpacity, Platform, Modal, Pressable, TextInput
} from "react-native";
import { ThemedText } from "@/components/ThemedText";
import { useTheme } from "@/hooks/useTheme";
import { Spacing, BorderRadius } from "@/constants/theme";
import { supabase } from "@/lib/supabase";
import { Picker } from "@react-native-picker/picker";
import Feather from "@expo/vector-icons/Feather";

export default function PermissionsManagerScreen() {
  const { theme } = useTheme();
  const [loading, setLoading] = useState(true);
  const [users, setUsers] = useState<any[]>([]);
  const [offices, setOffices] = useState<any[]>([]);
  const [departments, setDepartments] = useState<string[]>([]);
  
  const [permissions, setPermissions] = useState<any[]>([]);
  
  const [activeTarget, setActiveTarget] = useState<any>(null);
  
  // Array of { permission: string, scope: string, scope_id: string }
  const [userGrants, setUserGrants] = useState<any[]>([]);
  const [searchQuery, setSearchQuery] = useState("");

  // Modal State
  const [scopeModalVisible, setScopeModalVisible] = useState(false);
  const [activePermConfig, setActivePermConfig] = useState<any>(null);
  const [configScopeType, setConfigScopeType] = useState("GLOBAL");
  const [configScopeId, setConfigScopeId] = useState("");

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    setLoading(true);
    try {
      const [usersRes, permsRes, officesRes, deptRes] = await Promise.all([
        supabase.from("profiles").select("id, name, role, employee_number, department").order("name"),
        supabase.from("permissions").select("*"),
        supabase.from("offices").select("id, name"),
        supabase.from("profiles").select("department").not("department", "is", null)
      ]);

      if (usersRes.data) setUsers(usersRes.data);
      if (permsRes.data) setPermissions(permsRes.data);
      if (officesRes.data) setOffices(officesRes.data);
      if (deptRes.data) {
        const uniqueDepts = Array.from(new Set(deptRes.data.map((d: any) => d.department))).filter(Boolean);
        setDepartments(uniqueDepts as string[]);
      }
    } catch (err) {
      console.error(err);
    }
    setLoading(false);
  };

  const loadTargetPermissions = async (userId: string) => {
    const { data, error } = await supabase
      .from("user_permissions")
      .select("permission, scope, scope_id")
      .eq("user_id", userId)
      .is("revoked_at", null);
      
    if (data) {
      setUserGrants(data);
    } else {
      setUserGrants([]);
    }
  };

  useEffect(() => {
    if (activeTarget) {
      loadTargetPermissions(activeTarget.id);
    } else {
      setUserGrants([]);
    }
  }, [activeTarget]);

  const handleToggleAllow = async (permKey: string, isAllowed: boolean) => {
    if (!activeTarget) return;

    if (isAllowed) {
      // Default to GLOBAL allow if flipping switch
      const { data, error } = await supabase.rpc("admin_grant_permission", {
        p_user_id: activeTarget.id,
        p_permission: permKey,
        p_scope: "GLOBAL",
        p_scope_id: null
      });
      if (error) { console.error("[PermissionsManager] RPC error:", error.message); Alert.alert("Permission Error", error.message); }
    } else {
      const { error } = await supabase.rpc("admin_revoke_permission", {
        p_user_id: activeTarget.id,
        p_permission: permKey
      });
      if (error) { console.error("[PermissionsManager] RPC error:", error.message); Alert.alert("Permission Error", error.message); }
    }
    loadTargetPermissions(activeTarget.id);
  };

  const openConfig = (p: any, existingGrant: any) => {
    if (!activeTarget) return Alert.alert("Select a user first");
    setActivePermConfig(p);
    setConfigScopeType(existingGrant ? existingGrant.scope : "GLOBAL");
    setConfigScopeId(existingGrant && existingGrant.scope_id ? existingGrant.scope_id : "");
    setScopeModalVisible(true);
  };

  const handleSaveConfig = async () => {
    if (!activeTarget) return;
    
    // Revoke old first just in case to avoid duplicates
    await supabase.rpc("admin_revoke_permission", {
      p_user_id: activeTarget.id,
      p_permission: activePermConfig.permission_key
    });
      
    const { data, error } = await supabase.rpc("admin_grant_permission", {
      p_user_id: activeTarget.id,
      p_permission: activePermConfig.permission_key,
      p_scope: configScopeType,
      p_scope_id: configScopeId || null
    });
    
    if (error) { console.error("[PermissionsManager] RPC error:", error.message); Alert.alert("Permission Error", error.message); }
    
    setScopeModalVisible(false);
    loadTargetPermissions(activeTarget.id);
  };

  // Group permissions by module
  const groupedPerms = useMemo(() => {
    const groups: Record<string, any[]> = {};
    permissions.forEach(p => {
      const mod = p.module || "OTHER";
      if (!groups[mod]) groups[mod] = [];
      groups[mod].push(p);
    });
    return groups;
  }, [permissions]);

  if (loading && users.length === 0) {
    return (
      <View style={[styles.container, { justifyContent: "center", alignItems: "center" }]}>
        <ActivityIndicator size="large" color={theme.primary} />
      </View>
    );
  }

  return (
    <View style={[styles.container, { backgroundColor: theme.backgroundRoot }]}>
      <View style={styles.header}>
        <Feather name="shield" size={24} color={theme.text} />
        <ThemedText type="h2" style={{ marginLeft: 12 }}>Permissions & Scope</ThemedText>
      </View>

      <View style={styles.layout}>
        {/* Left Sidebar: Targets */}
        <View style={[styles.sidebar, { borderRightColor: theme.border }]}>
          <View style={styles.searchBox}>
            <Feather name="search" size={16} color={theme.textSecondary} style={{ marginRight: 8 }} />
            <TextInput
              style={[styles.searchInput, { color: theme.text }]}
              placeholder="Search Users..."
              placeholderTextColor={theme.textSecondary}
              value={searchQuery}
              onChangeText={setSearchQuery}
            />
          </View>
          <ScrollView style={{ flex: 1 }}>
            {users.filter(u => u.name.toLowerCase().includes(searchQuery.toLowerCase())).map(u => (
              <TouchableOpacity 
                key={u.id}
                style={[
                  styles.targetItem,
                  activeTarget?.id === u.id && { backgroundColor: theme.primary + "20", borderLeftColor: theme.primary, borderLeftWidth: 3 }
                ]}
                onPress={() => setActiveTarget(u)}
              >
                <ThemedText style={{ fontWeight: activeTarget?.id === u.id ? "bold" : "normal" }}>
                  {u.name}
                </ThemedText>
                <ThemedText type="caption" style={{ color: theme.textSecondary }}>{u.role}</ThemedText>
              </TouchableOpacity>
            ))}
          </ScrollView>
        </View>

        {/* Right Content: Permissions */}
        <ScrollView style={styles.mainContent}>
          {!activeTarget ? (
            <View style={{ flex: 1, justifyContent: "center", alignItems: "center", padding: Spacing.xl * 2 }}>
              <Feather name="arrow-left" size={48} color={theme.border} style={{ marginBottom: Spacing.lg }} />
              <ThemedText type="h3" style={{ color: theme.textSecondary }}>Select a user to configure</ThemedText>
            </View>
          ) : (
            <View style={{ paddingBottom: 100 }}>
              <View style={[styles.targetHeader, { borderBottomColor: theme.border }]}>
                <ThemedText type="h2">{activeTarget.name}</ThemedText>
                <ThemedText type="small" style={{ color: theme.textSecondary }}>Dynamic Scope Assignment</ThemedText>
              </View>

              {Object.keys(groupedPerms).map(module => (
                <View key={module} style={styles.moduleSection}>
                  <ThemedText style={[styles.moduleTitle, { color: theme.primary }]}>{module}</ThemedText>
                  
                  {groupedPerms[module].map((perm) => {
                    const existingGrant = userGrants.find(g => g.permission === perm.permission_key);
                    const isAllowed = !!existingGrant;

                    return (
                      <View key={perm.id} style={[styles.permRow, { borderBottomColor: theme.border }]}>
                        <View style={{ flex: 1 }}>
                          <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                            <ThemedText style={{ fontWeight: "600" }}>{perm.action}</ThemedText>
                            <ThemedText type="small" style={{ color: theme.textSecondary, marginLeft: 8 }}>{perm.permission_key}</ThemedText>
                          </View>
                          <ThemedText type="caption" style={{ color: theme.textSecondary, marginTop: 4 }}>
                            {perm.description}
                          </ThemedText>
                          
                          {isAllowed && (
                            <View style={{ flexDirection: "row", marginTop: 8, alignItems: "center" }}>
                              <View style={[styles.badge, { backgroundColor: theme.backgroundDefault, borderWidth: 1, borderColor: theme.primary }]}>
                                <ThemedText style={{ fontSize: 10, color: theme.primary, fontWeight: "bold" }}>
                                  SCOPE: {existingGrant.scope}
                                </ThemedText>
                              </View>
                              
                              {existingGrant.scope_id && (
                                 <ThemedText type="caption" style={{ color: theme.textSecondary, marginLeft: 6, fontSize: 11 }}>
                                   ID: {existingGrant.scope_id}
                                 </ThemedText>
                              )}
                            </View>
                          )}
                        </View>
                        
                        <View style={{ flexDirection: "row", alignItems: "center" }}>
                          <TouchableOpacity 
                            style={[styles.configBtn, { borderColor: theme.border }]}
                            onPress={() => openConfig(perm, existingGrant)}
                          >
                            <Feather name="settings" size={16} color={theme.textSecondary} />
                          </TouchableOpacity>
                          
                          <Switch 
                            value={isAllowed} 
                            onValueChange={(val) => handleToggleAllow(perm.permission_key, val)} 
                            trackColor={{ false: theme.border, true: theme.primary + "80" }}
                            thumbColor={isAllowed ? theme.primary : "#f4f3f4"}
                          />
                        </View>
                      </View>
                    );
                  })}
                </View>
              ))}
            </View>
          )}
        </ScrollView>

        {/* Scope Configuration Modal */}
        <Modal visible={scopeModalVisible} transparent animationType="slide">
          <View style={styles.modalOverlay}>
            <View style={[styles.modalContent, { backgroundColor: theme.backgroundDefault }]}>
              <View style={[styles.modalHeader, { borderBottomColor: theme.border }]}>
                <ThemedText type="h3">Configure Scope</ThemedText>
                <TouchableOpacity onPress={() => setScopeModalVisible(false)}>
                  <Feather name="x" size={24} color={theme.text} />
                </TouchableOpacity>
              </View>
              
              {activePermConfig && (
                <ScrollView style={{ padding: Spacing.xl }}>
                  <ThemedText type="small" style={{ color: theme.textSecondary, marginBottom: 4 }}>Permission</ThemedText>
                  <ThemedText style={{ fontWeight: "bold", fontSize: 16, marginBottom: Spacing.xl }}>{activePermConfig.permission_key}</ThemedText>
                  
                  <ThemedText type="small" style={{ color: theme.textSecondary, marginBottom: 8 }}>Scope Type</ThemedText>
                  <View style={[styles.pickerWrapper, { backgroundColor: theme.backgroundSecondary, marginBottom: Spacing.xl }]}>
                    <Picker dropdownIconColor={theme.text} itemStyle={{ color: theme.text }} selectedValue={configScopeType} onValueChange={setConfigScopeType} style={{ color: theme.text, height: Platform.OS === "web" ? 40 : undefined, outline: "none", borderWidth: 0, backgroundColor: theme.backgroundSecondary } as any}>
                      <Picker.Item label="GLOBAL (All Data)" value="GLOBAL" />
                      <Picker.Item label="OFFICE (Location Specific)" value="OFFICE" />
                      <Picker.Item label="DEPARTMENT" value="DEPARTMENT" />
                      <Picker.Item label="TEAM (Team members only)" value="TEAM" />
                      <Picker.Item label="SELF (Only own data)" value="SELF" />
                    </Picker>
                  </View>

                  {["OFFICE", "TEAM"].includes(configScopeType) && (
                    <>
                      <ThemedText type="small" style={{ color: theme.textSecondary, marginBottom: 8 }}>Target Resource ID (Optional)</ThemedText>
                      <TextInput
                        style={[styles.searchInput, { color: theme.text, backgroundColor: theme.backgroundSecondary, marginBottom: Spacing.xl, height: 40, paddingHorizontal: 10 }]}
                        placeholder="Enter UUID for specific team/office..."
                        placeholderTextColor={theme.textSecondary}
                        value={configScopeId}
                        onChangeText={setConfigScopeId}
                      />
                    </>
                  )}
                  
                  <Pressable style={[styles.saveBtn, { backgroundColor: theme.primary }]} onPress={handleSaveConfig}>
                    <Feather name="check" size={18} color="#fff" />
                    <ThemedText style={{ color: "#fff", fontWeight: "bold", marginLeft: 8 }}>Apply Permission & Scope</ThemedText>
                  </Pressable>
                </ScrollView>
              )}
            </View>
          </View>
        </Modal>

      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: {
    flexDirection: "row",
    alignItems: "center",
    padding: Spacing.lg,
    paddingTop: Platform.OS === "ios" ? 50 : Spacing.xl,
    paddingBottom: Spacing.xl,
  },
  layout: { flex: 1, flexDirection: Platform.OS === "web" ? "row" : "column" },
  sidebar: {
    width: Platform.OS === "web" ? 300 : "100%",
    height: Platform.OS === "web" ? "100%" : 200,
    borderRightWidth: Platform.OS === "web" ? 1 : 0,
    borderBottomWidth: Platform.OS === "web" ? 0 : 1,
  },
  mainContent: { flex: 1, padding: Spacing.lg },
  searchBox: { flexDirection: "row", alignItems: "center", padding: Spacing.md, borderBottomWidth: 1, borderBottomColor: "#eee" },
  searchInput: { flex: 1, height: 36, outline: "none" } as any,
  targetItem: { padding: Spacing.md, paddingHorizontal: Spacing.lg, borderBottomWidth: 1, borderBottomColor: "#eee" },
  targetHeader: { paddingBottom: Spacing.lg, marginBottom: Spacing.lg, borderBottomWidth: 1 },
  moduleSection: { marginBottom: Spacing.xl * 2 },
  moduleTitle: { fontWeight: "bold", letterSpacing: 1, marginBottom: Spacing.md, fontSize: 12 },
  permRow: { flexDirection: "row", paddingVertical: Spacing.lg, borderBottomWidth: StyleSheet.hairlineWidth },
  badge: { paddingHorizontal: 6, paddingVertical: 2, borderRadius: BorderRadius.sm },
  configBtn: { padding: 6, borderRadius: BorderRadius.sm, borderWidth: 1, marginRight: 12 },
  modalOverlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.5)", justifyContent: "center", alignItems: "center" },
  modalContent: { width: "90%", maxWidth: 500, maxHeight: "90%", borderRadius: BorderRadius.lg, overflow: "hidden" },
  modalHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", padding: Spacing.lg, borderBottomWidth: 1 },
  pickerWrapper: { borderRadius: BorderRadius.md, overflow: "hidden" },
  saveBtn: { flexDirection: "row", justifyContent: "center", alignItems: "center", padding: Spacing.lg, borderRadius: BorderRadius.md, marginTop: Spacing.xl }
});




