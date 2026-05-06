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
import { supabase } from "@/lib/supabase";

interface Task {
  id: string;
  title: string;
  description: string;
  status: string;
  priority: string;
  assigned_to_name: string;
  deadline: string;
  created_at: string;
}

interface Employee {
  id: string;
  name: string;
}

const PRIORITY_COLORS: Record<string, string> = {
  high: Colors.light.error,
  medium: Colors.light.warning,
  low: Colors.light.success,
};

const STATUS_COLORS: Record<string, string> = {
  pending: Colors.light.warning,
  in_progress: Colors.light.info,
  completed: Colors.light.success,
  cancelled: Colors.light.error,
};

const EMPTY_FORM = {
  title: "",
  description: "",
  priority: "medium",
  deadline: new Date(Date.now() + 86400000).toISOString().split("T")[0],
  assigned_to: "",
};

export default function TaskProjectControlScreen() {
  const { theme } = useTheme();
  const insets = useSafeAreaInsets();
  const [tasks, setTasks] = useState<Task[]>([]);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<"pending" | "in_progress" | "completed">(
    "pending",
  );
  const [showModal, setShowModal] = useState(false);
  const [showEmployeePicker, setShowEmployeePicker] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [saving, setSaving] = useState(false);

  const loadTasks = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from("tasks")
      .select(
        `id, title, description, status, priority, due_date, created_at, profiles!tasks_assigned_to_fkey(name)`,
      )
      .eq("status", filter)
      .order("due_date", { ascending: true });

    if (error) {
      console.error("Error loading tasks:", error);
    } else {
      setTasks(
        (data || []).map((t: any) => ({
          id: t.id,
          title: t.title,
          description: t.description,
          status: t.status,
          priority: t.priority,
          assigned_to_name: t.profiles?.name || "Unassigned",
          deadline: t.due_date,
          created_at: t.created_at,
        })),
      );
    }
    setLoading(false);
  }, [filter]);

  const loadEmployees = useCallback(async () => {
    const { data } = await supabase
      .from("profiles")
      .select("id, name")
      .eq("is_active", true)
      .order("name");
    setEmployees(data || []);
  }, []);

  useFocusEffect(
    useCallback(() => {
      loadTasks();
      loadEmployees();
    }, [loadTasks, loadEmployees]),
  );

  const handleCreate = async () => {
    if (!form.title.trim()) {
      Alert.alert("Required", "Task title is required");
      return;
    }
    if (!form.assigned_to) {
      Alert.alert("Required", "Please assign the task to an employee");
      return;
    }
    setSaving(true);
    const { error } = await supabase.from("tasks").insert({
      title: form.title,
      description: form.description,
      priority: form.priority,
      due_date: form.deadline,
      status: "pending",
      assigned_to: form.assigned_to || null,
    });
    setSaving(false);
    if (error) Alert.alert("Error", "Failed to create task: " + error.message);
    else {
      setShowModal(false);
      setForm(EMPTY_FORM);
      loadTasks();
      const emp = employees.find((e) => e.id === form.assigned_to);
      Alert.alert("✅ Task Created", `"${form.title}" assigned to ${emp?.name || "employee"}.`);
    }
  };

  const handleStatusChange = async (id: string, newStatus: string) => {
    const { error } = await supabase.from("tasks").update({ status: newStatus }).eq("id", id);
    if (error) Alert.alert("Error", "Failed to update task");
    else {
      loadTasks();
      if (newStatus === "completed") Alert.alert("✅ Task Completed", "Task marked as completed.");
      else if (newStatus === "in_progress") Alert.alert("▶️ Started", "Task is now in progress.");
    }
  };

  const selectedEmployeeName =
    employees.find((e) => e.id === form.assigned_to)?.name || "Select Employee";

  const renderItem = ({ item }: { item: Task }) => {
    const isOverdue =
      item.deadline &&
      new Date(item.deadline) < new Date() &&
      item.status !== "completed";
    return (
      <View style={[styles.card, { backgroundColor: theme.backgroundDefault }]}>
        <View style={styles.cardHeader}>
          <View style={{ flex: 1 }}>
            <ThemedText type="body" style={{ fontWeight: "600" }}>
              {item.title}
            </ThemedText>
            <ThemedText type="caption" style={{ color: theme.textSecondary }}>
              {item.assigned_to_name}
            </ThemedText>
            {item.deadline ? (
              <ThemedText
                type="caption"
                style={{
                  color: isOverdue ? Colors.light.error : theme.textSecondary,
                }}
              >
                Due: {new Date(item.deadline).toLocaleDateString()}
              </ThemedText>
            ) : null}
          </View>
          <View style={{ alignItems: "flex-end", gap: Spacing.xs }}>
            <View
              style={[
                styles.badge,
                {
                  backgroundColor:
                    (PRIORITY_COLORS[item.priority] || Colors.light.info) +
                    "20",
                },
              ]}
            >
              <ThemedText
                type="caption"
                style={{
                  color: PRIORITY_COLORS[item.priority] || Colors.light.info,
                  fontWeight: "600",
                }}
              >
                {item.priority?.toUpperCase()}
              </ThemedText>
            </View>
            <View
              style={[
                styles.badge,
                {
                  backgroundColor:
                    (STATUS_COLORS[item.status] || Colors.light.info) + "20",
                },
              ]}
            >
              <ThemedText
                type="caption"
                style={{
                  color: STATUS_COLORS[item.status] || Colors.light.info,
                  fontWeight: "600",
                }}
              >
                {item.status?.replace("_", " ").toUpperCase()}
              </ThemedText>
            </View>
          </View>
        </View>
        {item.description ? (
          <ThemedText
            type="small"
            style={{ color: theme.textSecondary, marginTop: Spacing.xs }}
            numberOfLines={2}
          >
            {item.description}
          </ThemedText>
        ) : null}
        {item.status !== "completed" && (
          <View style={styles.actions}>
            {item.status === "pending" && (
              <Pressable
                style={[
                  styles.actionBtn,
                  { backgroundColor: Colors.light.info + "20" },
                ]}
                onPress={() => handleStatusChange(item.id, "in_progress")}
              >
                <Feather name="play" size={14} color={Colors.light.info} />
                <ThemedText
                  type="caption"
                  style={{ color: Colors.light.info, fontWeight: "600" }}
                >
                  Start
                </ThemedText>
              </Pressable>
            )}
            <Pressable
              style={[
                styles.actionBtn,
                { backgroundColor: Colors.light.success + "20" },
              ]}
              onPress={() => handleStatusChange(item.id, "completed")}
            >
              <Feather name="check" size={14} color={Colors.light.success} />
              <ThemedText
                type="caption"
                style={{ color: Colors.light.success, fontWeight: "600" }}
              >
                Complete
              </ThemedText>
            </Pressable>
          </View>
        )}
      </View>
    );
  };

  return (
    <View style={styles.container}>
      <View style={styles.topRow}>
        <View style={styles.filters}>
          {(["pending", "in_progress", "completed"] as const).map((f) => (
            <Pressable
              key={f}
              style={[
                styles.filterChip,
                {
                  backgroundColor:
                    filter === f ? theme.primary : theme.backgroundDefault,
                },
              ]}
              onPress={() => setFilter(f)}
            >
              <ThemedText
                type="caption"
                style={{
                  color: filter === f ? "#FFF" : theme.text,
                  fontWeight: filter === f ? "600" : "400",
                  fontSize: 11,
                }}
              >
                {f === "in_progress"
                  ? "In Progress"
                  : f.charAt(0).toUpperCase() + f.slice(1)}
              </ThemedText>
            </Pressable>
          ))}
        </View>
        <Pressable
          style={[styles.addBtn, { backgroundColor: Colors.light.primary }]}
          onPress={() => setShowModal(true)}
        >
          <Feather name="plus" size={18} color="#FFF" />
        </Pressable>
      </View>

      <Spacer height={Spacing.md} />

      {loading ? (
        <View style={styles.centered}>
          <ThemedText>Loading...</ThemedText>
        </View>
      ) : tasks.length === 0 ? (
        <View style={styles.centered}>
          <Feather name="check-square" size={40} color={theme.textSecondary} />
          <Spacer height={Spacing.md} />
          <ThemedText style={{ color: theme.textSecondary }}>
            No {filter.replace("_", " ")} tasks
          </ThemedText>
        </View>
      ) : (
        <FlatList
          data={tasks}
          keyExtractor={(item) => item.id}
          renderItem={renderItem}
          contentContainerStyle={{ gap: Spacing.md }}
          showsVerticalScrollIndicator={false}
        />
      )}

      {/* Create Task Modal */}
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
              <ThemedText type="h3">Create Task</ThemedText>
              <Pressable onPress={() => setShowModal(false)}>
                <Feather name="x" size={24} color={theme.text} />
              </Pressable>
            </View>
            <ScrollView
              style={styles.modalContent}
              keyboardShouldPersistTaps="handled"
            >
              <ThemedText type="small" style={styles.inputLabel}>
                Title *
              </ThemedText>
              <TextInput
                style={[
                  styles.input,
                  {
                    backgroundColor: theme.backgroundSecondary,
                    color: theme.text,
                  },
                ]}
                value={form.title}
                onChangeText={(t) => setForm({ ...form, title: t })}
                placeholder="Task title"
                placeholderTextColor={theme.textSecondary}
              />
              <Spacer height={Spacing.md} />

              <ThemedText type="small" style={styles.inputLabel}>
                Description
              </ThemedText>
              <TextInput
                style={[
                  styles.input,
                  styles.textArea,
                  {
                    backgroundColor: theme.backgroundSecondary,
                    color: theme.text,
                  },
                ]}
                value={form.description}
                onChangeText={(t) => setForm({ ...form, description: t })}
                placeholder="Task description"
                placeholderTextColor={theme.textSecondary}
                multiline
                numberOfLines={3}
              />
              <Spacer height={Spacing.md} />

              <ThemedText type="small" style={styles.inputLabel}>
                Assign To
              </ThemedText>
              <Pressable
                style={[
                  styles.input,
                  styles.pickerBtn,
                  { backgroundColor: theme.backgroundSecondary },
                ]}
                onPress={() => setShowEmployeePicker(true)}
              >
                <ThemedText
                  style={{
                    color: form.assigned_to ? theme.text : theme.textSecondary,
                  }}
                >
                  {selectedEmployeeName}
                </ThemedText>
                <Feather
                  name="chevron-down"
                  size={16}
                  color={theme.textSecondary}
                />
              </Pressable>
              <Spacer height={Spacing.md} />

              <ThemedText type="small" style={styles.inputLabel}>
                Priority
              </ThemedText>
              <View style={styles.priorityRow}>
                {(["low", "medium", "high"] as const).map((p) => (
                  <Pressable
                    key={p}
                    style={[
                      styles.priorityOption,
                      {
                        backgroundColor:
                          form.priority === p
                            ? PRIORITY_COLORS[p]
                            : theme.backgroundSecondary,
                      },
                    ]}
                    onPress={() => setForm({ ...form, priority: p })}
                  >
                    <ThemedText
                      type="caption"
                      style={{
                        color: form.priority === p ? "#FFF" : theme.text,
                        fontWeight: "600",
                      }}
                    >
                      {p.toUpperCase()}
                    </ThemedText>
                  </Pressable>
                ))}
              </View>
              <Spacer height={Spacing.md} />

              <ThemedText type="small" style={styles.inputLabel}>
                Deadline (YYYY-MM-DD)
              </ThemedText>
              <TextInput
                style={[
                  styles.input,
                  {
                    backgroundColor: theme.backgroundSecondary,
                    color: theme.text,
                  },
                ]}
                value={form.deadline}
                onChangeText={(t) => setForm({ ...form, deadline: t })}
                placeholder="YYYY-MM-DD"
                placeholderTextColor={theme.textSecondary}
              />
              <Spacer height={Spacing.xl} />
              <Button onPress={handleCreate}>
                {saving ? "Creating..." : "Create Task"}
              </Button>
            </ScrollView>
          </ThemedView>
        </View>
      </Modal>

      {/* Employee Picker Modal */}
      <Modal
        visible={showEmployeePicker}
        animationType="slide"
        transparent
        onRequestClose={() => setShowEmployeePicker(false)}
      >
        <View style={styles.modalOverlay}>
          <ThemedView
            style={[
              styles.modalContainer,
              { paddingBottom: insets.bottom + Spacing.lg },
            ]}
          >
            <View style={styles.modalHeader}>
              <ThemedText type="h3">Select Employee</ThemedText>
              <Pressable onPress={() => setShowEmployeePicker(false)}>
                <Feather name="x" size={24} color={theme.text} />
              </Pressable>
            </View>
            <ScrollView>
              <Pressable
                style={[
                  styles.employeeItem,
                  { borderBottomColor: theme.border },
                ]}
                onPress={() => {
                  setForm({ ...form, assigned_to: "" });
                  setShowEmployeePicker(false);
                }}
              >
                <ThemedText style={{ color: theme.textSecondary }}>
                  Unassigned
                </ThemedText>
              </Pressable>
              {employees.map((emp) => (
                <Pressable
                  key={emp.id}
                  style={[
                    styles.employeeItem,
                    {
                      borderBottomColor: theme.border,
                      backgroundColor:
                        form.assigned_to === emp.id
                          ? theme.primary + "20"
                          : "transparent",
                    },
                  ]}
                  onPress={() => {
                    setForm({ ...form, assigned_to: emp.id });
                    setShowEmployeePicker(false);
                  }}
                >
                  <ThemedText
                    style={{
                      color:
                        form.assigned_to === emp.id
                          ? theme.primary
                          : theme.text,
                      fontWeight: form.assigned_to === emp.id ? "600" : "400",
                    }}
                  >
                    {emp.name}
                  </ThemedText>
                  {form.assigned_to === emp.id && (
                    <Feather name="check" size={16} color={theme.primary} />
                  )}
                </Pressable>
              ))}
            </ScrollView>
          </ThemedView>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: Spacing.lg },
  topRow: { flexDirection: "row", alignItems: "center", gap: Spacing.md },
  filters: { flex: 1, flexDirection: "row", gap: Spacing.sm },
  filterChip: {
    paddingHorizontal: Spacing.sm,
    paddingVertical: Spacing.sm,
    borderRadius: BorderRadius.full,
  },
  addBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
  },
  centered: { flex: 1, alignItems: "center", justifyContent: "center" },
  card: { padding: Spacing.lg, borderRadius: BorderRadius.md },
  cardHeader: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: Spacing.md,
  },
  badge: {
    paddingHorizontal: Spacing.sm,
    paddingVertical: Spacing.xs,
    borderRadius: BorderRadius.xs,
  },
  actions: { flexDirection: "row", gap: Spacing.md, marginTop: Spacing.md },
  actionBtn: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: Spacing.xs,
    paddingVertical: Spacing.sm,
    borderRadius: BorderRadius.sm,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.5)",
    justifyContent: "flex-end",
  },
  modalContainer: {
    borderTopLeftRadius: BorderRadius.xl,
    borderTopRightRadius: BorderRadius.xl,
    maxHeight: "85%",
  },
  modalHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    padding: Spacing.lg,
    borderBottomWidth: 1,
    borderBottomColor: "rgba(128,128,128,0.2)",
  },
  modalContent: { padding: Spacing.lg },
  inputLabel: { marginBottom: Spacing.xs, fontWeight: "600" },
  input: {
    height: Spacing.inputHeight,
    borderRadius: BorderRadius.sm,
    paddingHorizontal: Spacing.lg,
    fontSize: 16,
  },
  pickerBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingRight: Spacing.lg,
  },
  textArea: { height: 90, textAlignVertical: "top", paddingTop: Spacing.md },
  priorityRow: { flexDirection: "row", gap: Spacing.sm },
  priorityOption: {
    flex: 1,
    paddingVertical: Spacing.md,
    borderRadius: BorderRadius.sm,
    alignItems: "center",
  },
  employeeItem: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    padding: Spacing.lg,
    borderBottomWidth: 1,
  },
});
