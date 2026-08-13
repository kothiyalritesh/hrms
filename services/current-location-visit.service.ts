import { secureStorage } from "@/utils/secureStorage";
import Constants from "expo-constants";
import * as FileSystem from "expo-file-system/legacy";
import * as Crypto from "expo-crypto";
import { Platform } from "react-native";
import { supabase } from "@/lib/supabase";
import { firstRpcRow } from "@/utils/supabaseRpc";
import { GPSCoords } from "@/utils/gps";
import { parseDatabaseTimestamp } from "@/utils/businessDate";

export type PhotoSource = "CAMERA" | "GALLERY";
export type VerificationStatus =
  | "PENDING"
  | "APPROVED"
  | "REJECTED"
  | "NEEDS_INFORMATION"
  | "FLAGGED";

export type EvidencePhoto = {
  uri: string;
  mimeType: string;
  fileSize?: number;
  source: PhotoSource;
};

export type CurrentLocationSubmission = {
  visitId: string;
  sourceVisitId: string;
  selectedSiteId: string | null;
  location: GPSCoords;
  address: string | null;
  locationName: string;
  visitPurpose: string;
  clientProjectCompanyName?: string;
  additionalNotes?: string;
  expectedDurationMinutes: number;
  mismatchReason: string;
  mismatchExplanation?: string;
  declarationAt: string;
  idempotencyKey: string;
  photo?: EvidencePhoto | null;
  capturedOffline?: boolean;
  offlineIntegrityHash?: string;
  offlinePhotoHash?: string | null;
};

export type QueuedCurrentLocationSubmission = CurrentLocationSubmission & {
  retryCount?: number;
  lastError?: string | null;
  lastAttemptAt?: string | null;
  nextRetryAt?: string | null;
};

export type SubmissionResult = {
  visitId: string;
  sourceVisitId: string;
  verificationStatus: VerificationStatus;
  distanceMetres: number;
  duplicate: boolean;
  photoAdded: boolean;
  checkinTime: string;
  submittedAt: string;
};

const QUEUE_KEY = "@hrms_current_location_queue_v1";
const MAX_PHOTO_BYTES = 2 * 1024 * 1024;
const VERIFICATION_STATUSES = new Set<VerificationStatus>([
  "PENDING",
  "APPROVED",
  "REJECTED",
  "NEEDS_INFORMATION",
  "FLAGGED",
]);

async function authenticatedSession(forceRefresh = false) {
  let { data, error } = forceRefresh
    ? await supabase.auth.refreshSession()
    : await supabase.auth.getSession();
  if (error) throw new Error(`Unable to refresh your secure session: ${error.message}`);

  let session = data.session;
  const expiresSoon =
    session?.expires_at != null && session.expires_at * 1000 <= Date.now() + 60_000;
  if (!session || expiresSoon) {
    ({ data, error } = await supabase.auth.refreshSession());
    if (error) throw new Error(`Unable to refresh your secure session: ${error.message}`);
    session = data.session;
  }
  if (!session?.access_token) {
    throw new Error(
      "Your secure session has expired. Sign in again before submitting.",
    );
  }

  const { data: verified, error: verificationError } =
    await supabase.auth.getUser(session.access_token);
  if (verificationError || !verified.user) {
    if (!forceRefresh) return authenticatedSession(true);
    throw new Error(
      "Your secure session could not be verified. Reopen HRMS and try again.",
    );
  }
  return { session, user: verified.user };
}

function authorizationHeaders(accessToken: string) {
  return { Authorization: `Bearer ${accessToken}` };
}

