/**
 * SiteVisitObserverMap.tsx
 * Native version — renders Google Maps via react-native-maps.
 * Features Snapchat-style labeled markers with icon, label & status,
 * destination pin, polyline, and route playback controls.
 */

import React, { useRef, useEffect } from "react";
import { View, StyleSheet, TouchableOpacity } from "react-native";
import MapView, { Marker, Polyline, PROVIDER_GOOGLE } from "react-native-maps";
import Feather from "@expo/vector-icons/Feather";
import { ThemedText } from "@/components/ThemedText";
import { useTheme } from "@/hooks/useTheme";
import { BorderRadius } from "@/constants/theme";
import {
  SiteVisitObserverEmployee,
  SiteVisitObserverVisit,
} from "@/types/location-database";
import { CleanedRoutePoint } from "@/utils/routeCleanup";

export interface SiteVisitObserverMapProps {
  employees: SiteVisitObserverEmployee[];
  selectedEmployee: SiteVisitObserverEmployee | null;
  selectedVisit: SiteVisitObserverVisit | null;
  onSelectEmployee: (emp: SiteVisitObserverEmployee) => void;
  polylineCoords: Array<{ latitude: number; longitude: number }>;
  breadcrumbs: CleanedRoutePoint[];
  isPlaying: boolean;
  activePlaybackPoint: CleanedRoutePoint | null;
  playbackIndex: number;
  playbackSpeed: number;
  playbackProgress?: number;
  elapsedTimeStr?: string;
  totalTimeStr?: string;
  onTogglePlay: () => void;
  onRestart?: () => void;
  onSetSpeed: (speed: number) => void;
  onScrub?: (progress: number) => void;
}

const STATUS_MAP: Record<string, { color: string; symbol: string; label: string }> = {
  IN_TRANSIT: { color: "#6366F1", symbol: "🟣", label: "In Transit" },
  AT_SITE: { color: "#10B981", symbol: "🟢", label: "At Site" },
  CHECKED_IN: { color: "#10B981", symbol: "🟢", label: "At Site" },
  COMPLETED: { color: "#4B5563", symbol: "⚫", label: "Completed" },
  SIGNAL_LOST: { color: "#EF4444", symbol: "🟡", label: "Signal Lost" },
  DEFAULT: { color: "#3B82F6", symbol: "📍", label: "Active" },
};

