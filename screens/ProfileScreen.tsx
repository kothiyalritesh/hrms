import React, { useState } from "react";
import { StyleSheet, View, Pressable, Alert, Image, TextInput, Modal, ScrollView } from "react-native";
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

function MenuItem({ icon, title, subtitle, onPress, showArrow = true, danger = false }: MenuItemProps) {
  const { theme } = useTheme();
  const iconColor = danger ? Colors.light.error : theme.primary;
  const textColor = danger ? Colors.light.error : theme.text;
  
  return (
    <Pressable 
      style={({ pressed }) => [
        styles.menuItem,
        { backgroundColor: theme.backgroundDefault, opacity: pressed ? 0.8 : 1 }
      ]}
      onPress={onPress}
    >
      <View style={[styles.menuIcon, { backgroundColor: iconColor + "15" }]}>
        <Feather name={icon} size={20} color={iconColor} />
      </View>
      <View style={styles.menuContent}>
        <ThemedText type="body" style={{ color: textColor }}>{title}</ThemedText>
        {subtitle ? (
          <ThemedText type="caption" style={{ color: theme.textSecondary }}>{subtitle}</ThemedText>
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
  const [editName, setEditName] = useState(user?.name || "");
  const [editPhone, setEditPhone] = useState(user?.phone || "");

  const handleLogout = () => {
    Alert.alert(
      "Logout",
      "Are you sure you want to logout?",
      [
        { text: "Cancel", style: "cancel" },
        { 
          text: "Logout", 
          style: "destructive",
          onPress: async () => {
            await logout();
          }
        },
      ]
    );
  };

  const handleSaveProfile = async () => {
    if (!editName.trim()) {
      Alert.alert("Error", "Name cannot be empty");
      return;
    }
    await updateUser({ name: editName, phone: editPhone });
    setShowEditModal(false);
  };

  const getRoleBadgeColor = () => {
    switch (user?.role) {
      case "admin": return Colors.light.error;
      case "hr": return Colors.light.info;
      case "manager": return Colors.light.warning;
      default: return Colors.light.success;
    }
  };

  return (
    <View style={{ flex: 1, backgroundColor: theme.backgroundRoot }}>
      <ScreenScrollView>
        <View style={styles.profileHeader}>
          <View style={[styles.avatarContainer, { backgroundColor: theme.primary }]}>
            {user?.avatar ? (
              <Image source={{ uri: user.avatar }} style={styles.avatar} />
            ) : (
              <ThemedText type="h1" style={{ color: "#FFFFFF" }}>
                {user?.name?.charAt(0).toUpperCase() || "U"}
              </ThemedText>
            )}
            <Pressable 
              style={[styles.editAvatarBtn, { backgroundColor: theme.backgroundDefault }]}
              onPress={() => setShowEditModal(true)}
            >
              <Feather name="edit-2" size={14} color={theme.primary} />
            </Pressable>
          </View>
          
          <Spacer height={Spacing.md} />
          
          <ThemedText type="h2">{user?.name}</ThemedText>
          <ThemedText type="small" style={{ color: theme.textSecondary }}>{user?.email}</ThemedText>
          
          <Spacer height={Spacing.sm} />
          
          <View style={[styles.roleBadge, { backgroundColor: getRoleBadgeColor() + "20" }]}>
            <ThemedText type="caption" style={{ color: getRoleBadgeColor(), fontWeight: "600" }}>
              {user?.role?.toUpperCase()}
            </ThemedText>
          </View>
        </View>

        <Spacer height={Spacing.xl} />

        <View style={styles.infoCard}>
          <View style={[styles.infoRow, { backgroundColor: theme.backgroundDefault }]}>
            <Feather name="briefcase" size={18} color={theme.textSecondary} />
            <View style={styles.infoContent}>
              <ThemedText type="caption" style={{ color: theme.textSecondary }}>Designation</ThemedText>
              <ThemedText type="body">{user?.designation || "Not set"}</ThemedText>
            </View>
          </View>
          <View style={[styles.infoRow, { backgroundColor: theme.backgroundDefault }]}>
            <Feather name="users" size={18} color={theme.textSecondary} />
            <View style={styles.infoContent}>
              <ThemedText type="caption" style={{ color: theme.textSecondary }}>Department</ThemedText>
              <ThemedText type="body">{user?.department || "Not set"}</ThemedText>
            </View>
          </View>
          <View style={[styles.infoRow, { backgroundColor: theme.backgroundDefault }]}>
            <Feather name="phone" size={18} color={theme.textSecondary} />
            <View style={styles.infoContent}>
              <ThemedText type="caption" style={{ color: theme.textSecondary }}>Phone</ThemedText>
              <ThemedText type="body">{user?.phone || "Not set"}</ThemedText>
            </View>
          </View>
          <View style={[styles.infoRow, { backgroundColor: theme.backgroundDefault }]}>
            <Feather name="calendar" size={18} color={theme.textSecondary} />
            <View style={styles.infoContent}>
              <ThemedText type="caption" style={{ color: theme.textSecondary }}>Joined</ThemedText>
              <ThemedText type="body">
                {user?.joinDate ? new Date(user.joinDate).toLocaleDateString() : "Not set"}
              </ThemedText>
            </View>
          </View>
        </View>

        <Spacer height={Spacing.xl} />

        <ThemedText type="h4" style={styles.sectionTitle}>Account</ThemedText>
        <Spacer height={Spacing.sm} />
        
        <View style={styles.menuSection}>
          <MenuItem
            icon="user"
            title="Edit Profile"
            subtitle="Update your personal information"
            onPress={() => setShowEditModal(true)}
          />
          <MenuItem
            icon="file-text"
            title="My Documents"
            subtitle="View uploaded documents"
            onPress={() => navigation.navigate("DocumentsScreen")}
          />
          <MenuItem
            icon="dollar-sign"
            title="Payroll"
            subtitle="View salary slips"
            onPress={() => navigation.navigate("PayrollScreen")}
          />
          <MenuItem
            icon="calendar"
            title="Leave History"
            subtitle="View leave applications"
            onPress={() => navigation.navigate("LeaveScreen")}
          />
        </View>

        <Spacer height={Spacing.xl} />

        <ThemedText type="h4" style={styles.sectionTitle}>Settings</ThemedText>
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
            onPress={() => Alert.alert("Coming Soon", "Password change feature will be available soon.")}
          />
          <MenuItem
            icon="help-circle"
            title="Help & Support"
            onPress={() => Alert.alert("Contact HR", "Please contact HR department for any assistance.")}
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
        
        <ThemedText type="caption" style={[styles.versionText, { color: theme.textSecondary }]}>
          RE HRMS v1.0.0
        </ThemedText>
        
        <Spacer height={Spacing.xl} />
      </ScreenScrollView>

      <Modal
        visible={showEditModal}
        animationType="slide"
        transparent
        onRequestClose={() => setShowEditModal(false)}
      >
        <View style={styles.modalOverlay}>
          <ThemedView style={[styles.modalContainer, { paddingBottom: insets.bottom + Spacing.lg }]}>
            <View style={styles.modalHeader}>
              <ThemedText type="h3">Edit Profile</ThemedText>
              <Pressable onPress={() => setShowEditModal(false)}>
                <Feather name="x" size={24} color={theme.text} />
              </Pressable>
            </View>
            
            <ScrollView style={styles.modalContent} keyboardShouldPersistTaps="handled">
              <ThemedText type="small" style={styles.inputLabel}>Name</ThemedText>
              <TextInput
                style={[styles.modalInput, { backgroundColor: theme.backgroundSecondary, color: theme.text }]}
                value={editName}
                onChangeText={setEditName}
                placeholder="Your name"
                placeholderTextColor={theme.textSecondary}
              />
              
              <Spacer height={Spacing.lg} />
              
              <ThemedText type="small" style={styles.inputLabel}>Phone</ThemedText>
              <TextInput
                style={[styles.modalInput, { backgroundColor: theme.backgroundSecondary, color: theme.text }]}
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