function confirmedSubmissionResult(
  value: any,
  expectedVisitId: string,
  expectedSourceVisitId: string,
  requireBusinessSuccess: boolean,
): SubmissionResult {
  let timestampsAreValid = false;
  try {
    parseDatabaseTimestamp(String(value?.checkin_time || ""));
    parseDatabaseTimestamp(String(value?.submitted_at || ""));
    timestampsAreValid = true;
  } catch {
    timestampsAreValid = false;
  }
  if (
    (requireBusinessSuccess && value?.success !== true) ||
    value?.visit_id !== expectedVisitId ||
    value?.source_visit_id !== expectedSourceVisitId ||
    !VERIFICATION_STATUSES.has(value?.verification_status) ||
    !Number.isFinite(Number(value?.distance_metres)) ||
    typeof value?.duplicate !== "boolean" ||
    value?.status !== "CHECKED_IN" ||
    !timestampsAreValid
  ) {
    throw new Error(
      value?.message ||
        value?.error ||
        "The server did not confirm the current-location submission.",
    );
  }
  return {
    visitId: value.visit_id,
    sourceVisitId: value.source_visit_id,
    verificationStatus: value.verification_status,
    distanceMetres: Number(value.distance_metres),
    duplicate: value.duplicate,
    photoAdded: Boolean(value.photo_added),
    checkinTime: value.checkin_time,
    submittedAt: value.submitted_at,
  };
}

async function removeUncommittedPhoto(photoPath: string | null) {
  if (!photoPath) return;
  const { session } = await authenticatedSession();
  // The authenticated Edge Function uses server privileges only after proving
  // ownership and confirming no committed visit references this path.
  const { data, error } = await supabase.functions.invoke(
    "field-visit-evidence-upload",
    {
      body: { action: "delete_orphan", path: photoPath },
      headers: authorizationHeaders(session.access_token),
    },
  );
  if (
    error ||
    data?.success !== true ||
    data?.path !== photoPath ||
    (data?.deleted !== true && data?.referenced !== true)
  ) {
    throw new Error(
      data?.message ||
        data?.error ||
        error?.message ||
        "Uploaded evidence cleanup was not confirmed.",
    );
  }
}

function integrityMaterial(value: CurrentLocationSubmission) {
  return JSON.stringify({
    visitId: value.visitId,
    sourceVisitId: value.sourceVisitId,
    selectedSiteId: value.selectedSiteId,
    location: value.location,
    address: value.address,
    locationName: value.locationName,
    visitPurpose: value.visitPurpose,
    clientProjectCompanyName: value.clientProjectCompanyName,
    additionalNotes: value.additionalNotes,
    expectedDurationMinutes: value.expectedDurationMinutes,
    mismatchReason: value.mismatchReason,
    mismatchExplanation: value.mismatchExplanation,
    declarationAt: value.declarationAt,
    idempotencyKey: value.idempotencyKey,
    photo: value.photo
      ? { mimeType: value.photo.mimeType, source: value.photo.source }
      : null,
    offlinePhotoHash: value.offlinePhotoHash ?? null,
  });
}

async function integrityHash(value: CurrentLocationSubmission) {
  return Crypto.digestStringAsync(
    Crypto.CryptoDigestAlgorithm.SHA256,
    integrityMaterial(value),
  );
}

async function hashPhotoBytes(uri: string) {
  const base64 = await FileSystem.readAsStringAsync(uri, {
    encoding: FileSystem.EncodingType.Base64,
  });
  return Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, base64);
}

function metresBetween(
  a: { latitude: number; longitude: number },
  b: { latitude: number; longitude: number },
) {
  const r = 6371000;
  const p1 = (a.latitude * Math.PI) / 180;
  const p2 = (b.latitude * Math.PI) / 180;
  const dp = ((b.latitude - a.latitude) * Math.PI) / 180;
  const dl = ((b.longitude - a.longitude) * Math.PI) / 180;
  const h =
    Math.sin(dp / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) ** 2;
  return r * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

export function createUuid() {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto)
    return crypto.randomUUID();
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = Math.floor(Math.random() * 16);
    return (c === "x" ? r : (r & 0x3) | 0x8).toString(16);
  });
}

