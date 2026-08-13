import React, { useState, useCallback } from "react";
import {
  StyleSheet, View, TextInput, ScrollView,
  Pressable, Alert, FlatList, Platform,
} from "react-native";
import Feather from "@expo/vector-icons/Feather";
import { useFocusEffect } from "@react-navigation/native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { ThemedText } from "@/components/ThemedText";
import { formatDate } from "@/utils/format";
import { PageHeader } from "@/components/PageHeader";
import { Button } from "@/components/Button";
import { useTheme } from "@/hooks/useTheme";
import { Spacing, BorderRadius, Colors } from "@/constants/theme";
import Spacer from "@/components/Spacer";
import { useAuth } from "@/contexts/AuthContext";
import {
  SupportTicketService, SupportTicket,
  TicketCategory, TicketPriority,
} from "@/services/support-ticket.service";

const CATEGORIES: { value: TicketCategory; label: string; icon: keyof typeof Feather.glyphMap }[] = [
  { value: "technical", label: "Technical", icon: "monitor"      },
  { value: "hardware",  label: "Hardware",  icon: "cpu"          },
  { value: "hr",        label: "HR",        icon: "users"        },
  { value: "payroll",   label: "Payroll",   icon: "dollar-sign"  },
  { value: "leave",     label: "Leave",     icon: "calendar"     },
  { value: "other",     label: "Other",     icon: "help-circle"  },
];

const PRIORITIES: { value: TicketPriority; label: string; color: string }[] = [
  { value: "low",    label: "Low",    color: Colors.light.success },
  { value: "medium", label: "Medium", color: Colors.light.warning },
  { value: "high",   label: "High",   color: Colors.light.error   },
];

const STATUS_COLORS: Record<string, string> = {
  open:        Colors.light.info,
  in_progress: Colors.light.warning,
  resolved:    Colors.light.success,
  closed:      "#9CA3AF",
};

