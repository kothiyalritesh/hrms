import * as ImagePicker from "expo-image-picker";
import { manipulateAsync, SaveFormat } from "expo-image-manipulator";
import type { EvidencePhoto, PhotoSource } from "@/services/current-location-visit.service";

// Evidence is for visual verification, not archiving: a compact JPEG keeps
// uploads quick on mobile data and storage small. Same limits as the
// current-location fallback.
const MAX_EDGE_PX = 480;
const FALLBACK_EDGE_PX = 320;
const TARGET_BYTES = 150 * 1024;

function resizeToLongestEdge(width: number, height: number, edge: number) {
  if (Math.max(width, height) <= edge) return [];
  return width >= height ? [{ resize: { width: edge } }] : [{ resize: { height: edge } }];
}

export type CaptureResult =
  | { ok: true; photo: EvidencePhoto }
  | { ok: false; reason: "CANCELLED" | "PERMISSION_DENIED" | "UNSUPPORTED" | "FAILED" };

/** Opens the camera (or gallery) and returns a compressed JPEG without metadata. */
export async function captureEvidencePhoto(source: PhotoSource = "CAMERA"): Promise<CaptureResult> {
  const permission =
    source === "CAMERA"
      ? await ImagePicker.requestCameraPermissionsAsync()
      : await ImagePicker.requestMediaLibraryPermissionsAsync();
  if (!permission.granted) return { ok: false, reason: "PERMISSION_DENIED" };

  const picker = source === "CAMERA" ? ImagePicker.launchCameraAsync : ImagePicker.launchImageLibraryAsync;
  const selected = await picker({ mediaTypes: ["images"], quality: 0.5, allowsEditing: false });
  if (selected.canceled || !selected.assets[0]) return { ok: false, reason: "CANCELLED" };
  const asset = selected.assets[0];
  const mimeType = asset.mimeType || "image/jpeg";
  if (!["image/jpeg", "image/png"].includes(mimeType)) return { ok: false, reason: "UNSUPPORTED" };

  try {
    let processed = await manipulateAsync(
      asset.uri,
      resizeToLongestEdge(asset.width, asset.height, MAX_EDGE_PX),
      { compress: 0.22, format: SaveFormat.JPEG },
    );
    let blob = await (await fetch(processed.uri)).blob();
    if (blob.size > TARGET_BYTES) {
      processed = await manipulateAsync(
        processed.uri,
        resizeToLongestEdge(processed.width, processed.height, FALLBACK_EDGE_PX),
        { compress: 0.15, format: SaveFormat.JPEG },
      );
      blob = await (await fetch(processed.uri)).blob();
    }
    if (blob.size > TARGET_BYTES) {
      processed = await manipulateAsync(processed.uri, [], { compress: 0.1, format: SaveFormat.JPEG });
      blob = await (await fetch(processed.uri)).blob();
    }
    return { ok: true, photo: { uri: processed.uri, mimeType: "image/jpeg", fileSize: blob.size, source } };
  } catch (error) {
    console.error("[evidencePhoto] compression failed:", error);
    return { ok: false, reason: "FAILED" };
  }
}
