/**
 * ObserverFilterBar.tsx
 * Quick filter chips & text search for Site Visit Observer
 */

import React from "react";
import { View, StyleSheet, TouchableOpacity, TextInput, ScrollView } from "react-native";
import Feather from "@expo/vector-icons/Feather";
import { ThemedText } from "@/components/ThemedText";
import { useTheme } from "@/hooks/useTheme";
import { BorderRadius, Spacing } from "@/constants/theme";

export interface ObserverFilterBarProps {
  searchText: string;
  onSearchChange: (text: string) => void;
  statusFilter: string;
  onStatusFilterChange: (status: string) => void;
  departments: string[];
  selectedDepartment: string;
  onDepartmentChange: (dept: string) => void;
}

const QUICK_FILTERS = [
  { id: "ALL", label: "ALL" },
  { id: "IN_TRANSIT", label: "🟣 IN TRANSIT" },
  { id: "AT_SITE", label: "🟢 AT SITE" },
  { id: "COMPLETED", label: "⚫ COMPLETED" },
  { id: "SIGNAL_LOST", label: "🟡 SIGNAL LOST" },
];

export default function ObserverFilterBar({
  searchText,
  onSearchChange,
  statusFilter,
  onStatusFilterChange,
  departments,
  selectedDepartment,
  onDepartmentChange,
}: ObserverFilterBarProps) {
  const { theme } = useTheme();

  return (
    <View style={[s.container, { backgroundColor: theme.backgroundDefault, borderBottomColor: theme.border }]}>
      {/* Search Row */}
      <View style={[s.searchBox, { backgroundColor: theme.backgroundRoot, borderColor: theme.border }]}>
        <Feather name="search" size={14} color={theme.textSecondary} />
        <TextInput
          style={[s.input, { color: theme.text }]}
          placeholder="Search employee, ID, project..."
          placeholderTextColor={theme.textSecondary}
          value={searchText}
          onChangeText={onSearchChange}
        />
        {searchText.length > 0 && (
          <TouchableOpacity onPress={() => onSearchChange("")}>
            <Feather name="x" size={14} color={theme.textSecondary} />
          </TouchableOpacity>
        )}
      </View>

      {/* Quick Filter Chips */}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={s.chipsRow}>
        {QUICK_FILTERS.map((f) => {
          const isSelected = statusFilter === f.id;
          return (
            <TouchableOpacity
              key={f.id}
              style={[
                s.chip,
                { backgroundColor: theme.backgroundRoot, borderColor: theme.border },
                isSelected && { backgroundColor: "#7C3AED", borderColor: "#7C3AED" },
              ]}
              onPress={() => onStatusFilterChange(f.id)}
            >
              <ThemedText
                style={[
                  s.chipText,
                  { color: isSelected ? "#fff" : theme.textSecondary },
                ]}
              >
                {f.label}
              </ThemedText>
            </TouchableOpacity>
          );
        })}

        {/* Department Chips if available */}
        {departments.map((dept) => {
          const isSelected = selectedDepartment === dept;
          return (
            <TouchableOpacity
              key={dept}
              style={[
                s.chip,
                { backgroundColor: theme.backgroundRoot, borderColor: theme.border },
                isSelected && { backgroundColor: "#0284C7", borderColor: "#0284C7" },
              ]}
              onPress={() => onDepartmentChange(isSelected ? "" : dept)}
            >
              <ThemedText
                style={[
                  s.chipText,
                  { color: isSelected ? "#fff" : theme.textSecondary },
                ]}
              >
                Dept: {dept}
              </ThemedText>
            </TouchableOpacity>
          );
        })}
      </ScrollView>
    </View>
  );
}

const s = StyleSheet.create({
  container: {
    paddingHorizontal: Spacing.md,
    paddingVertical: 6,
    borderBottomWidth: 1,
    gap: 6,
  },
  searchBox: {
    flexDirection: "row",
    alignItems: "center",
    borderWidth: 1,
    borderRadius: BorderRadius.md,
    paddingHorizontal: 10,
    paddingVertical: 6,
    gap: 8,
  },
  input: {
    flex: 1,
    fontSize: 13,
    padding: 0,
  },
  chipsRow: {
    flexDirection: "row",
    flexGrow: 0,
  },
  chip: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: BorderRadius.full,
    borderWidth: 1,
    marginRight: 6,
  },
  chipText: {
    fontSize: 11,
    fontWeight: "700",
  },
});

