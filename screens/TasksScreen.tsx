import React, { useState, useCallback } from "react";
import {
  StyleSheet,
  View,
  Pressable,
  TextInput,
  Modal,
  Alert,
  RefreshControl,
} from "react-native";
import { Feather } from "@expo/vector-icons";
import { useFocusEffect } from "@react-navigation/native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useBottomTabBarHeight } from "@react-navigation/bottom-tabs";
import { ScreenScrollView } from "@/components/ScreenScrollView";
import { ThemedText } from "@/components/ThemedText";
import { ThemedView } from "@/components/ThemedView";
import { Button } from "@/components/Button";
import { useTheme } from "@/hooks/useTheme";
import { useAuth } from "@/contexts/AuthContext";
import { Spacing, BorderRadius, Colors, Shadows } from "@/constants/theme";
import Spacer from "@/components/Spacer";
import { supabase } from "@/lib/supabase";

type FilterType = "all" | "pending" | "in_progress" | "completed";

const PRIORITY_COLORS = {
  high: Colors.light.error,
  medium: Colors.light.warning,
  low: Colors.light.success,
};

const STATUS_COLORS = {
  pending: Colors.light.warning,
  in_progress: Colors.light.info,
  completed: Colors.light.success,
  cancelled: Colors.light.textSecondary,
};

interface Task {
  id: string;
  title: string;
  description: string;
  type: string;
  priority: "high" | "medium" | "low";
  status: "pending" | "in_progress" | "completed" | "cancelled";
  assigned_to: string;
  due_date: string;
  created_at: string;
  location?: { address: string };
}

const TASK_TYPE_ICONS: Record<string, keyof typeof Feather.glyphMap> = {
  follow_up: "phone",
  site_visit: "map-pin",
  lead: "user-plus",
  document: "file-text",
  marketing: "trending-up",
  other: "more-horizontal",
};

interface TaskCardProps {
  task: Task;
  onPress: () => void;
  onStatusChange: (status: Task["status"]) => void;
}

function TaskCard({ task, onPress, onStatusChange }: TaskCardProps) {
  const { theme } = useTheme();
  const priorityColor = PRIORITY_COLORS[task.priority];
  const statusColor = STATUS_COLORS[task.status];
  const deadline = new Date(task.due_date || task.created_at);
  const isOverdue =
    task.due_date && deadline < new Date() && task.status !== "completed";

  return (
    <Pressable
      style={({ pressed }) => [
        styles.taskCard,
        {
          backgroundColor: theme.backgroundDefault,
          opacity: pressed ? 0.9 : 1,
        },
      ]}
      onPress={onPress}
    >
      <View style={styles.taskHeader}>
        <View
          style={[
            styles.taskTypeIcon,
            { backgroundColor: theme.primary + "20" },
          ]}
        >
          <Feather
            name={TASK_TYPE_ICONS[task.type] || "more-horizontal"}
            size={18}
            color={theme.primary}
          />
        </View>
        <View style={styles.taskTitleContainer}>
          <ThemedText type="body" style={styles.taskTitle} numberOfLines={1}>
            {task.title}
          </ThemedText>
          <View style={styles.taskMeta}>
            <View
              style={[
                styles.priorityBadge,
                { backgroundColor: priorityColor + "20" },
              ]}
            >
              <ThemedText
                type="caption"
                style={{ color: priorityColor, fontWeight: "600" }}
              >
                {task.priority.toUpperCase()}
              </ThemedText>
            </View>
            <View
              style={[
                styles.statusBadge,
                { backgroundColor: statusColor + "20" },
              ]}
            >
              <ThemedText
                type="caption"
                style={{ color: statusColor, fontWeight: "500" }}
              >
                {task.status.replace("_", " ").toUpperCase()}
              </ThemedText>
            </View>
          </View>
        </View>
      </View>

      <ThemedText
        type="small"
        style={[styles.taskDescription, { color: theme.textSecondary }]}
        numberOfLines={2}
      >
        {task.description}
      </ThemedText>

      <View style={styles.taskFooter}>
        <View style={styles.deadlineContainer}>
          <Feather
            name="calendar"
            size={14}
            color={isOverdue ? Colors.light.error : theme.textSecondary}
          />
          <ThemedText
            type="caption"
            style={{
              color: isOverdue ? Colors.light.error : theme.textSecondary,
            }}
          >
            {deadline.toLocaleDateString()}
          </ThemedText>
        </View>

        {task.status !== "completed" ? (
          <View style={styles.actionButtons}>
            {task.status === "pending" ? (
              <Pressable
                style={({ pressed }) => [
                  styles.actionBtn,
                  { opacity: pressed ? 0.7 : 1 },
                ]}
                onPress={() => onStatusChange("in_progress")}
              >
                <Feather name="play" size={16} color={Colors.light.info} />
              </Pressable>
            ) : null}
            <Pressable
              style={({ pressed }) => [
                styles.actionBtn,
                { opacity: pressed ? 0.7 : 1 },
              ]}
              onPress={() => onStatusChange("completed")}
            >
              <Feather name="check" size={16} color={Colors.light.success} />
            </Pressable>
          </View>
        ) : null}
      </View>
    </Pressable>
  );
}

