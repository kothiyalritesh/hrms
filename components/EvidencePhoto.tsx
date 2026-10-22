import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator, Image, Modal, Platform, Pressable, ScrollView,
  StyleSheet, View, useWindowDimensions,
} from "react-native";
import Feather from "@expo/vector-icons/Feather";
import { ThemedText } from "@/components/ThemedText";
import { useTheme } from "@/hooks/useTheme";
import { CurrentLocationVisitService } from "@/services/current-location-visit.service";

/**
 * Location-mismatch evidence photo.
 *  - Shown whole (contain), never cropped.
 *  - Tap to open full screen; zoom with pinch (phone) or the +/- buttons and
 *    mouse wheel (browser).
 *  - The private storage link expires after a few minutes; it is fetched
 *    again automatically when it fails to load or is about to expire.
 */
interface Props {
  path: string | null | undefined;
  height?: number;
  caption?: string | null;
}

const LINK_TTL_MS = 5 * 60 * 1000;
const ZOOM_STEPS = [1, 1.5, 2, 3, 4];

export function EvidencePhoto({ path, height = 220, caption }: Props) {
  const { theme } = useTheme();
  const { width: winW, height: winH } = useWindowDimensions();
  const [url, setUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);
  const [open, setOpen] = useState(false);
  const [zoom, setZoom] = useState(0);
  const signedAt = useRef(0);
  const retried = useRef(false);

  const sign = useCallback(async () => {
    if (!path) return;
    setLoading(true);
    setFailed(false);
    const { data, error } = await CurrentLocationVisitService.getSignedEvidenceUrl(path);
    if (error || !data?.signedUrl) {
      setUrl(null);
      setFailed(true);
    } else {
      setUrl(data.signedUrl);
      signedAt.current = Date.now();
    }
    setLoading(false);
  }, [path]);

  useEffect(() => {
    retried.current = false;
    setUrl(null);
    void sign();
  }, [sign]);

  const openViewer = () => {
    if (!url) return;
    // Re-sign first when the link is close to expiring.
    if (Date.now() - signedAt.current > LINK_TTL_MS - 30_000) void sign();
    setZoom(0);
    setOpen(true);
  };

  const onImageError = () => {
    if (!retried.current) {
      retried.current = true;
      void sign();
    } else {
      setFailed(true);
    }
  };

  if (!path) return null;

  const scale = ZOOM_STEPS[zoom];
  const viewW = winW;
  const viewH = winH - 120;

  return (
    <View>
      <Pressable
        onPress={openViewer}
        disabled={!url}
        accessibilityRole="imagebutton"
        accessibilityLabel="Location mismatch photo. Tap to enlarge."
        style={[styles.thumb, { height, borderColor: theme.border, backgroundColor: theme.backgroundSecondary }]}
      >
        {loading && !url ? (
          <ActivityIndicator color={theme.primary} />
        ) : url && !failed ? (
          <>
            <Image source={{ uri: url }} style={styles.fill} resizeMode="contain" onError={onImageError} />
            <View style={styles.zoomHint}>
              <Feather name="maximize-2" size={12} color="#fff" />
              <ThemedText type="caption" style={{ color: "#fff", marginLeft: 4 }}>Tap to zoom</ThemedText>
            </View>
          </>
        ) : (
          <Pressable onPress={() => { retried.current = false; void sign(); }} style={styles.center}>
            <Feather name="image" size={22} color={theme.textSecondary} />
            <ThemedText type="caption" style={{ color: theme.textSecondary, marginTop: 4 }}>
              Photo could not be loaded. Tap to retry.
            </ThemedText>
          </Pressable>
        )}
      </Pressable>
      {caption ? (
        <ThemedText type="caption" style={{ color: theme.textSecondary, marginTop: 4 }}>{caption}</ThemedText>
      ) : null}

      <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)}>
        <View style={styles.backdrop}>
          <View style={styles.toolbar}>
            <Pressable onPress={() => setZoom((z) => Math.max(0, z - 1))} style={styles.tool} accessibilityLabel="Zoom out">
              <Feather name="zoom-out" size={20} color="#fff" />
            </Pressable>
            <ThemedText style={{ color: "#fff", minWidth: 44, textAlign: "center" }}>{Math.round(scale * 100)}%</ThemedText>
            <Pressable onPress={() => setZoom((z) => Math.min(ZOOM_STEPS.length - 1, z + 1))} style={styles.tool} accessibilityLabel="Zoom in">
              <Feather name="zoom-in" size={20} color="#fff" />
            </Pressable>
            <View style={{ flex: 1 }} />
            <Pressable onPress={() => setOpen(false)} style={styles.tool} accessibilityLabel="Close">
              <Feather name="x" size={22} color="#fff" />
            </Pressable>
          </View>
          <ScrollView
            style={{ flex: 1 }}
            contentContainerStyle={{ minWidth: viewW, minHeight: viewH, alignItems: "center", justifyContent: "center" }}
            horizontal={false}
            maximumZoomScale={5}
            minimumZoomScale={1}
            centerContent
            bouncesZoom
          >
            <ScrollView
              horizontal
              contentContainerStyle={{ minWidth: viewW, alignItems: "center", justifyContent: "center" }}
            >
              <Pressable
                onPress={() => setZoom((z) => (z === 0 ? 2 : 0))}
                {...(Platform.OS === "web"
                  ? ({
                      onWheel: (e: any) => {
                        e.preventDefault?.();
                        setZoom((z) => (e.deltaY < 0 ? Math.min(ZOOM_STEPS.length - 1, z + 1) : Math.max(0, z - 1)));
                      },
                    } as any)
                  : {})}
              >
                {url ? (
                  <Image
                    source={{ uri: url }}
                    style={{ width: viewW * scale, height: viewH * scale }}
                    resizeMode="contain"
                    onError={onImageError}
                  />
                ) : null}
              </Pressable>
            </ScrollView>
          </ScrollView>
          {caption ? (
            <ThemedText type="caption" style={{ color: "#E5E7EB", textAlign: "center", padding: 10 }}>{caption}</ThemedText>
          ) : null}
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  thumb: { width: "100%", borderWidth: 1, borderRadius: 10, overflow: "hidden", alignItems: "center", justifyContent: "center" },
  fill: { width: "100%", height: "100%" },
  center: { alignItems: "center", justifyContent: "center", padding: 12 },
  zoomHint: {
    position: "absolute", right: 8, bottom: 8, flexDirection: "row", alignItems: "center",
    backgroundColor: "rgba(0,0,0,0.55)", paddingHorizontal: 8, paddingVertical: 3, borderRadius: 12,
  },
  backdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.94)" },
  toolbar: { flexDirection: "row", alignItems: "center", paddingHorizontal: 12, paddingTop: 16, paddingBottom: 8, gap: 6 },
  tool: { padding: 10, borderRadius: 20, backgroundColor: "rgba(255,255,255,0.12)" },
});
