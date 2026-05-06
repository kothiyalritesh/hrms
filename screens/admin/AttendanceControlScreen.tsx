import React from "react";
import { View, StyleSheet } from "react-native";
import { ThemedText } from "@/components/ThemedText";

export default function AttendanceControlScreen() {
  return (
    <View style={styles.container}>
      <ThemedText type="h3">Attendance Control</ThemedText>
      <ThemedText>View and manage employee attendance</ThemedText>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    padding: 16,
    alignItems: "center",
    justifyContent: "center",
  },
});
