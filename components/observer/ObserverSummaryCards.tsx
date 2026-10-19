/**
 * ObserverSummaryCards.tsx
 * Top KPI cards for the Site Visit Observer panel:
 * - Total Visits
 * - At Site
 * - In Transit
 * - Completed
 * - Signal Lost
 */

import React from "react";
import { ScrollView, View, StyleSheet, TouchableOpacity } from "react-native";
import Feather from "@expo/vector-icons/Feather";
import { ThemedText } from "@/components/ThemedText";
import { useTheme } from "@/hooks/useTheme";
import { BorderRadius, Spacing } from "@/constants/theme";
import { SiteVisitObserverSummary } from "@/types/location-database";

export interface ObserverSummaryCardsProps {
  summary: SiteVisitObserverSummary;
  selectedFilter: string;
  onSelectFilter: (filter: string) => void;
}

export default function ObserverSummaryCards({
  summary,
  selectedFilter,
  onSelectFilter,
}: ObserverSummaryCardsProps) {
  const { theme } = useTheme();

  const cards = [
    {
      id: "ALL",
      label: "Total Visits",
      count: summary.total_visits,
      icon: "map-pin",
      color: "#7C3AED",
      bg: "#F5F3FF",
    },
    {
      id: "AT_SITE",
      label: "At Site",
      count: summary.at_site,
      icon: "check-circle",
      color: "#10B981",
      bg: "#ECFDF5",
    },
    {
      id: "IN_TRANSIT",
      label: "In Transit",
      count: summary.in_transit,
      icon: "navigation",
      color: "#6366F1",
      bg: "#EEF2FF",
    },
    {
      id: "COMPLETED",
      label: "Completed",
      count: summary.completed,
      icon: "flag",
      color: "#4B5563",
      bg: "#F3F4F6",
    },
    {
      id: "FLAGGED",
      label: "Flagged",
      count: summary.flagged ?? 0,
      icon: "alert-octagon",
      color: "#D97706",
      bg: "#FFFBEB",
    },
    {
      id: "SIGNAL_LOST",
      label: "No signal",
      count: summary.signal_lost,
      icon: "wifi-off",
      color: "#EF4444",
      bg: "#FEF2F2",
    },
  ];

  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ flexGrow: 0 }} contentContainerStyle={s.container}>
      {cards.map((c) => {
        const isSelected = selectedFilter === c.id;
        return (
          <TouchableOpacity
            key={c.id}
            style={[
              s.card,
              { backgroundColor: c.color + "12", borderColor: isSelected ? c.color : theme.border },
              isSelected && { borderWidth: 2 },
            ]}
            onPress={() => onSelectFilter(c.id)}
            accessibilityRole="button"
            accessibilityState={{ selected: isSelected }}
          >
            <View style={s.cardHeader}>
              <Feather name={c.icon as any} size={14} color={c.color} />
              <ThemedText style={[s.count, { color: c.color }]}>{c.count}</ThemedText>
            </View>
            <ThemedText style={[s.label, { color: theme.textSecondary }]}>{c.label}</ThemedText>
          </TouchableOpacity>
        );
      })}
    </ScrollView>
  );
}

const s = StyleSheet.create({
  container: {
    flexDirection: "row",
    gap: 8,
    paddingHorizontal: Spacing.md,
    paddingVertical: 6,
  },
  card: {
    minWidth: 84,
    minHeight: 48,
    flexGrow: 1,
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderRadius: BorderRadius.md,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  cardHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
  },
  count: {
    fontSize: 16,
    fontWeight: "800",
  },
  label: {
    fontSize: 12,
    fontWeight: "600",
    marginTop: 2,
  },
});