export default function RaiseTicketScreen() {
  const { theme } = useTheme();
  const insets = useSafeAreaInsets();
  const { user } = useAuth();

  const [tab,           setTab]           = useState<"raise" | "my">("my");
  const [title,         setTitle]         = useState("");
  const [description,   setDescription]   = useState("");
  const [category,      setCategory]      = useState<TicketCategory>("technical");
  const [priority,      setPriority]      = useState<TicketPriority>("medium");
  const [submitting,    setSubmitting]    = useState(false);
  const [submitSuccess, setSubmitSuccess] = useState(false);
  const [myTickets,     setMyTickets]     = useState<SupportTicket[]>([]);
  const [loadingTickets,setLoadingTickets]= useState(false);

  const loadMyTickets = useCallback(async () => {
    if (!user?.id) return;
    setLoadingTickets(true);
    const { data } = await SupportTicketService.getMyTickets(user.id);
    setMyTickets((data as SupportTicket[]) || []);
    setLoadingTickets(false);
  }, [user?.id]);

  useFocusEffect(useCallback(() => { loadMyTickets(); }, [loadMyTickets]));

  const handleSubmit = async () => {
    if (!title.trim() || !description.trim()) {
      Alert.alert("Required", "Please fill in title and description.");
      return;
    }
    if (!user?.id) return;
    setSubmitting(true);
    const { error } = await SupportTicketService.createTicket({
      userId: user.id, title: title.trim(),
      description: description.trim(), category, priority,
    });
    setSubmitting(false);
    if (error) {
      Alert.alert("Error", "Failed to submit ticket: " + error.message);
    } else {
      setTitle(""); setDescription(""); setCategory("technical"); setPriority("medium");
      setSubmitSuccess(true);
      setTab("my");
      loadMyTickets();
      setTimeout(() => setSubmitSuccess(false), 4000);
    }
  };

  const renderTicket = ({ item }: { item: SupportTicket }) => {
    const sc = STATUS_COLORS[item.status] ?? "#9CA3AF";
    const isResolved = item.status === "resolved" || item.status === "closed";
    return (
      <View style={[styles.ticketCard, { backgroundColor: theme.backgroundDefault }]}>
        <View style={[styles.ticketBar, { backgroundColor: sc }]} />
        <View style={{ flex: 1, padding: Spacing.md }}>
          <View style={styles.ticketTop}>
            <ThemedText type="small" style={{ fontWeight: "700", flex: 1, color: theme.text }} numberOfLines={1}>
              {item.title}
            </ThemedText>
            <View style={[styles.sBadge, { backgroundColor: sc + "20" }]}>
              <ThemedText type="caption" style={{ color: sc, fontWeight: "700", fontSize: 10 }}>
                {item.status.replace("_", " ").toUpperCase()}
              </ThemedText>
            </View>
          </View>
          <ThemedText type="caption" style={{ color: theme.textSecondary, marginTop: 4 }} numberOfLines={2}>
            {item.description}
          </ThemedText>
          <View style={styles.ticketMeta}>
            <ThemedText type="caption" style={{ color: theme.textSecondary }}>
              {item.category.toUpperCase()} · {item.priority.toUpperCase()}
            </ThemedText>
            <ThemedText type="caption" style={{ color: theme.textSecondary }}>
              {formatDate(item.created_at)}
            </ThemedText>
          </View>
          <View style={[
            styles.resolutionBox,
            { backgroundColor: isResolved ? Colors.light.success + "10" : "#FEF3C7",
              borderColor: isResolved ? Colors.light.success + "40" : "#FDE68A" },
          ]}>
            <Feather
              name={isResolved ? "check-circle" : "clock"}
              size={12}
              color={isResolved ? Colors.light.success : "#D97706"}
            />
            <ThemedText type="caption" style={{ color: isResolved ? Colors.light.success : "#92400E", marginLeft: 6, flex: 1 }}>
              {isResolved
                ? (item.resolution_notes || "This ticket has been resolved.")
                : "Awaiting response · team reverts within 24 hrs"
              }
            </ThemedText>
          </View>
        </View>
      </View>
    );
  };

  return (
    <View style={{ flex: 1, backgroundColor: theme.backgroundDefault }}>
      <PageHeader
        title="Support"
        subtitle="Raise and track tickets"
        rightIcon="plus"
        rightLabel="New"
        onRightPress={() => setTab("raise")}
      />

      {/* Tab bar */}
      <View style={[styles.tabRow, { backgroundColor: theme.backgroundDefault, borderBottomColor: theme.border }]}>
        {(["my", "raise"] as const).map((t) => (
          <Pressable
            key={t}
            style={[styles.tabBtn, t === tab && { borderBottomColor: theme.primary, borderBottomWidth: 2 }]}
            onPress={() => { setTab(t); if (t === "my") loadMyTickets(); }}
          >
            <ThemedText
              type="body"
              style={{ color: t === tab ? theme.primary : theme.textSecondary, fontWeight: t === tab ? "700" : "400" }}
            >
              {t === "raise" ? "Raise Ticket" : `My Tickets${myTickets.length > 0 ? ` (${myTickets.length})` : ""}`}
            </ThemedText>
          </Pressable>
        ))}
      </View>

      {tab === "raise"
        ? <ScrollView
            style={{ flex: 1 }}
            contentContainerStyle={[styles.form, { paddingBottom: insets.bottom + 40 }]}
            keyboardShouldPersistTaps="handled"
          >
            <Spacer height={Spacing.lg} />
            <ThemedText type="small" style={styles.label}>Category</ThemedText>
            <View style={styles.chipRow}>
              {CATEGORIES.map((c) => (
                <Pressable
                  key={c.value}
                  style={[styles.chip, { backgroundColor: category === c.value ? theme.primary : theme.backgroundSecondary }]}
                  onPress={() => setCategory(c.value)}
                >
                  <Feather name={c.icon} size={13} color={category === c.value ? "#fff" : theme.textSecondary} />
                  <ThemedText type="caption" style={{ color: category === c.value ? "#fff" : theme.textSecondary, marginLeft: 4 }}>
                    {c.label}
                  </ThemedText>
                </Pressable>
              ))}
            </View>

            <Spacer height={Spacing.md} />
            <ThemedText type="small" style={styles.label}>Priority</ThemedText>
            <View style={styles.chipRow}>
              {PRIORITIES.map((p) => (
                <Pressable
                  key={p.value}
                  style={[styles.chip, { backgroundColor: priority === p.value ? p.color : theme.backgroundSecondary }]}
                  onPress={() => setPriority(p.value)}
                >
                  <ThemedText type="caption" style={{ color: priority === p.value ? "#fff" : theme.textSecondary, fontWeight: "600" }}>
                    {p.label}
                  </ThemedText>
                </Pressable>
              ))}
            </View>

            <Spacer height={Spacing.md} />
            <ThemedText type="small" style={styles.label}>Title *</ThemedText>
            <TextInput
              style={[styles.input, { backgroundColor: theme.backgroundSecondary, color: theme.text }]}
              value={title} onChangeText={setTitle}
              placeholder="Brief summary of the issue"
              placeholderTextColor={theme.textSecondary}
            />

            <Spacer height={Spacing.md} />
            <ThemedText type="small" style={styles.label}>Description *</ThemedText>
            <TextInput
              style={[styles.input, styles.textArea, { backgroundColor: theme.backgroundSecondary, color: theme.text }]}
              value={description} onChangeText={setDescription}
              placeholder="Describe the issue in detail..."
              placeholderTextColor={theme.textSecondary}
              multiline numberOfLines={5} textAlignVertical="top"
            />

            <Spacer height={Spacing.xl} />
            <Button onPress={handleSubmit}>{submitting ? "Submitting..." : "Submit Ticket"}</Button>
          </ScrollView>
        : <FlatList
            data={myTickets}
            keyExtractor={(item) => item.id}
            renderItem={renderTicket}
            contentContainerStyle={[styles.list, { paddingBottom: insets.bottom + 80 }]}
            ItemSeparatorComponent={() => <Spacer height={Spacing.sm} />}
            ListHeaderComponent={
              <>
                {submitSuccess && (
                  <View style={[styles.successBanner, { backgroundColor: Colors.light.success + "15", borderColor: Colors.light.success + "50" }]}>
                    <Feather name="check-circle" size={15} color={Colors.light.success} />
                    <ThemedText type="caption" style={{ color: Colors.light.success, flex: 1, marginLeft: 8, fontWeight: "600" }}>
                      Ticket submitted! We'll revert within 24 hours.
                    </ThemedText>
                  </View>
                )}
                <View style={[styles.infoBanner, { backgroundColor: "#EFF6FF", borderColor: "#BFDBFE" }]}>
                  <Feather name="info" size={14} color="#3B82F6" />
                  <ThemedText type="caption" style={{ color: "#1D4ED8", flex: 1, marginLeft: 8, lineHeight: 18 }}>
                    Our support team reviews your ticket and reverts within{" "}
                    <ThemedText type="caption" style={{ fontWeight: "700", color: "#1D4ED8" }}>24 hours</ThemedText>.
                  </ThemedText>
                </View>
              </>
            }
            ListEmptyComponent={
              loadingTickets ? null : (
                <View style={styles.empty}>
                  <Feather name="inbox" size={40} color="#9CA3AF" />
                  <Spacer height={Spacing.md} />
                  <ThemedText type="body" style={{ color: "#9CA3AF", textAlign: "center" }}>No tickets raised yet</ThemedText>
                </View>
              )
            }
          />
      }
    </View>
  );
}

