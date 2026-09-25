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
  const [roles, setRoles] = useState<any[]>([]);
  const [teams, setTeams] = useState<string[]>([]);
  const [offices, setOffices] = useState<any[]>([]);
  
  const [permissions, setPermissions] = useState<any[]>([]);
  
  const [selectedTargetType, setSelectedTargetType] = useState<"USER" | "ROLE">("ROLE");
  const [activeTarget, setActiveTarget] = useState<any>(null);
  
  const [currentOverrides, setCurrentOverrides] = useState<any[]>([]);
  const [inheritedPermissions, setInheritedPermissions] = useState<any[]>([]);
  const [searchQuery, setSearchQuery] = useState("");

  // Modal State
  const [scopeModalVisible, setScopeModalVisible] = useState(false);
  const [activePermConfig, setActivePermConfig] = useState<any>(null);
  const [configScopeType, setConfigScopeType] = useState("ALL");
  const [configScopeId, setConfigScopeId] = useState("");

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    setLoading(true);
    try {
      const [usersRes, rolesRes, permsRes, officesRes, teamRes] = await Promise.all([
        supabase.from("profiles").select("id, name, role, employee_number").order("name"),
        supabase.from("roles").select("id, name").order("name"),
        supabase.from("permissions").select("*"),
        supabase.from("offices").select("id, name"),
        supabase.from("profiles").select("team").not("team", "is", null)
      ]);

      if (permsRes.error) Alert.alert("Permissions Fetch Error", permsRes.error.message);
      
      setUsers(usersRes.data || []);
      setRoles(rolesRes.data || []);
      setPermissions(permsRes.data || []);
      setOffices(officesRes.data || []);
      
      const distinctTeams = Array.from(new Set((teamRes.data || []).map((t: any) => t.team).filter(Boolean)));
      setTeams(distinctTeams as string[]);
    } catch (e) {
      console.error(e);
    }
    setLoading(false);
  };

  useEffect(() => {
    if (activeTarget) {
      loadTargetPermissions();
    } else {
      setCurrentOverrides([]);
      setInheritedPermissions([]);
    }
  }, [activeTarget, selectedTargetType]);

  const loadTargetPermissions = async () => {
    if (!activeTarget) return;
    
    const table = selectedTargetType === "USER" ? "user_permission_overrides" : "role_permissions";
    const col = selectedTargetType === "USER" ? "user_id" : "role_id";
    
    const { data } = await supabase.from(table).select("*").eq(col, activeTarget.id);
    setCurrentOverrides(data || []);

    if (selectedTargetType === "USER" && activeTarget.role) {
      const roleObj = roles.find(r => r.name === activeTarget.role);
      if (roleObj) {
        const { data: inheritedData } = await supabase.from("role_permissions").select("*").eq("role_id", roleObj.id);
        setInheritedPermissions(inheritedData || []);
      } else {
        setInheritedPermissions([]);
      }
    } else {
      setInheritedPermissions([]);
    }
  };

  const groupedPermissions = useMemo(() => {
    const map = new Map<string, any[]>();
    permissions.forEach(p => {
      const mod = p.module.toUpperCase();
      if (!map.has(mod)) map.set(mod, []);
      map.get(mod)!.push(p);
    });
    return Array.from(map.entries()).sort((a, b) => a[0].localeCompare(b[0]));
  }, [permissions]);

  const openConfig = (p: any, existingOverride: any) => {
    if (!activeTarget) return Alert.alert("Select a target first");
    setActivePermConfig(p);
    setConfigScopeType(existingOverride && existingOverride.effect === "ALLOW" ? existingOverride.scope_type : "ALL");
    setConfigScopeId(existingOverride && existingOverride.scope_id ? existingOverride.scope_id : "");
    setScopeModalVisible(true);
  };

  const handleSaveConfig = async () => {
    if (!activeTarget) return;
    const table = selectedTargetType === "USER" ? "user_permission_overrides" : "role_permissions";
    const col = selectedTargetType === "USER" ? "user_id" : "role_id";
    
    await supabase.from(table).delete()
      .eq(col, activeTarget.id)
      .eq("permission_id", activePermConfig.id);
      
    await supabase.from(table).insert({
      [col]: activeTarget.id,
      permission_id: activePermConfig.id,
      effect: "ALLOW",
      scope_type: configScopeType,
      scope_id: configScopeId || null
    });
    
    setScopeModalVisible(false);
    loadTargetPermissions();
  };

  const handleInsertDeny = async (permissionId: string) => {
    if (!activeTarget) return;
    const table = selectedTargetType === "USER" ? "user_permission_overrides" : "role_permissions";
    const col = selectedTargetType === "USER" ? "user_id" : "role_id";
    
    await supabase.from(table).delete()
      .eq(col, activeTarget.id)
      .eq("permission_id", permissionId);
      
    await supabase.from(table).insert({
      [col]: activeTarget.id,
      permission_id: permissionId,
      effect: "DENY",
      scope_type: "ALL" // Scope doesn't matter for DENY but DB requires non-null
    });
    
    loadTargetPermissions();
  };

  const handleRemoveOverride = async (permissionId: string) => {
    if (!activeTarget) return;
    const table = selectedTargetType === "USER" ? "user_permission_overrides" : "role_permissions";
    const col = selectedTargetType === "USER" ? "user_id" : "role_id";
    await supabase.from(table).delete()
      .eq(col, activeTarget.id)
      .eq("permission_id", permissionId);
    loadTargetPermissions();
  };

  const filteredUsers = useMemo(() => {
    const q = searchQuery.toLowerCase();
    return users.filter(u => u.name?.toLowerCase().includes(q) || (u.employee_number && String(u.employee_number).toLowerCase().includes(q)));
  }, [users, searchQuery]);

  const filteredRoles = useMemo(() => {
    const q = searchQuery.toLowerCase();
    return roles.filter(r => r.name?.toLowerCase().includes(q));
  }, [roles, searchQuery]);

  if (loading) return <ActivityIndicator style={{ flex: 1, backgroundColor: theme.backgroundSecondary }} color={theme.primary} />;

  return (
    <View style={{ flex: 1, backgroundColor: theme.backgroundSecondary }}>
      {/* Header */}
      <View style={[styles.header, { backgroundColor: theme.backgroundDefault, borderBottomWidth: 1, borderBottomColor: theme.border }]}>
        <Feather name="shield" size={24} color={theme.primary} />
        <ThemedText type="h2" style={{ color: theme.text, marginLeft: Spacing.sm }}>Access Control</ThemedText>
      </View>

      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: Spacing.lg, paddingBottom: 100 }}>
        
        {/* Segments */}
        <View style={styles.segmentContainer}>
          <TouchableOpacity 
            style={[styles.segment, selectedTargetType === "ROLE" ? { backgroundColor: theme.primary } : { backgroundColor: theme.backgroundDefault }]}
            onPress={() => { setSelectedTargetType("ROLE"); setActiveTarget(null); setSearchQuery(""); }}
          >
            <Feather name="users" size={16} color={selectedTargetType === "ROLE" ? "#fff" : theme.textSecondary} />
            <ThemedText style={{ marginLeft: 8, color: selectedTargetType === "ROLE" ? "#fff" : theme.textSecondary, fontWeight: selectedTargetType === "ROLE" ? "bold" : "normal" }}>Role Defaults</ThemedText>
          </TouchableOpacity>
          <TouchableOpacity 
            style={[styles.segment, selectedTargetType === "USER" ? { backgroundColor: theme.primary } : { backgroundColor: theme.backgroundDefault }]}
            onPress={() => { setSelectedTargetType("USER"); setActiveTarget(null); setSearchQuery(""); }}
          >
            <Feather name="user" size={16} color={selectedTargetType === "USER" ? "#fff" : theme.textSecondary} />
            <ThemedText style={{ marginLeft: 8, color: selectedTargetType === "USER" ? "#fff" : theme.textSecondary, fontWeight: selectedTargetType === "USER" ? "bold" : "normal" }}>User Overrides</ThemedText>
          </TouchableOpacity>
        </View>

        {/* Target Selector */}
        <View style={[styles.card, { backgroundColor: theme.backgroundDefault, borderColor: theme.border }]}>
          {activeTarget ? (
            <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
              <View>
                <ThemedText type="small" style={{ color: theme.textSecondary, marginBottom: 4 }}>
                  {selectedTargetType === "ROLE" ? "Configuring Role:" : "Configuring Employee:"}
                </ThemedText>
                <ThemedText type="h4" style={{ color: theme.primary }}>{activeTarget.name}</ThemedText>
                {selectedTargetType === "USER" && activeTarget.role && (
                   <ThemedText type="caption" style={{ color: theme.textSecondary }}>Inherits permissions from {activeTarget.role} role</ThemedText>
                )}
              </View>
              <TouchableOpacity 
                style={{ padding: Spacing.sm, backgroundColor: theme.backgroundSecondary, borderRadius: BorderRadius.sm }}
                onPress={() => { setActiveTarget(null); setSearchQuery(""); }}
              >
                <Feather name="x" size={18} color={theme.text} />
              </TouchableOpacity>
            </View>
          ) : (
            <View>
              <ThemedText type="small" style={{ color: theme.textSecondary, marginBottom: 8 }}>
                {selectedTargetType === "ROLE" ? "Search and select a Role" : "Search and select an Employee"}
              </ThemedText>
              
              <View style={[styles.searchBar, { backgroundColor: theme.backgroundSecondary }]}>
                <Feather name="search" size={16} color={theme.textSecondary} />
                <TextInput
                  style={{ flex: 1, marginLeft: 8, color: theme.text, height: Platform.OS === "web" ? 36 : undefined, outline: "none" } as any}
                  placeholder={selectedTargetType === "ROLE" ? "Search roles..." : "Search employees..."}
                  placeholderTextColor={theme.textSecondary}
                  value={searchQuery}
                  onChangeText={setSearchQuery}
                  autoFocus={true}
                />
              </View>

              <ScrollView style={{ marginTop: Spacing.sm, maxHeight: 300 }} nestedScrollEnabled={true}>
                {selectedTargetType === "USER" ? (
                  filteredUsers.map(u => (
                    <TouchableOpacity 
                      key={u.id} 
                      style={[styles.searchResultItem, { borderBottomColor: theme.backgroundSecondary }]}
                      onPress={() => setActiveTarget(u)}
                    >
                      <View>
                        <ThemedText style={{ fontWeight: "600" }}>{u.name}</ThemedText>
                        <ThemedText type="caption" style={{ color: theme.textSecondary }}>{u.role || "No Role"}</ThemedText>
                      </View>
                      <Feather name="chevron-right" size={16} color={theme.textSecondary} />
                    </TouchableOpacity>
                  ))
                ) : (
                  filteredRoles.map(r => (
                    <TouchableOpacity 
                      key={r.id} 
                      style={[styles.searchResultItem, { borderBottomColor: theme.backgroundSecondary }]}
                      onPress={() => setActiveTarget(r)}
                    >
                      <ThemedText style={{ fontWeight: "600" }}>{r.name}</ThemedText>
                      <Feather name="chevron-right" size={16} color={theme.textSecondary} />
                    </TouchableOpacity>
                  ))
                )}
              </ScrollView>
            </View>
          )}
        </View>

        {/* Permissions List */}
        {activeTarget ? (
          <View style={{ marginTop: Spacing.xl }}>
            <ThemedText type="h3" style={{ marginBottom: Spacing.lg }}>Permission Catalogue</ThemedText>
            
            {groupedPermissions.map(([moduleName, perms]) => (
              <View key={moduleName} style={[styles.moduleCard, { backgroundColor: theme.backgroundDefault, borderColor: theme.border }]}>
                <View style={[styles.moduleHeader, { borderBottomColor: theme.border, backgroundColor: theme.backgroundSecondary }]}>
                  <Feather name="layers" size={18} color={theme.primary} />
                  <ThemedText type="h4" style={{ marginLeft: Spacing.sm }}>{moduleName}</ThemedText>
                </View>
                
                {perms.map((p, idx) => {
                  const existingOverride = currentOverrides.find(o => o.permission_id === p.id);
                  const inheritedPerm = inheritedPermissions.find(o => o.permission_id === p.id && o.effect === "ALLOW");
                  
                  const isExplicitlyAllowed = existingOverride?.effect === "ALLOW";
                  const isExplicitlyDenied = existingOverride?.effect === "DENY";
                  
                  const isVisuallyOn = isExplicitlyAllowed || (!!inheritedPerm && !isExplicitlyDenied);
                  
                  return (
                    <View key={p.id} style={[styles.permRow, idx < perms.length - 1 && { borderBottomWidth: 1, borderBottomColor: theme.backgroundSecondary }]}>
                      <View style={{ flex: 1, paddingRight: Spacing.md }}>
                        <ThemedText style={{ fontWeight: "600", fontSize: 15 }}>{p.action}</ThemedText>
                        <ThemedText type="caption" style={{ color: theme.textSecondary, marginTop: 2 }}>{p.permission_key}</ThemedText>
                        
                        {(isExplicitlyAllowed || (!!inheritedPerm && !isExplicitlyDenied)) && (
                          <View style={{ flexDirection: "row", alignItems: "center", marginTop: 4 }}>
                            {isExplicitlyAllowed ? (
                              <View style={[styles.badge, { backgroundColor: theme.backgroundDefault, borderWidth: 1, borderColor: theme.primary }]}>
                                <ThemedText style={{ fontSize: 10, color: theme.primary, fontWeight: "bold" }}>
                                  CUSTOM: {existingOverride.scope_type}
                                </ThemedText>
                              </View>
                            ) : (
                              <View style={[styles.badge, { backgroundColor: theme.border }]}>
                                <ThemedText style={{ fontSize: 10, color: theme.textSecondary, fontWeight: "bold" }}>
                                  INHERITED: {inheritedPerm.scope_type}
                                </ThemedText>
                              </View>
                            )}
                            
                            {isExplicitlyAllowed && existingOverride.scope_id && (
                               <ThemedText type="caption" style={{ color: theme.textSecondary, marginLeft: 6, fontSize: 11 }}>
                                 Scoped resource attached
                               </ThemedText>
                            )}
                          </View>
                        )}

                        {isExplicitlyDenied && (
                          <View style={{ flexDirection: "row", alignItems: "center", marginTop: 4 }}>
                             <View style={[styles.badge, { backgroundColor: theme.backgroundDefault, borderWidth: 1, borderColor: "red" }]}>
                               <ThemedText style={{ fontSize: 10, color: "red", fontWeight: "bold" }}>
                                 EXPLICITLY REVOKED
                               </ThemedText>
                             </View>
                          </View>
                        )}
                      </View>
                      
                      <View style={{ flexDirection: "row", alignItems: "center", gap: Spacing.md }}>
                        {isExplicitlyAllowed && (
                           <TouchableOpacity onPress={() => openConfig(p, existingOverride)}>
                             <Feather name="settings" size={18} color={theme.textSecondary} />
                           </TouchableOpacity>
                        )}
                        <Switch 
                          value={isVisuallyOn} 
                          onValueChange={(v) => {
                            if (v) {
                              if (inheritedPerm) handleRemoveOverride(p.id);
                              else openConfig(p, existingOverride);
                            } else {
                              if (inheritedPerm) handleInsertDeny(p.id);
                              else handleRemoveOverride(p.id);
                            }
                          }} 
                          trackColor={{ true: theme.primary }}
                        />
                      </View>
                    </View>
                  );
                })}
              </View>
            ))}
          </View>
        ) : (
          <View style={{ marginTop: 60, alignItems: "center" }}>
            <Feather name="lock" size={48} color={theme.border} />
            <ThemedText type="h4" style={{ marginTop: Spacing.md, color: theme.textSecondary }}>Select a target to manage permissions</ThemedText>
          </View>
        )}
      </ScrollView>

      {/* Scope Configuration Modal */}
      <Modal visible={scopeModalVisible} transparent animationType="slide">
        <View style={styles.modalOverlay}>
          <View style={[styles.modalContent, { backgroundColor: theme.backgroundDefault }]}>
            <View style={[styles.modalHeader, { borderBottomColor: theme.border }]}>
              <ThemedText type="h3">Configure Custom Override</ThemedText>
              <TouchableOpacity onPress={() => setScopeModalVisible(false)}>
                <Feather name="x" size={24} color={theme.text} />
              </TouchableOpacity>
            </View>
            
            {activePermConfig && (
              <ScrollView style={{ padding: Spacing.lg }}>
                <ThemedText type="small" style={{ color: theme.textSecondary, marginBottom: 4 }}>Permission</ThemedText>
                <ThemedText style={{ fontWeight: "bold", fontSize: 16, marginBottom: Spacing.xl }}>{activePermConfig.permission_key}</ThemedText>
                
                <ThemedText type="small" style={{ color: theme.textSecondary, marginBottom: 8 }}>Scope Type</ThemedText>
                <View style={[styles.pickerWrapper, { backgroundColor: theme.backgroundSecondary, marginBottom: Spacing.xl }]}>
                  <Picker dropdownIconColor={theme.text} itemStyle={{ color: theme.text }} selectedValue={configScopeType} onValueChange={setConfigScopeType} style={{ color: theme.text, height: Platform.OS === "web" ? 40 : undefined, outline: "none", borderWidth: 0, backgroundColor: theme.backgroundSecondary } as any}>
                    <Picker.Item label="All (Global Access)" value="ALL" />
                    <Picker.Item label="Team (Subordinates only)" value="TEAM" />
                    <Picker.Item label="Office (Location specific)" value="OFFICE" />
                    <Picker.Item label="Self (Own records only)" value="SELF" />
                  </Picker>
                </View>

                {["TEAM", "OFFICE"].includes(configScopeType) && (
                  <>
                    <ThemedText type="small" style={{ color: theme.textSecondary, marginBottom: 8 }}>Target Resource (Optional)</ThemedText>
                    <View style={[styles.pickerWrapper, { backgroundColor: theme.backgroundSecondary, marginBottom: Spacing.xl }]}>
                      <Picker dropdownIconColor={theme.text} itemStyle={{ color: theme.text }} selectedValue={configScopeId} onValueChange={setConfigScopeId} style={{ color: theme.text, height: Platform.OS === "web" ? 40 : undefined, outline: "none", borderWidth: 0, backgroundColor: theme.backgroundSecondary } as any}>
                        <Picker.Item label="Dynamic (User's own assigned Team/Office)" value="" />
                        {configScopeType === "TEAM" && teams.map((t, i) => <Picker.Item key={i} label={t} value={t} />)}
                        {configScopeType === "OFFICE" && offices.map(o => <Picker.Item key={o.id} label={o.name} value={o.id} />)}
                      </Picker>
                    </View>
                  </>
                )}
                
                <Pressable style={[styles.saveBtn, { backgroundColor: theme.primary }]} onPress={handleSaveConfig}>
                  <Feather name="check" size={18} color="#fff" />
                  <ThemedText style={{ color: "#fff", fontWeight: "bold", marginLeft: 8 }}>Apply Override</ThemedText>
                </Pressable>
              </ScrollView>
            )}
          </View>
        </View>
      </Modal>

    </View>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: "row",
    alignItems: "center",
    padding: Spacing.lg,
    paddingTop: Platform.OS === "ios" ? 50 : Spacing.xl,
    paddingBottom: Spacing.xl,
  },
  segmentContainer: {
    flexDirection: "row",
    gap: Spacing.sm,
    marginBottom: Spacing.xl,
  },
  segment: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: Spacing.md,
    borderRadius: BorderRadius.md,
    ...(Platform.OS === "web" ? { cursor: "pointer" } : {}),
  },
  card: {
    padding: Spacing.lg,
    borderRadius: BorderRadius.md,
    borderWidth: 1,
  },
  searchBar: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: Spacing.md,
    paddingVertical: Platform.OS === "web" ? 0 : Spacing.sm,
    borderRadius: BorderRadius.sm,
    borderWidth: 1,
    borderColor: "transparent",
  },
  searchResultItem: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: Spacing.md,
    borderBottomWidth: 1,
  },
  pickerWrapper: {
    borderRadius: BorderRadius.sm,
    overflow: "hidden",
  },
  moduleCard: {
    borderRadius: BorderRadius.md,
    borderWidth: 1,
    marginBottom: Spacing.lg,
    overflow: "hidden"
  },
  moduleHeader: {
    flexDirection: "row",
    alignItems: "center",
    padding: Spacing.md,
    borderBottomWidth: 1,
  },
  permRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    padding: Spacing.md,
  },
  badge: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 10,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.5)",
    justifyContent: "flex-end"
  },
  modalContent: {
    borderTopLeftRadius: BorderRadius.xl,
    borderTopRightRadius: BorderRadius.xl,
    minHeight: "60%"
  },
  modalHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    padding: Spacing.lg,
    borderBottomWidth: 1,
  },
  saveBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    padding: Spacing.md,
    borderRadius: BorderRadius.md,
    marginTop: Spacing.md,
    marginBottom: 40
  }
});
