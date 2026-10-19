import React, { useState, useCallback, useEffect, useRef } from "react";
import {
  StyleSheet,
  View,
  Pressable,
  TextInput,
  Modal,
  Alert,
  RefreshControl,
  Platform,
  ScrollView,
  Switch,
} from "react-native";
import Feather from "@expo/vector-icons/Feather";
import { useFocusEffect, useRoute } from "@react-navigation/native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useBottomTabBarHeight } from "@react-navigation/bottom-tabs";
import { ScreenScrollView } from "@/components/ScreenScrollView";
import { ThemedText } from "@/components/ThemedText";
import { formatDate } from "@/utils/format";
import { ThemedView } from "@/components/ThemedView";
import { Button } from "@/components/Button";
import { useTheme } from "@/hooks/useTheme";
import { useAuth } from "@/contexts/AuthContext";
import { Spacing, BorderRadius, Colors, Shadows } from "@/constants/theme";
import Spacer from "@/components/Spacer";
import { supabase } from "@/lib/supabase";
import { BusinessClockService } from "@/services/business-clock.service";
import { addBusinessDays, isDueDateOverdue } from "@/utils/businessDate";
import { EventAnnouncement, EventService } from "@/services/event.service";
import {
  TaskSharingService,
  TaskVisibilityFields,
} from "@/services/task-sharing.service";
import { ForwardTaskModal } from "@/components/ForwardTaskModal";

const PRIMARY = "#6D1B6D";
const isWeb = Platform.OS === "web";
const ACTIVE_PAGE_SIZE = 100;
const DONE_PAGE_SIZE = 200;

type FilterType = "all" | "pending" | "in_progress" | "completed";
type ScopeFilter = "all" | "mine" | "shared";

const PRIORITY_COLORS = {
  high: Colors.light.error,
  medium: Colors.light.warning,
  low: Colors.light.success,
};

const STATUS_COLORS = {
  pending: Colors.light.warning,
  in_progress: Colors.light.info,
  completed: Colors.light.success,
  cancelled: "#9CA3AF",
};

interface Task extends TaskVisibilityFields {
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

/** Where a task came from, e.g. "Shared by Asha" / "Forwarded by Ravi". */
function taskOrigin(task: Task, userId?: string | null): string | null {
  if (task.relation === "SHARED") {
    const name = task.shared_by_name || task.created_by_name || "your manager";
    return task.shared_via === "FORWARDED"
      ? `Forwarded by ${name}`
      : `Shared by ${name}`;
  }
  if (
    task.relation === "ASSIGNED" &&
    task.assigned_by &&
    task.assigned_by !== userId
  ) {
    return `Assigned by ${task.assigned_by_name || "your manager"}`;
  }
  return null;
}

const canUpdateTask = (task: Task) => task.can_update !== false;

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
  businessDate: string | null;
  onPress: () => void;
  onStatusChange: (status: Task["status"]) => void;
  currentUserId?: string | null;
  onForward: () => void;
}

