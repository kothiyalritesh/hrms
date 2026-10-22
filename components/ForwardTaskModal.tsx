import React, { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
} from "react-native";
import Feather from "@expo/vector-icons/Feather";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { ThemedText } from "@/components/ThemedText";
import { ThemedView } from "@/components/ThemedView";
import { Button } from "@/components/Button";
import { useTheme } from "@/hooks/useTheme";
import { BorderRadius, Spacing } from "@/constants/theme";
import {
  DirectReport,
  TaskSharingService,
} from "@/services/task-sharing.service";

interface ForwardTaskModalProps {
  visible: boolean;
  task: { id: string; title: string; forwarded_count?: number | null } | null;
  onClose: () => void;
  /** Called after a successful forward with the server's message. */
  onForwarded: (message: string) => void;
}

export function ForwardTaskModal({
  visible,
  task,
  onClose,
  onForwarded,
}: ForwardTaskModalProps) {
  const { theme } = useTheme();
  const insets = useSafeAreaInsets();
  const [reports, setReports] = useState<DirectReport[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!visible) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    TaskSharingService.getMyDirectReports()
      .then((rows) => {
        if (cancelled) return;
        setReports(rows);
        setSelected(new Set(rows.map((r) => r.id)));
      })
      .catch((e: any) => {
        if (!cancelled) setError(e?.message || "Could not load your team.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [visible, task?.id]);

  const allSelected = reports.length > 0 && selected.size === reports.length;

  const toggle = (id: string) => {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleAll = () => {
    setSelected(allSelected ? new Set() : new Set(reports.map((r) => r.id)));
  };

  const submit = async () => {
    if (!task || selected.size === 0 || submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      const result = await TaskSharingService.forwardTask(
        task.id,
        allSelected ? null : Array.from(selected),
      );
      if (!result.success) {
        setError(result.message || "Could not forward this task.");
        return;
      }
      onForwarded(result.message || "Task forwarded.");
    } catch (e: any) {
      setError(e?.message || "Could not forward this task.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal
      visible={visible}
      animationType="slide"
      transparent
      onRequestClose={onClose}
    >
      <View style={styles.overlay}>
        <ThemedView
          style={[
            styles.container,
            { paddingBottom: insets.bottom + Spacing.lg },
          ]}
        >
          <View style={[styles.header, { borderBottomColor: theme.border }]}>
            <View style={{ flex: 1 }}>
              <ThemedText type="h4">Forward to my team</ThemedText>
              {task ? (
                <ThemedText
                  type="caption"
                  style={{ color: theme.textSecondary, marginTop: 2 }}
                  numberOfLines={1}
                >
                  {task.title}
                </ThemedText>
              ) : null}
            </View>
            <Pressable
              onPress={onClose}
              accessibilityRole="button"
              accessibilityLabel="Close"
              hitSlop={8}
            >
              <Feather name="x" size={24} color={theme.text} />
            </Pressable>
          </View>

          <View style={styles.body}>
            <ThemedText
              type="small"
              style={{ color: theme.textSecondary, marginBottom: Spacing.sm }}
            >
              People who report to you will see this task. Pick who should get
              it, or keep it at your level.
            </ThemedText>
            {task?.forwarded_count ? (
              <ThemedText
                type="small"
                style={{ color: theme.success, marginBottom: Spacing.sm }}
              >
                Already forwarded to {task.forwarded_count}.
              </ThemedText>
            ) : null}

            {loading ? (
              <ActivityIndicator
                color={theme.primary}
                style={{ marginVertical: Spacing.xl }}
              />
            ) : reports.length === 0 && !error ? (
              <ThemedText
                style={{ color: theme.textSecondary, marginVertical: Spacing.lg }}
              >
                Nobody reports to you yet.
              </ThemedText>
            ) : (
              <>
                {reports.length > 1 ? (
                  <Pressable
                    onPress={toggleAll}
                    style={[styles.row, { borderBottomColor: theme.border }]}
                    accessibilityRole="checkbox"
                    accessibilityState={{ checked: allSelected }}
                  >
                    <Feather
                      name={allSelected ? "check-square" : "square"}
                      size={20}
                      color={theme.primary}
                    />
                    <ThemedText style={{ fontWeight: "700", flex: 1 }}>
                      Everyone ({reports.length})
                    </ThemedText>
                  </Pressable>
                ) : null}
                <ScrollView style={styles.list}>
                  {reports.map((report) => {
                    const checked = selected.has(report.id);
                    return (
                      <Pressable
                        key={report.id}
                        onPress={() => toggle(report.id)}
                        style={[styles.row, { borderBottomColor: theme.borderLight }]}
                        accessibilityRole="checkbox"
                        accessibilityState={{ checked }}
                      >
                        <Feather
                          name={checked ? "check-square" : "square"}
                          size={20}
                          color={checked ? theme.primary : theme.textSecondary}
                        />
                        <View style={{ flex: 1, minWidth: 0 }}>
                          <ThemedText numberOfLines={1}>
                            {report.name || "Unnamed employee"}
                          </ThemedText>
                          {report.employee_number ? (
                            <ThemedText
                              type="caption"
                              style={{ color: theme.textSecondary }}
                            >
                              {report.employee_number}
                            </ThemedText>
                          ) : null}
                        </View>
                      </Pressable>
                    );
                  })}
                </ScrollView>
              </>
            )}

            {error ? (
              <ThemedText
                type="small"
                style={{ color: theme.error, marginTop: Spacing.sm }}
              >
                {error}
              </ThemedText>
            ) : null}

            <View style={styles.actions}>
              <Button
                variant="outline"
                onPress={onClose}
                style={styles.actionBtn}
              >
                Keep at my level
              </Button>
              <Button
                onPress={submit}
                disabled={loading || submitting || selected.size === 0}
                style={styles.actionBtn}
              >
                {submitting ? "Forwarding..." : `Forward (${selected.size})`}
              </Button>
            </View>
          </View>
        </ThemedView>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: "rgba(0, 0, 0, 0.5)",
    justifyContent: "flex-end",
  },
  container: {
    borderTopLeftRadius: BorderRadius.xl,
    borderTopRightRadius: BorderRadius.xl,
    maxHeight: "85%",
    width: "100%",
    maxWidth: 640,
    alignSelf: "center",
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.sm,
    padding: Spacing.lg,
    borderBottomWidth: 1,
  },
  body: { padding: Spacing.lg },
  list: { maxHeight: 320 },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.md,
    minHeight: 48,
    paddingVertical: Spacing.sm,
    borderBottomWidth: 1,
  },
  actions: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: Spacing.sm,
    marginTop: Spacing.lg,
  },
  actionBtn: { flexGrow: 1, flexBasis: 140 },
});
