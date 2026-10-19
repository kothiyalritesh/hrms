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
        <Feather name="search" size={16} color={theme.textSecondary} />
        <TextInput
          style={[s.input, { color: theme.text }]}
          placeholder="Search employee, ID, project..."
          placeholderTextColor={theme.textSecondary}
          value={searchText}
          onChangeText={onSearchChange}
          autoCorrect={false}
          autoCapitalize="none"
          returnKeyType="search"
          accessibilityLabel="Search employees"
        />
        {searchText.length > 0 && (
          <TouchableOpacity
            onPress={() => onSearchChange("")}
            style={s.clearBtn}
            accessibilityRole="button"
            accessibilityLabel="Clear search"
          >
            <Feather name="x" size={16} color={theme.textSecondary} />
          </TouchableOpacity>
        )}
      </View>

      {/* Quick Filter Chips */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={s.chipsRow}
        contentContainerStyle={s.chipsContent}
        keyboardShouldPersistTaps="handled"
      >
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
              hitSlop={{ top: 2, bottom: 2 }}
              accessibilityRole="button"
              accessibilityState={{ selected: isSelected }}
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
              hitSlop={{ top: 2, bottom: 2 }}
              accessibilityRole="button"
              accessibilityState={{ selected: isSelected }}
            >
              <ThemedText
                style={[
                  s.chipText,
                  { color: isSelected ? "#fff" : theme.textSecondary },
                ]}
              >
                Dept: {dept.length > 24 ? `${dept.slice(0, 23)}…` : dept}
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
    paddingLeft: 12,
    minHeight: 44,
    gap: 8,
  },
  input: {
    flex: 1,
    minWidth: 0,
    fontSize: 14,
    paddingVertical: 8,
    paddingHorizontal: 0,
  },
  clearBtn: {
    width: 44,
    height: 44,
    alignItems: "center",
    justifyContent: "center",
  },
  chipsRow: {
    flexGrow: 0,
  },
  chipsContent: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 2,
  },
  chip: {
    paddingHorizontal: 12,
    minHeight: 40,
    justifyContent: "center",
    borderRadius: BorderRadius.full,
    borderWidth: 1,
    marginRight: 8,
  },
  chipText: {
    fontSize: 13,
    fontWeight: "700",
  },
});

