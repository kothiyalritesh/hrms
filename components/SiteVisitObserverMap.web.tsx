/**
 * SiteVisitObserverMap.web.tsx
 * Web version — renders Google Maps via Google Maps JavaScript API (no react-native-maps).
 * This completely avoids codegenNativeComponent errors in web bundler.
 * Features Google Maps JavaScript API with Snapchat-style labeled markers,
 * selective marker mutations for live GPS updates, and timestamp-driven route playback
 * with timeline scrubbing.
 */

import React, { useRef, useEffect } from "react";
import { View, StyleSheet, TouchableOpacity } from "react-native";
import Feather from "@expo/vector-icons/Feather";
import { ThemedText } from "@/components/ThemedText";
import { useTheme } from "@/hooks/useTheme";
import { BorderRadius } from "@/constants/theme";
import {
  SiteVisitObserverEmployee,
  SiteVisitObserverVisit,
} from "@/types/location-database";
import { CleanedRoutePoint } from "@/utils/routeCleanup";
import { loadGoogleMaps } from "@/utils/googleMapsLoader";
import { advancedMapOptions } from "@/utils/googleAdvancedMarkers";

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

// Marker styling helpers
function getMarkerConfig(status: string) {
  switch (status) {
    case "AT_SITE":
    case "CHECKED_IN":
      return { color: "#10B981", symbol: "🟢", labelText: "At Site" };
    case "IN_TRANSIT":
      return { color: "#6366F1", symbol: "🟣", labelText: "In Transit" };
    case "SIGNAL_LOST":
      return { color: "#EF4444", symbol: "🟡", labelText: "Signal Lost" };
    case "COMPLETED":
      return { color: "#4B5563", symbol: "⚫", labelText: "Completed" };
    default:
      return { color: "#3B82F6", symbol: "📍", labelText: "Active" };
  }
}

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
  playbackProgress = 0,
  elapsedTimeStr = "00:00",
  totalTimeStr = "00:00",
  onTogglePlay,
  onRestart,
  onSetSpeed,
  onScrub,
}: SiteVisitObserverMapProps) {
  const { theme } = useTheme();
  const containerRef = useRef<HTMLDivElement>(null);
  const mapInstanceRef = useRef<any>(null);
  const markersRef = useRef<any[]>([]);
  const markersMapRef = useRef<Map<string, any>>(new Map());
  const destMarkerRef = useRef<any>(null);
  const polylineRef = useRef<any>(null);
  const playbackMarkerRef = useRef<any>(null);

  // Initialize web map
  useEffect(() => {
    if (!containerRef.current) return;

    let isCancelled = false;
    void loadGoogleMaps()
      .then(() => {
        if (isCancelled || !containerRef.current) return;
        const google = (window as any).google;
        if (!google?.maps) return;

        if (!mapInstanceRef.current) {
          const map = new google.maps.Map(
            containerRef.current,
            advancedMapOptions({
              center: { lat: 28.5355, lng: 77.391 },
              zoom: 12,
              mapTypeControl: false,
              streetViewControl: false,
              fullscreenControl: true,
            }),
          );
          mapInstanceRef.current = map;
        }
      })
      .catch((err) => {
        console.warn("[SiteVisitObserverMap.web] Google Maps load failed:", err);
      });

    return () => {
      isCancelled = true;
    };
  }, []);

  // Update employee markers on the map
  // Selective Marker Update Engine (Avoid whole-map redraws)
  useEffect(() => {
    const map = mapInstanceRef.current;
    const google = (window as any).google;
    if (!map || !google?.maps) return;

    const currentMap = markersMapRef.current;
    const activeEmpIds = new Set<string>();
    const bounds = new google.maps.LatLngBounds();
    let hasPoints = false;

    // Add / update employee pins
    for (const emp of employees) {
      const lat = emp.tracking?.latitude ?? emp.latest_lat;
      const lon = emp.tracking?.longitude ?? emp.latest_lon;
      if (lat == null || lon == null) continue;

      activeEmpIds.add(emp.employee_id);
      hasPoints = true;
      const pos = { lat, lng: lon };
      bounds.extend(pos);

      const status = emp.tracking?.status ?? emp.tracking_status ?? "DEFAULT";
      const markerCfg = getMarkerConfig(status);
      const firstName = emp.name.split(" ")[0];

      if (currentMap.has(emp.employee_id)) {
        // Selective in-place update
        const existingMarker = currentMap.get(emp.employee_id);
        existingMarker.setPosition(pos);
        existingMarker.setTitle(`${emp.name} • ${markerCfg.labelText}`);
      } else {
        // Create new Snapchat-style labeled marker
        const marker = new google.maps.Marker({
          position: pos,
          map,
          title: `${emp.name} • ${markerCfg.labelText}`,
          label: {
            text: `${markerCfg.symbol} ${firstName}`,
            color: "#111827",
            fontSize: "12px",
            fontWeight: "700",
            className: "snapchat-observer-marker",
          },
        });

        marker.addListener("click", () => {
          onSelectEmployee(emp);
        });

        currentMap.set(emp.employee_id, marker);
        markersRef.current.push(marker);
      }
    }

    // Clean up markers for employees no longer in list
    for (const [empId, marker] of currentMap.entries()) {
      if (!activeEmpIds.has(empId)) {
        if (typeof marker.setMap === "function") marker.setMap(null);
        currentMap.delete(empId);
      }
    }

    // Destination Pin
    if (
      selectedVisit &&
      selectedVisit.destination_lat != null &&
      selectedVisit.destination_lon != null
    ) {
      const destPos = {
        lat: selectedVisit.destination_lat,
        lng: selectedVisit.destination_lon,
      };
      bounds.extend(destPos);

      if (!destMarkerRef.current) {
        destMarkerRef.current = new google.maps.Marker({
          position: destPos,
          map,
          title: selectedVisit.project_name || selectedVisit.location_name || "Destination",
          icon: "https://maps.google.com/mapfiles/ms/icons/red-dot.png",
        });
      } else {
        destMarkerRef.current.setPosition(destPos);
        destMarkerRef.current.setMap(map);
      }
    } else if (destMarkerRef.current) {
      destMarkerRef.current.setMap(null);
    }

    if (hasPoints && !polylineCoords.length) {
      if (selectedEmployee) {
        const selLat = selectedEmployee.tracking?.latitude ?? selectedEmployee.latest_lat;
        const selLon = selectedEmployee.tracking?.longitude ?? selectedEmployee.latest_lon;
        if (selLat != null && selLon != null) {
          map.panTo({ lat: selLat, lng: selLon });
        }
      } else {
        map.fitBounds(bounds);
      }
    }
  }, [employees, selectedEmployee, selectedVisit, onSelectEmployee, polylineCoords.length]);

  // Route Polyline
  useEffect(() => {
    const map = mapInstanceRef.current;
    const google = (window as any).google;
    if (!map || !google?.maps) return;

    if (polylineRef.current) {
      polylineRef.current.setMap(null);
      polylineRef.current = null;
    }

    if (polylineCoords.length > 1) {
      const path = polylineCoords.map((c) => ({ lat: c.latitude, lng: c.longitude }));
      polylineRef.current = new google.maps.Polyline({
        path,
        geodesic: true,
        strokeColor: "#7C3AED",
        strokeOpacity: 0.9,
        strokeWeight: 4,
        map,
      });

      const bounds = new google.maps.LatLngBounds();
      for (const p of path) bounds.extend(p);
      map.fitBounds(bounds);
    }
  }, [polylineCoords]);

  // Animated Playback Marker
  useEffect(() => {
    const map = mapInstanceRef.current;
    const google = (window as any).google;
    if (!map || !google?.maps) return;

    if (!isPlaying || !activePlaybackPoint) {
      if (playbackMarkerRef.current) {
        playbackMarkerRef.current.setMap(null);
        playbackMarkerRef.current = null;
      }
      return;
    }

    const pos = {
      lat: activePlaybackPoint.latitude,
      lng: activePlaybackPoint.longitude,
    };

    if (!playbackMarkerRef.current) {
      playbackMarkerRef.current = new google.maps.Marker({
        position: pos,
        map,
        title: "Playback Marker",
        icon: "https://maps.google.com/mapfiles/ms/icons/purple-dot.png",
      });
    } else {
      playbackMarkerRef.current.setPosition(pos);
    }
  }, [isPlaying, activePlaybackPoint]);

  return (
    <View style={s.container}>
      {/* HTML container for Google Maps on Web */}
      <div
        ref={containerRef}
        style={{
          width: "100%",
          height: "100%",
          position: "absolute",
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
        }}
      />

      {/* Timestamp-Driven Route Playback Scrub Bar */}
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

          <View style={s.scrubContainer}>
            <View style={s.scrubTimeRow}>
              <ThemedText style={s.playbackText}>
                Step {playbackIndex + 1} / {breadcrumbs.length}
              </ThemedText>
              <ThemedText type="caption" style={{ color: theme.textSecondary, fontWeight: "600" }}>
                {elapsedTimeStr} / {totalTimeStr}
              </ThemedText>
            </View>

            {/* Interactive Timeline Scrubber */}
            <input
              type="range"
              min="0"
              max="1"
              step="0.001"
              value={playbackProgress}
              onChange={(e) => onScrub && onScrub(parseFloat(e.target.value))}
              style={{
                width: "100%",
                accentColor: "#7C3AED",
                cursor: "pointer",
                height: 4,
              }}
            />

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
  container: {
    flex: 1,
    position: "relative",
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
    zIndex: 10,
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
  scrubContainer: {
    flex: 1,
    gap: 4,
  },
  scrubTimeRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  playbackText: {
    fontSize: 11,
    fontWeight: "700",
  },
  speedSelector: {
    flexDirection: "row",
    gap: 4,
  },
  speedBtn: {
    paddingHorizontal: 6,
    paddingVertical: 4,
    borderRadius: 6,
    backgroundColor: "#F3F4F6",
  },
  activeSpeedBtn: {
    backgroundColor: "#7C3AED",
  },
  speedText: {
    fontSize: 11,
    fontWeight: "600",
    color: "#4B5563",
  },
  activeSpeedText: {
    color: "#fff",
  },
});
