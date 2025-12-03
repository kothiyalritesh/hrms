import React, { useState, useCallback } from "react";
import { StyleSheet, View, Pressable, TextInput, Modal, RefreshControl, ScrollView, Dimensions } from "react-native";
import { Feather } from "@expo/vector-icons";
import { useFocusEffect } from "@react-navigation/native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { ScreenScrollView } from "@/components/ScreenScrollView";
import { ThemedText } from "@/components/ThemedText";
import { ThemedView } from "@/components/ThemedView";
import { Button } from "@/components/Button";
import { useTheme } from "@/hooks/useTheme";
import { useAuth } from "@/contexts/AuthContext";
import { Spacing, BorderRadius, Colors, Shadows } from "@/constants/theme";
import Spacer from "@/components/Spacer";
import { ProjectStorage, Project } from "@/utils/storage";

const { width: SCREEN_WIDTH } = Dimensions.get("window");
const CARD_WIDTH = (SCREEN_WIDTH - Spacing.xl * 2 - Spacing.md) / 2;

const STATUS_COLORS = {
  available: Colors.light.success,
  sold_out: Colors.light.error,
  upcoming: Colors.light.info,
};

interface ProjectCardProps {
  project: Project;
  onPress: () => void;
}

function ProjectCard({ project, onPress }: ProjectCardProps) {
  const { theme } = useTheme();
  const statusColor = STATUS_COLORS[project.status];
  
  return (
    <Pressable 
      style={({ pressed }) => [
        styles.projectCard,
        { backgroundColor: theme.backgroundDefault, opacity: pressed ? 0.9 : 1 }
      ]}
      onPress={onPress}
    >
      <View style={[styles.projectImage, { backgroundColor: theme.primary + "20" }]}>
        <Feather name="home" size={32} color={theme.primary} />
      </View>
      
      <View style={styles.projectContent}>
        <View style={[styles.statusBadge, { backgroundColor: statusColor + "20" }]}>
          <ThemedText type="caption" style={{ color: statusColor, fontWeight: "600", fontSize: 10 }}>
            {project.status.replace("_", " ").toUpperCase()}
          </ThemedText>
        </View>
        
        <ThemedText type="body" style={styles.projectName} numberOfLines={1}>
          {project.name}
        </ThemedText>
        
        <View style={styles.projectLocation}>
          <Feather name="map-pin" size={12} color={theme.textSecondary} />
          <ThemedText type="caption" style={{ color: theme.textSecondary }} numberOfLines={1}>
            {project.location}
          </ThemedText>
        </View>
        
        <ThemedText type="small" style={{ color: theme.primary, fontWeight: "600" }}>
          {project.price}
        </ThemedText>
        
        <View style={styles.projectType}>
          <ThemedText type="caption" style={{ color: theme.textSecondary, textTransform: "capitalize" }}>
            {project.type}
          </ThemedText>
        </View>
      </View>
    </Pressable>
  );
}

