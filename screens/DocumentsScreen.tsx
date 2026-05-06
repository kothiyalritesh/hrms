import React, { useState, useCallback } from "react";
import { Platform, StyleSheet,
  View,
  Pressable,
  Modal,
  Alert,
  RefreshControl,
  Linking,
} from "react-native";
import { Feather } from "@expo/vector-icons";
import { useFocusEffect } from "@react-navigation/native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import * as DocumentPicker from "expo-document-picker";
import { ScreenScrollView } from "@/components/ScreenScrollView";
import { ThemedText } from "@/components/ThemedText";
import { ThemedView } from "@/components/ThemedView";
import { Button } from "@/components/Button";
import { useTheme } from "@/hooks/useTheme";
import { useAuth } from "@/contexts/AuthContext";
import { Spacing, BorderRadius, Colors } from "@/constants/theme";
import Spacer from "@/components/Spacer";
import { supabase } from "@/lib/supabase";

type DocumentCategory = "personal" | "hr" | "property" | "certificate";

const CATEGORY_ICONS: Record<DocumentCategory, keyof typeof Feather.glyphMap> =
  {
    personal: "user",
    hr: "file-text",
    property: "home",
    certificate: "award",
  };

const CATEGORY_LABELS: Record<DocumentCategory, string> = {
  personal: "Personal (PAN/Aadhaar)",
  hr: "HR Documents",
  property: "Property Documents",
  certificate: "Certificates",
};

interface DocumentCardProps {
  doc: Document;
  onDelete: () => void;
  onView: () => void;
}

function DocumentCard({ doc, onDelete, onView }: DocumentCardProps) {
  const { theme } = useTheme();

  const formatSize = (bytes: number) => {
    if (bytes < 1024) return bytes + " B";
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + " KB";
    return (bytes / (1024 * 1024)).toFixed(1) + " MB";
  };

  const getFileIcon = (type: string): keyof typeof Feather.glyphMap => {
    if (type.includes("pdf")) return "file-text";
    if (type.includes("image")) return "image";
    if (type.includes("word") || type.includes("doc")) return "file";
    return "file";
  };

  const handleDelete = () => {
    Alert.alert("Delete Document", `Are you sure you want to delete "${doc.name}"?`, [
      { text: "Cancel", style: "cancel" },
      { text: "Delete", style: "destructive", onPress: onDelete },
    ]);
  };

  return (
    <View style={[styles.docCard, { backgroundColor: theme.backgroundDefault }]}>
      <View style={[styles.docIcon, { backgroundColor: theme.primary + "15" }]}>
        <Feather name={getFileIcon(doc.mime_type)} size={24} color={theme.primary} />
      </View>
      <View style={styles.docContent}>
        <ThemedText type="body" style={styles.docName} numberOfLines={1}>{doc.name}</ThemedText>
        <ThemedText type="caption" style={{ color: theme.textSecondary }}>
          {formatSize(doc.size)} · {new Date(doc.uploaded_at).toLocaleDateString()}
        </ThemedText>
      </View>
      <View style={styles.docActions}>
        <Pressable style={({ pressed }) => [styles.actionBtn, { opacity: pressed ? 0.6 : 1 }]} onPress={onView}>
          <Feather name="eye" size={18} color={theme.primary} />
        </Pressable>
        <Pressable style={({ pressed }) => [styles.actionBtn, { opacity: pressed ? 0.6 : 1 }]} onPress={handleDelete}>
          <Feather name="trash-2" size={18} color={Colors.light.error} />
        </Pressable>
      </View>
    </View>
  );
}

interface Document {
  id: string;
  name: string;
  category: DocumentCategory;
  file_path: string;
  file_url: string;
  size: number;
  uploaded_at: string;
  mime_type: string;
}

