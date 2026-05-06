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
} from "react-native";
import { Feather } from "@expo/vector-icons";
import { useFocusEffect } from "@react-navigation/native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { ThemedText } from "@/components/ThemedText";
import { ThemedView } from "@/components/ThemedView";
import { Button } from "@/components/Button";
import { useTheme } from "@/hooks/useTheme";
import { Spacing, BorderRadius, Colors } from "@/constants/theme";
import Spacer from "@/components/Spacer";
import { DepartmentService } from "@/services/department.service";
import { Department, Designation } from "@/types/hrms.types";
import { supabase } from "@/lib/supabase";

type TabType = "departments" | "designations" | "hierarchy";

export default function OrganizationSettingsScreen() {
  const { theme } = useTheme();
  const insets = useSafeAreaInsets();
  const [activeTab, setActiveTab] = useState<TabType>("departments");

  const [departments, setDepartments] = useState<Department[]>([]);
  const [designations, setDesignations] = useState<Designation[]>([]);
  const [hierarchyData, setHierarchyData] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  const [showModal, setShowModal] = useState(false);
  const [modalType, setModalType] = useState<TabType>("departments");
  const [editingItem, setEditingItem] = useState<any>(null);

  // Department form
  const [deptForm, setDeptForm] = useState({
    name: "",
    code: "",
    description: "",
  });

  // Designation form
  const [desigForm, setDesigForm] = useState({
    name: "",
    code: "",
    department_id: "",
    level: "1",
    description: "",
  });

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const [deptsRes, desigsRes, profilesRes] = await Promise.all([
        DepartmentService.getAll(),
        DepartmentService.getAllDesignations(),
        supabase
          .from("profiles")
          .select("id, name, role, reporting_manager_id, department_id, designation_id, is_active")
          .eq("is_active", true)
          .order("name"),
      ]);
      setDepartments(deptsRes);
      setDesignations(desigsRes);
      setHierarchyData(profilesRes.data || []);
    } catch (err) {
      console.error("Error loading org data:", err);
    }
    setLoading(false);
  }, []);

  useFocusEffect(
    useCallback(() => {
      loadData();
    }, [loadData]),
  );

  const openAddModal = (type: TabType) => {
    setModalType(type);
    setEditingItem(null);
    if (type === "departments") {
      setDeptForm({ name: "", code: "", description: "" });
    } else {
      setDesigForm({ name: "", code: "", department_id: "", level: "1", description: "" });
    }
    setShowModal(true);
  };

  const openEditModal = (item: any, type: TabType) => {
    setModalType(type);
    setEditingItem(item);
    if (type === "departments") {
      setDeptForm({
        name: item.name || "",
        code: item.code || "",
        description: item.description || "",
      });
    } else {
      setDesigForm({
        name: item.name || "",
        code: item.code || "",
        department_id: item.department_id || "",
        level: String(item.level || "1"),
        description: item.description || "",
      });
    }
    setShowModal(true);
  };

  const handleSave = async () => {
    try {
      if (modalType === "departments") {
        if (!deptForm.name.trim()) {
          Alert.alert("Error", "Department name is required");
          return;
        }
        if (editingItem) {
          await DepartmentService.update(editingItem.id, deptForm);
          Alert.alert("Success", "Department updated");
        } else {
          await DepartmentService.create(deptForm);
          Alert.alert("Success", "Department created");
        }
      } else {
        if (!desigForm.name.trim()) {
          Alert.alert("Error", "Designation name is required");
          return;
        }
        const payload = {
          ...desigForm,
          level: parseInt(desigForm.level, 10),
        };
        if (editingItem) {
          await DepartmentService.updateDesignation(editingItem.id, payload);
          Alert.alert("Success", "Designation updated");
        } else {
          await DepartmentService.createDesignation(payload);
          Alert.alert("Success", "Designation created");
        }
      }
      setShowModal(false);
      loadData();
    } catch (err: any) {
      Alert.alert("Error", err.message || "Failed to save");
    }
  };

  const handleDelete = (item: any, type: TabType) => {
    Alert.alert(
      "Confirm Delete",
      `Are you sure you want to delete "${item.name}"?`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete",
          style: "destructive",
          onPress: async () => {
            try {
              if (type === "departments") {
                await DepartmentService.softDelete(item.id);
              } else {
                await DepartmentService.softDeleteDesignation(item.id);
              }
              loadData();
            } catch (err: any) {
              Alert.alert("Error", err.message || "Failed to delete");
            }
          },
        },
      ],
    );
  };

  const renderDepartment = ({ item }: { item: Department }) => (
    <View style={[styles.card, { backgroundColor: theme.backgroundDefault }]}>
      <View style={styles.cardHeader}>
        <View style={styles.cardInfo}>
          <ThemedText type="body" style={styles.cardTitle}>{item.name}</ThemedText>
          {item.code && (
            <ThemedText type="caption" style={{ color: theme.textSecondary }}>
              Code: {item.code}
            </ThemedText>
          )}
          {item.description && (
            <ThemedText type="caption" style={{ color: theme.textSecondary }} numberOfLines={2}>
              {item.description}
            </ThemedText>
          )}
        </View>
        <View style={styles.cardActions}>
          <Pressable
            style={[styles.actionBtn, { backgroundColor: theme.backgroundRoot }]}
            onPress={() => openEditModal(item, "departments")}
          >
            <Feather name="edit-2" size={16} color={Colors.light.info} />
          </Pressable>
          <Pressable
            style={[styles.actionBtn, { backgroundColor: theme.backgroundRoot }]}
            onPress={() => handleDelete(item, "departments")}
          >
            <Feather name="trash-2" size={16} color={Colors.light.error} />
          </Pressable>
        </View>
      </View>
    </View>
  );

  const renderDesignation = ({ item }: { item: Designation }) => (
    <View style={[styles.card, { backgroundColor: theme.backgroundDefault }]}>
      <View style={styles.cardHeader}>
        <View style={styles.cardInfo}>
          <ThemedText type="body" style={styles.cardTitle}>{item.name}</ThemedText>
          <ThemedText type="caption" style={{ color: theme.textSecondary }}>
            Level {item.level} • {(item as any).department_name || "No Department"}
          </ThemedText>
          {item.code && (
            <ThemedText type="caption" style={{ color: theme.textSecondary }}>
              Code: {item.code}
            </ThemedText>
          )}
        </View>
        <View style={styles.cardActions}>
          <Pressable
            style={[styles.actionBtn, { backgroundColor: theme.backgroundRoot }]}
            onPress={() => openEditModal(item, "designations")}
          >
            <Feather name="edit-2" size={16} color={Colors.light.info} />
          </Pressable>
          <Pressable
            style={[styles.actionBtn, { backgroundColor: theme.backgroundRoot }]}
            onPress={() => handleDelete(item, "designations")}
          >
            <Feather name="trash-2" size={16} color={Colors.light.error} />
          </Pressable>
        </View>
      </View>
    </View>
  );

  return (
    <View style={[styles.container, { backgroundColor: theme.backgroundRoot }]}>
      {/* Tabs */}
      <View style={styles.tabRow}>
        {(["departments", "designations", "hierarchy"] as TabType[]).map((tab) => (
          <Pressable
            key={tab}
            style={[styles.tab, activeTab === tab && { backgroundColor: theme.primary }]}
            onPress={() => setActiveTab(tab)}
          >
            <ThemedText
              type="caption"
              style={{ color: activeTab === tab ? "#FFFFFF" : theme.text, fontWeight: "600" }}
            >
              {tab === "departments" ? "Departments" : tab === "designations" ? "Designations" : "Hierarchy"}
            </ThemedText>
          </Pressable>
        ))}
      </View>

      <Spacer height={Spacing.md} />

      {/* Add Button — only for dept/desig tabs */}
      {activeTab !== "hierarchy" && (
        <Pressable
          style={[styles.addButton, { backgroundColor: Colors.light.primary }]}
          onPress={() => openAddModal(activeTab as "departments" | "designations")}
        >
          <Feather name="plus" size={18} color="#FFFFFF" />
          <ThemedText style={styles.addButtonText}>
            Add {activeTab === "departments" ? "Department" : "Designation"}
          </ThemedText>
        </Pressable>
      )}

      <Spacer height={Spacing.md} />

      {/* List */}
      {loading ? (
        <View style={styles.centered}>
          <ActivityIndicator color={theme.primary} />
        </View>
      ) : activeTab === "departments" ? (
        <FlatList
          data={departments}
          keyExtractor={(item) => item.id}
          renderItem={renderDepartment}
          contentContainerStyle={styles.list}
          showsVerticalScrollIndicator={false}
          ListEmptyComponent={
            <View style={styles.centered}>
              <Feather name="folder" size={40} color={theme.textSecondary} />
              <Spacer height={Spacing.sm} />
              <ThemedText type="caption" style={{ color: theme.textSecondary }}>No departments found</ThemedText>
            </View>
          }
        />
      ) : activeTab === "designations" ? (
        <FlatList
          data={designations}
          keyExtractor={(item) => item.id}
          renderItem={renderDesignation}
          contentContainerStyle={styles.list}
          showsVerticalScrollIndicator={false}
          ListEmptyComponent={
            <View style={styles.centered}>
              <Feather name="award" size={40} color={theme.textSecondary} />
              <Spacer height={Spacing.sm} />
              <ThemedText type="caption" style={{ color: theme.textSecondary }}>No designations found</ThemedText>
            </View>
          }
        />
      ) : (
        <HierarchyView
          employees={hierarchyData}
          departments={departments}
          designations={designations}
          theme={theme}
        />
      )}

      {/* Modal */}
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
                {editingItem ? "Edit" : "Add"}{" "}
                {modalType === "departments" ? "Department" : "Designation"}
              </ThemedText>
              <Pressable onPress={() => setShowModal(false)}>
                <Feather name="x" size={24} color={theme.text} />
              </Pressable>
            </View>

            <ScrollView style={styles.modalContent}>
              {modalType === "departments" ? (
                <>
                  <ThemedText type="small" style={styles.inputLabel}>Name *</ThemedText>
                  <TextInput
                    style={[styles.input, { backgroundColor: theme.backgroundSecondary, color: theme.text }]}
                    value={deptForm.name}
                    onChangeText={(t) => setDeptForm({ ...deptForm, name: t })}
                    placeholder="e.g., Human Resources"
                    placeholderTextColor={theme.textSecondary}
                  />
                  <Spacer height={Spacing.md} />

                  <ThemedText type="small" style={styles.inputLabel}>Code</ThemedText>
                  <TextInput
                    style={[styles.input, { backgroundColor: theme.backgroundSecondary, color: theme.text }]}
                    value={deptForm.code}
                    onChangeText={(t) => setDeptForm({ ...deptForm, code: t })}
                    placeholder="e.g., HR"
                    placeholderTextColor={theme.textSecondary}
                    autoCapitalize="characters"
                  />
                  <Spacer height={Spacing.md} />

                  <ThemedText type="small" style={styles.inputLabel}>Description</ThemedText>
                  <TextInput
                    style={[styles.input, styles.textArea, { backgroundColor: theme.backgroundSecondary, color: theme.text }]}
                    value={deptForm.description}
                    onChangeText={(t) => setDeptForm({ ...deptForm, description: t })}
                    placeholder="Department description"
                    placeholderTextColor={theme.textSecondary}
                    multiline
                    numberOfLines={3}
                  />
                </>
              ) : (
                <>
                  <ThemedText type="small" style={styles.inputLabel}>Name *</ThemedText>
                  <TextInput
                    style={[styles.input, { backgroundColor: theme.backgroundSecondary, color: theme.text }]}
                    value={desigForm.name}
                    onChangeText={(t) => setDesigForm({ ...desigForm, name: t })}
                    placeholder="e.g., Senior Developer"
                    placeholderTextColor={theme.textSecondary}
                  />
                  <Spacer height={Spacing.md} />

                  <ThemedText type="small" style={styles.inputLabel}>Code</ThemedText>
                  <TextInput
                    style={[styles.input, { backgroundColor: theme.backgroundSecondary, color: theme.text }]}
                    value={desigForm.code}
                    onChangeText={(t) => setDesigForm({ ...desigForm, code: t })}
                    placeholder="e.g., SR-DEV"
                    placeholderTextColor={theme.textSecondary}
                    autoCapitalize="characters"
                  />
                  <Spacer height={Spacing.md} />

                  <ThemedText type="small" style={styles.inputLabel}>Department</ThemedText>
                  <View style={[styles.pickerContainer, { backgroundColor: theme.backgroundSecondary }]}>
                    <TextInput
                      style={[styles.input, { backgroundColor: "transparent" }]}
                      value={departments.find((d) => d.id === desigForm.department_id)?.name || ""}
                      placeholder="Select department ID"
                      placeholderTextColor={theme.textSecondary}
                      editable={false}
                    />
                  </View>
                  <View style={{ flexDirection: "row", flexWrap: "wrap", gap: Spacing.xs }}>
                    {departments.map((dept) => (
                      <Pressable
                        key={dept.id}
                        style={[
                          styles.deptChip,
                          {
                            backgroundColor:
                              desigForm.department_id === dept.id
                                ? theme.primary
                                : theme.backgroundSecondary,
                          },
                        ]}
                        onPress={() => setDesigForm({ ...desigForm, department_id: dept.id })}
                      >
                        <ThemedText
                          type="caption"
                          style={{
                            color: desigForm.department_id === dept.id ? "#FFFFFF" : theme.text,
                          }}
                        >
                          {dept.name}
                        </ThemedText>
                      </Pressable>
                    ))}
                  </View>
                  <Spacer height={Spacing.md} />

                  <ThemedText type="small" style={styles.inputLabel}>Level (1=Entry, 7=CXO)</ThemedText>
                  <TextInput
                    style={[styles.input, { backgroundColor: theme.backgroundSecondary, color: theme.text }]}
                    value={desigForm.level}
                    onChangeText={(t) => setDesigForm({ ...desigForm, level: t })}
                    placeholder="1"
                    placeholderTextColor={theme.textSecondary}
                    keyboardType="number-pad"
                  />
                  <Spacer height={Spacing.md} />

                  <ThemedText type="small" style={styles.inputLabel}>Description</ThemedText>
                  <TextInput
                    style={[styles.input, styles.textArea, { backgroundColor: theme.backgroundSecondary, color: theme.text }]}
                    value={desigForm.description}
                    onChangeText={(t) => setDesigForm({ ...desigForm, description: t })}
                    placeholder="Designation description"
                    placeholderTextColor={theme.textSecondary}
                    multiline
                    numberOfLines={3}
                  />
                </>
              )}

              <Spacer height={Spacing.xl} />
              <Button onPress={handleSave}>
                {editingItem ? "Save Changes" : "Create"}
              </Button>
            </ScrollView>
          </ThemedView>
        </View>
      </Modal>
    </View>
  );
}

