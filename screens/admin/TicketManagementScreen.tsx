import React, { useState, useCallback } from "react";
import {
  StyleSheet,
  View,
  FlatList,
  Pressable,
  Modal,
  TextInput,
  ScrollView,
  Alert,
  SectionList,
} from "react-native";
import Feather from "@expo/vector-icons/Feather";
import { useFocusEffect } from "@react-navigation/native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { ThemedText } from "@/components/ThemedText";
import { formatDate } from "@/utils/format";
import { ThemedView } from "@/components/ThemedView";
import { Button } from "@/components/Button";
import { useTheme } from "@/hooks/useTheme";
import { Spacing, BorderRadius, Colors } from "@/constants/theme";
import Spacer from "@/components/Spacer";
import {
  SupportTicketService,
  SupportTicket,
  TicketStatus,
} from "@/services/support-ticket.service";

const STATUS_OPTIONS: { value: TicketStatus; label: string; color: string }[] = [
  { value: "open", label: "Open", color: Colors.light.info },
  { value: "in_progress", label: "In Progress", color: Colors.light.warning },
  { value: "resolved", label: "Resolved", color: Colors.light.success },
  { value: "closed", label: "Closed", color: "#9CA3AF" },
];

const FILTER_OPTIONS = ["all", "open", "in_progress", "resolved", "closed"] as const;

function statusColor(s: string) {
  return STATUS_OPTIONS.find((o) => o.value === s)?.color ?? "#9CA3AF";
}
function priorityColor(p: string) {
  return p === "high" ? Colors.light.error : p === "medium" ? Colors.light.warning : Colors.light.success;
}

// Group tickets by date (YYYY-MM-DD of created_at)
function groupByDate(tickets: SupportTicket[]): { title: string; data: SupportTicket[] }[] {
  const map: Record<string, SupportTicket[]> = {};
  for (const t of tickets) {
    const day = formatDate(t.created_at);
    if (!map[day]) map[day] = [];
    map[day].push(t);
  }
  return Object.entries(map).map(([title, data]) => ({ title, data }));
}

