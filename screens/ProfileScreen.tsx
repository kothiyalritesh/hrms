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
import Feather from "@expo/vector-icons/Feather";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { ScreenScrollView } from "@/components/ScreenScrollView";
import { ThemedText } from "@/components/ThemedText";
import { ThemedView } from "@/components/ThemedView";
import { Button } from "@/components/Button";
import { useTheme } from "@/hooks/useTheme";
import { formatDate, toTitleCase } from "@/utils/format";
import { useAuth } from "@/contexts/AuthContext";
import { Spacing, BorderRadius, Colors } from "@/constants/theme";
import Spacer from "@/components/Spacer";
import { supabase } from "@/lib/supabase";
import * as ImagePicker from "expo-image-picker";
import releaseConfig from "@/release.config.json";
import DeviceSessionsModal from "@/components/DeviceSessionsModal";

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
  const [avatarUri, setAvatarUri] = useState<string | null>(null);
  const [avatarBase64, setAvatarBase64] = useState<string | null>(null);
  const [avatarMime, setAvatarMime] = useState<string>("image/jpeg");
  const [avatarUploading, setAvatarUploading] = useState(false);
  const [displayAvatar, setDisplayAvatar] = useState<string | null>(null);
  const [offices, setOffices] = useState<any[]>([]);
  const [currentOfficeId, setCurrentOfficeId] = useState<string | null>(null);
  const [showOfficePicker, setShowOfficePicker] = useState(false);
  const [showDeviceSessions, setShowDeviceSessions] = useState(false);
  const [team, setTeam] = useState<string | null>(null);
  const [dateOfJoining, setDateOfJoining] = useState<string | null>(null);
  const [historyTimeline, setHistoryTimeline] = useState<any[]>([]);

  useEffect(() => {
    let active = true;
    if (!user?.avatar) {
      setDisplayAvatar(null);
      return () => {
        active = false;
      };
    }
    if (/^https?:\/\//i.test(user.avatar)) {
      setDisplayAvatar(user.avatar);
      return () => {
        active = false;
      };
    }
    supabase.storage
      .from("profile-pics")
      .createSignedUrl(user.avatar, 3600)
      .then(({ data, error }) => {
        if (active) setDisplayAvatar(error ? null : data?.signedUrl || null);
      });
    return () => {
      active = false;
    };
  }, [user?.avatar]);

  useEffect(() => {
    if (!user?.id) return;
    supabase
      .from("offices")
      .select("id, name")
      .eq("is_active", true)
      .then(({ data }: { data: any[] | null }) => {
        setOffices(data || []);
      });
    supabase
      .from("profiles")
      .select("office_id, team, joining_date")
      .eq("id", user.id)
      .maybeSingle()
      .then(({ data }: { data: any }) => {
        setCurrentOfficeId(data?.office_id || null);
        setTeam(data?.team || null);
        setDateOfJoining(data?.joining_date || null);
      });
  }, [user?.id]);

  const handleSaveOffice = async (officeId: string) => {
    setShowOfficePicker(false);
    Alert.alert(
      "Office Assignment Protected",
      "Office assignments can only be changed by an authorized HR administrator.",
    );
  };

  const openEditModal = () => {
    setEditName(user?.name || "");
    setAvatarUri(null);
    setAvatarBase64(null);
    setAvatarFile(null);
    setAvatarMime("image/jpeg");
    setShowEditModal(true);
  };

  const [avatarFile, setAvatarFile] = useState<File | null>(null);

  const pickImage = async (source: "camera" | "gallery") => {
    if (Platform.OS === "web") {
      // On web, use a hidden file input to get the actual File object (avoids CORS)
      return new Promise<void>((resolve) => {
        const input = document.createElement("input");
        input.type = "file";
        input.accept = "image/*";
        if (source === "camera") input.capture = "environment";
        input.onchange = (e: any) => {
          const file: File = e.target.files[0];
          if (!file) {
            resolve();
            return;
          }
          setAvatarFile(file);
          setAvatarUri(URL.createObjectURL(file));
          setAvatarBase64(null);
          setAvatarMime(file.type || "image/jpeg");
          resolve();
        };
        input.click();
      });
    }
    let result;
    const opts = {
      allowsEditing: true,
      aspect: [1, 1] as [number, number],
      quality: 0.7,
      base64: true,
    };
    if (source === "camera") {
      const { status } = await ImagePicker.requestCameraPermissionsAsync();
      if (status !== "granted") {
        Alert.alert("Permission required", "Camera permission is needed.");
        return;
      }
      result = await ImagePicker.launchCameraAsync(opts);
    } else {
      const { status } =
        await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (status !== "granted") {
        Alert.alert("Permission required", "Gallery permission is needed.");
        return;
      }
      result = await ImagePicker.launchImageLibraryAsync({
        ...opts,
        mediaTypes: "images",
      });
    }
    if (!result.canceled && result.assets[0]) {
      const asset = result.assets[0];
      setAvatarUri(asset.uri);
      setAvatarBase64(asset.base64 ?? null);
      setAvatarFile(null);
      const mime =
        asset.mimeType ||
        (asset.uri.includes(".png") ? "image/png" : "image/jpeg");
      setAvatarMime(mime);
    }
  };

  const uploadAvatar = async (): Promise<string | null> => {
    try {
      const ext = avatarMime.split("/")[1] || "jpg";
      const fileName = `avatars/${user!.id}.${ext}`;
      let uploadError: any = null;

      if (avatarFile) {
        // Web: upload the real File object directly — no CORS issues
        const { error } = await supabase.storage
          .from("profile-pics")
          .upload(fileName, avatarFile, {
            upsert: true,
            contentType: avatarMime,
          });
        uploadError = error;
      } else if (avatarBase64) {
        // Native: decode base64 → Uint8Array
        const binary = atob(avatarBase64);
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
        const { error } = await supabase.storage
          .from("profile-pics")
          .upload(fileName, bytes, { upsert: true, contentType: avatarMime });
        uploadError = error;
      } else if (avatarUri) {
        const response = await fetch(avatarUri);
        const blob = await response.blob();
        const { error } = await supabase.storage
          .from("profile-pics")
          .upload(fileName, blob, { upsert: true, contentType: avatarMime });
        uploadError = error;
      }

      if (uploadError) throw uploadError;
      return fileName;
    } catch (e: any) {
      console.error("Avatar upload error:", e);
      return null;
    }
  };

  const performLogout = async () => {
    try {
      await logout();
    } catch (error: any) {
      Alert.alert(
        "Logout failed",
        error?.message ||
          "Your session could not be cleared. Please try again.",
      );
    }
  };

  const handleLogout = () => {
    if (Platform.OS === "web") {
      const confirmed = window.confirm("Are you sure you want to log out?");
      if (confirmed) void performLogout();
      return;
    }
    Alert.alert("Log Out", "Are you sure you want to log out?", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Log Out",
        style: "destructive",
        onPress: () => void performLogout(),
      },
    ]);
  };

  const handleSaveProfile = async () => {
    if (!editName.trim()) {
      Alert.alert("Error", "Name cannot be empty");
      return;
    }
    setAvatarUploading(true);
    try {
      let avatarUrl = user?.avatar || null;
      if (avatarUri || avatarBase64 || avatarFile) {
        const uploaded = await uploadAvatar();
        if (uploaded) avatarUrl = uploaded;
        else
          Alert.alert(
            "Warning",
            "Profile picture upload failed, but name was saved.",
          );
      }
      await updateUser({
        name: editName.trim(),
        ...(avatarUrl ? { avatar: avatarUrl } : {}),
      });
      setShowEditModal(false);
      Alert.alert("✅ Profile Updated", "Your profile has been saved.");
    } finally {
      setAvatarUploading(false);
    }
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
      <ScreenScrollView
        contentContainerStyle={{ paddingHorizontal: Spacing.lg }}
      >
        {/* Profile hero banner */}
        <View
          style={[
            styles.profileBanner,
            {
              backgroundColor: theme.primary,
              paddingTop: insets.top + Spacing.lg,
              marginHorizontal: -Spacing.lg,
            },
          ]}
        >
          <Pressable style={styles.avatarWrapper} onPress={openEditModal}>
            <View
              style={[styles.avatarContainer, { backgroundColor: "#4A0F4A" }]}
            >
              {displayAvatar ? (
                <Image source={{ uri: displayAvatar }} style={styles.avatar} />
              ) : (
                <ThemedText
                  type="h1"
                  style={{ color: "#FFFFFF", fontSize: 32 }}
                >
                  {user?.name?.charAt(0).toUpperCase() || "U"}
                </ThemedText>
              )}
            </View>
            <View
              style={[
                styles.editAvatarBtn,
                { backgroundColor: theme.backgroundDefault },
              ]}
            >
              <Feather name="camera" size={12} color={theme.primary} />
            </View>
          </Pressable>
          <Spacer height={Spacing.md} />
          <ThemedText type="h2" style={{ color: "#FFFFFF", fontWeight: "800" }}>
            {toTitleCase(user?.name)}
          </ThemedText>
          <ThemedText
            type="small"
            style={{ color: "rgba(255,255,255,0.70)", marginTop: 2 }}
          >
            {user?.phone ? `+91 ${user.phone}` : user?.email || ""}
          </ThemedText>
          <Spacer height={Spacing.sm} />
          <View
            style={[
              styles.roleBadge,
              { backgroundColor: "rgba(255,255,255,0.18)" },
            ]}
          >
            <ThemedText
              type="caption"
              style={{
                color: "#FFFFFF",
                fontWeight: "700",
                letterSpacing: 0.4,
              }}
            >
              {toTitleCase(user?.role?.replace(/_/g, " "))}
            </ThemedText>
          </View>
          <Spacer height={Spacing.xl} />
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
                {formatDate(dateOfJoining || (user as any)?.date_of_joining)}
              </ThemedText>
            </View>
          </View>
          {team ? (
            <View
              style={[
                styles.infoRow,
                { backgroundColor: theme.backgroundDefault },
              ]}
            >
              <Feather name="users" size={18} color={theme.textSecondary} />
              <View style={styles.infoContent}>
                <ThemedText
                  type="caption"
                  style={{ color: theme.textSecondary }}
                >
                  Team
                </ThemedText>
                <ThemedText type="body">{team}</ThemedText>
              </View>
            </View>
          ) : null}
        </View>

        <Spacer height={Spacing.xl} />

        {(user?.role?.includes("PARTNER") ||
          user?.role?.includes("HEAD") ||
          user?.role?.includes("MANAGER")) && (
          <>
            <ThemedText type="h4" style={styles.sectionTitle}>
              My Team
            </ThemedText>
            <Spacer height={Spacing.sm} />

            <View style={styles.menuSection}>
              <MenuItem
                icon="users"
                title="Team Reports"
                subtitle="Open the authoritative My Team view"
                onPress={() => navigation.navigate("MyTeam")}
              />
            </View>
            <Spacer height={Spacing.xl} />
          </>
        )}

        <ThemedText type="h4" style={styles.sectionTitle}>
          Account
        </ThemedText>
        <Spacer height={Spacing.sm} />

        <View style={styles.menuSection}>
          <MenuItem
            icon="user"
            title="Edit Profile"
            subtitle="Update your name and photo"
            onPress={openEditModal}
          />
          <MenuItem
            icon="map-pin"
            title="My Office"
            subtitle={
              offices.find((o) => o.id === currentOfficeId)?.name ||
              "Not assigned — tap to set"
            }
            onPress={() =>
              Alert.alert(
                "Office Assignment",
                "Contact HR to change your assigned office.",
              )
            }
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
            icon="smartphone"
            title="Device Sessions"
            subtitle="This device, other active devices and last activity"
            onPress={() => setShowDeviceSessions(true)}
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
          RE HRMS v{releaseConfig.version} · Build {releaseConfig.buildId}
        </ThemedText>

        <Spacer height={Spacing.xl} />
      
          {/* Recent History Timeline */}
          <View style={{ marginTop: Spacing.xl, marginBottom: Spacing.xl }}>
            <ThemedText type="h4" style={{ marginBottom: Spacing.md, paddingHorizontal: Spacing.xs }}>Recent History</ThemedText>
            <View style={{ backgroundColor: theme.backgroundDefault, borderRadius: 14, padding: Spacing.lg, ...(Platform.OS === 'web' ? { boxShadow: "0 2px 8px rgba(0,0,0,0.05)" } : { shadowColor: '#000', shadowOffset: {width: 0, height: 2}, shadowOpacity: 0.05, shadowRadius: 8, elevation: 2}) }}>
              {historyTimeline.length === 0 ? (
                <ThemedText style={{ color: theme.textSecondary, textAlign: 'center' }}>No recent history found.</ThemedText>
              ) : (
                historyTimeline.map((item, index) => {
                  let color = theme.textSecondary;
                  let icon = "minus";
                  if (item.day_status === 'PRESENT' || item.day_status === 'PRESENT_LATE' || item.day_status === 'HALF_DAY_PRESENT') { color = '#10B981'; icon = 'check-circle'; }
                  else if (item.day_status === 'ABSENT' || item.day_status === 'UNAUTHORIZED_ABSENT') { color = '#EF4444'; icon = 'x-circle'; }
                  else if (item.day_status === 'ON_LEAVE') { color = '#8B5CF6'; icon = 'umbrella'; }
                  else if (item.day_status === 'WEEKOFF' || item.day_status === 'HOLIDAY') { color = '#3B82F6'; icon = 'calendar'; }
                  
                  return (
                    <View key={item.work_date} style={{ flexDirection: 'row', alignItems: 'flex-start', marginBottom: index === historyTimeline.length - 1 ? 0 : 16 }}>
                      <View style={{ width: 1, backgroundColor: index === historyTimeline.length - 1 ? 'transparent' : theme.border, position: 'absolute', left: 11, top: 24, bottom: -16 }} />
                      <View style={{ width: 24, height: 24, borderRadius: 12, backgroundColor: color + '15', alignItems: 'center', justifyContent: 'center', marginRight: 12, zIndex: 2 }}>
                        <Feather name={icon} size={12} color={color} />
                      </View>
                      <View style={{ flex: 1 }}>
                        <ThemedText style={{ fontWeight: '600', fontSize: 14 }}>{new Date(item.work_date).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}</ThemedText>
                        <ThemedText style={{ color: theme.textSecondary, fontSize: 13, marginTop: 2 }}>{item.day_status ? item.day_status.replace(/_/g, ' ') : 'UNKNOWN'} {item.latest_tracking_status === 'OFFICE' ? 'at ' + (item.office_name || 'Office') : (item.latest_tracking_status === 'FIELD_VISIT' ? 'on Field Visit' : '')}</ThemedText>
                      </View>
                    </View>
                  );
                })
              )}
              <Pressable 
                style={{ marginTop: 16, paddingTop: 16, borderTopWidth: 1, borderTopColor: theme.border, alignItems: 'center' }}
                onPress={() => navigation.navigate("Attendance")}
              >
                <ThemedText style={{ color: theme.primary, fontWeight: '600' }}>View Full Calendar</ThemedText>
              </Pressable>
            </View>
          </View>
  
        </ScreenScrollView>

      <DeviceSessionsModal
        visible={showDeviceSessions}
        onClose={() => setShowDeviceSessions(false)}
      />

      {/* Office Picker Modal */}
      <Modal
        visible={showOfficePicker}
        animationType="slide"
        transparent
        onRequestClose={() => setShowOfficePicker(false)}
      >
        <View style={styles.modalOverlay}>
          <ThemedView
            style={[
              styles.modalContainer,
              { paddingBottom: insets.bottom + Spacing.lg },
            ]}
          >
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
                    style={[
                      s.officeRow,
                      selected && {
                        borderColor: theme.primary,
                        backgroundColor: theme.primary + "10",
                      },
                    ]}
                    onPress={() => handleSaveOffice(office.id)}
                  >
                    <View
                      style={[
                        s.officeIcon,
                        {
                          backgroundColor: selected
                            ? theme.primary
                            : theme.primary + "20",
                        },
                      ]}
                    >
                      <Feather
                        name="map-pin"
                        size={16}
                        color={selected ? "#fff" : theme.primary}
                      />
                    </View>
                    <ThemedText
                      type="body"
                      style={{
                        flex: 1,
                        color: selected ? theme.primary : theme.text,
                        fontWeight: selected ? "700" : "400",
                      }}
                    >
                      {office.name}
                    </ThemedText>
                    {selected && (
                      <Feather
                        name="check-circle"
                        size={20}
                        color={theme.primary}
                      />
                    )}
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
              {/* Profile picture picker */}
              <View style={{ alignItems: "center", marginBottom: 20 }}>
                <View
                  style={[
                    styles.avatarContainer,
                    { backgroundColor: theme.primary, marginBottom: 12 },
                  ]}
                >
                  {avatarUri ? (
                    <Image source={{ uri: avatarUri }} style={styles.avatar} />
                  ) : displayAvatar ? (
                    <Image
                      source={{ uri: displayAvatar }}
                      style={styles.avatar}
                    />
                  ) : (
                    <ThemedText type="h1" style={{ color: "#FFFFFF" }}>
                      {user?.name?.charAt(0).toUpperCase() || "U"}
                    </ThemedText>
                  )}
                </View>
                <View style={{ flexDirection: "row", gap: 10 }}>
                  <TouchableOpacity
                    style={[s.picBtn, { borderColor: theme.primary }]}
                    onPress={() => pickImage("camera")}
                  >
                    <Feather name="camera" size={15} color={theme.primary} />
                    <ThemedText
                      style={[s.picBtnText, { color: theme.primary }]}
                    >
                      Camera
                    </ThemedText>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[s.picBtn, { borderColor: theme.primary }]}
                    onPress={() => pickImage("gallery")}
                  >
                    <Feather name="image" size={15} color={theme.primary} />
                    <ThemedText
                      style={[s.picBtnText, { color: theme.primary }]}
                    >
                      Gallery
                    </ThemedText>
                  </TouchableOpacity>
                </View>
                {avatarUri && (
                  <ThemedText
                    style={{ fontSize: 12, color: "#10B981", marginTop: 6 }}
                  >
                    ✓ New photo selected
                  </ThemedText>
                )}
              </View>

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

              <Spacer height={Spacing.xl} />

              <Button onPress={handleSaveProfile} loading={avatarUploading}>
                {avatarUploading ? "Uploading..." : "Save Changes"}
              </Button>
            </ScrollView>
          </ThemedView>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  profileBanner: {
    alignItems: "center",
    paddingHorizontal: Spacing.xl,
    borderBottomLeftRadius: 28,
    borderBottomRightRadius: 28,
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
  avatarWrapper: { position: "relative" },
  avatarContainer: {
    width: Spacing.avatarLg + 4,
    height: Spacing.avatarLg + 4,
    borderRadius: (Spacing.avatarLg + 4) / 2,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 3,
    borderColor: "rgba(255,255,255,0.4)",
  },
  avatar: {
    width: "100%",
    height: "100%",
    borderRadius: (Spacing.avatarLg + 4) / 2,
  },
  editAvatarBtn: {
    position: "absolute",
    bottom: 2,
    right: 2,
    width: 26,
    height: 26,
    borderRadius: 13,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1.5,
    borderColor: "rgba(109,27,109,0.15)",
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
    borderRadius: 14,
    gap: Spacing.md,
    ...(Platform.OS === "web"
      ? { boxShadow: "0 2px 8px rgba(109,27,109,0.07)" }
      : {
          shadowColor: "#6D1B6D",
          shadowOffset: { width: 0, height: 2 },
          shadowOpacity: 0.07,
          shadowRadius: 8,
          elevation: 2,
        }),
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
    borderRadius: 14,
    gap: Spacing.md,
    ...(Platform.OS === "web"
      ? { boxShadow: "0 2px 8px rgba(109,27,109,0.07)" }
      : {
          shadowColor: "#6D1B6D",
          shadowOffset: { width: 0, height: 2 },
          shadowOpacity: 0.07,
          shadowRadius: 8,
          elevation: 2,
        }),
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
  picBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 20,
    borderWidth: 1.5,
  },
  picBtnText: {
    fontSize: 13,
    fontWeight: "600",
  },
  // Team Management Styles
  dateRangeRow: {
    flexDirection: "row",
    gap: 12,
    marginBottom: 16,
  },
  dateInput: {
    flex: 1,
  },
  dateField: {
    height: 40,
    borderRadius: 8,
    paddingHorizontal: 12,
    marginTop: 4,
    fontSize: 14,
  },
  statsGrid: {
    flexDirection: "row",
    gap: 12,
  },
  statCard: {
    flex: 1,
    padding: 16,
    borderRadius: 12,
    alignItems: "center",
    ...(Platform.OS === "web"
      ? { boxShadow: "0 2px 8px rgba(109,27,109,0.07)" }
      : {
          shadowColor: "#6D1B6D",
          shadowOffset: { width: 0, height: 2 },
          shadowOpacity: 0.07,
          shadowRadius: 8,
          elevation: 2,
        }),
  },
  memberCard: {
    padding: 14,
    borderRadius: 12,
    marginBottom: 12,
    ...(Platform.OS === "web"
      ? { boxShadow: "0 2px 8px rgba(109,27,109,0.07)" }
      : {
          shadowColor: "#6D1B6D",
          shadowOffset: { width: 0, height: 2 },
          shadowOpacity: 0.07,
          shadowRadius: 8,
          elevation: 2,
        }),
  },
  memberHeader: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 8,
  },
  memberAvatar: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
  },
  memberInfo: {
    flex: 1,
    marginLeft: 12,
  },
  memberStats: {
    alignItems: "flex-end",
  },
  statusBadge: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 12,
  },
  statusText: {
    color: "#FFFFFF",
    fontSize: 11,
    fontWeight: "700",
  },
  memberDetails: {
    gap: 4,
  },
  detailItem: {
    flexDirection: "row",
    alignItems: "center",
  },
  emptyState: {
    alignItems: "center",
    padding: 40,
  },
});
