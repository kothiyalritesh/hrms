import React from "react";
import { View, Pressable, StyleSheet, Platform } from "react-native";
import Feather from "@expo/vector-icons/Feather";
import { ThemedText } from "@/components/ThemedText";
import { Spacing, BorderRadius } from "@/constants/theme";

interface PageHeaderProps {
  title: string;
  subtitle?: string;
  rightIcon?: keyof typeof Feather.glyphMap;
  rightLabel?: string;
  onRightPress?: () => void;
  /** Pass a badge count to show on right icon */
  badge?: number;
  /** Force show the button even if it's on smaller screens */
  forceShowButton?: boolean;
}

export function PageHeader({
  title,
  subtitle,
  rightIcon,
  rightLabel,
  onRightPress,
  badge,
  forceShowButton = false,
}: PageHeaderProps) {
  const PRIMARY = "#6D1B6D";

  return (
    <View style={[styles.header, { backgroundColor: PRIMARY }]}>
      <View style={styles.row}>
        <View style={{ flex: 1 }}>
          <ThemedText type="h2" style={styles.title}>
            {title}
          </ThemedText>
          {subtitle ? (
            <ThemedText type="caption" style={styles.subtitle}>
              {subtitle}
            </ThemedText>
          ) : null}
        </View>

        {rightIcon && onRightPress ? (
          <Pressable
            style={({ pressed }) => [
              styles.rightBtn,
              { opacity: pressed ? 0.7 : 1 },
            ]}
            onPress={onRightPress}
          >
            <Feather name={rightIcon} size={18} color="#FFFFFF" />
            {rightLabel ? (
              <ThemedText type="caption" style={styles.rightLabel}>
                {rightLabel}
              </ThemedText>
            ) : null}
            {badge && badge > 0 ? (
              <View style={styles.badge}>
                <ThemedText style={styles.badgeText}>
                  {badge > 9 ? "9+" : badge}
                </ThemedText>
              </View>
            ) : null}
          </Pressable>
        ) : null}
      </View>
      <View style={styles.bottomCurve} />
    </View>
  );
}

const styles = StyleSheet.create({
  header: {
    paddingHorizontal: Spacing.xl,
    paddingTop: Spacing.sm,
    paddingBottom: Spacing.xl,
    borderBottomLeftRadius: 24,
    borderBottomRightRadius: 24,
    zIndex: 100,
    ...(Platform.OS === "web"
      ? { boxShadow: "0 6px 20px rgba(109,27,109,0.18)" }
      : {
          shadowColor: "#6D1B6D",
          shadowOffset: { width: 0, height: 6 },
          shadowOpacity: 0.18,
          shadowRadius: 18,
          elevation: 8,
        }),
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.md,
    justifyContent: "space-between",
  },
  title: {
    color: "#FFFFFF",
    fontWeight: "800",
  },
  subtitle: {
    color: "rgba(255,255,255,0.65)",
    marginTop: 3,
  },
  rightBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: "rgba(255,255,255,0.16)",
    paddingHorizontal: Spacing.md,
    paddingVertical: 8,
    borderRadius: BorderRadius.full,
    position: "relative",
    zIndex: 101,
  },
  rightLabel: {
    color: "#FFFFFF",
    fontWeight: "600",
  },
  badge: {
    position: "absolute",
    top: -4,
    right: -4,
    minWidth: 16,
    height: 16,
    borderRadius: 8,
    backgroundColor: "#C8252D",
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 3,
    borderWidth: 1.5,
    borderColor: "#6D1B6D",
    zIndex: 102,
  },
  badgeText: {
    color: "#FFF",
    fontSize: 8,
    fontWeight: "700",
  },
  bottomCurve: {
    height: 0,
  },
});