export default function SiteVisitObserverMap({
  employees,
  selectedEmployee,
  selectedVisit,
  onSelectEmployee,
  polylineCoords,
  breadcrumbs,
  isPlaying,
  activePlaybackPoint,
  playbackIndex,
  playbackSpeed,
  elapsedTimeStr = "00:00",
  totalTimeStr = "00:00",
  onTogglePlay,
  onRestart,
  onSetSpeed,
}: SiteVisitObserverMapProps) {
  const { theme } = useTheme();
  const mapRef = useRef<MapView>(null);

  useEffect(() => {
    if (!mapRef.current) return;

    if (breadcrumbs.length > 1) {
      mapRef.current.fitToCoordinates(
        breadcrumbs.map((b) => ({ latitude: b.latitude, longitude: b.longitude })),
        {
          edgePadding: { top: 120, right: 60, bottom: 60, left: 60 },
          animated: true,
        },
      );
    } else if (employees.length > 0) {
      const coords = employees
        .map((e) => ({
          latitude: e.tracking?.latitude ?? e.latest_lat,
          longitude: e.tracking?.longitude ?? e.latest_lon,
        }))
        .filter(
          (c): c is { latitude: number; longitude: number } =>
            c.latitude != null && c.longitude != null,
        );

      if (coords.length > 0) {
        mapRef.current.fitToCoordinates(coords, {
          edgePadding: { top: 120, right: 60, bottom: 60, left: 60 },
          animated: true,
        });
      }
    }
  }, [breadcrumbs, employees]);

  return (
    <View style={s.container}>
      <MapView
        ref={mapRef}
        provider={PROVIDER_GOOGLE}
        style={StyleSheet.absoluteFill}
        initialRegion={{
          latitude: 28.5355,
          longitude: 77.391,
          latitudeDelta: 0.25,
          longitudeDelta: 0.25,
        }}
      >
        {/* Snapchat-Style Labeled Employee Markers */}
        {employees.map((emp) => {
          const lat = emp.tracking?.latitude ?? emp.latest_lat;
          const lon = emp.tracking?.longitude ?? emp.latest_lon;
          if (lat == null || lon == null) return null;

          const isSelected = selectedEmployee?.employee_id === emp.employee_id;
          const st = emp.tracking?.status ?? emp.tracking_status ?? "DEFAULT";
          const cfg = STATUS_MAP[st] || STATUS_MAP.DEFAULT;
          const firstName = emp.name.split(" ")[0];

          return (
            <Marker
              key={`emp-${emp.employee_id}`}
              coordinate={{ latitude: lat, longitude: lon }}
              onPress={() => onSelectEmployee(emp)}
            >
              <View style={[s.labeledMarker, isSelected && s.selectedMarker]}>
                <View style={[s.markerBubble, { borderColor: cfg.color }]}>
                  <ThemedText style={s.markerLabel}>
                    {cfg.symbol} {firstName}
                  </ThemedText>
                </View>
                <View style={[s.markerPin, { backgroundColor: cfg.color }]} />
              </View>
            </Marker>
          );
        })}

        {/* Selected Visit Destination Pin */}
        {selectedVisit &&
          selectedVisit.destination_lat != null &&
          selectedVisit.destination_lon != null && (
            <Marker
              key={`dest-${selectedVisit.visit_id}`}
              coordinate={{
                latitude: selectedVisit.destination_lat,
                longitude: selectedVisit.destination_lon,
              }}
              pinColor="#EF4444"
              title={selectedVisit.project_name || selectedVisit.location_name || "Destination"}
            />
          )}

        {/* Visit Route Polyline */}
        {polylineCoords.length > 1 && (
          <Polyline
            coordinates={polylineCoords}
            strokeColor="#7C3AED"
            strokeWidth={4}
          />
        )}

        {/* Animated Playback Marker */}
        {isPlaying && activePlaybackPoint && (
          <Marker
            key="playback-marker"
            coordinate={{
              latitude: activePlaybackPoint.latitude,
              longitude: activePlaybackPoint.longitude,
            }}
          >
            <View style={s.playbackMarker}>
              <Feather name="navigation" size={16} color="#fff" />
            </View>
          </Marker>
        )}
      </MapView>

      {/* Route Playback Controller */}
      {breadcrumbs.length > 0 && (
        <View style={[s.playbackBar, { backgroundColor: theme.backgroundDefault }]}>
          <TouchableOpacity style={s.playBtn} onPress={onTogglePlay}>
            <Feather name={isPlaying ? "pause" : "play"} size={16} color="#fff" />
          </TouchableOpacity>

          {onRestart && (
            <TouchableOpacity style={s.restartBtn} onPress={onRestart}>
              <Feather name="rotate-ccw" size={14} color="#7C3AED" />
            </TouchableOpacity>
          )}

          <View style={s.playbackInfo}>
            <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
              <ThemedText style={s.playbackText}>
                Step {playbackIndex + 1} / {breadcrumbs.length}
              </ThemedText>
              <ThemedText type="caption" style={{ color: theme.textSecondary, fontWeight: "600" }}>
                {elapsedTimeStr} / {totalTimeStr}
              </ThemedText>
            </View>
            {activePlaybackPoint && (
              <ThemedText type="caption" style={{ color: theme.textSecondary }}>
                {new Date(activePlaybackPoint.recorded_at).toLocaleTimeString("en-IN", {
                  hour: "2-digit",
                  minute: "2-digit",
                })}
                {activePlaybackPoint.speed_mps != null &&
                  ` · ${(activePlaybackPoint.speed_mps * 3.6).toFixed(0)} km/h`}
              </ThemedText>
            )}
          </View>

          <View style={s.speedSelector}>
            {[0.5, 1, 2, 5].map((spd) => (
              <TouchableOpacity
                key={`spd-${spd}`}
                style={[s.speedBtn, playbackSpeed === spd && s.activeSpeedBtn]}
                onPress={() => onSetSpeed(spd)}
              >
                <ThemedText
                  style={[s.speedText, playbackSpeed === spd && s.activeSpeedText]}
                >
                  {spd}x
                </ThemedText>
              </TouchableOpacity>
            ))}
          </View>
        </View>
      )}
    </View>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, position: "relative" },
  labeledMarker: { alignItems: "center" },
  selectedMarker: { transform: [{ scale: 1.15 }] },
  markerBubble: {
    backgroundColor: "#fff",
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 8,
    borderWidth: 2,
    elevation: 3,
    shadowColor: "#000",
    shadowOpacity: 0.2,
    shadowRadius: 3,
    shadowOffset: { width: 0, height: 2 },
  },
  markerLabel: { fontSize: 11, fontWeight: "700", color: "#1F2937" },
  markerPin: { width: 8, height: 8, borderRadius: 4, marginTop: 2 },
  playbackMarker: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: "#7C3AED",
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 2,
    borderColor: "#fff",
  },
  playbackBar: {
    position: "absolute",
    top: 12,
    left: 12,
    right: 12,
    flexDirection: "row",
    alignItems: "center",
    padding: 10,
    borderRadius: BorderRadius.lg,
    elevation: 4,
    shadowColor: "#000",
    shadowOpacity: 0.15,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 2 },
    gap: 10,
  },
  playBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: "#7C3AED",
    alignItems: "center",
    justifyContent: "center",
  },
  restartBtn: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: "#F3E8FF",
    alignItems: "center",
    justifyContent: "center",
  },
  playbackInfo: { flex: 1, gap: 2 },
  playbackText: { fontSize: 11, fontWeight: "700" },
  speedSelector: { flexDirection: "row", gap: 4 },
  speedBtn: {
    paddingHorizontal: 6,
    paddingVertical: 4,
    borderRadius: 6,
    backgroundColor: "#F3F4F6",
  },
  activeSpeedBtn: { backgroundColor: "#7C3AED" },
  speedText: { fontSize: 11, fontWeight: "600", color: "#4B5563" },
  activeSpeedText: { color: "#fff" },
});