export default function DocumentsScreen() {
  const { theme } = useTheme();
  const { user } = useAuth();
  const insets = useSafeAreaInsets();

  const [documents, setDocuments] = useState<Document[]>([]);
  const [selectedCategory, setSelectedCategory] = useState<DocumentCategory | "all">("all");
  const [refreshing, setRefreshing] = useState(false);
  const [showUploadModal, setShowUploadModal] = useState(false);
  const [uploadCategory, setUploadCategory] = useState<DocumentCategory>("personal");
  const [uploading, setUploading] = useState(false);

  const loadData = useCallback(async () => {
    if (!user?.id) return;
    const { data, error } = await supabase
      .from("employee_documents")
      .select("*")
      .eq("user_id", user.id)
      .order("uploaded_at", { ascending: false });
    if (!error) setDocuments(data || []);
  }, [user?.id]);

  useFocusEffect(useCallback(() => { loadData(); }, [loadData]));

  const onRefresh = async () => {
    setRefreshing(true);
    await loadData();
    setRefreshing(false);
  };

  const handlePickDocument = async () => {
    if (!user?.id) return;
    try {
      const result = await DocumentPicker.getDocumentAsync({ type: "*/*", copyToCacheDirectory: true });
      if (result.canceled || !result.assets?.length) return;

      const file = result.assets[0];
      setUploading(true);

      // Read file as blob
      const response = await fetch(file.uri);
      const blob = await response.blob();
      const filePath = `${user.id}/${uploadCategory}/${Date.now()}_${file.name}`;

      // Upload to Supabase Storage
      const { error: uploadError } = await supabase.storage
        .from("employee-documents")
        .upload(filePath, blob, { contentType: file.mimeType || "application/octet-stream", upsert: false });

      if (uploadError) throw uploadError;

      // Get public URL
      const { data: urlData } = supabase.storage
        .from("employee-documents")
        .getPublicUrl(filePath);

      // Save record to DB
      const { error: dbError } = await supabase.from("employee_documents").insert({
        user_id: user.id,
        name: file.name,
        category: uploadCategory,
        file_path: filePath,
        file_url: urlData.publicUrl,
        size: file.size || 0,
        mime_type: file.mimeType || "application/octet-stream",
      });

      if (dbError) throw dbError;

      await loadData();
      setShowUploadModal(false);
      Alert.alert("Success", "Document uploaded successfully");
    } catch (error: any) {
      Alert.alert("Error", error?.message || "Failed to upload document");
    } finally {
      setUploading(false);
    }
  };

  const handleDelete = async (doc: Document) => {
    try {
      await supabase.storage.from("employee-documents").remove([doc.file_path]);
      await supabase.from("employee_documents").delete().eq("id", doc.id);
      await loadData();
    } catch (error: any) {
      Alert.alert("Error", "Failed to delete document");
    }
  };

  const handleView = (doc: Document) => {
    if (doc.file_url) Linking.openURL(doc.file_url);
  };

  const filteredDocs = selectedCategory === "all"
    ? documents
    : documents.filter((d) => d.category === selectedCategory);

  const categories: (DocumentCategory | "all")[] = [
    "all",
    "personal",
    "hr",
    "property",
    "certificate",
  ];

  return (
    <View style={{ flex: 1, backgroundColor: theme.backgroundRoot }}>
      <ScreenScrollView
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor={theme.primary}
          />
        }
      >
        <View style={styles.filtersRow}>
          {categories.map((cat) => (
            <Pressable
              key={cat}
              style={[
                styles.filterChip,
                {
                  backgroundColor:
                    selectedCategory === cat
                      ? theme.primary
                      : theme.backgroundDefault,
                },
              ]}
              onPress={() => setSelectedCategory(cat)}
            >
              <ThemedText
                type="caption"
                style={{
                  color: selectedCategory === cat ? "#FFFFFF" : theme.text,
                  fontWeight: selectedCategory === cat ? "600" : "400",
                }}
              >
                {cat === "all"
                  ? "All"
                  : cat.charAt(0).toUpperCase() + cat.slice(1)}
              </ThemedText>
            </Pressable>
          ))}
        </View>

        <Spacer height={Spacing.lg} />

        {filteredDocs.length > 0 ? (
          <View style={styles.docsList}>
            {filteredDocs.map((doc) => (
              <DocumentCard
                key={doc.id}
                doc={doc}
                onDelete={() => handleDelete(doc)}
                onView={() => handleView(doc)}
              />
            ))}
          </View>
        ) : (
          <View
            style={[
              styles.emptyState,
              { backgroundColor: theme.backgroundDefault },
            ]}
          >
            <Feather name="folder" size={48} color={theme.textSecondary} />
            <Spacer height={Spacing.md} />
            <ThemedText
              type="body"
              style={{ color: theme.textSecondary, textAlign: "center" }}
            >
              No documents uploaded
            </ThemedText>
            <Spacer height={Spacing.md} />
            <Pressable onPress={() => setShowUploadModal(true)}>
              <ThemedText type="link">Upload your first document</ThemedText>
            </Pressable>
          </View>
        )}

        <Spacer height={Spacing["4xl"]} />
      </ScreenScrollView>

      <Pressable
        style={({ pressed }) => [
          styles.fab,
          {
            backgroundColor: theme.primary,
            bottom: insets.bottom + Spacing.xl,
            opacity: pressed ? 0.9 : 1,
            transform: [{ scale: pressed ? 0.95 : 1 }],
            ...(Platform.OS === "web"
              ? { boxShadow: "0 2px 8px rgba(0,0,0,0.2)" }
              : { shadowColor: "#000", shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.2, shadowRadius: 4, elevation: 4 }),
          },
        ]}
        onPress={() => setShowUploadModal(true)}
      >
        <Feather name="plus" size={24} color="#FFFFFF" />
      </Pressable>

      <Modal
        visible={showUploadModal}
        animationType="slide"
        transparent
        onRequestClose={() => setShowUploadModal(false)}
      >
        <View style={styles.modalOverlay}>
          <ThemedView
            style={[
              styles.modalContainer,
              { paddingBottom: insets.bottom + Spacing.lg },
            ]}
          >
            <View style={styles.modalHeader}>
              <ThemedText type="h3">Upload Document</ThemedText>
              <Pressable onPress={() => setShowUploadModal(false)}>
                <Feather name="x" size={24} color={theme.text} />
              </Pressable>
            </View>

            <View style={styles.modalContent}>
              <ThemedText type="small" style={styles.inputLabel}>
                Document Category
              </ThemedText>
              <View style={styles.categoryGrid}>
                {(
                  [
                    "personal",
                    "hr",
                    "property",
                    "certificate",
                  ] as DocumentCategory[]
                ).map((cat) => (
                  <Pressable
                    key={cat}
                    style={[
                      styles.categoryOption,
                      {
                        backgroundColor:
                          uploadCategory === cat
                            ? theme.primary + "20"
                            : theme.backgroundSecondary,
                        borderColor:
                          uploadCategory === cat
                            ? theme.primary
                            : "transparent",
                      },
                    ]}
                    onPress={() => setUploadCategory(cat)}
                  >
                    <Feather
                      name={CATEGORY_ICONS[cat]}
                      size={24}
                      color={
                        uploadCategory === cat
                          ? theme.primary
                          : theme.textSecondary
                      }
                    />
                    <ThemedText
                      type="caption"
                      style={{
                        color:
                          uploadCategory === cat ? theme.primary : theme.text,
                        textAlign: "center",
                      }}
                    >
                      {cat.charAt(0).toUpperCase() + cat.slice(1)}
                    </ThemedText>
                  </Pressable>
                ))}
              </View>

              <Spacer height={Spacing.xl} />

              <Button onPress={handlePickDocument} disabled={uploading}>
                {uploading ? "Uploading..." : "Select & Upload Document"}
              </Button>

              <Spacer height={Spacing.md} />

              <ThemedText
                type="caption"
                style={[styles.helpText, { color: theme.textSecondary }]}
              >
                Supported formats: PDF, JPG, PNG, DOC, DOCX
              </ThemedText>
            </View>
          </ThemedView>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  filtersRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: Spacing.sm,
  },
  filterChip: {
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    borderRadius: BorderRadius.full,
  },
  docsList: {
    gap: Spacing.md,
  },
  docCard: {
    flexDirection: "row",
    alignItems: "center",
    padding: Spacing.lg,
    borderRadius: BorderRadius.md,
    gap: Spacing.md,
  },
  docIcon: {
    width: 48,
    height: 48,
    borderRadius: BorderRadius.sm,
    alignItems: "center",
    justifyContent: "center",
  },
  docContent: {
    flex: 1,
  },
  docName: {
    fontWeight: "500",
    marginBottom: Spacing.xs,
  },
  docActions: {
    flexDirection: "row",
    gap: Spacing.sm,
  },
  actionBtn: {
    width: 36,
    height: 36,
    alignItems: "center",
    justifyContent: "center",
  },
  emptyState: {
    alignItems: "center",
    padding: Spacing["3xl"],
    borderRadius: BorderRadius.md,
  },
  fab: {
    position: "absolute",
    right: Spacing.xl,
    width: Spacing.fabSize,
    height: Spacing.fabSize,
    borderRadius: Spacing.fabSize / 2,
    alignItems: "center",
    justifyContent: "center",
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: "rgba(0, 0, 0, 0.5)",
    justifyContent: "flex-end",
  },
  modalContainer: {
    borderTopLeftRadius: BorderRadius.xl,
    borderTopRightRadius: BorderRadius.xl,
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
    marginBottom: Spacing.md,
    fontWeight: "600",
  },
  categoryGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: Spacing.md,
  },
  categoryOption: {
    width: "47%",
    padding: Spacing.lg,
    borderRadius: BorderRadius.md,
    alignItems: "center",
    gap: Spacing.sm,
    borderWidth: 2,
  },
  helpText: {
    textAlign: "center",
  },
});