export default function TasksScreen() {
  const { theme } = useTheme();
  const { user } = useAuth();
  const insets = useSafeAreaInsets();
  const tabBarHeight = useBottomTabBarHeight();

  const [tasks, setTasks] = useState<Task[]>([]);
  const [filter, setFilter] = useState<FilterType>("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [refreshing, setRefreshing] = useState(false);
  const [selectedTask, setSelectedTask] = useState<Task | null>(null);
  const [showDetailModal, setShowDetailModal] = useState(false);
  const [showCreateModal, setShowCreateModal] = useState(false);

  const [newTask, setNewTask] = useState({
    title: "",
    description: "",
    type: "follow_up" as Task["type"],
    priority: "medium" as Task["priority"],
    deadline: new Date(Date.now() + 86400000).toISOString(),
  });

  const canCreateTasks = [
    "SYSTEM_ADMIN",
    "ADMIN",
    "BUSINESS_HEAD",
    "TEAM_HEAD",
    "TEAM_LEADER",
    "SALES_MANAGER",
    "GM_SALES",
    "AGM_SALES",
  ].includes(user?.role || "");

  const loadTasks = useCallback(async () => {
    let query = supabase
      .from("tasks")
      .select("*")
      .order("created_at", { ascending: false });
    // Non-admin/manager users only see their own tasks
    if (!canCreateTasks) {
      query = query.eq("assigned_to", user?.id);
    }
    const { data, error } = await query;
    if (!error) setTasks(data || []);
  }, [user?.id, canCreateTasks]);

  useFocusEffect(
    useCallback(() => {
      loadTasks();
    }, [loadTasks]),
  );

  const onRefresh = async () => {
    setRefreshing(true);
    await loadTasks();
    setRefreshing(false);
  };

  const handleStatusChange = async (taskId: string, newStatus: string) => {
    await supabase.from("tasks").update({ status: newStatus }).eq("id", taskId);
    await loadTasks();
    if (newStatus === "completed") Alert.alert("✅ Task Completed", "Great work! Task marked as completed.");
    else if (newStatus === "in_progress") Alert.alert("▶️ Task Started", "Task is now in progress.");
  };

  const handleCreateTask = async () => {
    if (!newTask.title.trim()) {
      Alert.alert("Required", "Please enter a task title");
      return;
    }
    const { error } = await supabase.from("tasks").insert({
      title: newTask.title,
      description: newTask.description,
      type: newTask.type,
      priority: newTask.priority,
      due_date: new Date(Date.now() + 86400000).toISOString().split("T")[0],
      status: "pending",
      assigned_to: user?.id || null,
    });
    if (error) {
      Alert.alert("Error", error.message);
      return;
    }
    setShowCreateModal(false);
    setNewTask({ title: "", description: "", type: "follow_up", priority: "medium", deadline: new Date(Date.now() + 86400000).toISOString() });
    await loadTasks();
    Alert.alert("✅ Task Created", `"${newTask.title}" has been added to your tasks.`);
  };

  const filteredTasks = tasks.filter((task) => {
    if (filter !== "all" && task.status !== filter) return false;
    if (
      searchQuery &&
      !task.title.toLowerCase().includes(searchQuery.toLowerCase())
    )
      return false;
    return true;
  });

  const filters: { key: FilterType; label: string }[] = [
    { key: "all", label: "All" },
    { key: "pending", label: "Pending" },
    { key: "in_progress", label: "In Progress" },
    { key: "completed", label: "Completed" },
  ];

  return (
    <View style={{ flex: 1, backgroundColor: theme.backgroundRoot }}>
      <ScreenScrollView
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor={theme.primary}
          />
        }
        contentContainerStyle={{ paddingBottom: tabBarHeight + Spacing["4xl"] }}
      >
        <View
          style={[
            styles.searchContainer,
            { backgroundColor: theme.backgroundDefault },
          ]}
        >
          <Feather name="search" size={18} color={theme.textSecondary} />
          <TextInput
            style={[styles.searchInput, { color: theme.text }]}
            placeholder="Search tasks..."
            placeholderTextColor={theme.textSecondary}
            value={searchQuery}
            onChangeText={setSearchQuery}
          />
          {searchQuery ? (
            <Pressable onPress={() => setSearchQuery("")}>
              <Feather name="x" size={18} color={theme.textSecondary} />
            </Pressable>
          ) : null}
        </View>

        <Spacer height={Spacing.md} />

        <View style={styles.filtersRow}>
          {filters.map((f) => (
            <Pressable
              key={f.key}
              style={[
                styles.filterChip,
                {
                  backgroundColor:
                    filter === f.key ? theme.primary : theme.backgroundDefault,
                },
              ]}
              onPress={() => setFilter(f.key)}
            >
              <ThemedText
                type="caption"
                style={{
                  color: filter === f.key ? "#FFFFFF" : theme.text,
                  fontWeight: filter === f.key ? "600" : "400",
                }}
              >
                {f.label}
              </ThemedText>
            </Pressable>
          ))}
        </View>

        <Spacer height={Spacing.lg} />

        {filteredTasks.length > 0 ? (
          <View style={styles.tasksList}>
            {filteredTasks.map((task) => (
              <TaskCard
                key={task.id}
                task={task}
                onPress={() => {
                  setSelectedTask(task);
                  setShowDetailModal(true);
                }}
                onStatusChange={(status) => handleStatusChange(task.id, status)}
              />
            ))}
          </View>
        ) : (
          <View
            style={[
              styles.emptyState,
              { backgroundColor: theme.backgroundDefault },
            ]}
          >
            <Feather name="inbox" size={48} color={theme.textSecondary} />
            <Spacer height={Spacing.md} />
            <ThemedText
              type="body"
              style={{ color: theme.textSecondary, textAlign: "center" }}
            >
              {searchQuery ? "No tasks match your search" : "No tasks yet"}
            </ThemedText>
          </View>
        )}
      </ScreenScrollView>

      {canCreateTasks ? (
        <Pressable
          style={({ pressed }) => [
            styles.fab,
            {
              backgroundColor: theme.primary,
              bottom: tabBarHeight + Spacing.xl,
              opacity: pressed ? 0.9 : 1,
              transform: [{ scale: pressed ? 0.95 : 1 }],
            },
          ]}
          onPress={() => setShowCreateModal(true)}
        >
          <Feather name="plus" size={24} color="#FFFFFF" />
        </Pressable>
      ) : null}

      <Modal
        visible={showDetailModal}
        animationType="slide"
        transparent
        onRequestClose={() => setShowDetailModal(false)}
      >
        <View style={styles.modalOverlay}>
          <ThemedView
            style={[
              styles.modalContainer,
              { paddingBottom: insets.bottom + Spacing.lg },
            ]}
          >
            <View style={styles.modalHeader}>
              <ThemedText type="h3">Task Details</ThemedText>
              <Pressable onPress={() => setShowDetailModal(false)}>
                <Feather name="x" size={24} color={theme.text} />
              </Pressable>
            </View>

            {selectedTask ? (
              <View style={styles.modalContent}>
                <ThemedText type="h4">{selectedTask.title}</ThemedText>
                <Spacer height={Spacing.md} />
                <ThemedText type="body" style={{ color: theme.textSecondary }}>
                  {selectedTask.description}
                </ThemedText>
                <Spacer height={Spacing.lg} />

                <View style={styles.detailRow}>
                  <ThemedText type="small" style={{ color: theme.textSecondary }}>Type:</ThemedText>
                  <ThemedText type="small" style={{ textTransform: "capitalize" }}>
                    {(selectedTask.type || "other").replace(/_/g, " ")}
                  </ThemedText>
                </View>
                <View style={styles.detailRow}>
                  <ThemedText type="small" style={{ color: theme.textSecondary }}>Priority:</ThemedText>
                  <ThemedText type="small" style={{ color: PRIORITY_COLORS[selectedTask.priority] }}>
                    {(selectedTask.priority || "medium").toUpperCase()}
                  </ThemedText>
                </View>
                <View style={styles.detailRow}>
                  <ThemedText type="small" style={{ color: theme.textSecondary }}>Status:</ThemedText>
                  <ThemedText type="small" style={{ color: STATUS_COLORS[selectedTask.status] }}>
                    {(selectedTask.status || "pending").replace(/_/g, " ").toUpperCase()}
                  </ThemedText>
                </View>
                <View style={styles.detailRow}>
                  <ThemedText type="small" style={{ color: theme.textSecondary }}>Deadline:</ThemedText>
                  <ThemedText type="small">
                    {selectedTask.due_date ? new Date(selectedTask.due_date).toLocaleDateString() : "No date"}
                  </ThemedText>
                </View>

                {selectedTask.location ? (
                  <View style={styles.detailRow}>
                    <ThemedText
                      type="small"
                      style={{ color: theme.textSecondary }}
                    >
                      Location:
                    </ThemedText>
                    <ThemedText type="small">
                      {selectedTask.location.address}
                    </ThemedText>
                  </View>
                ) : null}

                <Spacer height={Spacing.xl} />

                {selectedTask.status !== "completed" ? (
                  <Button
                    onPress={() => {
                      handleStatusChange(selectedTask.id, "completed");
                      setShowDetailModal(false);
                    }}
                  >
                    Mark as Complete
                  </Button>
                ) : null}
              </View>
            ) : null}
          </ThemedView>
        </View>
      </Modal>

      <Modal
        visible={showCreateModal}
        animationType="slide"
        transparent
        onRequestClose={() => setShowCreateModal(false)}
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
              <Pressable onPress={() => setShowCreateModal(false)}>
                <Feather name="x" size={24} color={theme.text} />
              </Pressable>
            </View>

            <View style={styles.modalContent}>
              <ThemedText type="small" style={styles.inputLabel}>
                Title
              </ThemedText>
              <TextInput
                style={[
                  styles.modalInput,
                  {
                    backgroundColor: theme.backgroundSecondary,
                    color: theme.text,
                  },
                ]}
                placeholder="Task title"
                placeholderTextColor={theme.textSecondary}
                value={newTask.title}
                onChangeText={(text) => setNewTask({ ...newTask, title: text })}
              />

              <Spacer height={Spacing.md} />

              <ThemedText type="small" style={styles.inputLabel}>
                Description
              </ThemedText>
              <TextInput
                style={[
                  styles.modalInput,
                  styles.textArea,
                  {
                    backgroundColor: theme.backgroundSecondary,
                    color: theme.text,
                  },
                ]}
                placeholder="Task description"
                placeholderTextColor={theme.textSecondary}
                value={newTask.description}
                onChangeText={(text) =>
                  setNewTask({ ...newTask, description: text })
                }
                multiline
                numberOfLines={3}
              />

              <Spacer height={Spacing.md} />

              <ThemedText type="small" style={styles.inputLabel}>
                Priority
              </ThemedText>
              <View style={styles.prioritySelector}>
                {(["low", "medium", "high"] as const).map((p) => (
                  <Pressable
                    key={p}
                    style={[
                      styles.priorityOption,
                      {
                        backgroundColor:
                          newTask.priority === p
                            ? PRIORITY_COLORS[p]
                            : theme.backgroundSecondary,
                      },
                    ]}
                    onPress={() => setNewTask({ ...newTask, priority: p })}
                  >
                    <ThemedText
                      type="caption"
                      style={{
                        color: newTask.priority === p ? "#FFFFFF" : theme.text,
                        fontWeight: "600",
                      }}
                    >
                      {p.toUpperCase()}
                    </ThemedText>
                  </Pressable>
                ))}
              </View>

              <Spacer height={Spacing.xl} />

              <Button onPress={handleCreateTask}>Create Task</Button>
            </View>
          </ThemedView>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  searchContainer: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.md,
    borderRadius: BorderRadius.md,
    gap: Spacing.sm,
  },
  searchInput: {
    flex: 1,
    fontSize: 16,
    paddingVertical: Spacing.xs,
  },
  filtersRow: {
    flexDirection: "row",
    gap: Spacing.sm,
  },
  filterChip: {
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    borderRadius: BorderRadius.full,
  },
  tasksList: {
    gap: Spacing.md,
  },
  taskCard: {
    padding: Spacing.lg,
    borderRadius: BorderRadius.md,
  },
  taskHeader: {
    flexDirection: "row",
    gap: Spacing.md,
    marginBottom: Spacing.sm,
  },
  taskTypeIcon: {
    width: 40,
    height: 40,
    borderRadius: BorderRadius.sm,
    alignItems: "center",
    justifyContent: "center",
  },
  taskTitleContainer: {
    flex: 1,
  },
  taskTitle: {
    fontWeight: "600",
    marginBottom: Spacing.xs,
  },
  taskMeta: {
    flexDirection: "row",
    gap: Spacing.sm,
  },
  priorityBadge: {
    paddingHorizontal: Spacing.sm,
    paddingVertical: 2,
    borderRadius: BorderRadius.xs,
  },
  statusBadge: {
    paddingHorizontal: Spacing.sm,
    paddingVertical: 2,
    borderRadius: BorderRadius.xs,
  },
  taskDescription: {
    marginBottom: Spacing.md,
  },
  taskFooter: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  deadlineContainer: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.xs,
  },
  actionButtons: {
    flexDirection: "row",
    gap: Spacing.md,
  },
  actionBtn: {
    width: 32,
    height: 32,
    alignItems: "center",
    justifyContent: "center",
  },
  emptyState: {
    alignItems: "center",
    padding: Spacing["3xl"],
    borderRadius: BorderRadius.md,
  },
  fab: {
    position: "absolute",
    right: Spacing.xl,
    width: Spacing.fabSize,
    height: Spacing.fabSize,
    borderRadius: Spacing.fabSize / 2,
    alignItems: "center",
    justifyContent: "center",
    ...Shadows.fab,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: "rgba(0, 0, 0, 0.5)",
    justifyContent: "flex-end",
  },
  modalContainer: {
    borderTopLeftRadius: BorderRadius.xl,
    borderTopRightRadius: BorderRadius.xl,
    maxHeight: "80%",
  },
  modalHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    padding: Spacing.lg,
    borderBottomWidth: 1,
    borderBottomColor: "rgba(128, 128, 128, 0.2)",
  },
  modalContent: {
    padding: Spacing.lg,
  },
  detailRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    paddingVertical: Spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: "rgba(128, 128, 128, 0.1)",
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
  textArea: {
    height: 100,
    textAlignVertical: "top",
    paddingTop: Spacing.md,
  },
  prioritySelector: {
    flexDirection: "row",
    gap: Spacing.sm,
  },
  priorityOption: {
    flex: 1,
    paddingVertical: Spacing.md,
    borderRadius: BorderRadius.sm,
    alignItems: "center",
  },
});