const styles = StyleSheet.create({
  tabRow:    { flexDirection: "row", borderBottomWidth: 1 },
  tabBtn:    { flex: 1, alignItems: "center", paddingVertical: Spacing.md },
  form:      { paddingHorizontal: Spacing.lg },
  list:      { padding: Spacing.lg },
  label:     { fontWeight: "600", marginBottom: Spacing.xs },
  chipRow:   { flexDirection: "row", flexWrap: "wrap", gap: Spacing.sm },
  chip:      { flexDirection: "row", alignItems: "center", paddingHorizontal: Spacing.md, paddingVertical: 8, borderRadius: BorderRadius.full },
  input:     { borderRadius: 10, paddingHorizontal: Spacing.md, paddingVertical: Spacing.md, fontSize: 15 },
  textArea:  { minHeight: 110, paddingTop: Spacing.md },
  ticketCard:{ flexDirection: "row", borderRadius: 14, overflow: "hidden",
    ...(Platform.OS === "web"
      ? { boxShadow: "0 2px 8px rgba(109,27,109,0.07)" }
      : { shadowColor: "#6D1B6D", shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.07, shadowRadius: 8, elevation: 2 }),
  },
  ticketBar: { width: 4 },
  ticketTop: { flexDirection: "row", alignItems: "center", gap: Spacing.sm },
  sBadge:    { paddingHorizontal: 7, paddingVertical: 3, borderRadius: 5 },
  ticketMeta:{ flexDirection: "row", justifyContent: "space-between", marginTop: 6 },
  resolutionBox: {
    flexDirection: "row", alignItems: "flex-start",
    marginTop: 8, padding: 8, borderRadius: 8, borderWidth: 1,
  },
  successBanner: { flexDirection: "row", alignItems: "center", padding: Spacing.md, borderRadius: 12, borderWidth: 1, marginBottom: Spacing.sm },
  infoBanner:    { flexDirection: "row", alignItems: "flex-start", padding: Spacing.md, borderRadius: 12, borderWidth: 1, marginBottom: Spacing.md },
  empty:         { alignItems: "center", paddingTop: 60 },
});
