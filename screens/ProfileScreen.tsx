import React, { useState, useEffect } from "react";
import {
  StyleSheet,
  View,
  Pressable,
  Alert,
  Image,
  TextInput,
  Modal,
  ScrollView,
  Platform,
  TouchableOpacity,
} from "react-native";
import { Feather } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { ScreenScrollView } from "@/components/ScreenScrollView";
import { ThemedText } from "@/components/ThemedText";
import { ThemedView } from "@/components/ThemedView";
import { Button } from "@/components/Button";
import { useTheme } from "@/hooks/useTheme";
import { useAuth } from "@/contexts/AuthContext";
import { Spacing, BorderRadius, Colors } from "@/constants/theme";
import Spacer from "@/components/Spacer";
import { supabase } from "@/lib/supabase";

type ProfileScreenProps = {
  navigation: NativeStackNavigationProp<any>;
};

interface MenuItemProps {
  icon: keyof typeof Feather.glyphMap;
  title: string;
  subtitle?: string;
  onPress: () => void;
  showArrow?: boolean;
  danger?: boolean;
}

function MenuItem({
  icon,
  title,
  subtitle,
  onPress,
  showArrow = true,
  danger = false,
}: MenuItemProps) {
  const { theme } = useTheme();
  const iconColor = danger ? Colors.light.error : theme.primary;
  const textColor = danger ? Colors.light.error : theme.text;

  return (
    <Pressable
      style={({ pressed }) => [
        styles.menuItem,
        {
          backgroundColor: theme.backgroundDefault,
          opacity: pressed ? 0.8 : 1,
        },
      ]}
      onPress={onPress}
    >
      <View style={[styles.menuIcon, { backgroundColor: iconColor + "15" }]}>
        <Feather name={icon} size={20} color={iconColor} />
      </View>
      <View style={styles.menuContent}>
        <ThemedText type="body" style={{ color: textColor }}>
          {title}
        </ThemedText>
        {subtitle ? (
          <ThemedText type="caption" style={{ color: theme.textSecondary }}>
            {subtitle}
          </ThemedText>
        ) : null}
      </View>
      {showArrow ? (
        <Feather name="chevron-right" size={20} color={theme.textSecondary} />
      ) : null}
    </Pressable>
  );
}