export default function TicketManagementScreen() {
  const { theme } = useTheme();
  const insets = useSafeAreaInsets();
  const [tickets, setTickets] = useState<SupportTicket[]>([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<"manage" | "log">("manage");
  const [filter, setFilter] = useState<typeof FILTER_OPTIONS[number]>("all");
  const [selected, setSelected] = useState<SupportTicket | null>(null);
  const [newStatus, setNewStatus] = useState<TicketStatus>("open");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);

  const loadTickets = useCallback(async () => {
    setLoading(true);
    const { data } = await SupportTicketService.getAllTickets();
    setTickets((data as any[])?.map((t) => ({
      ...t,
      user_name: t.profiles?.name,
      user_phone: t.profiles?.phone,
    })) || []);
    setLoading(false);
  }, []);

  useFocusEffect(useCallback(() => { loadTickets(); }, [loadTickets]));

  const openDetail = (ticket: SupportTicket) => {
    setSelected(ticket);
    setNewStatus(ticket.status);
    setNotes(ticket.resolution_notes || "");
  };

  const handleUpdate = async () => {
    if (!selected) return;
    setSaving(true);
    const { error } = await SupportTicketService.updateTicketStatus(selected.id, newStatus, notes);
    setSaving(false);
    if (error) {
      Alert.alert("Error", error.message);
    } else {
      setSelected(null);
      loadTickets();
    }
  };

  const filtered = filter === "all" ? tickets : tickets.filter((t) => t.status === filter);

  const logSections = groupByDate(tickets);

  const counts = {
    open: tickets.filter((t) => t.status === "open").length,
    in_progress: tickets.filter((t) => t.status === "in_progress").length,
  };

  const renderTicket = ({ item }: { item: SupportTicket }) => (
    <Pressable
      style={[styles.card, { backgroundColor: theme.backgroundDefault }]}
      onPress={() => openDetail(item)}
    >
      <View style={styles.cardTop}>
        <View style={{ flex: 1 }}>
          <ThemedText type="body" style={{ fontWeight: "700" }} numberOfLines={1}>
            {item.title}
          </ThemedText>
          <ThemedText type="caption" style={{ color: theme.textSecondary, marginTop: 2 }}>
            {item.user_name || "Unknown"} {item.user_phone ? `· ${item.user_phone}` : ""}
          </ThemedText>
        </View>
        <View style={[styles.badge, { backgroundColor: statusColor(item.status) + "20" }]}>
          <ThemedText type="caption" style={{ color: statusColor(item.status), fontWeight: "700", fontSize: 10 }}>
            {item.status.replace("_", " ").toUpperCase()}
          </ThemedText>
        </View>
      </View>
      <ThemedText type="caption" style={{ color: theme.textSecondary, marginTop: 4 }} numberOfLines={2}>
        {item.description}
      </ThemedText>
      <View style={styles.cardMeta}>
        <View style={[styles.catChip, { backgroundColor: priorityColor(item.priority) + "15" }]}>
          <ThemedText type="caption" style={{ color: priorityColor(item.priority), fontWeight: "600", fontSize: 10 }}>
            {item.priority.toUpperCase()}
          </ThemedText>
        </View>
        <ThemedText type="caption" style={{ color: theme.textSecondary }}>
          {item.category.toUpperCase()}
        </ThemedText>
        <ThemedText type="caption" style={{ color: theme.textSecondary }}>
          {formatDate(item.created_at)}
        </ThemedText>
      </View>
    </Pressable>
  );

  return (
    <View style={[styles.container, { paddingTop: insets.top > 0 ? insets.top : Spacing.lg }]}>
      {/* Summary row */}
      {(counts.open > 0 || counts.in_progress > 0) && (
        <View style={styles.summaryRow}>
          {counts.open > 0 && (
            <View style={[styles.summaryChip, { backgroundColor: Colors.light.info + "15" }]}>
              <ThemedText type="caption" style={{ color: Colors.light.info, fontWeight: "700" }}>
                {counts.open} Open
              </ThemedText>
            </View>
          )}
          {counts.in_progress > 0 && (
            <View style={[styles.summaryChip, { backgroundColor: Colors.light.warning + "15" }]}>
              <ThemedText type="caption" style={{ color: Colors.light.warning, fontWeight: "700" }}>
                {counts.in_progress} In Progress
              </ThemedText>
            </View>
          )}
        </View>
      )}

      {/* Tabs: Manage / Log */}
      <View style={[styles.tabRow, { backgroundColor: theme.backgroundDefault }]}>
        {(["manage", "log"] as const).map((t) => (
          <Pressable
            key={t}
            style={[styles.tabBtn, tab === t && { borderBottomColor: theme.primary, borderBottomWidth: 2 }]}
            onPress={() => setTab(t)}
          >
            <ThemedText
              type="caption"
              style={{ color: tab === t ? theme.primary : theme.textSecondary, fontWeight: "700" }}
            >
              {t === "manage" ? `🎫 Manage (${tickets.length})` : `📋 Date Log`}
            </ThemedText>
          </Pressable>
        ))}
      </View>

      {tab === "manage" ? (
        <>
          {/* Filter tabs */}
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.filterScroll} contentContainerStyle={styles.filterRow}>
            {FILTER_OPTIONS.map((f) => (
              <Pressable
                key={f}
                style={[styles.filterChip, { backgroundColor: filter === f ? theme.primary : theme.backgroundDefault }]}
                onPress={() => setFilter(f)}
              >
                <ThemedText type="caption" style={{ color: filter === f ? "#fff" : theme.textSecondary, fontWeight: "600" }}>
                  {f === "all" ? "All" : f.replace("_", " ").replace(/\b\w/g, (c) => c.toUpperCase())}
                </ThemedText>
              </Pressable>
            ))}
          </ScrollView>

          <FlatList
            data={filtered}
            keyExtractor={(item) => item.id}
            renderItem={renderTicket}
            contentContainerStyle={[styles.list, { paddingBottom: insets.bottom + 80 }]}
            ListEmptyComponent={
              loading ? null : (
                <View style={styles.empty}>
                  <Feather name="inbox" size={40} color={theme.textSecondary} />
                  <Spacer height={Spacing.md} />
                  <ThemedText type="body" style={{ color: theme.textSecondary }}>No tickets found</ThemedText>
                </View>
              )
            }
          />
        </>
      ) : (
        /* ── Date Log View ── */
        <SectionList
          sections={logSections}
          keyExtractor={(item) => item.id}
          contentContainerStyle={[styles.list, { paddingBottom: insets.bottom + 80 }]}
          ListEmptyComponent={
            <View style={styles.empty}>
              <Feather name="calendar" size={40} color={theme.textSecondary} />
              <Spacer height={Spacing.md} />
              <ThemedText type="body" style={{ color: theme.textSecondary }}>No ticket history</ThemedText>
            </View>
          }
          renderSectionHeader={({ section }) => (
            <View style={[styles.dateHeader, { backgroundColor: theme.backgroundRoot }]}>
              <Feather name="calendar" size={13} color={theme.primary} />
              <ThemedText type="caption" style={{ color: theme.primary, fontWeight: "800", fontSize: 12 }}>
                {section.title}
              </ThemedText>
              <View style={[styles.dateBadge, { backgroundColor: theme.primary + "20" }]}>
                <ThemedText type="caption" style={{ color: theme.primary, fontWeight: "700", fontSize: 10 }}>
                  {section.data.length} ticket{section.data.length !== 1 ? "s" : ""}
                </ThemedText>
              </View>
            </View>
          )}
          renderItem={({ item }) => (
            <Pressable
              style={[styles.logRow, { backgroundColor: theme.backgroundDefault }]}
              onPress={() => { setTab("manage"); openDetail(item); }}
            >
              <View style={[styles.logDot, { backgroundColor: statusColor(item.status) }]} />
              <View style={{ flex: 1 }}>
                <ThemedText type="body" style={{ fontWeight: "600", fontSize: 13 }} numberOfLines={1}>
                  {item.title}
                </ThemedText>
                <ThemedText type="caption" style={{ color: theme.textSecondary, marginTop: 1 }}>
                  {item.user_name || "Unknown"}
                  {" · "}
                  {new Date(item.created_at).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", hour12: true })}
                </ThemedText>
              </View>
              <View style={{ alignItems: "flex-end", gap: 4 }}>
                <View style={[styles.badge, { backgroundColor: statusColor(item.status) + "20" }]}>
                  <ThemedText type="caption" style={{ color: statusColor(item.status), fontWeight: "700", fontSize: 10 }}>
                    {item.status.replace("_", " ").toUpperCase()}
                  </ThemedText>
                </View>
                <ThemedText type="caption" style={{ color: priorityColor(item.priority), fontWeight: "600", fontSize: 10 }}>
                  {item.priority.toUpperCase()}
                </ThemedText>
              </View>
            </Pressable>
          )}
        />
      )}

      {/* Detail / Update Modal */}
      <Modal visible={!!selected} animationType="slide" transparent onRequestClose={() => setSelected(null)}>
        <View style={styles.overlay}>
          <ThemedView style={[styles.sheet, { paddingBottom: insets.bottom + Spacing.lg }]}>
            <View style={styles.sheetHeader}>
              <ThemedText type="h3">Ticket Detail</ThemedText>
              <Pressable onPress={() => setSelected(null)}>
                <Feather name="x" size={24} color={theme.text} />
              </Pressable>
            </View>
            <ScrollView style={styles.sheetBody} keyboardShouldPersistTaps="handled">
              <ThemedText type="body" style={{ fontWeight: "700" }}>{selected?.title}</ThemedText>
              <Spacer height={4} />
              <ThemedText type="caption" style={{ color: theme.textSecondary }}>
                From: {selected?.user_name} {selected?.user_phone ? `(${selected.user_phone})` : ""}
              </ThemedText>
              <ThemedText type="caption" style={{ color: theme.textSecondary }}>
                Category: {selected?.category} · Priority: {selected?.priority}
              </ThemedText>
              <Spacer height={Spacing.md} />
              <ThemedText type="body">{selected?.description}</ThemedText>

              <Spacer height={Spacing.xl} />
              <ThemedText type="small" style={styles.label}>Update Status</ThemedText>
              <View style={styles.statusRow}>
                {STATUS_OPTIONS.map((s) => (
                  <Pressable
                    key={s.value}
                    style={[styles.statusChip, { backgroundColor: newStatus === s.value ? s.color : theme.backgroundSecondary }]}
                    onPress={() => setNewStatus(s.value)}
                  >
                    <ThemedText type="caption" style={{ color: newStatus === s.value ? "#fff" : theme.textSecondary, fontWeight: "600" }}>
                      {s.label}
                    </ThemedText>
                  </Pressable>
                ))}
              </View>

              <Spacer height={Spacing.md} />
              <ThemedText type="small" style={styles.label}>Resolution Notes</ThemedText>
              <TextInput
                style={[styles.notesInput, { backgroundColor: theme.backgroundSecondary, color: theme.text }]}
                value={notes}
                onChangeText={setNotes}
                placeholder="Add resolution notes (optional)"
                placeholderTextColor={theme.textSecondary}
                multiline
                numberOfLines={3}
                textAlignVertical="top"
              />

              <Spacer height={Spacing.xl} />
              <Button onPress={handleUpdate}>{saving ? "Saving..." : "Update Ticket"}</Button>
            </ScrollView>
          </ThemedView>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  summaryRow: { flexDirection: "row", gap: Spacing.sm, padding: Spacing.md, paddingBottom: 0 },
  summaryChip: { paddingHorizontal: Spacing.md, paddingVertical: Spacing.xs, borderRadius: BorderRadius.full },
  tabRow: { flexDirection: "row", borderBottomWidth: 1, borderBottomColor: "#E5E7EB" },
  tabBtn: { flex: 1, alignItems: "center", paddingVertical: Spacing.sm },
  filterScroll: { maxHeight: 52 },
  filterRow: { flexDirection: "row", gap: Spacing.sm, paddingHorizontal: Spacing.md, paddingVertical: Spacing.sm },
  filterChip: { paddingHorizontal: Spacing.md, paddingVertical: Spacing.sm, borderRadius: BorderRadius.full },
  list: { padding: Spacing.md, gap: Spacing.md },
  card: { padding: Spacing.lg, borderRadius: BorderRadius.md },
  cardTop: { flexDirection: "row", alignItems: "flex-start", gap: Spacing.sm },
  badge: { paddingHorizontal: Spacing.sm, paddingVertical: 3, borderRadius: BorderRadius.xs },
  cardMeta: { flexDirection: "row", alignItems: "center", gap: Spacing.md, marginTop: Spacing.sm },
  catChip: { paddingHorizontal: Spacing.sm, paddingVertical: 2, borderRadius: BorderRadius.xs },
  empty: { alignItems: "center", paddingTop: 80 },
  overlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.5)", justifyContent: "flex-end" },
  sheet: { borderTopLeftRadius: BorderRadius.xl, borderTopRightRadius: BorderRadius.xl, maxHeight: "85%" },
  sheetHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", padding: Spacing.lg, borderBottomWidth: 1, borderBottomColor: "rgba(128,128,128,0.2)" },
  sheetBody: { padding: Spacing.lg },
  label: { fontWeight: "600", marginBottom: Spacing.xs },
  statusRow: { flexDirection: "row", flexWrap: "wrap", gap: Spacing.sm },
  statusChip: { paddingHorizontal: Spacing.md, paddingVertical: Spacing.sm, borderRadius: BorderRadius.full },
  notesInput: { borderRadius: BorderRadius.sm, padding: Spacing.md, minHeight: 80, fontSize: 14 },
  // Log view
  dateHeader: { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: Spacing.md, paddingVertical: 8, marginTop: 4 },
  dateBadge: { paddingHorizontal: 7, paddingVertical: 2, borderRadius: 10 },
  logRow: { flexDirection: "row", alignItems: "center", gap: Spacing.md, padding: Spacing.md, borderRadius: BorderRadius.md, marginBottom: 6 },
  logDot: { width: 10, height: 10, borderRadius: 5, flexShrink: 0 },
});
