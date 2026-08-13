import React, { useState, useCallback } from "react";
import {
  StyleSheet, View, Pressable, TextInput, Modal,
  RefreshControl, ScrollView, Platform, Dimensions,
} from "react-native";
import Feather from "@expo/vector-icons/Feather";
import { useFocusEffect } from "@react-navigation/native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { ScreenScrollView } from "@/components/ScreenScrollView";
import { PageHeader } from "@/components/PageHeader";
import { ThemedText } from "@/components/ThemedText";
import { ThemedView } from "@/components/ThemedView";
import { Button } from "@/components/Button";
import { useTheme } from "@/hooks/useTheme";
import { Spacing, BorderRadius, Colors } from "@/constants/theme";
import Spacer from "@/components/Spacer";
import { ProjectStorage, Project } from "@/utils/storage";

const { width: W } = Dimensions.get("window");
const CARD_W = (W - Spacing.lg * 2 - Spacing.md) / 2;

const STATUS_COLORS: Record<string, string> = {
  available: Colors.light.success,
  sold_out:  Colors.light.error,
  upcoming:  Colors.light.info,
};

function ProjectCard({ project, onPress }: { project: Project; onPress: () => void }) {
  const { theme } = useTheme();
  const sc = STATUS_COLORS[project.status];

  return (
    <Pressable
      style={({ pressed }) => [styles.projCard, { backgroundColor: theme.backgroundDefault, opacity: pressed ? 0.88 : 1 }]}
      onPress={onPress}
    >
      <View style={[styles.projImage, { backgroundColor: theme.primary + "18" }]}>
        <Feather name="home" size={28} color={theme.primary} />
      </View>
      <View style={styles.projContent}>
        <View style={[styles.sBadge, { backgroundColor: sc + "20" }]}>
          <ThemedText type="caption" style={{ color: sc, fontWeight: "700", fontSize: 10 }}>
            {project.status.replace("_", " ").toUpperCase()}
          </ThemedText>
        </View>
        <ThemedText type="small" style={{ fontWeight: "700", color: theme.text, marginTop: 4 }} numberOfLines={1}>
          {project.name}
        </ThemedText>
        <View style={styles.location}>
          <Feather name="map-pin" size={11} color={theme.textSecondary} />
          <ThemedText type="caption" style={{ color: theme.textSecondary }} numberOfLines={1}>{project.location}</ThemedText>
        </View>
        <ThemedText type="small" style={{ color: theme.primary, fontWeight: "700", marginTop: 4 }}>
          {project.price}
        </ThemedText>
      </View>
    </Pressable>
  );
}

