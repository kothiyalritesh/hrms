import React from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { ThemedText } from "@/components/ThemedText";
import { useTheme } from "@/hooks/useTheme";
import { BorderRadius, Spacing } from "@/constants/theme";

type Props = {
  page: number;
  pageSize: number;
  total: number;
  onPageChange: (page: number) => void;
};

export function PaginationControls({ page, pageSize, total, onPageChange }: Props) {
  const { theme } = useTheme();
  if (total <= pageSize) return null;
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  return (
    <View style={styles.row}>
      <Pressable
        disabled={page <= 0}
        onPress={() => onPageChange(page - 1)}
        style={[styles.button, { backgroundColor: theme.backgroundDefault, opacity: page <= 0 ? 0.45 : 1 }]}
      >
        <ThemedText type="small">Previous</ThemedText>
      </Pressable>
      <ThemedText type="caption" style={{ color: theme.textSecondary }}>
        Showing {page * pageSize + 1}-{Math.min((page + 1) * pageSize, total)} of {total}
      </ThemedText>
      <Pressable
        disabled={page + 1 >= pageCount}
        onPress={() => onPageChange(page + 1)}
        style={[styles.button, { backgroundColor: theme.backgroundDefault, opacity: page + 1 >= pageCount ? 0.45 : 1 }]}
      >
        <ThemedText type="small">Next</ThemedText>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: Spacing.sm, marginVertical: Spacing.sm },
  button: { paddingHorizontal: Spacing.md, paddingVertical: Spacing.sm, borderRadius: BorderRadius.sm },
});