function HierarchyView({
  employees,
  departments,
  designations,
  theme,
}: {
  employees: any[];
  departments: Department[];
  designations: Designation[];
  theme: any;
}) {
  // Build a map: managerId → direct reports
  const childrenMap = new Map<string | null, any[]>();
  employees.forEach((emp) => {
    const mgr = emp.reporting_manager_id || null;
    if (!childrenMap.has(mgr)) childrenMap.set(mgr, []);
    childrenMap.get(mgr)!.push(emp);
  });

  // Top-level = no manager OR manager not in the list
  const empIds = new Set(employees.map((e) => e.id));
  const roots = employees.filter(
    (e) => !e.reporting_manager_id || !empIds.has(e.reporting_manager_id)
  );

  if (roots.length === 0) {
    return (
      <View style={{ alignItems: "center", paddingVertical: 40 }}>
        <Feather name="git-branch" size={40} color={theme.textSecondary} />
        <Spacer height={Spacing.sm} />
        <ThemedText type="caption" style={{ color: theme.textSecondary }}>
          No hierarchy data. Assign reporting managers to employees.
        </ThemedText>
      </View>
    );
  }

  function renderNode(emp: any, depth: number): React.ReactNode {
    const children = childrenMap.get(emp.id) || [];
    const deptName = departments.find((d) => d.id === emp.department_id)?.name;
    const desigName = designations.find((d) => d.id === emp.designation_id)?.name;
    return (
      <View key={emp.id} style={{ marginLeft: depth * 20 }}>
        <View
          style={[
            hierStyles.node,
            {
              backgroundColor: theme.backgroundDefault,
              borderLeftColor: depth === 0 ? Colors.light.primary : Colors.light.info,
            },
          ]}
        >
          <View style={[hierStyles.avatar, { backgroundColor: Colors.light.primary + "22" }]}>
            <Feather name="user" size={14} color={Colors.light.primary} />
          </View>
          <View style={{ flex: 1 }}>
            <ThemedText type="body" style={{ fontWeight: "700", color: theme.text }}>
              {emp.name}
            </ThemedText>
            <ThemedText type="caption" style={{ color: theme.textSecondary }}>
              {[desigName, deptName].filter(Boolean).join(" · ") || emp.role || ""}
            </ThemedText>
          </View>
          {children.length > 0 && (
            <View style={[hierStyles.badge, { backgroundColor: Colors.light.primary + "22" }]}>
              <ThemedText type="caption" style={{ color: Colors.light.primary, fontWeight: "700" }}>
                {children.length}
              </ThemedText>
            </View>
          )}
        </View>
        {children.map((child) => renderNode(child, depth + 1))}
      </View>
    );
  }

  return (
    <ScrollView showsVerticalScrollIndicator={false} style={{ flex: 1 }}>
      {roots.map((root) => renderNode(root, 0))}
      <Spacer height={Spacing["2xl"]} />
    </ScrollView>
  );
}