export default function ProfileScreen({ navigation }: ProfileScreenProps) {
  const { theme } = useTheme();
  const { user, logout, updateUser } = useAuth();
  const insets = useSafeAreaInsets();

  const [showEditModal, setShowEditModal] = useState(false);
  const [editName, setEditName] = useState("");
  const [editPhone, setEditPhone] = useState("");
  const [showPasswordModal, setShowPasswordModal] = useState(false);
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [passwordLoading, setPasswordLoading] = useState(false);
  const [offices, setOffices] = useState<any[]>([]);
  const [currentOfficeId, setCurrentOfficeId] = useState<string | null>(null);
  const [showOfficePicker, setShowOfficePicker] = useState(false);
  const [savingOffice, setSavingOffice] = useState(false);

  useEffect(() => {
    if (!user?.id) return;
    // Load offices and current assignment
    supabase.from("offices").select("id, name").eq("is_active", true).then(({ data }: { data: any[] | null }) => {
      setOffices(data || []);
    });
    supabase.from("profiles").select("office_id").eq("id", user.id).single().then(({ data }: { data: any }) => {
      setCurrentOfficeId(data?.office_id || null);
    });
  }, [user?.id]);

  const handleSaveOffice = async (officeId: string) => {
    if (!user?.id) return;
    setSavingOffice(true);
    const { error } = await supabase
      .from("profiles")
      .update({ office_id: officeId })
      .eq("id", user.id);
    setSavingOffice(false);
    if (error) {
      Alert.alert("Error", "Failed to save office. Please try again.");
      return;
    }
    setCurrentOfficeId(officeId);
    setShowOfficePicker(false);
    const office = offices.find((o) => o.id === officeId);
    Alert.alert("✅ Office Saved", `Your office is now set to ${office?.name}.`);
  };

  const handleChangePassword = async () => {
    if (newPassword.trim().length < 4) {
      Alert.alert("Too Short", "New password must be at least 4 characters.");
      return;
    }
    if (newPassword.trim() !== confirmPassword.trim()) {
      Alert.alert("Mismatch", "New passwords do not match.");
      return;
    }
    setPasswordLoading(true);
    try {
      // Verify current password against DB (custom_password or default first-name)
      const { data: profile, error: fetchErr } = await supabase
        .from("profiles")
        .select("custom_password, name")
        .eq("id", user!.id)
        .single();
      if (fetchErr || !profile) throw new Error("Could not verify identity.");
      const expected = profile.custom_password || profile.name?.split(" ")[0]?.toLowerCase();
      if (currentPassword.trim() !== expected) {
        Alert.alert("Wrong Password", "Current password is incorrect.");
        setPasswordLoading(false);
        return;
      }
      const { error } = await supabase
        .from("profiles")
        .update({ custom_password: newPassword.trim() })
        .eq("id", user!.id);
      if (error) throw error;
      setShowPasswordModal(false);
      setCurrentPassword(""); setNewPassword(""); setConfirmPassword("");
      Alert.alert("✅ Password Changed", "Your password has been updated.");
    } catch (e: any) {
      Alert.alert("Error", e.message || "Failed to change password.");
    } finally {
      setPasswordLoading(false);
    }
  };

  const openEditModal = () => {
    setEditName(user?.name || "");
    setEditPhone(user?.phone || "");
    setShowEditModal(true);
  };

  const handleLogout = () => {
    if (Platform.OS === "web") {
      const confirmed = window.confirm("Are you sure you want to logout?");
      if (confirmed) logout();
      return;
    }
    Alert.alert("Logout", "Are you sure you want to logout?", [
      { text: "Cancel", style: "cancel" },
      { text: "Logout", style: "destructive", onPress: () => logout() },
    ]);
  };

  const handleSaveProfile = async () => {
    if (!editName.trim()) {
      Alert.alert("Required", "Name cannot be empty");
      return;
    }
    await updateUser({ name: editName, phone: editPhone });
    setShowEditModal(false);
    Alert.alert("✅ Profile Updated", "Your profile has been updated successfully.");
  };

  const getRoleBadgeColor = () => {
    switch (user?.role) {
      case "SYSTEM_ADMIN":
      case "ADMIN":
        return Colors.light.error;
      case "BUSINESS_HEAD":
      case "TEAM_HEAD":
        return Colors.light.info;
      case "SALES_MANAGER":
      case "GM_SALES":
        return Colors.light.warning;
      default:
        return Colors.light.success;
    }
  };

  return (
    <View style={{ flex: 1, backgroundColor: theme.backgroundRoot }}>
      <ScreenScrollView>
        <View style={styles.profileHeader}>
          <View
            style={[styles.avatarContainer, { backgroundColor: theme.primary }]}
          >
            <ThemedText type="h1" style={{ color: "#FFFFFF" }}>
              {user?.name?.charAt(0).toUpperCase() || "U"}
            </ThemedText>
            <Pressable
              style={[
                styles.editAvatarBtn,
                { backgroundColor: theme.backgroundDefault },
              ]}
              onPress={openEditModal}
            >
              <Feather name="edit-2" size={14} color={theme.primary} />
            </Pressable>
          </View>

          <Spacer height={Spacing.md} />

          <ThemedText type="h2">{user?.name}</ThemedText>
          <ThemedText type="small" style={{ color: theme.textSecondary }}>
            {user?.email}
          </ThemedText>

          <Spacer height={Spacing.sm} />

          <View
            style={[
              styles.roleBadge,
              { backgroundColor: getRoleBadgeColor() + "20" },
            ]}
          >
            <ThemedText
              type="caption"
              style={{ color: getRoleBadgeColor(), fontWeight: "600" }}
            >
              {user?.role?.replace(/_/g, " ")}
            </ThemedText>
          </View>
        </View>

        <Spacer height={Spacing.xl} />

        <View style={styles.infoCard}>
          <View
            style={[
              styles.infoRow,
              { backgroundColor: theme.backgroundDefault },
            ]}
          >
            <Feather name="phone" size={18} color={theme.textSecondary} />
            <View style={styles.infoContent}>
              <ThemedText type="caption" style={{ color: theme.textSecondary }}>
                Phone
              </ThemedText>
              <ThemedText type="body">{user?.phone || "Not set"}</ThemedText>
            </View>
          </View>
          <View
            style={[
              styles.infoRow,
              { backgroundColor: theme.backgroundDefault },
            ]}
          >
            <Feather name="calendar" size={18} color={theme.textSecondary} />
            <View style={styles.infoContent}>
              <ThemedText type="caption" style={{ color: theme.textSecondary }}>
                Joined
              </ThemedText>
              <ThemedText type="body">
                {user?.created_at
                  ? new Date(user.created_at).toLocaleDateString()
                  : "Not set"}
              </ThemedText>
            </View>
          </View>
        </View>

        <Spacer height={Spacing.xl} />

        <ThemedText type="h4" style={styles.sectionTitle}>
          Account
        </ThemedText>
        <Spacer height={Spacing.sm} />

        <View style={styles.menuSection}>
          <MenuItem
            icon="user"
            title="Edit Profile"
            subtitle="Update your name and phone"
            onPress={openEditModal}
          />
          <MenuItem
            icon="map-pin"
            title="My Office"
            subtitle={offices.find((o) => o.id === currentOfficeId)?.name || "Not assigned — tap to set"}
            onPress={() => setShowOfficePicker(true)}
          />
          <MenuItem
            icon="file-text"
            title="My Documents"
            subtitle="View uploaded documents"
            onPress={() => navigation.navigate("DocumentsScreen")}
          />
          <MenuItem
            icon="calendar"
            title="Leave History"
            subtitle="View leave applications"
            onPress={() => navigation.navigate("LeaveScreen")}
          />
        </View>

        <Spacer height={Spacing.xl} />

        <ThemedText type="h4" style={styles.sectionTitle}>
          Settings
        </ThemedText>
        <Spacer height={Spacing.sm} />

        <View style={styles.menuSection}>
          <MenuItem
            icon="bell"
            title="Notifications"
            subtitle="Manage notification preferences"
            onPress={() => navigation.navigate("Notifications")}
          />
          <MenuItem
            icon="lock"
            title="Change Password"
            onPress={() => setShowPasswordModal(true)}
          />
          <MenuItem
            icon="help-circle"
            title="Help & Support"
            onPress={() =>
              Alert.alert(
                "Contact HR",
                "Please contact HR department for any assistance.",
              )
            }
          />
        </View>

        <Spacer height={Spacing.xl} />

        <View style={styles.menuSection}>
          <MenuItem
            icon="log-out"
            title="Logout"
            onPress={handleLogout}
            showArrow={false}
            danger
          />
        </View>

        <Spacer height={Spacing["2xl"]} />

        <ThemedText
          type="caption"
          style={[styles.versionText, { color: theme.textSecondary }]}
        >
          RE HRMS v1.0.0
        </ThemedText>

        <Spacer height={Spacing.xl} />
      </ScreenScrollView>

      {/* Change Password Modal */}
      <Modal
        visible={showPasswordModal}
        animationType="slide"
        transparent
        onRequestClose={() => setShowPasswordModal(false)}
      >
        <View style={styles.modalOverlay}>
          <ThemedView style={[styles.modalContainer, { paddingBottom: insets.bottom + Spacing.lg }]}>
            <View style={styles.modalHeader}>
              <ThemedText type="h3">Change Password</ThemedText>
              <Pressable onPress={() => setShowPasswordModal(false)}>
                <Feather name="x" size={24} color={theme.text} />
              </Pressable>
            </View>
            <ScrollView style={styles.modalContent} keyboardShouldPersistTaps="handled">
              <ThemedText type="small" style={styles.inputLabel}>Current Password</ThemedText>
              <TextInput
                style={[styles.modalInput, { backgroundColor: theme.backgroundSecondary, color: theme.text }]}
                value={currentPassword}
                onChangeText={setCurrentPassword}
                placeholder="Enter current password"
                placeholderTextColor={theme.textSecondary}
                secureTextEntry
              />
              <Spacer height={Spacing.md} />
              <ThemedText type="small" style={styles.inputLabel}>New Password</ThemedText>
              <TextInput
                style={[styles.modalInput, { backgroundColor: theme.backgroundSecondary, color: theme.text }]}
                value={newPassword}
                onChangeText={setNewPassword}
                placeholder="Enter new password"
                placeholderTextColor={theme.textSecondary}
                secureTextEntry
              />
              <Spacer height={Spacing.md} />
              <ThemedText type="small" style={styles.inputLabel}>Confirm New Password</ThemedText>
              <TextInput
                style={[styles.modalInput, { backgroundColor: theme.backgroundSecondary, color: theme.text }]}
                value={confirmPassword}
                onChangeText={setConfirmPassword}
                placeholder="Confirm new password"
                placeholderTextColor={theme.textSecondary}
                secureTextEntry
              />
              <Spacer height={Spacing.xl} />
              <Button onPress={handleChangePassword} loading={passwordLoading}>Update Password</Button>
            </ScrollView>
          </ThemedView>
        </View>
      </Modal>

      {/* Office Picker Modal */}
      <Modal
        visible={showOfficePicker}
        animationType="slide"
        transparent
        onRequestClose={() => setShowOfficePicker(false)}
      >
        <View style={styles.modalOverlay}>
          <ThemedView style={[styles.modalContainer, { paddingBottom: insets.bottom + Spacing.lg }]}>
            <View style={styles.modalHeader}>
              <ThemedText type="h3">Select Your Office</ThemedText>
              <Pressable onPress={() => setShowOfficePicker(false)}>
                <Feather name="x" size={24} color={theme.text} />
              </Pressable>
            </View>
            <ScrollView style={styles.modalContent}>
              {!currentOfficeId && (
                <View style={[s.warningBanner]}>
                  <Feather name="alert-circle" size={16} color="#92400E" />
                  <ThemedText style={s.warningText}>
                    No office assigned. Select your office to enable check-in.
                  </ThemedText>
                </View>
              )}
              <Spacer height={Spacing.md} />
              {offices.map((office) => {
                const selected = office.id === currentOfficeId;
                return (
                  <TouchableOpacity
                    key={office.id}
                    style={[s.officeRow, selected && { borderColor: theme.primary, backgroundColor: theme.primary + "10" }]}
                    onPress={() => handleSaveOffice(office.id)}
                    disabled={savingOffice}
                  >
                    <View style={[s.officeIcon, { backgroundColor: selected ? theme.primary : theme.primary + "20" }]}>
                      <Feather name="map-pin" size={16} color={selected ? "#fff" : theme.primary} />
                    </View>
                    <ThemedText type="body" style={{ flex: 1, color: selected ? theme.primary : theme.text, fontWeight: selected ? "700" : "400" }}>
                      {office.name}
                    </ThemedText>
                    {selected && <Feather name="check-circle" size={20} color={theme.primary} />}
                  </TouchableOpacity>
                );
              })}
              <Spacer height={Spacing.lg} />
            </ScrollView>
          </ThemedView>
        </View>
      </Modal>

      {/* Edit Profile Modal */}
      <Modal
        visible={showEditModal}
        animationType="slide"
        transparent
        onRequestClose={() => setShowEditModal(false)}
      >
        <View style={styles.modalOverlay}>
          <ThemedView
            style={[
              styles.modalContainer,
              { paddingBottom: insets.bottom + Spacing.lg },
            ]}
          >
            <View style={styles.modalHeader}>
              <ThemedText type="h3">Edit Profile</ThemedText>
              <Pressable onPress={() => setShowEditModal(false)}>
                <Feather name="x" size={24} color={theme.text} />
              </Pressable>
            </View>

            <ScrollView
              style={styles.modalContent}
              keyboardShouldPersistTaps="handled"
            >
              <ThemedText type="small" style={styles.inputLabel}>
                Name
              </ThemedText>
              <TextInput
                style={[
                  styles.modalInput,
                  {
                    backgroundColor: theme.backgroundSecondary,
                    color: theme.text,
                  },
                ]}
                value={editName}
                onChangeText={setEditName}
                placeholder="Your name"
                placeholderTextColor={theme.textSecondary}
              />

              <Spacer height={Spacing.lg} />

              <ThemedText type="small" style={styles.inputLabel}>
                Phone
              </ThemedText>
              <TextInput
                style={[
                  styles.modalInput,
                  {
                    backgroundColor: theme.backgroundSecondary,
                    color: theme.text,
                  },
                ]}
                value={editPhone}
                onChangeText={setEditPhone}
                placeholder="Phone number"
                placeholderTextColor={theme.textSecondary}
                keyboardType="phone-pad"
              />

              <Spacer height={Spacing.xl} />

              <Button onPress={handleSaveProfile}>Save Changes</Button>
            </ScrollView>
          </ThemedView>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  profileHeader: {
    alignItems: "center",
    paddingTop: Spacing.lg,
  },
  avatarContainer: {
    width: Spacing.avatarLg,
    height: Spacing.avatarLg,
    borderRadius: Spacing.avatarLg / 2,
    alignItems: "center",
    justifyContent: "center",
    position: "relative",
  },
  avatar: {
    width: "100%",
    height: "100%",
    borderRadius: Spacing.avatarLg / 2,
  },
  editAvatarBtn: {
    position: "absolute",
    bottom: 0,
    right: 0,
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
  },
  roleBadge: {
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.xs,
    borderRadius: BorderRadius.full,
  },
  infoCard: {
    gap: Spacing.sm,
  },
  infoRow: {
    flexDirection: "row",
    alignItems: "center",
    padding: Spacing.lg,
    borderRadius: BorderRadius.md,
    gap: Spacing.md,
  },
  infoContent: {
    flex: 1,
  },
  sectionTitle: {
    marginLeft: Spacing.xs,
  },
  menuSection: {
    gap: Spacing.sm,
  },
  menuItem: {
    flexDirection: "row",
    alignItems: "center",
    padding: Spacing.lg,
    borderRadius: BorderRadius.md,
    gap: Spacing.md,
  },
  menuIcon: {
    width: 40,
    height: 40,
    borderRadius: BorderRadius.sm,
    alignItems: "center",
    justifyContent: "center",
  },
  menuContent: {
    flex: 1,
  },
  versionText: {
    textAlign: "center",
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: "rgba(0, 0, 0, 0.5)",
    justifyContent: "flex-end",
  },
  modalContainer: {
    borderTopLeftRadius: BorderRadius.xl,
    borderTopRightRadius: BorderRadius.xl,
    maxHeight: "80%",
  },
  modalHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    padding: Spacing.lg,
    borderBottomWidth: 1,
    borderBottomColor: "rgba(128, 128, 128, 0.2)",
  },
  modalContent: {
    padding: Spacing.lg,
  },
  inputLabel: {
    marginBottom: Spacing.xs,
    fontWeight: "600",
  },
  modalInput: {
    height: Spacing.inputHeight,
    borderRadius: BorderRadius.sm,
    paddingHorizontal: Spacing.lg,
    fontSize: 16,
  },
});

const s = StyleSheet.create({
  warningBanner: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    backgroundColor: "#FEF3C7",
    borderWidth: 1,
    borderColor: "#F59E0B",
    borderRadius: 10,
    padding: 12,
  },
  warningText: {
    flex: 1,
    fontSize: 13,
    color: "#92400E",
  },
  officeRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    padding: 14,
    borderRadius: 10,
    borderWidth: 1.5,
    borderColor: "#E5E7EB",
    marginBottom: 10,
  },
  officeIcon: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
  },
});
