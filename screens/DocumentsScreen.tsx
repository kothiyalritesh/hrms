import React, { useState, useCallback } from "react";
import { Platform, StyleSheet, View, Pressable, Modal, Alert, RefreshControl } from "react-native";
import Feather from "@expo/vector-icons/Feather";
import { useFocusEffect } from "@react-navigation/native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import * as DocumentPicker from "expo-document-picker";
import { ScreenScrollView } from "@/components/ScreenScrollView";
import { PageHeader } from "@/components/PageHeader";
import { ThemedText } from "@/components/ThemedText";
import { formatDate } from "@/utils/format";
import { ThemedView } from "@/components/ThemedView";
import { Button } from "@/components/Button";
import { useTheme } from "@/hooks/useTheme";
import { Spacing, BorderRadius, Colors } from "@/constants/theme";
import Spacer from "@/components/Spacer";
import { DocumentStorage, Document } from "@/utils/storage";

type DocumentCategory = "personal" | "hr" | "property" | "certificate";

const CATEGORY_META: Record<DocumentCategory, { icon: keyof typeof Feather.glyphMap; label: string; color: string }> = {
  personal:    { icon: "user",      label: "Personal",    color: "#6D1B6D" },
  hr:          { icon: "file-text", label: "HR Docs",     color: "#1A5FD4" },
  property:    { icon: "home",      label: "Property",    color: "#12966E" },
  certificate: { icon: "award",     label: "Certificate", color: "#D97706" },
};

function getFileIcon(type: string): keyof typeof Feather.glyphMap {
  if (type.includes("pdf"))   return "file-text";
  if (type.includes("image")) return "image";
  return "file";
}

function formatSize(bytes: number) {
  if (bytes < 1024)        return bytes + " B";
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + " KB";
  return (bytes / (1024 * 1024)).toFixed(1) + " MB";
}

function DocCard({ doc, onDelete }: { doc: Document; onDelete: () => void }) {
  const { theme } = useTheme();
  const meta = CATEGORY_META[doc.category as DocumentCategory];

  const handleDelete = () =>
    Alert.alert("Delete Document", `Delete "${doc.name}"?`, [
      { text: "Cancel", style: "cancel" },
      { text: "Delete", style: "destructive", onPress: onDelete },
    ]);

  return (
    <View style={[styles.card, { backgroundColor: theme.backgroundDefault }]}>
      <View style={[styles.docIcon, { backgroundColor: (meta?.color ?? theme.primary) + "18" }]}>
        <Feather name={getFileIcon(doc.type)} size={22} color={meta?.color ?? theme.primary} />
      </View>
      <View style={styles.docInfo}>
        <ThemedText type="small" style={{ fontWeight: "600", color: theme.text }} numberOfLines={1}>{doc.name}</ThemedText>
        <ThemedText type="caption" style={{ color: theme.textSecondary, marginTop: 2 }}>
          {formatSize(doc.size)} · {formatDate(doc.uploadedAt)}
        </ThemedText>
      </View>
      <Pressable style={({ pressed }) => [styles.iconBtn, { opacity: pressed ? 0.6 : 1 }]} onPress={handleDelete}>
        <Feather name="trash-2" size={17} color={Colors.light.error} />
      </Pressable>
    </View>
  );
}