const hierStyles = StyleSheet.create({
  node: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.sm,
    padding: Spacing.md,
    borderRadius: BorderRadius.md,
    borderLeftWidth: 3,
    marginBottom: Spacing.sm,
  },
  avatar: {
    width: 30,
    height: 30,
    borderRadius: 15,
    alignItems: "center",
    justifyContent: "center",
  },
  badge: {
    paddingHorizontal: Spacing.sm,
    paddingVertical: 2,
    borderRadius: BorderRadius.full,
    minWidth: 24,
    alignItems: "center",
  },
});

const styles = StyleSheet.create({
  container: {
    flex: 1,
    padding: Spacing.lg,
  },
  tabRow: {
    flexDirection: "row",
    gap: Spacing.sm,
    marginBottom: Spacing.md,
  },
  tab: {
    flex: 1,
    paddingVertical: Spacing.md,
    borderRadius: BorderRadius.md,
    backgroundColor: "rgba(128,128,128,0.1)",
    alignItems: "center",
  },
  addButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: Spacing.md,
    borderRadius: BorderRadius.md,
    gap: Spacing.sm,
  },
  addButtonText: {
    color: "#FFFFFF",
    fontWeight: "600",
    fontSize: 15,
  },
  list: {
    gap: Spacing.md,
    paddingBottom: Spacing.xl,
  },
  card: {
    padding: Spacing.lg,
    borderRadius: BorderRadius.md,
  },
  cardHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
  },
  cardInfo: {
    flex: 1,
  },
  cardTitle: {
    fontWeight: "600",
    marginBottom: Spacing.xs,
  },
  cardActions: {
    flexDirection: "row",
    gap: Spacing.xs,
  },
  actionBtn: {
    width: 32,
    height: 32,
    borderRadius: BorderRadius.sm,
    alignItems: "center",
    justifyContent: "center",
  },
  centered: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: Spacing["3xl"],
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
  input: {
    height: Spacing.inputHeight,
    borderRadius: BorderRadius.sm,
    paddingHorizontal: Spacing.lg,
    fontSize: 16,
  },
  textArea: {
    height: 80,
    textAlignVertical: "top",
    paddingTop: Spacing.md,
  },
  pickerContainer: {
    borderRadius: BorderRadius.sm,
    overflow: "hidden",
    marginBottom: Spacing.xs,
  },
  deptChip: {
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    borderRadius: BorderRadius.sm,
    marginBottom: Spacing.xs,
  },
});

