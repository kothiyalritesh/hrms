import React, { useState, useCallback } from "react";
import {
  StyleSheet,
  View,
  FlatList,
  Pressable,
  TextInput,
  Alert,
} from "react-native";
import { Feather } from "@expo/vector-icons";
import { useFocusEffect } from "@react-navigation/native";
import { ThemedText } from "@/components/ThemedText";
import { useTheme } from "@/hooks/useTheme";
import { Spacing, BorderRadius, Colors } from "@/constants/theme";
import Spacer from "@/components/Spacer";
import { supabase } from "@/lib/supabase";

interface Office {
  id: string;
  name: string;
  address: string;
  latitude?: number;
  longitude?: number;
  attendance_radius: number;
  is_active: boolean;
}

export default function OfficeSettingsScreen() {
  const { theme } = useTheme();
  const [offices, setOffices] = useState<Office[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAddForm, setShowAddForm] = useState(false);
  const [newOffice, setNewOffice] = useState({
    name: "",
    address: "",
    latitude: "",
    longitude: "",
    attendance_radius: "100",
  });

  const loadOffices = useCallback(async () => {
    const { data, error } = await supabase
      .from("offices")
      .select("*")
      .order("name");

    if (error) {
      console.error("Error loading offices:", error);
    } else {
      setOffices(data || []);
    }
    setLoading(false);
  }, []);

  useFocusEffect(
    useCallback(() => {
      loadOffices();
    }, [loadOffices]),
  );

  const addOffice = async () => {
    if (!newOffice.name.trim() || !newOffice.address.trim()) {
      Alert.alert("Error", "Please enter office name and address");
      return;
    }
    const lat = parseFloat(newOffice.latitude);
    const lon = parseFloat(newOffice.longitude);
    if (newOffice.latitude && (isNaN(lat) || lat < -90 || lat > 90)) {
      Alert.alert("Error", "Latitude must be between -90 and 90");
      return;
    }
    if (newOffice.longitude && (isNaN(lon) || lon < -180 || lon > 180)) {
      Alert.alert("Error", "Longitude must be between -180 and 180");
      return;
    }

    const { error } = await supabase.from("offices").insert([
      {
        name: newOffice.name,
        address: newOffice.address,
        latitude: newOffice.latitude ? lat : null,
        longitude: newOffice.longitude ? lon : null,
        attendance_radius: parseInt(newOffice.attendance_radius) || 100,
        is_active: true,
      },
    ]);

    if (error) {
      Alert.alert("Error", "Failed to add office");
    } else {
      setNewOffice({ name: "", address: "", latitude: "", longitude: "", attendance_radius: "100" });
      setShowAddForm(false);
      loadOffices();
      Alert.alert("✅ Office Added", `"${newOffice.name}" has been added successfully.`);
    }
  };

  const toggleOfficeStatus = async (
    officeId: string,
    currentStatus: boolean,
  ) => {
    const newStatus = !currentStatus;
    const action = newStatus ? "activate" : "deactivate";

    Alert.alert(
      `${action.charAt(0).toUpperCase() + action.slice(1)} Office`,
      `Are you sure you want to ${action} this office?`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: action.charAt(0).toUpperCase() + action.slice(1),
          onPress: async () => {
            const { error } = await supabase
              .from("offices")
              .update({ is_active: newStatus })
              .eq("id", officeId);

            if (error) {
              Alert.alert("Error", `Failed to ${action} office`);
            } else {
              loadOffices();
            }
          },
        },
      ],
    );
  };

  const updateAttendanceRadius = async (
    officeId: string,
    newRadius: string,
  ) => {
    const radius = parseInt(newRadius);
    if (isNaN(radius) || radius < 10 || radius > 1000) {
      Alert.alert(
        "Error",
        "Attendance radius must be between 10 and 1000 meters",
      );
      return;
    }

    const { error } = await supabase
      .from("offices")
      .update({ attendance_radius: radius })
      .eq("id", officeId);

    if (error) {
      Alert.alert("Error", "Failed to update attendance radius");
    } else {
      loadOffices();
      Alert.alert("✅ Updated", `Attendance radius set to ${radius}m.`);
    }
  };

  const renderOffice = ({ item }: { item: Office }) => (
    <View
      style={[styles.officeCard, { backgroundColor: theme.backgroundDefault }]}
    >
      <View style={styles.officeHeader}>
        <View style={styles.officeInfo}>
          <ThemedText type="body" style={styles.officeName}>
            {item.name}
          </ThemedText>
          <ThemedText type="caption" style={{ color: theme.textSecondary }}>
            {item.address}
          </ThemedText>
          <ThemedText type="caption" style={{ color: theme.textSecondary }}>
            Radius: {item.attendance_radius}m
          </ThemedText>
          {item.latitude && item.longitude ? (
            <ThemedText type="caption" style={{ color: Colors.light.success }}>
              📍 Geo-tagged ({item.latitude.toFixed(4)}, {item.longitude.toFixed(4)})
            </ThemedText>
          ) : (
            <ThemedText type="caption" style={{ color: Colors.light.warning }}>
              ⚠️ No GPS coordinates — geo-fence inactive
            </ThemedText>
          )}
        </View>

        <View style={styles.officeActions}>
          <View
            style={[
              styles.statusBadge,
              {
                backgroundColor: item.is_active
                  ? Colors.light.success + "20"
                  : Colors.light.error + "20",
              },
            ]}
          >
            <ThemedText
              type="caption"
              style={{
                color: item.is_active
                  ? Colors.light.success
                  : Colors.light.error,
                fontWeight: "600",
              }}
            >
              {item.is_active ? "Active" : "Inactive"}
            </ThemedText>
          </View>

          <Pressable
            style={[
              styles.actionButton,
              { backgroundColor: theme.backgroundRoot },
            ]}
            onPress={() => toggleOfficeStatus(item.id, item.is_active)}
          >
            <Feather
              name={item.is_active ? "eye-off" : "eye"}
              size={16}
              color={item.is_active ? Colors.light.error : Colors.light.success}
            />
          </Pressable>
        </View>
      </View>

      <Spacer height={Spacing.md} />

      <View style={styles.radiusSection}>
        <ThemedText type="caption" style={{ color: theme.textSecondary }}>
          Update Attendance Radius (meters):
        </ThemedText>
        <View style={styles.radiusInput}>
          <TextInput
            style={[
              styles.input,
              { backgroundColor: theme.backgroundRoot, color: theme.text },
            ]}
            placeholder="100"
            placeholderTextColor={theme.textSecondary}
            defaultValue={item.attendance_radius.toString()}
            keyboardType="numeric"
            onSubmitEditing={(e) =>
              updateAttendanceRadius(item.id, e.nativeEvent.text)
            }
          />
        </View>
      </View>
    </View>
  );

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <ThemedText type="h3">Office Management</ThemedText>
        <Pressable
          style={[styles.addButton, { backgroundColor: Colors.light.primary }]}
          onPress={() => setShowAddForm(!showAddForm)}
        >
          <Feather name="plus" size={20} color="#FFFFFF" />
          <ThemedText type="caption" style={styles.addButtonText}>
            Add Office
          </ThemedText>
        </Pressable>
      </View>

      {showAddForm && (
        <View
          style={[styles.addForm, { backgroundColor: theme.backgroundDefault }]}
        >
          <ThemedText type="body" style={styles.formTitle}>
            Add New Office
          </ThemedText>

          <TextInput
            style={[
              styles.formInput,
              { backgroundColor: theme.backgroundRoot, color: theme.text },
            ]}
            placeholder="Office Name"
            placeholderTextColor={theme.textSecondary}
            value={newOffice.name}
            onChangeText={(text) => setNewOffice({ ...newOffice, name: text })}
          />

          <TextInput
            style={[
              styles.formInput,
              { backgroundColor: theme.backgroundRoot, color: theme.text },
            ]}
            placeholder="Office Address"
            placeholderTextColor={theme.textSecondary}
            value={newOffice.address}
            onChangeText={(text) =>
              setNewOffice({ ...newOffice, address: text })
            }
            multiline
          />

          <TextInput
            style={[
              styles.formInput,
              { backgroundColor: theme.backgroundRoot, color: theme.text },
            ]}
            placeholder="Latitude (e.g. 28.6139)"
            placeholderTextColor={theme.textSecondary}
            value={newOffice.latitude}
            onChangeText={(text) => setNewOffice({ ...newOffice, latitude: text })}
            keyboardType="decimal-pad"
          />

          <TextInput
            style={[
              styles.formInput,
              { backgroundColor: theme.backgroundRoot, color: theme.text },
            ]}
            placeholder="Longitude (e.g. 77.2090)"
            placeholderTextColor={theme.textSecondary}
            value={newOffice.longitude}
            onChangeText={(text) => setNewOffice({ ...newOffice, longitude: text })}
            keyboardType="decimal-pad"
          />

          <TextInput
            style={[
              styles.formInput,
              { backgroundColor: theme.backgroundRoot, color: theme.text },
            ]}
            placeholder="Attendance Radius (meters, default 100)"
            placeholderTextColor={theme.textSecondary}
            value={newOffice.attendance_radius}
            onChangeText={(text) =>
              setNewOffice({ ...newOffice, attendance_radius: text })
            }
            keyboardType="numeric"
          />

          <View style={styles.formButtons}>
            <Pressable
              style={[
                styles.formButton,
                { backgroundColor: Colors.light.error },
              ]}
              onPress={() => setShowAddForm(false)}
            >
              <ThemedText type="caption" style={styles.formButtonText}>
                Cancel
              </ThemedText>
            </Pressable>

            <Pressable
              style={[
                styles.formButton,
                { backgroundColor: Colors.light.success },
              ]}
              onPress={addOffice}
            >
              <ThemedText type="caption" style={styles.formButtonText}>
                Add Office
              </ThemedText>
            </Pressable>
          </View>
        </View>
      )}

      <Spacer height={Spacing.md} />

      {loading ? (
        <View style={styles.centered}>
          <ThemedText>Loading offices...</ThemedText>
        </View>
      ) : (
        <FlatList
          data={offices}
          keyExtractor={(item) => item.id}
          renderItem={renderOffice}
          contentContainerStyle={styles.list}
          showsVerticalScrollIndicator={false}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    padding: Spacing.lg,
  },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  addButton: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    borderRadius: BorderRadius.sm,
    gap: Spacing.xs,
  },
  addButtonText: {
    color: "#FFFFFF",
    fontWeight: "600",
  },
  addForm: {
    padding: Spacing.lg,
    borderRadius: BorderRadius.md,
    marginTop: Spacing.md,
  },
  formTitle: {
    marginBottom: Spacing.md,
  },
  formInput: {
    padding: Spacing.md,
    borderRadius: BorderRadius.sm,
    marginBottom: Spacing.md,
    fontSize: 16,
  },
  formButtons: {
    flexDirection: "row",
    gap: Spacing.md,
  },
  formButton: {
    flex: 1,
    paddingVertical: Spacing.md,
    borderRadius: BorderRadius.sm,
    alignItems: "center",
  },
  formButtonText: {
    color: "#FFFFFF",
    fontWeight: "600",
  },
  centered: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  list: {
    gap: Spacing.md,
  },
  officeCard: {
    padding: Spacing.lg,
    borderRadius: BorderRadius.md,
  },
  officeHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
  },
  officeInfo: {
    flex: 1,
  },
  officeName: {
    marginBottom: Spacing.xs,
  },
  officeActions: {
    alignItems: "flex-end",
    gap: Spacing.sm,
  },
  statusBadge: {
    paddingHorizontal: Spacing.sm,
    paddingVertical: Spacing.xs,
    borderRadius: BorderRadius.xs,
  },
  actionButton: {
    width: 32,
    height: 32,
    borderRadius: BorderRadius.sm,
    alignItems: "center",
    justifyContent: "center",
  },
  radiusSection: {
    gap: Spacing.xs,
  },
  radiusInput: {
    flexDirection: "row",
  },
  input: {
    flex: 1,
    padding: Spacing.sm,
    borderRadius: BorderRadius.xs,
    fontSize: 14,
  },
});
