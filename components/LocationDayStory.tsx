import React from "react";
import { Linking, Pressable, StyleSheet, View } from "react-native";
import { ThemedText } from "@/components/ThemedText";
import { useTheme } from "@/hooks/useTheme";
import { fmtDistance, istClock } from "@/utils/locationFreshness";

export interface LocationStorySegment {
  type: "STAY" | "TRIP" | "GAP";
  start: string;
  end: string;
  minutes: number;
  distance_m?: number;
  place?: string | null;
  latitude?: number;
  longitude?: number;
  points?: number;
}

export interface LocationStoryEvent {
  type: string;
  at: string;
  label: string;
}

export interface LocationStoryPoint {
  latitude: number;
  longitude: number;
  recorded_at: string;
  accuracy: number | null;
  quality: string;
  speed: number | null;
}

/** Server day story (rpc_location_timeline). */
export interface LocationStory {
  date: string;
  segments: LocationStorySegment[];
  events: LocationStoryEvent[];
  points: LocationStoryPoint[];
  summary: {
    first_fix: string | null;
    last_fix: string | null;
    good_points: number;
    all_points: number;
    flagged_points: number;
    low_accuracy_points: number;
    distance_km: number;
    moving_minutes: number;
    stationary_minutes: number;
    gap_minutes: number;
  };
}

function duration(minutes: number) {
  const m = Math.max(0, Math.round(minutes));
  if (m < 60) return `${m} min`;
  return m % 60 ? `${Math.floor(m / 60)}h ${m % 60}m` : `${Math.floor(m / 60)}h`;
}

type Row =
  | { kind: "segment"; at: string; segment: LocationStorySegment }
  | { kind: "event"; at: string; event: LocationStoryEvent };

/** The day as stays, trips, gaps and check-in events (never raw dots). */
export default function LocationDayStory({ story }: { story: LocationStory }) {
  const { theme } = useTheme();
  const rows: Row[] = [
    ...story.segments.map((segment) => ({ kind: "segment" as const, at: segment.start, segment })),
    ...story.events.map((event) => ({ kind: "event" as const, at: event.at, event })),
  ].sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
  const sum = story.summary;

  return (
    <View style={{ gap: 6, marginBottom: 10 }}>
      <ThemedText style={{ fontSize: 11, color: theme.textSecondary, fontWeight: "700" }}>DAY SUMMARY</ThemedText>
      <ThemedText style={{ fontSize: 12, color: theme.text }}>
        {sum.good_points
          ? `${istClock(sum.first_fix)} – ${istClock(sum.last_fix)} · travelled ${sum.distance_km} km · moving ${duration(sum.moving_minutes)} · in one place ${duration(sum.stationary_minutes)}`
          : "No good GPS position recorded this day."}
      </ThemedText>
      {sum.gap_minutes > 0 || sum.flagged_points > 0 || sum.low_accuracy_points > 0 ? (
        <ThemedText style={{ fontSize: 12, color: "#B45309" }}>
          {[
            sum.gap_minutes > 0 ? `no location for ${duration(sum.gap_minutes)} in total` : null,
            sum.flagged_points > 0 ? `${sum.flagged_points} suspicious point(s) ignored` : null,
            sum.low_accuracy_points > 0 ? `${sum.low_accuracy_points} weak-GPS point(s) ignored` : null,
          ].filter(Boolean).join(" · ")}
        </ThemedText>
      ) : null}

      <View style={[styles.list, { borderColor: theme.border }]}>
        {rows.length === 0 ? (
          <ThemedText style={{ fontSize: 12, color: theme.textSecondary, padding: 8 }}>Nothing recorded.</ThemedText>
        ) : null}
        {rows.map((row, index) => {
          if (row.kind === "event") {
            return (
              <View key={`e${index}`} style={styles.row}>
                <ThemedText style={[styles.time, { color: theme.textSecondary }]}>{istClock(row.event.at)}</ThemedText>
                <ThemedText style={{ fontSize: 12, color: theme.textSecondary, flex: 1 }}>🔑 {row.event.label}</ThemedText>
              </View>
            );
          }
          const seg = row.segment;
          const range = `${istClock(seg.start)} – ${istClock(seg.end)}`;
          if (seg.type === "GAP") {
            return (
              <View key={`g${index}`} style={[styles.row, { backgroundColor: "#FEF2F2" }]}>
                <ThemedText style={[styles.time, { color: "#DC2626" }]}>{istClock(seg.start)}</ThemedText>
                <ThemedText style={{ fontSize: 12, color: "#DC2626", flex: 1 }}>
                  ⚠ No location for {duration(seg.minutes)} ({range})
                </ThemedText>
              </View>
            );
          }
          if (seg.type === "TRIP") {
            return (
              <View key={`t${index}`} style={styles.row}>
                <ThemedText style={[styles.time, { color: "#2563EB" }]}>{istClock(seg.start)}</ThemedText>
                <ThemedText style={{ fontSize: 12, color: theme.text, flex: 1 }}>
                  🚗 Travelled {fmtDistance(seg.distance_m ?? 0) || "0 m"} in {duration(seg.minutes)} ({range})
                </ThemedText>
              </View>
            );
          }
          const canOpen = seg.latitude != null && seg.longitude != null;
          return (
            <Pressable
              key={`s${index}`}
              disabled={!canOpen}
              onPress={() => {
                if (canOpen) void Linking.openURL(`https://www.google.com/maps/search/?api=1&query=${seg.latitude},${seg.longitude}`);
              }}
              style={[styles.row, { backgroundColor: "#F0FDF4" }]}
            >
              <ThemedText style={[styles.time, { color: "#059669" }]}>{istClock(seg.start)}</ThemedText>
              <ThemedText style={{ fontSize: 12, color: theme.text, flex: 1 }}>
                📍 {seg.place ?? "Stopped"} · {duration(seg.minutes)} ({range})
              </ThemedText>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  list: { borderWidth: StyleSheet.hairlineWidth, borderRadius: 8, overflow: "hidden" },
  row: { flexDirection: "row", gap: 8, paddingVertical: 6, paddingHorizontal: 8, alignItems: "flex-start" },
  time: { fontSize: 12, fontWeight: "700", width: 64 },
});
