import React, { useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, View } from "react-native";
import Feather from "@expo/vector-icons/Feather";
import { ThemedText } from "@/components/ThemedText";
import { useTheme } from "@/hooks/useTheme";
import { formatHrmsTime } from "@/utils/attendanceTimestamp";
import {
  EVENT_STYLE,
  currentPlace,
  dayProblems,
  keyEvents,
  type DayEvent,
} from "@/services/attendance-day-events.service";

const STRIP_MAX = 5;

function style(type: string) {
  return EVENT_STYLE[type] ?? { icon: "circle", color: "#64748B", short: type.toLowerCase() };
}

/** Full day, every source, in time order (also used in the Timeline window). */
export function DayEventList({ events }: { events: DayEvent[] }) {
  const { theme } = useTheme();
  return (
    <View style={{ gap: 6 }}>
      {events.map((e, i) => {
        const st = style(e.type);
        return (
          <View key={`${e.type}-${e.at}-${i}`} style={styles.listRow}>
            <ThemedText style={[styles.time, { color: theme.text }]}>{formatHrmsTime(e.at)}</ThemedText>
            <Feather name={st.icon as any} size={13} color={st.color} style={{ marginTop: 2 }} />
            <View style={{ flex: 1, minWidth: 0 }}>
              <ThemedText style={{ fontSize: 13, fontWeight: "700" }}>
                {e.title}
                {e.place ? <ThemedText style={{ fontSize: 13, fontWeight: "400" }}> · {e.place}</ThemedText> : null}
              </ThemedText>
              {e.detail && e.type !== "BIO_PUNCH" ? (
                <ThemedText type="caption" style={{ color: theme.textSecondary }}>
                  {e.type === "GPS_GAP" ? `until ${e.detail}` : e.detail}
                </ThemedText>
              ) : null}
              {!e.verified && e.type !== "GPS_GAP" ? (
                <ThemedText type="caption" style={{ color: "#D97706" }}>not confirmed</ThemedText>
              ) : null}
            </View>
          </View>
        );
      })}
    </View>
  );
}

/**
 * Card part of Attendance Control: the day at a glance (strip), the full day
 * on demand, where the employee is now (only as far as evidence shows) and
 * what needs attention.
 */
export default function DayStory({
  events,
  loading,
  onLoad,
}: {
  events?: DayEvent[];
  loading?: boolean;
  onLoad?: () => void;
}) {
  const { theme } = useTheme();
  const [open, setOpen] = useState(false);

  if (!events) {
    if (!onLoad) return null;
    return (
      <Pressable onPress={onLoad} style={[styles.more, { borderColor: theme.border }]} accessibilityRole="button">
        {loading ? <ActivityIndicator size="small" color={theme.primary} /> : <Feather name="list" size={12} color={theme.primary} />}
        <ThemedText style={{ color: theme.primary, fontSize: 12, fontWeight: "700" }}>Show the day</ThemedText>
      </Pressable>
    );
  }
  if (events.length === 0) return null;

  const strip = keyEvents(events);
  const shown = strip.slice(0, STRIP_MAX);
  const now = currentPlace(events);
  const problems = dayProblems(events);

  return (
    <View style={{ gap: 6, marginTop: 6 }}>
      <View style={styles.strip}>
        {shown.map((e, i) => {
          const st = style(e.type);
          return (
            <View key={`${e.type}-${e.at}-${i}`} style={styles.stripItem}>
              {i > 0 ? <Feather name="chevron-right" size={11} color={theme.textSecondary} /> : null}
              <View style={[styles.chip, { backgroundColor: st.color + "14", borderColor: st.color + "40" }]}>
                <Feather name={st.icon as any} size={10} color={st.color} />
                <ThemedText style={{ fontSize: 11, color: theme.text }} numberOfLines={1}>
                  {formatHrmsTime(e.at)} {st.short}
                  {e.place ? ` · ${e.place}` : ""}
                </ThemedText>
              </View>
            </View>
          );
        })}
        {strip.length > STRIP_MAX ? (
          <ThemedText type="caption" style={{ color: theme.textSecondary }}>+{strip.length - STRIP_MAX} more</ThemedText>
        ) : null}
      </View>

      {now ? (
        <ThemedText style={{ fontSize: 12, color: now.confirmed ? theme.text : "#D97706" }}>
          <ThemedText style={{ fontSize: 12, fontWeight: "800" }}>Now: </ThemedText>
          {now.text} · {now.confirmed ? "last confirmed" : "since"} {formatHrmsTime(now.at)}
          {now.confirmed ? "" : " (location not confirmed)"}
        </ThemedText>
      ) : null}

      {problems.map((p) => (
        <View key={p} style={styles.problem}>
          <Feather name="alert-circle" size={11} color="#D97706" />
          <ThemedText style={{ fontSize: 11, color: "#D97706", fontWeight: "700", flex: 1 }}>{p}</ThemedText>
        </View>
      ))}

      <Pressable onPress={() => setOpen((v) => !v)} style={styles.toggle} accessibilityRole="button">
        <Feather name={open ? "chevron-up" : "chevron-down"} size={12} color={theme.primary} />
        <ThemedText style={{ color: theme.primary, fontSize: 12, fontWeight: "700" }}>
          {open ? "Hide full day" : `Full day (${events.length})`}
        </ThemedText>
      </Pressable>
      {open ? (
        <View style={[styles.full, { borderColor: theme.border }]}>
          <DayEventList events={events} />
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  strip: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 4 },
  stripItem: { flexDirection: "row", alignItems: "center", gap: 4, maxWidth: "100%" },
  chip: { flexDirection: "row", alignItems: "center", gap: 4, borderWidth: 1, borderRadius: 10, paddingHorizontal: 6, paddingVertical: 2, flexShrink: 1 },
  problem: { flexDirection: "row", alignItems: "center", gap: 4 },
  toggle: { flexDirection: "row", alignItems: "center", gap: 4, alignSelf: "flex-start", minHeight: 28 },
  full: { borderWidth: 1, borderRadius: 8, padding: 8 },
  listRow: { flexDirection: "row", alignItems: "flex-start", gap: 8 },
  time: { width: 64, fontSize: 12, fontWeight: "700" },
  more: { flexDirection: "row", alignItems: "center", gap: 6, alignSelf: "flex-start", borderWidth: 1, borderRadius: 8, paddingHorizontal: 10, minHeight: 32, marginTop: 6 },
});