export default function DocumentsScreen() {
  const { theme } = useTheme();
  const insets = useSafeAreaInsets();

  const [documents,        setDocuments]        = useState<Document[]>([]);
  const [selectedCategory, setSelectedCategory] = useState<DocumentCategory | "all">("all");
  const [refreshing,       setRefreshing]        = useState(false);
  const [showUpload,       setShowUpload]        = useState(false);
  const [uploadCategory,   setUploadCategory]    = useState<DocumentCategory>("personal");

  const loadData = useCallback(async () => {
    setDocuments(await DocumentStorage.getAll());
  }, []);

  useFocusEffect(useCallback(() => { loadData(); }, [loadData]));
  const onRefresh = async () => { setRefreshing(true); await loadData(); setRefreshing(false); };

  const handlePick = async () => {
    try {
      const result = await DocumentPicker.getDocumentAsync({ type: "*/*", copyToCacheDirectory: true });
      if (!result.canceled && result.assets?.length) {
        const file = result.assets[0];
        await DocumentStorage.add({
          id: "doc_" + Date.now(), name: file.name, category: uploadCategory,
          uri: file.uri, size: file.size || 0, uploadedAt: new Date().toISOString(),
          type: file.mimeType || "application/octet-stream",
        });
        await loadData();
        setShowUpload(false);
        Alert.alert("Success", "Document uploaded successfully");
      }
    } catch { Alert.alert("Error", "Failed to upload document"); }
  };

  const filtered = selectedCategory === "all" ? documents : documents.filter((d) => d.category === selectedCategory);
  const chips: (DocumentCategory | "all")[] = ["all", "personal", "hr", "property", "certificate"];

  return (
    <View style={{ flex: 1, backgroundColor: theme.backgroundRoot }}>
      <PageHeader
        title="Documents"
        subtitle={`${documents.length} file${documents.length !== 1 ? "s" : ""} stored`}
        rightIcon="upload"
        rightLabel="Upload"
        onRightPress={() => setShowUpload(true)}
      />

      <ScreenScrollView
        noPaddingTop
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={theme.primary} />}
        contentContainerStyle={styles.content}
      >
        <Spacer height={Spacing.lg} />

        {/* Filter chips */}
        <View style={styles.chips}>
          {chips.map((cat) => (
            <Pressable
              key={cat}
              style={[styles.chip, { backgroundColor: selectedCategory === cat ? theme.primary : theme.backgroundDefault }]}
              onPress={() => setSelectedCategory(cat)}
            >
              <ThemedText type="caption" style={{ color: selectedCategory === cat ? "#FFFFFF" : theme.text, fontWeight: selectedCategory === cat ? "700" : "400" }}>
                {cat === "all" ? "All" : CATEGORY_META[cat].label}
              </ThemedText>
            </Pressable>
          ))}
        </View>

        <Spacer height={Spacing.lg} />

        {filtered.length > 0
          ? <View style={styles.list}>
              {filtered.map((doc) => <DocCard key={doc.id} doc={doc} onDelete={() => DocumentStorage.delete(doc.id).then(loadData)} />)}
            </View>
          : <View style={[styles.empty, { backgroundColor: theme.backgroundDefault }]}>
              <Feather name="folder" size={44} color={theme.textSecondary} />
              <Spacer height={Spacing.md} />
              <ThemedText type="body" style={{ color: theme.textSecondary, textAlign: "center" }}>No documents uploaded</ThemedText>
              <Pressable onPress={() => setShowUpload(true)} style={{ marginTop: Spacing.md }}>
                <ThemedText type="small" style={{ color: theme.primary, fontWeight: "600" }}>Upload your first document</ThemedText>
              </Pressable>
            </View>
        }
        <Spacer height={Spacing["4xl"]} />
      </ScreenScrollView>

      {/* Upload Modal */}
      <Modal visible={showUpload} animationType="slide" transparent onRequestClose={() => setShowUpload(false)}>
        <View style={styles.overlay}>
          <ThemedView style={[styles.sheet, { paddingBottom: insets.bottom + Spacing.lg }]}>
            <View style={styles.sheetHandle} />
            <View style={styles.sheetHeader}>
              <ThemedText type="h3">Upload Document</ThemedText>
              <Pressable onPress={() => setShowUpload(false)}>
                <Feather name="x" size={22} color={theme.text} />
              </Pressable>
            </View>
            <View style={styles.sheetBody}>
              <ThemedText type="small" style={styles.label}>Category</ThemedText>
              <View style={styles.categoryGrid}>
                {(["personal","hr","property","certificate"] as DocumentCategory[]).map((cat) => {
                  const m = CATEGORY_META[cat];
                  const sel = uploadCategory === cat;
                  return (
                    <Pressable
                      key={cat}
                      style={[styles.catOption, { backgroundColor: sel ? theme.primary + "18" : theme.backgroundSecondary, borderColor: sel ? theme.primary : "transparent" }]}
                      onPress={() => setUploadCategory(cat)}
                    >
                      <Feather name={m.icon} size={22} color={sel ? theme.primary : theme.textSecondary} />
                      <ThemedText type="caption" style={{ color: sel ? theme.primary : theme.text, marginTop: 4, textAlign: "center" }}>
                        {m.label}
                      </ThemedText>
                    </Pressable>
                  );
                })}
              </View>
              <Spacer height={Spacing.xl} />
              <Button onPress={handlePick}>Select File</Button>
              <Spacer height={Spacing.sm} />
              <ThemedText type="caption" style={{ color: theme.textSecondary, textAlign: "center" }}>
                Supported: PDF, JPG, PNG, DOC, DOCX
              </ThemedText>
            </View>
          </ThemedView>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  content: { paddingHorizontal: Spacing.lg },
  chips:   { flexDirection: "row", flexWrap: "wrap", gap: Spacing.sm },
  chip:    { paddingHorizontal: Spacing.md, paddingVertical: 7, borderRadius: BorderRadius.full },
  list:    { gap: Spacing.sm },
  card: {
    flexDirection: "row", alignItems: "center",
    padding: Spacing.lg, borderRadius: 14, gap: Spacing.md,
    ...(Platform.OS === "web"
      ? { boxShadow: "0 2px 8px rgba(109,27,109,0.07)" }
      : { shadowColor: "#6D1B6D", shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.07, shadowRadius: 8, elevation: 2 }),
  },
  docIcon:  { width: 44, height: 44, borderRadius: 11, alignItems: "center", justifyContent: "center" },
  docInfo:  { flex: 1 },
  iconBtn:  { width: 34, height: 34, alignItems: "center", justifyContent: "center" },
  empty:    { alignItems: "center", padding: Spacing["3xl"], borderRadius: 14 },
  overlay:  { flex: 1, backgroundColor: "rgba(0,0,0,0.48)", justifyContent: "flex-end" },
  sheet:    { borderTopLeftRadius: 24, borderTopRightRadius: 24, maxHeight: "80%" },
  sheetHandle: {
    width: 36, height: 4, borderRadius: 2,
    backgroundColor: "rgba(0,0,0,0.15)", alignSelf: "center", marginTop: 12, marginBottom: 4,
  },
  sheetHeader: {
    flexDirection: "row", justifyContent: "space-between", alignItems: "center",
    paddingHorizontal: Spacing.lg, paddingVertical: Spacing.md,
    borderBottomWidth: 1, borderBottomColor: "rgba(128,128,128,0.15)",
  },
  sheetBody:    { padding: Spacing.lg },
  label:        { fontWeight: "600", marginBottom: Spacing.sm },
  categoryGrid: { flexDirection: "row", flexWrap: "wrap", gap: Spacing.md },
  catOption: {
    width: "47%", padding: Spacing.lg, borderRadius: 12,
    alignItems: "center", borderWidth: 1.5,
  },
});