export default function ProjectsScreen() {
  const { theme } = useTheme();
  const { user } = useAuth();
  const insets = useSafeAreaInsets();
  
  const [projects, setProjects] = useState<Project[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [filterStatus, setFilterStatus] = useState<Project["status"] | "all">("all");
  const [refreshing, setRefreshing] = useState(false);
  const [selectedProject, setSelectedProject] = useState<Project | null>(null);
  const [showDetailModal, setShowDetailModal] = useState(false);

  const canManageProjects = user?.role === "admin";

  const loadData = useCallback(async () => {
    const allProjects = await ProjectStorage.getAll();
    setProjects(allProjects);
  }, []);

  useFocusEffect(
    useCallback(() => {
      loadData();
    }, [loadData])
  );

  const onRefresh = async () => {
    setRefreshing(true);
    await loadData();
    setRefreshing(false);
  };

  const filteredProjects = projects.filter(project => {
    if (filterStatus !== "all" && project.status !== filterStatus) return false;
    if (searchQuery) {
      const query = searchQuery.toLowerCase();
      return (
        project.name.toLowerCase().includes(query) ||
        project.location.toLowerCase().includes(query)
      );
    }
    return true;
  });

  const filters: { key: Project["status"] | "all"; label: string }[] = [
    { key: "all", label: "All" },
    { key: "available", label: "Available" },
    { key: "upcoming", label: "Upcoming" },
    { key: "sold_out", label: "Sold Out" },
  ];

  return (
    <View style={{ flex: 1, backgroundColor: theme.backgroundRoot }}>
      <ScreenScrollView
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={theme.primary} />
        }
      >
        <View style={[styles.searchContainer, { backgroundColor: theme.backgroundDefault }]}>
          <Feather name="search" size={18} color={theme.textSecondary} />
          <TextInput
            style={[styles.searchInput, { color: theme.text }]}
            placeholder="Search projects..."
            placeholderTextColor={theme.textSecondary}
            value={searchQuery}
            onChangeText={setSearchQuery}
          />
          {searchQuery ? (
            <Pressable onPress={() => setSearchQuery("")}>
              <Feather name="x" size={18} color={theme.textSecondary} />
            </Pressable>
          ) : null}
        </View>

        <Spacer height={Spacing.md} />

        <ScrollView 
          horizontal 
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.filtersScroll}
        >
          {filters.map(f => (
            <Pressable
              key={f.key}
              style={[
                styles.filterChip,
                { 
                  backgroundColor: filterStatus === f.key ? theme.primary : theme.backgroundDefault,
                }
              ]}
              onPress={() => setFilterStatus(f.key)}
            >
              <ThemedText 
                type="caption" 
                style={{ 
                  color: filterStatus === f.key ? "#FFFFFF" : theme.text,
                  fontWeight: filterStatus === f.key ? "600" : "400",
                }}
              >
                {f.label}
              </ThemedText>
            </Pressable>
          ))}
        </ScrollView>

        <Spacer height={Spacing.lg} />

        <View style={styles.statsRow}>
          <View style={[styles.statCard, { backgroundColor: theme.backgroundDefault }]}>
            <ThemedText type="h3" style={{ color: theme.primary }}>{projects.length}</ThemedText>
            <ThemedText type="caption" style={{ color: theme.textSecondary }}>Total Projects</ThemedText>
          </View>
          <View style={[styles.statCard, { backgroundColor: theme.backgroundDefault }]}>
            <ThemedText type="h3" style={{ color: Colors.light.success }}>
              {projects.filter(p => p.status === "available").length}
            </ThemedText>
            <ThemedText type="caption" style={{ color: theme.textSecondary }}>Available</ThemedText>
          </View>
          <View style={[styles.statCard, { backgroundColor: theme.backgroundDefault }]}>
            <ThemedText type="h3" style={{ color: Colors.light.info }}>
              {projects.filter(p => p.status === "upcoming").length}
            </ThemedText>
            <ThemedText type="caption" style={{ color: theme.textSecondary }}>Upcoming</ThemedText>
          </View>
        </View>

        <Spacer height={Spacing.xl} />

        {filteredProjects.length > 0 ? (
          <View style={styles.projectsGrid}>
            {filteredProjects.map(project => (
              <ProjectCard
                key={project.id}
                project={project}
                onPress={() => {
                  setSelectedProject(project);
                  setShowDetailModal(true);
                }}
              />
            ))}
          </View>
        ) : (
          <View style={[styles.emptyState, { backgroundColor: theme.backgroundDefault }]}>
            <Feather name="home" size={48} color={theme.textSecondary} />
            <Spacer height={Spacing.md} />
            <ThemedText type="body" style={{ color: theme.textSecondary, textAlign: "center" }}>
              {searchQuery ? "No projects match your search" : "No projects available"}
            </ThemedText>
          </View>
        )}

        <Spacer height={Spacing["4xl"]} />
      </ScreenScrollView>

      <Modal
        visible={showDetailModal}
        animationType="slide"
        transparent
        onRequestClose={() => setShowDetailModal(false)}
      >
        <View style={styles.modalOverlay}>
          <ThemedView style={[styles.modalContainer, { paddingBottom: insets.bottom + Spacing.lg }]}>
            <View style={styles.modalHeader}>
              <ThemedText type="h3">Project Details</ThemedText>
              <Pressable onPress={() => setShowDetailModal(false)}>
                <Feather name="x" size={24} color={theme.text} />
              </Pressable>
            </View>
            
            {selectedProject ? (
              <ScrollView style={styles.modalContent} showsVerticalScrollIndicator={false}>
                <View style={[styles.detailImage, { backgroundColor: theme.primary + "20" }]}>
                  <Feather name="home" size={64} color={theme.primary} />
                </View>
                
                <Spacer height={Spacing.lg} />
                
                <View style={styles.detailHeader}>
                  <ThemedText type="h2">{selectedProject.name}</ThemedText>
                  <View style={[styles.statusBadge, { backgroundColor: STATUS_COLORS[selectedProject.status] + "20" }]}>
                    <ThemedText type="caption" style={{ color: STATUS_COLORS[selectedProject.status], fontWeight: "600" }}>
                      {selectedProject.status.replace("_", " ").toUpperCase()}
                    </ThemedText>
                  </View>
                </View>
                
                <View style={styles.detailLocation}>
                  <Feather name="map-pin" size={16} color={theme.textSecondary} />
                  <ThemedText type="body" style={{ color: theme.textSecondary }}>
                    {selectedProject.address}
                  </ThemedText>
                </View>
                
                <Spacer height={Spacing.lg} />
                
                <View style={[styles.priceCard, { backgroundColor: theme.primary + "10" }]}>
                  <ThemedText type="caption" style={{ color: theme.primary }}>Price Range</ThemedText>
                  <ThemedText type="h3" style={{ color: theme.primary }}>{selectedProject.price}</ThemedText>
                  {selectedProject.pricePerSqft ? (
                    <ThemedText type="caption" style={{ color: theme.textSecondary }}>
                      {selectedProject.pricePerSqft}
                    </ThemedText>
                  ) : null}
                </View>
                
                <Spacer height={Spacing.lg} />
                
                <ThemedText type="h4">Description</ThemedText>
                <Spacer height={Spacing.sm} />
                <ThemedText type="body" style={{ color: theme.textSecondary }}>
                  {selectedProject.description}
                </ThemedText>
                
                <Spacer height={Spacing.lg} />
                
                <ThemedText type="h4">Amenities</ThemedText>
                <Spacer height={Spacing.sm} />
                <View style={styles.amenitiesGrid}>
                  {selectedProject.amenities.map((amenity, index) => (
                    <View 
                      key={index} 
                      style={[styles.amenityChip, { backgroundColor: theme.backgroundSecondary }]}
                    >
                      <Feather name="check" size={12} color={Colors.light.success} />
                      <ThemedText type="caption">{amenity}</ThemedText>
                    </View>
                  ))}
                </View>
                
                <Spacer height={Spacing.xl} />
                
                <Button onPress={() => setShowDetailModal(false)}>
                  Contact Sales
                </Button>
                
                <Spacer height={Spacing.lg} />
              </ScrollView>
            ) : null}
          </ThemedView>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  searchContainer: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.md,
    borderRadius: BorderRadius.md,
    gap: Spacing.sm,
  },
  searchInput: {
    flex: 1,
    fontSize: 16,
    paddingVertical: Spacing.xs,
  },
  filtersScroll: {
    gap: Spacing.sm,
  },
  filterChip: {
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    borderRadius: BorderRadius.full,
  },
  statsRow: {
    flexDirection: "row",
    gap: Spacing.md,
  },
  statCard: {
    flex: 1,
    alignItems: "center",
    padding: Spacing.lg,
    borderRadius: BorderRadius.md,
  },
  projectsGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: Spacing.md,
  },
  projectCard: {
    width: CARD_WIDTH,
    borderRadius: BorderRadius.md,
    overflow: "hidden",
  },
  projectImage: {
    height: 100,
    alignItems: "center",
    justifyContent: "center",
  },
  projectContent: {
    padding: Spacing.md,
  },
  statusBadge: {
    alignSelf: "flex-start",
    paddingHorizontal: Spacing.sm,
    paddingVertical: 2,
    borderRadius: BorderRadius.xs,
    marginBottom: Spacing.xs,
  },
  projectName: {
    fontWeight: "600",
    marginBottom: Spacing.xs,
  },
  projectLocation: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.xs,
    marginBottom: Spacing.sm,
  },
  projectType: {
    marginTop: Spacing.xs,
  },
  emptyState: {
    alignItems: "center",
    padding: Spacing["3xl"],
    borderRadius: BorderRadius.md,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: "rgba(0, 0, 0, 0.5)",
    justifyContent: "flex-end",
  },
  modalContainer: {
    borderTopLeftRadius: BorderRadius.xl,
    borderTopRightRadius: BorderRadius.xl,
    maxHeight: "90%",
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
  detailImage: {
    height: 180,
    borderRadius: BorderRadius.lg,
    alignItems: "center",
    justifyContent: "center",
  },
  detailHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
  },
  detailLocation: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: Spacing.sm,
    marginTop: Spacing.sm,
  },
  priceCard: {
    padding: Spacing.lg,
    borderRadius: BorderRadius.md,
    alignItems: "center",
  },
  amenitiesGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: Spacing.sm,
  },
  amenityChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.xs,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    borderRadius: BorderRadius.full,
  },
});