function TaskCard({
  task,
  businessDate,
  onPress,
  onStatusChange,
  currentUserId,
  onForward,
}: TaskCardProps) {
  const { theme } = useTheme();
  const origin = taskOrigin(task, currentUserId);
  const editable = canUpdateTask(task);
  const forwardedCount = Number(task.forwarded_count || 0);
  const priorityColor = PRIORITY_COLORS[task.priority];
  const statusColor = STATUS_COLORS[task.status];
  const deadline = new Date(task.due_date || task.created_at);
  const isOverdue =
    isDueDateOverdue(task.due_date, businessDate) &&
    task.status !== "completed" &&
    task.status !== "cancelled";

  return (
    <Pressable
      style={({ pressed }) => [
        styles.taskCard,
        {
          backgroundColor: theme.backgroundDefault,
          opacity: pressed ? 0.9 : 1,
        },
        isWeb && { boxShadow: "0 2px 8px rgba(109,27,109,0.07)" },
      ]}
      onPress={onPress}
    >
      {/* left priority bar */}
      <View
        style={[
          {
            width: 4,
            backgroundColor: priorityColor,
            borderTopLeftRadius: BorderRadius.md,
            borderBottomLeftRadius: BorderRadius.md,
          },
        ]}
      />
      <View style={styles.taskCardInner}>
        <View style={styles.taskHeader}>
          <View
            style={[styles.taskTypeIcon, { backgroundColor: PRIMARY + "18" }]}
          >
            <Feather
              name={TASK_TYPE_ICONS[task.type] || "more-horizontal"}
              size={16}
              color={PRIMARY}
            />
          </View>
          <View style={styles.taskTitleContainer}>
            <ThemedText
              style={{ fontWeight: "700", fontSize: 14, color: theme.text }}
              numberOfLines={1}
            >
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
                  style={{
                    color: priorityColor,
                    fontWeight: "700",
                    fontSize: 10,
                  }}
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
                  style={{
                    color: statusColor,
                    fontWeight: "600",
                    fontSize: 10,
                  }}
                >
                  {task.status.replace("_", " ").toUpperCase()}
                </ThemedText>
              </View>
            </View>
          </View>
        </View>

        {task.description ? (
          <ThemedText
            style={{
              color: theme.textSecondary,
              fontSize: 13,
              marginBottom: Spacing.sm,
              lineHeight: 18,
            }}
            numberOfLines={2}
          >
            {task.description}
          </ThemedText>
        ) : null}

        {origin ? (
          <View style={styles.originRow}>
            <Feather
              name={task.shared_via === "FORWARDED" ? "corner-up-right" : "user"}
              size={12}
              color={theme.primary}
            />
            <ThemedText
              style={{ fontSize: 12, color: theme.primary, fontWeight: "600", flexShrink: 1 }}
              numberOfLines={1}
            >
              {origin}
            </ThemedText>
          </View>
        ) : null}

        <View style={styles.taskFooter}>
          <View style={styles.deadlineContainer}>
            <Feather
              name="calendar"
              size={12}
              color={isOverdue ? Colors.light.error : theme.textSecondary}
            />
            <ThemedText
              style={{
                fontSize: 12,
                color: isOverdue ? Colors.light.error : theme.textSecondary,
              }}
            >
              {formatDate(deadline)}
            </ThemedText>
          </View>
          {!editable ? (
            <View
              style={[
                styles.viewOnlyBadge,
                { backgroundColor: theme.backgroundSecondary },
              ]}
            >
              <Feather name="eye" size={11} color={theme.textSecondary} />
              <ThemedText style={{ fontSize: 11, color: theme.textSecondary }}>
                View only
              </ThemedText>
            </View>
          ) : task.status !== "completed" ? (
            <View style={styles.actionButtons}>
              {task.status === "pending" ? (
                <Pressable
                  style={({ pressed }) => [
                    styles.actionBtn,
                    {
                      backgroundColor: Colors.light.info + "20",
                      opacity: pressed ? 0.7 : 1,
                    },
                  ]}
                  onPress={() => onStatusChange("in_progress")}
                >
                  <Feather name="play" size={14} color={Colors.light.info} />
                </Pressable>
              ) : null}
              <Pressable
                style={({ pressed }) => [
                  styles.actionBtn,
                  {
                    backgroundColor: Colors.light.success + "20",
                    opacity: pressed ? 0.7 : 1,
                  },
                ]}
                onPress={() => onStatusChange("completed")}
              >
                <Feather name="check" size={14} color={Colors.light.success} />
              </Pressable>
            </View>
          ) : null}
        </View>

        {task.can_forward ? (
          <View style={[styles.forwardRow, { borderTopColor: theme.borderLight }]}>
            <Pressable
              onPress={onForward}
              accessibilityRole="button"
              accessibilityLabel="Forward to my team"
              style={({ pressed }) => [
                styles.forwardBtn,
                {
                  borderColor: theme.primary,
                  opacity: pressed ? 0.7 : 1,
                },
              ]}
            >
              <Feather name="corner-up-right" size={13} color={theme.primary} />
              <ThemedText
                style={{ fontSize: 12, fontWeight: "700", color: theme.primary }}
              >
                Forward to my team
              </ThemedText>
            </Pressable>
            {forwardedCount > 0 ? (
              <ThemedText style={{ fontSize: 11, color: theme.success, fontWeight: "600" }}>
                Forwarded to {forwardedCount}
              </ThemedText>
            ) : null}
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
  const route = useRoute<any>();
  const lastOpenedEventId = useRef<string | null>(null);

  const [tasks, setTasks] = useState<Task[]>([]);
  const [taskLoadError, setTaskLoadError] = useState<string | null>(null);
  const [eventAnnouncements, setEventAnnouncements] = useState<
    EventAnnouncement[]
  >([]);
  const [filter, setFilter] = useState<FilterType>("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [refreshing, setRefreshing] = useState(false);
  const [businessDate, setBusinessDate] = useState<string | null>(null);
  const [selectedTask, setSelectedTask] = useState<Task | null>(null);
  const [showDetailModal, setShowDetailModal] = useState(false);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [selectedEvent, setSelectedEvent] = useState<EventAnnouncement | null>(
    null,
  );
  const [showEventModal, setShowEventModal] = useState(false);
  const [acknowledgingEventId, setAcknowledgingEventId] = useState<
    string | null
  >(null);

  const [newTask, setNewTask] = useState({
    title: "",
    description: "",
    priority: "medium" as Task["priority"],
  });
  const [creatingTask, setCreatingTask] = useState(false);
  const creatingTaskRef = useRef(false);
  const [activeLimit, setActiveLimit] = useState(ACTIVE_PAGE_SIZE);
  const [doneLimit, setDoneLimit] = useState(DONE_PAGE_SIZE);
  const [hasMoreActive, setHasMoreActive] = useState(false);
  const [hasMoreDone, setHasMoreDone] = useState(false);
  const [scopeFilter, setScopeFilter] = useState<ScopeFilter>("all");
  const [forwardTask, setForwardTask] = useState<Task | null>(null);
  const [hasDirectReports, setHasDirectReports] = useState(false);
  const [shareWithReports, setShareWithReports] = useState(true);

  const canCreateTasks = !!user?.id;

  // Whether I lead a team decides if the "Visible to my direct reports"
  // switch is shown on the create form. Checked once per user.
  useEffect(() => {
    if (!user?.id) return;
    let cancelled = false;
    TaskSharingService.getMyDirectReports()
      .then((rows) => {
        if (!cancelled) setHasDirectReports(rows.length > 0);
      })
      .catch(() => {
        if (!cancelled) setHasDirectReports(false);
      });
    return () => {
      cancelled = true;
    };
  }, [user?.id]);

  const loadTasks = useCallback(async () => {
    if (!user?.id) return;
    // rpc_my_tasks: tasks assigned to me, created/assigned by me, or
    // shared/forwarded to me along the reporting hierarchy.
    const [activeResult, doneResult, announcements, currentBusinessDate] = await Promise.all([
      TaskSharingService.getMyTasks<Task>(["pending", "in_progress"], activeLimit)
        .then((data) => ({ data, error: null as any }))
        .catch((error) => ({ data: [] as Task[], error })),
      // Completed/cancelled tasks are needed by the "Completed" tab; load them
      // page by page so long-time users don't download their whole history.
      TaskSharingService.getMyTasks<Task>(["completed", "cancelled"], doneLimit)
        .then((data) => ({ data, error: null as any }))
        .catch((error) => ({ data: [] as Task[], error })),
      EventService.getAnnouncements(user.id).catch(() => null),
      BusinessClockService.getDate(true).catch(() => null),
    ]);
    const taskError = activeResult.error || doneResult.error;
    if (taskError) {
      console.error("Unable to load tasks:", taskError);
      setTaskLoadError(taskError?.message || "Could not load tasks.");
    } else {
      const seen = new Set<string>();
      const merged = [...activeResult.data, ...doneResult.data].filter(
        (task: Task) => (seen.has(task.id) ? false : (seen.add(task.id), true)),
      );
      setTasks(merged);
      setHasMoreActive(activeResult.data.length >= activeLimit);
      setHasMoreDone(doneResult.data.length >= doneLimit);
      setTaskLoadError(null);
    }
    if (announcements) setEventAnnouncements(announcements);
    if (currentBusinessDate) setBusinessDate(currentBusinessDate);
  }, [user?.id, activeLimit, doneLimit]);

  useFocusEffect(
    useCallback(() => {
      loadTasks();
    }, [loadTasks]),
  );

  useEffect(() => {
    const eventId = route.params?.eventId;
    if (!eventId || lastOpenedEventId.current === eventId) return;
    const announcement = eventAnnouncements.find(
      (item) => item.eventId === eventId,
    );
    if (!announcement) return;
    lastOpenedEventId.current = eventId;
    setSelectedEvent(announcement);
    setShowEventModal(true);
  }, [eventAnnouncements, route.params?.eventId]);

  const onRefresh = async () => {
    setRefreshing(true);
    await loadTasks();
    setRefreshing(false);
  };

  const handleStatusChange = async (taskId: string, newStatus: string) => {
    const target = tasks.find((task) => task.id === taskId);
    if (target && !canUpdateTask(target)) {
      Alert.alert("View only", "This task was shared with you, so only its owner can change its status.");
      return;
    }
    const previous = tasks;
    const previousSelected = selectedTask;
    // Optimistic: the card moves to its new tab immediately.
    setTasks((current) =>
      current.map((task) =>
        task.id === taskId ? { ...task, status: newStatus as Task["status"] } : task,
      ),
    );
    setSelectedTask((current) =>
      current?.id === taskId ? { ...current, status: newStatus as Task["status"] } : current,
    );
    const { data, error } = await supabase
      .from("tasks")
      .update({ status: newStatus })
      .eq("id", taskId)
      .select("id");
    if (error || !data?.length) {
      setTasks(previous);
      setSelectedTask(previousSelected);
      Alert.alert(
        "Unable to update task",
        error?.message || "You don't have permission to change this task.",
      );
      return;
    }
    await loadTasks();
  };

  const acknowledgeEvent = async (announcement: EventAnnouncement) => {
    if (!user?.id || announcement.acknowledgedAt) return;
    setAcknowledgingEventId(announcement.eventId);
    try {
      const acknowledgedAt = await EventService.acknowledgeEvent(
        announcement.eventId,
        user.id,
      );
      setEventAnnouncements((current) =>
        current.map((item) =>
          item.eventId === announcement.eventId
            ? { ...item, acknowledgedAt }
            : item,
        ),
      );
      setSelectedEvent((current) =>
        current?.eventId === announcement.eventId
          ? { ...current, acknowledgedAt }
          : current,
      );
    } catch (error: any) {
      Alert.alert(
        "Unable to acknowledge",
        error?.message || "Please try again.",
      );
    } finally {
      setAcknowledgingEventId(null);
    }
  };

  const handleCreateTask = async () => {
    if (creatingTaskRef.current) return;
    if (!newTask.title.trim()) {
      Alert.alert("Error", "Please enter a task title");
      return;
    }
    creatingTaskRef.current = true;
    setCreatingTask(true);
    try {
      const businessDate = await BusinessClockService.getDate(true);
      const { error } = await supabase.from("tasks").insert({
        title: newTask.title,
        description: newTask.description,
        priority: newTask.priority,
        due_date: addBusinessDays(businessDate, 1),
        status: "pending",
        assigned_to: user?.id || null,
        assigned_by: user?.id || null,
        share_scope:
          hasDirectReports && !shareWithReports ? "PRIVATE" : "DIRECT_REPORTS",
      });
      if (error) {
        Alert.alert("Error", error.message);
        return;
      }
      await loadTasks();
      setShowCreateModal(false);
      setNewTask({
        title: "",
        description: "",
        priority: "medium",
      });
      setShareWithReports(true);
    } catch (error: any) {
      Alert.alert("Error", error?.message || "Could not create the task. Please try again.");
    } finally {
      creatingTaskRef.current = false;
      setCreatingTask(false);
    }
  };

  const filteredTasks = tasks.filter((task) => {
    if (filter !== "all" && task.status !== filter) return false;
    if (scopeFilter === "shared" && task.relation !== "SHARED") return false;
    if (scopeFilter === "mine" && task.relation === "SHARED") return false;
    if (
      searchQuery &&
      !task.title.toLowerCase().includes(searchQuery.toLowerCase())
    )
      return false;
    return true;
  });
  const filteredEventAnnouncements = eventAnnouncements.filter(
    (announcement) => {
      const status = announcement.acknowledgedAt ? "completed" : "pending";
      if (filter !== "all" && filter !== status) return false;
      if (
        searchQuery &&
        !announcement.event.title
          .toLowerCase()
          .includes(searchQuery.toLowerCase())
      ) {
        return false;
      }
      return true;
    },
  );

  const filters: { key: FilterType; label: string }[] = [
    { key: "all", label: "All" },
    { key: "pending", label: "Pending" },
    { key: "in_progress", label: "In Progress" },
    { key: "completed", label: "Completed" },
  ];
  const sharedCount = tasks.filter((task) => task.relation === "SHARED").length;
  const scopeFilters: { key: ScopeFilter; label: string }[] = [
    { key: "all", label: "All" },
    { key: "mine", label: "Mine" },
    {
      key: "shared",
      label: sharedCount > 0 ? `From my manager (${sharedCount})` : "From my manager",
    },
  ];
  // Event messages are not tasks from the hierarchy; hide them under the
  // "From my manager" scope so the list matches the chip.
  const visibleEventAnnouncements =
    scopeFilter === "shared" ? [] : filteredEventAnnouncements;

  return (
    <View style={{ flex: 1, backgroundColor: theme.backgroundRoot }}>
      {/* ── Purple Hero Header ── */}
      <View
        style={[
          styles.header,
          { backgroundColor: PRIMARY, paddingTop: insets.top + 12 },
        ]}
      >
        <View style={styles.headerRow}>
          <View style={{ flex: 1 }}>
            <ThemedText
              style={{
                color: "rgba(255,255,255,0.65)",
                fontSize: 11,
                marginBottom: 2,
              }}
            >
              MY WORK
            </ThemedText>
            <ThemedText
              style={{ color: "#FFFFFF", fontWeight: "800", fontSize: 22 }}
            >
              Tasks
            </ThemedText>
          </View>
          <Pressable
            style={({ pressed }) => [
              styles.addBtn,
              { opacity: pressed ? 0.8 : 1 },
            ]}
            onPress={() => setShowCreateModal(true)}
          >
            <Feather name="plus" size={18} color={PRIMARY} />
          </Pressable>
        </View>

        {/* Search bar inside header */}
        <View
          style={[
            styles.searchBar,
            { backgroundColor: "rgba(255,255,255,0.15)" },
          ]}
        >
          <Feather name="search" size={16} color="rgba(255,255,255,0.7)" />
          <TextInput
            style={[styles.searchInput, { color: "#FFFFFF" }]}
            placeholder="Search tasks..."
            placeholderTextColor="rgba(255,255,255,0.5)"
            value={searchQuery}
            onChangeText={setSearchQuery}
          />
          {searchQuery ? (
            <Pressable onPress={() => setSearchQuery("")}>
              <Feather name="x" size={16} color="rgba(255,255,255,0.7)" />
            </Pressable>
          ) : null}
        </View>

        {/* Filter chips */}
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          style={styles.filtersScroll}
          contentContainerStyle={styles.filtersContent}
        >
          {filters.map((f) => (
            <Pressable
              key={f.key}
              style={[
                styles.filterChip,
                {
                  backgroundColor:
                    filter === f.key ? "#FFFFFF" : "rgba(255,255,255,0.15)",
                },
              ]}
              onPress={() => setFilter(f.key)}
            >
              <ThemedText
                style={{
                  fontSize: 12,
                  fontWeight: "600",
                  color: filter === f.key ? PRIMARY : "rgba(255,255,255,0.85)",
                }}
              >
                {f.label}
              </ThemedText>
            </Pressable>
          ))}
        </ScrollView>
      </View>

      <ScreenScrollView
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor={PRIMARY}
          />
        }
        contentContainerStyle={{
          paddingBottom: tabBarHeight + Spacing["4xl"],
          paddingHorizontal: Spacing.lg,
          paddingTop: Spacing.lg,
        }}
      >
        {taskLoadError ? (
          <View
            style={{
              marginBottom: Spacing.md,
              padding: Spacing.md,
              borderRadius: BorderRadius.md,
              backgroundColor: `${Colors.light.error}12`,
              borderWidth: 1,
              borderColor: Colors.light.error,
              flexDirection: "row",
              alignItems: "center",
              gap: Spacing.sm,
            }}
          >
            <Feather
              name="alert-triangle"
              size={18}
              color={Colors.light.error}
            />
            <ThemedText style={{ color: Colors.light.error, flex: 1 }}>
              Tasks unavailable: {taskLoadError}
            </ThemedText>
            <Pressable onPress={() => void loadTasks()}>
              <ThemedText
                style={{ color: Colors.light.error, fontWeight: "700" }}
              >
                Retry
              </ThemedText>
            </Pressable>
          </View>
        ) : null}
        <View style={styles.scopeRow}>
          {scopeFilters.map((s) => {
            const active = scopeFilter === s.key;
            return (
              <Pressable
                key={s.key}
                onPress={() => setScopeFilter(s.key)}
                accessibilityRole="button"
                accessibilityState={{ selected: active }}
                style={[
                  styles.scopeChip,
                  {
                    backgroundColor: active ? theme.primary : theme.backgroundDefault,
                    borderColor: active ? theme.primary : theme.border,
                  },
                ]}
              >
                <ThemedText
                  style={{
                    fontSize: 12,
                    fontWeight: "600",
                    color: active ? "#FFFFFF" : theme.textSecondary,
                  }}
                  numberOfLines={1}
                >
                  {s.label}
                </ThemedText>
              </Pressable>
            );
          })}
        </View>
        {visibleEventAnnouncements.length > 0 ? (
          <View style={styles.eventTaskSection}>
            <View style={styles.eventTaskHeading}>
              <Feather name="bell" size={16} color={PRIMARY} />
              <ThemedText
                style={{ color: theme.text, fontWeight: "800", fontSize: 15 }}
              >
                Event messages
              </ThemedText>
            </View>
            {visibleEventAnnouncements.map((announcement) => (
              <Pressable
                key={announcement.eventId}
                onPress={() => {
                  setSelectedEvent(announcement);
                  setShowEventModal(true);
                }}
                style={({ pressed }) => [
                  styles.eventTaskCard,
                  {
                    backgroundColor: theme.backgroundDefault,
                    borderColor: announcement.acknowledgedAt
                      ? Colors.light.success
                      : PRIMARY,
                    opacity: pressed ? 0.88 : 1,
                  },
                ]}
              >
                <View
                  style={[
                    styles.eventTaskIcon,
                    { backgroundColor: PRIMARY + "18" },
                  ]}
                >
                  <Feather name="calendar" size={18} color={PRIMARY} />
                </View>
                <View style={{ flex: 1 }}>
                  <ThemedText style={{ color: theme.text, fontWeight: "800" }}>
                    {announcement.event.title}
                  </ThemedText>
                  <ThemedText
                    type="caption"
                    style={{ color: theme.textSecondary, marginTop: 3 }}
                  >
                    {announcement.event.event_date} •{" "}
                    {announcement.event.start_time.slice(0, 5)}-
                    {announcement.event.end_time.slice(0, 5)}
                  </ThemedText>
                  <ThemedText
                    type="caption"
                    style={{ color: theme.textSecondary, marginTop: 2 }}
                    numberOfLines={1}
                  >
                    {announcement.event.address}
                  </ThemedText>
                </View>
                <View
                  style={[
                    styles.eventStatus,
                    {
                      backgroundColor: announcement.acknowledgedAt
                        ? Colors.light.success + "18"
                        : Colors.light.warning + "18",
                    },
                  ]}
                >
                  <ThemedText
                    type="caption"
                    style={{
                      color: announcement.acknowledgedAt
                        ? Colors.light.success
                        : Colors.light.warning,
                      fontWeight: "800",
                    }}
                  >
                    {announcement.acknowledgedAt ? "SEEN" : "NEW"}
                  </ThemedText>
                </View>
              </Pressable>
            ))}
          </View>
        ) : null}

        {filteredTasks.length > 0 ? (
          <View style={styles.tasksList}>
            {filteredTasks.map((task) => (
              <TaskCard
                key={task.id}
                task={task}
                businessDate={businessDate}
                onPress={() => {
                  setSelectedTask(task);
                  setShowDetailModal(true);
                }}
                onStatusChange={(status) => handleStatusChange(task.id, status)}
                currentUserId={user?.id}
                onForward={() => setForwardTask(task)}
              />
            ))}
          </View>
        ) : visibleEventAnnouncements.length === 0 ? (
          <View
            style={[
              styles.emptyState,
              { backgroundColor: theme.backgroundDefault },
            ]}
          >
            <View
              style={[
                styles.emptyIconWrap,
                { backgroundColor: PRIMARY + "12" },
              ]}
            >
              <Feather name="check-square" size={32} color={PRIMARY} />
            </View>
            <Spacer height={Spacing.md} />
            <ThemedText
              style={{
                fontWeight: "700",
                fontSize: 16,
                color: theme.text,
                textAlign: "center",
              }}
            >
              {searchQuery ? "No matching tasks" : "All clear!"}
            </ThemedText>
            <ThemedText
              style={{
                color: theme.textSecondary,
                textAlign: "center",
                marginTop: 4,
                fontSize: 13,
              }}
            >
              {searchQuery
                ? "Try a different search term"
                : scopeFilter === "shared"
                  ? "Nothing shared with you by your manager yet"
                  : "No tasks assigned yet"}
            </ThemedText>
          </View>
        ) : null}
        {hasMoreActive && filter !== "completed" ? (
          <Pressable
            style={styles.loadMoreButton}
            onPress={() => setActiveLimit((current) => current + ACTIVE_PAGE_SIZE)}
          >
            <ThemedText style={{ color: PRIMARY, fontWeight: "700" }}>
              Load more active tasks
            </ThemedText>
          </Pressable>
        ) : null}
        {hasMoreDone && (filter === "all" || filter === "completed") ? (
          <Pressable
            style={styles.loadMoreButton}
            onPress={() => setDoneLimit((current) => current + DONE_PAGE_SIZE)}
          >
            <ThemedText style={{ color: PRIMARY, fontWeight: "700" }}>
              Load more completed tasks
            </ThemedText>
          </Pressable>
        ) : null}
      </ScreenScrollView>

      <Modal
        visible={showEventModal}
        animationType="slide"
        transparent
        onRequestClose={() => setShowEventModal(false)}
      >
        <View style={styles.modalOverlay}>
          <ThemedView
            style={[
              styles.modalContainer,
              { paddingBottom: insets.bottom + Spacing.lg },
            ]}
          >
            <View style={styles.modalHeader}>
              <ThemedText type="h3">Event Details</ThemedText>
              <Pressable onPress={() => setShowEventModal(false)}>
                <Feather name="x" size={24} color={theme.text} />
              </Pressable>
            </View>
            {selectedEvent ? (
              <View style={styles.modalContent}>
                <ThemedText type="h3">{selectedEvent.event.title}</ThemedText>
                <Spacer height={Spacing.md} />
                {selectedEvent.event.description ? (
                  <ThemedText
                    type="body"
                    style={{ color: theme.textSecondary, lineHeight: 21 }}
                  >
                    {selectedEvent.event.description}
                  </ThemedText>
                ) : null}
                <Spacer height={Spacing.lg} />
                <View style={styles.eventDetailRow}>
                  <Feather name="calendar" size={16} color={PRIMARY} />
                  <ThemedText style={{ color: theme.text, flex: 1 }}>
                    {selectedEvent.event.event_date} •{" "}
                    {selectedEvent.event.start_time.slice(0, 5)}-
                    {selectedEvent.event.end_time.slice(0, 5)}
                  </ThemedText>
                </View>
                <View style={styles.eventDetailRow}>
                  <Feather name="map-pin" size={16} color={PRIMARY} />
                  <ThemedText style={{ color: theme.text, flex: 1 }}>
                    {selectedEvent.event.address}
                  </ThemedText>
                </View>
                <Spacer height={Spacing.xl} />
                <Button
                  disabled={
                    !!selectedEvent.acknowledgedAt ||
                    acknowledgingEventId === selectedEvent.eventId
                  }
                  onPress={() => acknowledgeEvent(selectedEvent)}
                >
                  {selectedEvent.acknowledgedAt
                    ? "Seen ✓"
                    : acknowledgingEventId === selectedEvent.eventId
                      ? "Saving..."
                      : "Got it"}
                </Button>
              </View>
            ) : null}
          </ThemedView>
        </View>
      </Modal>

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
                  <ThemedText
                    type="small"
                    style={{ color: theme.textSecondary }}
                  >
                    Type:
                  </ThemedText>
                  <ThemedText
                    type="small"
                    style={{ textTransform: "capitalize" }}
                  >
                    {(selectedTask.type || "other").replace(/_/g, " ")}
                  </ThemedText>
                </View>
                <View style={styles.detailRow}>
                  <ThemedText
                    type="small"
                    style={{ color: theme.textSecondary }}
                  >
                    Priority:
                  </ThemedText>
                  <ThemedText
                    type="small"
                    style={{ color: PRIORITY_COLORS[selectedTask.priority] }}
                  >
                    {(selectedTask.priority || "medium").toUpperCase()}
                  </ThemedText>
                </View>
                <View style={styles.detailRow}>
                  <ThemedText
                    type="small"
                    style={{ color: theme.textSecondary }}
                  >
                    Status:
                  </ThemedText>
                  <ThemedText
                    type="small"
                    style={{ color: STATUS_COLORS[selectedTask.status] }}
                  >
                    {(selectedTask.status || "pending")
                      .replace(/_/g, " ")
                      .toUpperCase()}
                  </ThemedText>
                </View>
                <View style={styles.detailRow}>
                  <ThemedText
                    type="small"
                    style={{ color: theme.textSecondary }}
                  >
                    Deadline:
                  </ThemedText>
                  <ThemedText type="small">
                    {selectedTask.due_date
                      ? formatDate(selectedTask.due_date)
                      : "No date"}
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

                {taskOrigin(selectedTask, user?.id) ? (
                  <View style={styles.detailRow}>
                    <ThemedText
                      type="small"
                      style={{ color: theme.textSecondary }}
                    >
                      From:
                    </ThemedText>
                    <ThemedText
                      type="small"
                      style={{ color: theme.primary, flexShrink: 1, textAlign: "right" }}
                    >
                      {taskOrigin(selectedTask, user?.id)}
                    </ThemedText>
                  </View>
                ) : null}

                {selectedTask.assigned_to_name &&
                selectedTask.assigned_to !== user?.id ? (
                  <View style={styles.detailRow}>
                    <ThemedText
                      type="small"
                      style={{ color: theme.textSecondary }}
                    >
                      Assigned to:
                    </ThemedText>
                    <ThemedText
                      type="small"
                      style={{ flexShrink: 1, textAlign: "right" }}
                    >
                      {selectedTask.assigned_to_name}
                    </ThemedText>
                  </View>
                ) : null}

                <Spacer height={Spacing.xl} />

                {!canUpdateTask(selectedTask) ? (
                  <View
                    style={[
                      styles.viewOnlyNotice,
                      {
                        backgroundColor: theme.backgroundSecondary,
                        borderColor: theme.border,
                      },
                    ]}
                  >
                    <Feather name="eye" size={16} color={theme.textSecondary} />
                    <ThemedText
                      type="small"
                      style={{ color: theme.textSecondary, flex: 1 }}
                    >
                      View only - shared with you
                    </ThemedText>
                  </View>
                ) : selectedTask.status !== "completed" ? (
                  <Button
                    onPress={() => {
                      handleStatusChange(selectedTask.id, "completed");
                      setShowDetailModal(false);
                    }}
                  >
                    Mark as Complete
                  </Button>
                ) : null}

                {selectedTask.can_forward ? (
                  <>
                    <Spacer height={Spacing.md} />
                    <Button
                      variant="outline"
                      onPress={() => {
                        const task = selectedTask;
                        setShowDetailModal(false);
                        setForwardTask(task);
                      }}
                    >
                      {Number(selectedTask.forwarded_count || 0) > 0
                        ? `Forward to my team (forwarded to ${selectedTask.forwarded_count})`
                        : "Forward to my team"}
                    </Button>
                  </>
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

              {hasDirectReports ? (
                <>
                  <Spacer height={Spacing.md} />
                  <View
                    style={[
                      styles.shareSwitchRow,
                      {
                        backgroundColor: theme.backgroundSecondary,
                        borderColor: theme.border,
                      },
                    ]}
                  >
                    <View style={{ flex: 1, minWidth: 0 }}>
                      <ThemedText type="small" style={{ fontWeight: "600" }}>
                        Visible to my direct reports
                      </ThemedText>
                      <ThemedText
                        type="caption"
                        style={{ color: theme.textSecondary, marginTop: 2 }}
                      >
                        {shareWithReports
                          ? "Your team can see this task."
                          : "Only you can see this task."}
                      </ThemedText>
                    </View>
                    <Switch
                      value={shareWithReports}
                      onValueChange={setShareWithReports}
                      trackColor={{ false: theme.border, true: theme.primary }}
                      thumbColor="#FFFFFF"
                      accessibilityLabel="Visible to my direct reports"
                    />
                  </View>
                </>
              ) : null}

              <Spacer height={Spacing.xl} />

              <Button onPress={handleCreateTask} disabled={creatingTask}>
                {creatingTask ? "Creating..." : "Create Task"}
              </Button>
            </View>
          </ThemedView>
        </View>
      </Modal>

      <ForwardTaskModal
        visible={!!forwardTask}
        task={forwardTask}
        onClose={() => setForwardTask(null)}
        onForwarded={(message) => {
          setForwardTask(null);
          Alert.alert("Task forwarded", message);
          void loadTasks();
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  loadMoreButton: {
    alignItems: "center",
    justifyContent: "center",
    minHeight: 44,
    marginTop: Spacing.md,
    borderRadius: BorderRadius.md,
    borderWidth: 1,
    borderColor: PRIMARY,
  },
  // ── hero header ───────────────────────────────────────────────────────────
  header: {
    paddingHorizontal: Spacing.lg,
    paddingBottom: Spacing.md,
    borderBottomLeftRadius: 24,
    borderBottomRightRadius: 24,
    ...(isWeb
      ? { boxShadow: "0 6px 24px rgba(109,27,109,0.18)" }
      : {
          shadowColor: "#6D1B6D",
          shadowOffset: { width: 0, height: 6 },
          shadowOpacity: 0.18,
          shadowRadius: 20,
          elevation: 10,
        }),
  },
  headerRow: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: Spacing.md,
  },
  addBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: "#FFFFFF",
    alignItems: "center",
    justifyContent: "center",
  },
  searchBar: {
    flexDirection: "row",
    alignItems: "center",
    borderRadius: BorderRadius.full,
    paddingHorizontal: Spacing.md,
    height: 40,
    gap: Spacing.sm,
    marginBottom: Spacing.md,
  },
  searchInput: {
    flex: 1,
    fontSize: 14,
    color: "#FFFFFF",
  },
  filtersScroll: { marginHorizontal: -Spacing.lg },
  filtersContent: {
    paddingHorizontal: Spacing.lg,
    gap: Spacing.sm,
    paddingBottom: Spacing.md,
  },
  filterChip: {
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: BorderRadius.full,
  },
  tasksList: {
    gap: Spacing.md,
  },
  eventTaskSection: {
    gap: Spacing.sm,
    marginBottom: Spacing.xl,
  },
  eventTaskHeading: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.sm,
  },
  eventTaskCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.md,
    padding: Spacing.lg,
    borderRadius: BorderRadius.md,
    borderLeftWidth: 4,
  },
  eventTaskIcon: {
    width: 42,
    height: 42,
    borderRadius: BorderRadius.md,
    alignItems: "center",
    justifyContent: "center",
  },
  eventStatus: {
    paddingHorizontal: Spacing.sm,
    paddingVertical: 4,
    borderRadius: BorderRadius.full,
  },
  eventDetailRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: Spacing.sm,
    paddingVertical: Spacing.sm,
  },
  taskCard: {
    borderRadius: BorderRadius.md,
    overflow: "hidden",
    flexDirection: "row",
    ...(isWeb
      ? {}
      : {
          shadowColor: "#6D1B6D",
          shadowOffset: { width: 0, height: 2 },
          shadowOpacity: 0.07,
          shadowRadius: 8,
          elevation: 2,
        }),
  },
  taskCardInner: {
    flex: 1,
    padding: Spacing.lg,
  },
  taskHeader: {
    flexDirection: "row",
    gap: Spacing.sm,
    marginBottom: Spacing.sm,
  },
  taskTypeIcon: {
    width: 36,
    height: 36,
    borderRadius: BorderRadius.sm,
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
  },
  taskTitleContainer: { flex: 1 },
  taskTitle: { fontWeight: "700", marginBottom: Spacing.xs },
  taskMeta: { flexDirection: "row", gap: Spacing.sm, flexWrap: "wrap" },
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
  taskFooter: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  deadlineContainer: { flexDirection: "row", alignItems: "center", gap: 4 },
  actionButtons: { flexDirection: "row", gap: Spacing.sm },
  originRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    marginBottom: Spacing.sm,
  },
  viewOnlyBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: Spacing.sm,
    paddingVertical: 3,
    borderRadius: BorderRadius.full,
  },
  viewOnlyNotice: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.sm,
    padding: Spacing.md,
    borderRadius: BorderRadius.sm,
    borderWidth: 1,
  },
  forwardRow: {
    flexDirection: "row",
    alignItems: "center",
    flexWrap: "wrap",
    gap: Spacing.sm,
    marginTop: Spacing.md,
    paddingTop: Spacing.sm,
    borderTopWidth: 1,
  },
  forwardBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    minHeight: 32,
    paddingHorizontal: Spacing.md,
    borderRadius: BorderRadius.full,
    borderWidth: 1,
  },
  scopeRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: Spacing.sm,
    marginBottom: Spacing.md,
  },
  scopeChip: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: BorderRadius.full,
    borderWidth: 1,
  },
  shareSwitchRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.md,
    padding: Spacing.md,
    borderRadius: BorderRadius.sm,
    borderWidth: 1,
  },
  actionBtn: {
    width: 30,
    height: 30,
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
  },
  emptyState: {
    alignItems: "center",
    padding: Spacing["3xl"],
    borderRadius: BorderRadius.lg,
    marginTop: Spacing.xl,
  },
  emptyIconWrap: {
    width: 64,
    height: 64,
    borderRadius: 32,
    alignItems: "center",
    justifyContent: "center",
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