export function validateFreshLocation(location: GPSCoords) {
  if (location.mocked) {
    return {
      valid: false,
      reason: "Mock location is not allowed for field-visit evidence.",
    };
  }
  if (
    !Number.isFinite(location.latitude) ||
    !Number.isFinite(location.longitude) ||
    location.latitude === 0 ||
    location.longitude === 0 ||
    location.latitude < -90 ||
    location.latitude > 90 ||
    location.longitude < -180 ||
    location.longitude > 180
  ) {
    return { valid: false, reason: "Invalid GPS coordinates." };
  }
  const ageMs = Date.now() - new Date(location.capturedAt).getTime();
  if (!Number.isFinite(ageMs) || ageMs < -10_000 || ageMs > 60_000) {
    return {
      valid: false,
      reason:
        "This location reading is older than 60 seconds. Refresh your location.",
    };
  }
  const accuracy = location.accuracy ?? Number.POSITIVE_INFINITY;
  if (accuracy > 100)
    return {
      valid: false,
      reason: `Location accuracy is too low (±${Math.round(accuracy)} metres).`,
    };
  return { valid: true, moderate: accuracy > 50 };
}

async function uploadPhoto(
  submission: CurrentLocationSubmission,
  userId: string,
  initialAccessToken: string,
) {
  const photo = submission.photo;
  if (!photo) return null;
  if (!["image/jpeg", "image/png"].includes(photo.mimeType))
    throw new Error("Only JPEG or PNG photo evidence is allowed.");
  if (photo.fileSize != null && photo.fileSize > MAX_PHOTO_BYTES)
    throw new Error("Compressed photo evidence must be 2 MB or smaller.");

  const response = await fetch(photo.uri);
  const blob = await response.blob();
  if (blob.size > MAX_PHOTO_BYTES)
    throw new Error("Compressed photo evidence must be 2 MB or smaller.");
  if (!["image/jpeg", "image/png"].includes(blob.type || photo.mimeType))
    throw new Error("The selected file is not a supported image.");

  const form = new FormData();
  form.append("file", blob, "evidence.jpg");
  // The evidence path belongs to the immutable verification child row. The
  // source stop is retained separately for audit and employee display.
  form.append("visit_id", submission.visitId);
  form.append("idempotency_key", submission.idempotencyKey);
  form.append("captured_at", submission.location.capturedAt);
  let accessToken = initialAccessToken;
  const invokeUpload = () =>
    supabase.functions.invoke("field-visit-evidence-upload", {
      body: form,
      headers: authorizationHeaders(accessToken),
    });
  let { data, error } = await invokeUpload();

  // A mobile connection can change while the compressed multipart body is in
  // flight, and an app returning from the background may need one token refresh.
  // The server path is idempotent, so one retry cannot create duplicate evidence.
  const responseStatus = Number((error as any)?.context?.status || 0);
  const transientFailure =
    !!error &&
    (responseStatus === 401 ||
      responseStatus === 408 ||
      responseStatus === 429 ||
      responseStatus >= 500 ||
      /failed to send|fetch|network|timeout|connection/i.test(error.message));
  if (transientFailure) {
    if (responseStatus === 401) {
      const refreshed = await authenticatedSession(true);
      accessToken = refreshed.session.access_token;
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
    ({ data, error } = await invokeUpload());
  }

  if (error) {
    let serverMessage = "";
    const context = (error as any)?.context;
    if (context && typeof context.clone === "function") {
      try {
        const body = await context.clone().json();
        serverMessage = String(body?.message || body?.error || "");
      } catch {
        // The original SDK error message remains the fallback.
      }
    }
    throw new Error(serverMessage || error.message || "Photo upload failed.");
  }
  if (!data?.path)
    throw new Error(data?.message || data?.error || "Photo upload failed.");
  if (!String(data.path).startsWith(`${userId}/`))
    throw new Error("Invalid evidence ownership response.");
  return String(data.path);
}

export const CurrentLocationVisitService = {
  async submit(
    submission: CurrentLocationSubmission,
  ): Promise<SubmissionResult> {
    const quality = validateFreshLocation(submission.location);
    if (!quality.valid && !submission.capturedOffline)
      throw new Error(quality.reason);

    const { session, user: authenticatedUser } = await authenticatedSession();
    const { data: existing, error: existingError } = await supabase
      .from("field_visits")
      .select(
        "id,source_field_visit_id,verification_status,selected_site_distance_metres,evidence_photo_added,checkin_time,submitted_at,status",
      )
      .eq("user_id", authenticatedUser.id)
      .eq("idempotency_key", submission.idempotencyKey)
      .maybeSingle();
    if (existingError) {
      throw new Error(
        `Unable to verify an existing submission: ${existingError.message}`,
      );
    }
    if (existing) {
      if (
        existing.id !== submission.sourceVisitId &&
        existing.source_field_visit_id !== submission.sourceVisitId
      ) {
        throw new Error(
          "The idempotency key belongs to a different field visit.",
        );
      }
      return confirmedSubmissionResult(
        {
          visit_id: existing.id,
          source_visit_id: submission.sourceVisitId,
          verification_status: existing.verification_status,
          distance_metres: existing.selected_site_distance_metres,
          duplicate: true,
          photo_added: existing.evidence_photo_added,
          checkin_time: existing.checkin_time,
          submitted_at: existing.submitted_at,
          status: existing.status,
        },
        existing.id,
        submission.sourceVisitId,
        false,
      );
    }
    const recentQuery = supabase
      .from("field_visits")
      .select(
        "id,source_field_visit_id,verification_status,selected_site_distance_metres,evidence_photo_added,actual_latitude,actual_longitude,checkin_time,submitted_at,status",
      )
      .eq("user_id", authenticatedUser.id)
      .or(
        `id.eq.${submission.sourceVisitId},source_field_visit_id.eq.${submission.sourceVisitId}`,
      )
      .gte("submitted_at", new Date(Date.now() - 5 * 60_000).toISOString());
    const { data: recent, error: recentError } = await recentQuery;
    if (recentError) {
      throw new Error(
        `Unable to verify recent submissions: ${recentError.message}`,
      );
    }
    const nearDuplicate = recent?.find(
      (row: any) =>
        row.actual_latitude != null &&
        row.actual_longitude != null &&
        metresBetween(
          {
            latitude: row.actual_latitude,
            longitude: row.actual_longitude,
          },
          submission.location,
        ) <= 25,
    );
    if (nearDuplicate) {
      return confirmedSubmissionResult(
        {
          visit_id: nearDuplicate.id,
          source_visit_id: submission.sourceVisitId,
          verification_status: nearDuplicate.verification_status,
          distance_metres: nearDuplicate.selected_site_distance_metres,
          duplicate: true,
          photo_added: nearDuplicate.evidence_photo_added,
          checkin_time: nearDuplicate.checkin_time,
          submitted_at: nearDuplicate.submitted_at,
          status: nearDuplicate.status,
        },
        nearDuplicate.id,
        submission.sourceVisitId,
        false,
      );
    }

    const photoPath = await uploadPhoto(
      submission,
      authenticatedUser.id,
      session.access_token,
    );

    const { data, error } = await supabase.rpc(
      "submit_field_visit_current_location_v3",
      {
        p_visit_id: submission.visitId,
        p_source_visit_id: submission.sourceVisitId,
        p_selected_site_id: submission.selectedSiteId,
        p_actual_latitude: submission.location.latitude,
        p_actual_longitude: submission.location.longitude,
        p_accuracy_metres: submission.location.accuracy,
        p_captured_at: submission.location.capturedAt,
        p_location_provider: submission.location.provider,
        p_mocked_location: submission.location.mocked ?? false,
        p_actual_address: submission.address,
        p_actual_location_name: submission.locationName.trim(),
        p_visit_purpose: submission.visitPurpose.trim(),
        p_client_project_company_name:
          submission.clientProjectCompanyName?.trim() || null,
        p_expected_duration_minutes: submission.expectedDurationMinutes,
        p_additional_notes: submission.additionalNotes?.trim() || null,
        p_mismatch_reason: submission.mismatchReason,
        p_mismatch_explanation: submission.mismatchExplanation?.trim() || null,
        p_declaration_at: submission.declarationAt,
        p_evidence_photo_path: photoPath,
        p_evidence_photo_source: photoPath ? submission.photo?.source : null,
        p_device_platform: Platform.OS,
        p_app_version: Constants.expoConfig?.version ?? "unknown",
        p_idempotency_key: submission.idempotencyKey,
        p_captured_offline: submission.capturedOffline ?? false,
        p_offline_evidence_hash: submission.offlineIntegrityHash ?? null,
      },
    );
    if (error) {
      try {
        await removeUncommittedPhoto(photoPath);
      } catch (cleanupError: any) {
        throw new Error(
          `${error.message}. Photo cleanup also failed: ${cleanupError.message}`,
        );
      }
      throw error;
    }
    const row = firstRpcRow<any>(data);
    try {
      return confirmedSubmissionResult(
        row,
        submission.visitId,
        submission.sourceVisitId,
        true,
      );
    } catch (confirmationError) {
      // Some production databases previously retained the first v3 wrapper,
      // which committed the check-in but returned the older, shorter payload.
      // Confirm the exact committed row before treating that as a failure.
      const { data: committed, error: committedError } = await supabase
        .from("field_visits")
        .select(
          "id,verification_status,selected_site_distance_metres,evidence_photo_added,checkin_time,submitted_at,status,idempotency_key",
        )
        .eq("id", submission.visitId)
        .eq("user_id", authenticatedUser.id)
        .eq("idempotency_key", submission.idempotencyKey)
        .maybeSingle();
      if (!committedError && committed) {
        return confirmedSubmissionResult(
          {
            visit_id: committed.id,
            source_visit_id: submission.sourceVisitId,
            verification_status: committed.verification_status,
            distance_metres: committed.selected_site_distance_metres,
            duplicate:
              typeof row?.duplicate === "boolean" ? row.duplicate : false,
            photo_added: committed.evidence_photo_added,
            checkin_time: committed.checkin_time,
            submitted_at: committed.submitted_at,
            status: committed.status,
          },
          submission.visitId,
          submission.sourceVisitId,
          false,
        );
      }
      try {
        await removeUncommittedPhoto(photoPath);
      } catch (cleanupError: any) {
        throw new Error(
          `${(confirmationError as any)?.message || "Submission was not confirmed."} Photo cleanup also failed: ${cleanupError.message}`,
        );
      }
      throw new Error(
        committedError?.message ||
          (confirmationError as any)?.message ||
          "Submission was not confirmed.",
      );
    }
  },

  async enqueue(submission: CurrentLocationSubmission) {
    if (Platform.OS === "web") {
      throw new Error(
        "Offline field-visit evidence is unavailable in the web app because browsers cannot store it securely. Nothing was saved; reconnect and submit again.",
      );
    }
    let durable = submission;
    if (
      submission.photo &&
      FileSystem.documentDirectory
    ) {
      const directory = `${FileSystem.documentDirectory}field-visit-evidence/`;
      await FileSystem.makeDirectoryAsync(directory, { intermediates: true });
      const localUri = `${directory}${submission.idempotencyKey}.jpg`;
      if (submission.photo.uri !== localUri) {
        await FileSystem.copyAsync({
          from: submission.photo.uri,
          to: localUri,
        });
      }
      durable = {
        ...submission,
        photo: { ...submission.photo, uri: localUri },
      };
    }
    let photoHash: string | null = null;
    if (durable.photo) {
      photoHash = await hashPhotoBytes(durable.photo.uri);
      if (!photoHash) {
        throw new Error("Unable to verify the offline photo. Nothing was queued.");
      }
    }
    durable = {
      ...durable,
      offlinePhotoHash: photoHash,
    };
    durable = {
      ...durable,
      offlineIntegrityHash: await integrityHash(durable),
    };
    const queue = await this.getQueue();
    const next = queue.filter(
      (item) => item.idempotencyKey !== submission.idempotencyKey,
    );
    next.push({
      ...durable,
      capturedOffline: true,
      retryCount: 0,
      lastError: null,
      lastAttemptAt: null,
      nextRetryAt: new Date().toISOString(),
    } as QueuedCurrentLocationSubmission);
    await secureStorage.setItem(QUEUE_KEY, JSON.stringify(next));
  },

  async getQueue(): Promise<QueuedCurrentLocationSubmission[]> {
    if (Platform.OS === "web") {
      await secureStorage.removeItem(QUEUE_KEY);
      return [];
    }
    try {
      return JSON.parse((await secureStorage.getItem(QUEUE_KEY)) || "[]");
    } catch {
      return [];
    }
  },

  async clearQueueForLogout() {
    const queue = await this.getQueue();
    await Promise.all(
      queue.map(async (item) => {
        if (
          item.photo?.uri.startsWith(
            `${FileSystem.documentDirectory}field-visit-evidence/`,
          )
        ) {
          await FileSystem.deleteAsync(item.photo.uri, { idempotent: true });
        }
      }),
    );
    await secureStorage.removeItem(QUEUE_KEY);
  },

  async retryQueue() {
    if (Platform.OS === "web") {
      await secureStorage.removeItem(QUEUE_KEY);
      return { uploaded: 0, remaining: 0 };
    }
    const queue = await this.getQueue();
    const remaining: QueuedCurrentLocationSubmission[] = [];
    for (const item of queue) {
      if (item.nextRetryAt && Date.parse(item.nextRetryAt) > Date.now()) {
        remaining.push(item);
        continue;
      }
      try {
        const currentHash = await integrityHash(item);
        let photoMatches = true;
        if (item.photo) {
          const info = await FileSystem.getInfoAsync(item.photo.uri);
          photoMatches = Boolean(
            info.exists &&
              item.offlinePhotoHash &&
              (await hashPhotoBytes(item.photo.uri)) === item.offlinePhotoHash,
          );
        }
        if (currentHash !== item.offlineIntegrityHash || !photoMatches) {
          remaining.push(item);
          continue;
        }
        await this.submit(item);
        if (
          item.photo?.uri.startsWith(
            `${FileSystem.documentDirectory}field-visit-evidence/`,
          )
        ) {
          await FileSystem.deleteAsync(item.photo.uri, { idempotent: true });
        }
      } catch (error: any) {
        const retryCount = (item.retryCount ?? 0) + 1;
        const backoffMinutes = Math.min(60, 2 ** Math.min(retryCount, 6));
        remaining.push({
          ...item,
          retryCount,
          lastError: String(error?.message || "Upload failed"),
          lastAttemptAt: new Date().toISOString(),
          nextRetryAt: new Date(
            Date.now() + backoffMinutes * 60_000,
          ).toISOString(),
        });
      }
    }
    await secureStorage.setItem(QUEUE_KEY, JSON.stringify(remaining));
    return {
      uploaded: queue.length - remaining.length,
      remaining: remaining.length,
    };
  },

  getSignedEvidenceUrl(path: string) {
    return supabase.storage
      .from("field-visit-evidence")
      .createSignedUrl(path, 300);
  },

  async review(
    visitId: string,
    decision: Exclude<VerificationStatus, "PENDING">,
    notes?: string,
  ) {
    const { data, error } = await supabase.rpc("review_field_visit_current_location", {
      p_visit_id: visitId,
      p_decision: decision,
      p_notes: notes?.trim() || null,
    });
    const response = firstRpcRow<any>(data);
    return {
      data: response,
      error:
        error ??
        (response?.visit_id === visitId &&
        response?.new_status === decision
          ? null
          : new Error("The server did not confirm the field-visit review.")),
    };
  },
};
