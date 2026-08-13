import React from "react";
import { View, StyleSheet } from "react-native";
import { ThemedText } from "@/components/ThemedText";

export default function DocumentManagementScreen() {
  return (
    <View style={styles.container}>
      <ThemedText type="h3">Document Management</ThemedText>
      <ThemedText>View and verify employee documents</ThemedText>
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