export default function ProjectsScreen() {
  const { theme } = useTheme();
  const insets = useSafeAreaInsets();

  const [projects,       setProjects]       = useState<Project[]>([]);
  const [searchQuery,    setSearchQuery]    = useState("");
  const [filterStatus,   setFilterStatus]   = useState<Project["status"] | "all">("all");
  const [refreshing,     setRefreshing]     = useState(false);
  const [selectedProject,setSelectedProject]= useState<Project | null>(null);
  const [showDetail,     setShowDetail]     = useState(false);

  const loadData = useCallback(async () => {
    setProjects(await ProjectStorage.getAll());
  }, []);

  useFocusEffect(useCallback(() => { loadData(); }, [loadData]));
  const onRefresh = async () => { setRefreshing(true); await loadData(); setRefreshing(false); };

  const filtered = projects.filter((p) => {
    if (filterStatus !== "all" && p.status !== filterStatus) return false;
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      return p.name.toLowerCase().includes(q) || p.location.toLowerCase().includes(q);
    }
    return true;
  });

  const filters: { key: Project["status"] | "all"; label: string }[] = [
    { key: "all",       label: "All"       },
    { key: "available", label: "Available" },
    { key: "upcoming",  label: "Upcoming"  },
    { key: "sold_out",  label: "Sold Out"  },
  ];

  return (
    <View style={{ flex: 1, backgroundColor: theme.backgroundRoot }}>
      <PageHeader
        title="RE Projects"
        subtitle={`${projects.length} properties listed`}
      />

      <ScreenScrollView
        noPaddingTop
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={theme.primary} />}
        contentContainerStyle={styles.content}
      >
        <Spacer height={Spacing.lg} />

        {/* Search */}
        <View style={[styles.searchBox, { backgroundColor: theme.backgroundDefault }]}>
          <Feather name="search" size={17} color={theme.textSecondary} />
          <TextInput
            style={[styles.searchInput, { color: theme.text }]}
            placeholder="Search projects..."
            placeholderTextColor={theme.textSecondary}
            value={searchQuery}
            onChangeText={setSearchQuery}
          />
          {searchQuery
            ? <Pressable onPress={() => setSearchQuery("")}>
                <Feather name="x" size={17} color={theme.textSecondary} />
              </Pressable>
            : null
          }
        </View>

        <Spacer height={Spacing.md} />

        {/* Filter chips */}
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipRow}>
          {filters.map((f) => (
            <Pressable
              key={f.key}
              style={[styles.chip, { backgroundColor: filterStatus === f.key ? theme.primary : theme.backgroundDefault }]}
              onPress={() => setFilterStatus(f.key)}
            >
              <ThemedText type="caption" style={{ color: filterStatus === f.key ? "#FFFFFF" : theme.text, fontWeight: filterStatus === f.key ? "700" : "400" }}>
                {f.label}
              </ThemedText>
            </Pressable>
          ))}
        </ScrollView>

        <Spacer height={Spacing.lg} />

        {/* Stats row */}
        <View style={styles.statsRow}>
          {[
            { label: "Total",     value: projects.length,                                         color: theme.primary  },
            { label: "Available", value: projects.filter((p) => p.status === "available").length, color: Colors.light.success },
            { label: "Upcoming",  value: projects.filter((p) => p.status === "upcoming").length,  color: Colors.light.info    },
          ].map((s) => (
            <View key={s.label} style={[styles.statCard, { backgroundColor: theme.backgroundDefault }]}>
              <ThemedText type="h3" style={{ color: s.color, fontWeight: "800" }}>{s.value}</ThemedText>
              <ThemedText type="caption" style={{ color: theme.textSecondary, marginTop: 2 }}>{s.label}</ThemedText>
            </View>
          ))}
        </View>

        <Spacer height={Spacing.xl} />

        {filtered.length > 0
          ? <View style={styles.grid}>
              {filtered.map((p) => (
                <ProjectCard key={p.id} project={p} onPress={() => { setSelectedProject(p); setShowDetail(true); }} />
              ))}
            </View>
          : <View style={[styles.empty, { backgroundColor: theme.backgroundDefault }]}>
              <Feather name="home" size={44} color={theme.textSecondary} />
              <Spacer height={Spacing.md} />
              <ThemedText type="body" style={{ color: theme.textSecondary, textAlign: "center" }}>
                {searchQuery ? "No projects match your search" : "No projects available"}
              </ThemedText>
            </View>
        }
        <Spacer height={Spacing["4xl"]} />
      </ScreenScrollView>

      {/* Detail Modal */}
      <Modal visible={showDetail} animationType="slide" transparent onRequestClose={() => setShowDetail(false)}>
        <View style={styles.overlay}>
          <ThemedView style={[styles.sheet, { paddingBottom: insets.bottom + Spacing.lg }]}>
            <View style={styles.sheetHandle} />
            <View style={styles.sheetHeader}>
              <ThemedText type="h3">Project Details</ThemedText>
              <Pressable onPress={() => setShowDetail(false)}>
                <Feather name="x" size={22} color={theme.text} />
              </Pressable>
            </View>
            {selectedProject && (
              <ScrollView style={styles.sheetBody} showsVerticalScrollIndicator={false}>
                <View style={[styles.detailHero, { backgroundColor: theme.primary + "18" }]}>
                  <Feather name="home" size={56} color={theme.primary} />
                </View>
                <Spacer height={Spacing.lg} />

                <View style={styles.detailTitleRow}>
                  <ThemedText type="h2" style={{ flex: 1 }}>{selectedProject.name}</ThemedText>
                  <View style={[styles.sBadge, { backgroundColor: STATUS_COLORS[selectedProject.status] + "20" }]}>
                    <ThemedText type="caption" style={{ color: STATUS_COLORS[selectedProject.status], fontWeight: "700" }}>
                      {selectedProject.status.replace("_", " ").toUpperCase()}
                    </ThemedText>
                  </View>
                </View>

                <View style={styles.location}>
                  <Feather name="map-pin" size={14} color={theme.textSecondary} />
                  <ThemedText type="small" style={{ color: theme.textSecondary, flex: 1 }}>{selectedProject.address}</ThemedText>
                </View>

                <Spacer height={Spacing.lg} />
                <View style={[styles.priceCard, { backgroundColor: theme.primary + "10" }]}>
                  <ThemedText type="caption" style={{ color: theme.primary }}>Price Range</ThemedText>
                  <ThemedText type="h3" style={{ color: theme.primary, fontWeight: "800" }}>{selectedProject.price}</ThemedText>
                  {selectedProject.pricePerSqft && (
                    <ThemedText type="caption" style={{ color: theme.textSecondary }}>{selectedProject.pricePerSqft}</ThemedText>
                  )}
                </View>

                <Spacer height={Spacing.lg} />
                <ThemedText type="h4" style={{ fontWeight: "700" }}>Description</ThemedText>
                <Spacer height={Spacing.sm} />
                <ThemedText type="body" style={{ color: theme.textSecondary, lineHeight: 22 }}>{selectedProject.description}</ThemedText>

                <Spacer height={Spacing.lg} />
                <ThemedText type="h4" style={{ fontWeight: "700" }}>Amenities</ThemedText>
                <Spacer height={Spacing.sm} />
                <View style={styles.amenitiesGrid}>
                  {selectedProject.amenities.map((a, i) => (
                    <View key={i} style={[styles.amenityChip, { backgroundColor: theme.backgroundSecondary }]}>
                      <Feather name="check" size={11} color={Colors.light.success} />
                      <ThemedText type="caption">{a}</ThemedText>
                    </View>
                  ))}
                </View>

                <Spacer height={Spacing.xl} />
                <Button onPress={() => setShowDetail(false)}>Contact Sales</Button>
                <Spacer height={Spacing.lg} />
              </ScrollView>
            )}
          </ThemedView>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  content:   { paddingHorizontal: Spacing.lg },
  searchBox: {
    flexDirection: "row", alignItems: "center",
    paddingHorizontal: Spacing.md, paddingVertical: 10,
    borderRadius: 12, gap: Spacing.sm,
    ...(Platform.OS === "web"
      ? { boxShadow: "0 1px 4px rgba(109,27,109,0.07)" }
      : { shadowColor: "#6D1B6D", shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.07, shadowRadius: 4, elevation: 1 }),
  },
  searchInput:{ flex: 1, fontSize: 15, paddingVertical: 2 },
  chipRow:    { gap: Spacing.sm, paddingRight: Spacing.lg },
  chip:       { paddingHorizontal: Spacing.md, paddingVertical: 7, borderRadius: BorderRadius.full },
  statsRow:   { flexDirection: "row", gap: Spacing.md },
  statCard:   { flex: 1, alignItems: "center", padding: Spacing.lg, borderRadius: 14,
    ...(Platform.OS === "web"
      ? { boxShadow: "0 2px 8px rgba(109,27,109,0.07)" }
      : { shadowColor: "#6D1B6D", shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.07, shadowRadius: 8, elevation: 2 }),
  },
  grid:       { flexDirection: "row", flexWrap: "wrap", gap: Spacing.md },
  projCard:   {
    width: CARD_W, borderRadius: 14, overflow: "hidden",
    ...(Platform.OS === "web"
      ? { boxShadow: "0 2px 8px rgba(109,27,109,0.07)" }
      : { shadowColor: "#6D1B6D", shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.07, shadowRadius: 8, elevation: 2 }),
  },
  projImage:  { height: 90, alignItems: "center", justifyContent: "center" },
  projContent:{ padding: Spacing.md },
  sBadge:     { alignSelf: "flex-start", paddingHorizontal: 7, paddingVertical: 2, borderRadius: 5 },
  location:   { flexDirection: "row", alignItems: "center", gap: 4, marginTop: 3 },
  empty:      { alignItems: "center", padding: Spacing["3xl"], borderRadius: 14 },
  overlay:    { flex: 1, backgroundColor: "rgba(0,0,0,0.48)", justifyContent: "flex-end" },
  sheet:      { borderTopLeftRadius: 24, borderTopRightRadius: 24, maxHeight: "92%" },
  sheetHandle:{ width: 36, height: 4, borderRadius: 2, backgroundColor: "rgba(0,0,0,0.15)", alignSelf: "center", marginTop: 12, marginBottom: 4 },
  sheetHeader:{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingHorizontal: Spacing.lg, paddingVertical: Spacing.md, borderBottomWidth: 1, borderBottomColor: "rgba(128,128,128,0.15)" },
  sheetBody:  { padding: Spacing.lg },
  detailHero: { height: 160, borderRadius: 14, alignItems: "center", justifyContent: "center" },
  detailTitleRow: { flexDirection: "row", alignItems: "flex-start", gap: Spacing.sm },
  priceCard:  { padding: Spacing.lg, borderRadius: 14, alignItems: "center" },
  amenitiesGrid: { flexDirection: "row", flexWrap: "wrap", gap: Spacing.sm },
  amenityChip:   { flexDirection: "row", alignItems: "center", gap: 5, paddingHorizontal: Spacing.md, paddingVertical: 6, borderRadius: BorderRadius.full },
});
