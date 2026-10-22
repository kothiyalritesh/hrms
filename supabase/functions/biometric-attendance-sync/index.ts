import { createClient } from "npm:@supabase/supabase-js@2.39.0";

const SYNC_SOURCE_HEADER = "pg_cron";
const FUNCTION_VERSION = "20260803.1";
const REQUIRED_BACKEND_SCHEMA_VERSION = "20260810000000";
const REQUEST_IN_PROGRESS_MS = 5 * 60 * 1000;
const ADMIN_ROLES = new Set([
  "SYSTEM_ADMIN",
  "SUPER_ADMIN",
  "ADMIN",
  "HR",
  "HRD",
]);
const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-biometric-sync-source, x-biometric-sync-secret",
};

type SmartOfficeLog = {
  EmployeeCode?: string | number;
  LogDate?: string;
  Direction?: string;
  PunchDirection?: string;
  SerialNumber?: string;
  DeviceId?: string;
  Temperature?: number | string;
  EventId?: string | number;
};

type DailyPunch = {
  userId: string;
  date: string;
  timestamps: string[];
};

function formatISTDate(date = new Date()) {
  const shifted = new Date(date.getTime() + 330 * 60 * 1000);
  return [
    shifted.getUTCFullYear(),
    String(shifted.getUTCMonth() + 1).padStart(2, "0"),
    String(shifted.getUTCDate()).padStart(2, "0"),
  ].join("-");
}

function isValidDateOnly(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return (
    !Number.isNaN(parsed.getTime()) &&
    parsed.toISOString().slice(0, 10) === value
  );
}

function dayNumber(value: string) {
  return Date.parse(`${value}T00:00:00Z`) / 86_400_000;
}

function confirmedResponseFromBatch(
  batch: any,
  fromDate: string,
  toDate: string,
) {
  const result = batch?.result ?? {};
  if (result.edge_response?.success === true) {
    return {
      ...result.edge_response,
      clientRequestId: batch.id,
      importBatchId: batch.id,
      rollbackId: batch.id,
      recovered: true,
    };
  }
  const submitted = Number(
    result.submittedPunches ??
      result.submitted_punches ??
      batch?.row_count ??
      0,
  );
  const inserted = Number(
    result.insertedPunches ?? result.inserted_punches ?? 0,
  );
  const duplicate = Number(
    result.duplicatePunches ?? result.duplicate_punches ?? 0,
  );
  const rejected = Number(
    result.rejectedPunches ?? result.rejected_punches ?? 0,
  );
  return {
    success: true,
    transaction_status: "COMMITTED",
    clientRequestId: batch.id,
    fromDate,
    toDate,
    fetchedPunches: Number(result.fetchedPunches ?? submitted),
    submittedPunches: submitted,
    insertedPunches: inserted,
    duplicatePunches: duplicate,
    rejectedPunches: rejected,
    importBatchId: batch.id,
    rollbackId: batch.id,
    sourceFileHash: batch.payload_hash,
    matchedEmployees: Number(
      result.matchedEmployees ?? result.attendance_days ?? 0,
    ),
    unmatchedPunches: Number(result.unmatchedPunches ?? 0),
    unmatchedEmployeeCodes: Number(result.unmatchedEmployeeCodes ?? 0),
    checkedIn: Number(result.checkedIn ?? result.created ?? 0),
    checkedOut: Number(result.checkedOut ?? result.checked_out ?? 0),
    summariesUpdated: Number(
      result.summariesUpdated ??
        Math.max(
          0,
          Number(result.attendance_days ?? 0) - Number(result.created ?? 0),
        ),
    ),
    recovered: true,
  };
}

function toISTTimestamp(value: string) {
  const normalized = value.trim().replace(" ", "T");
  return /(?:Z|[+-]\d{2}:\d{2})$/.test(normalized)
    ? normalized
    : `${normalized}+05:30`;
}

// Supabase client errors are plain objects ({ code, message, details, hint });
// String(error) gave "[object Object]" and hid every database failure.
function describeError(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (error && typeof error === "object") {
    const e = error as Record<string, unknown>;
    const parts = [e.code, e.message, e.details, e.hint]
      .filter((value) => value != null && String(value).trim() !== "")
      .map(String);
    if (parts.length) return parts.join(" | ");
    try {
      return JSON.stringify(error);
    } catch {
      // fall through
    }
  }
  return String(error);
}

function extractLogs(body: any): SmartOfficeLog[] {
  if (Array.isArray(body)) return body;
  if (Array.isArray(body?.records)) return body.records;
  if (Array.isArray(body?.result)) return body.result;
  return [];
}

// Active employees only: the database refuses punches of a deactivated
// employee (ACTIVE_MAPPED_EMPLOYEE_REQUIRED) and the batch is one
// transaction, so a single person who left but still punches blocked every
// other punch. Their punches are kept as raw / unmatched instead.
async function fetchAllMappedProfiles(admin: any) {
  const rows: any[] = [];
  const pageSize = 1000;
  for (let from = 0; from < 100_000; from += pageSize) {
    const { data, error } = await admin
      .from("profiles")
      .select("id,smartoffice_employee_code")
      .eq("is_active", true)
      .not("smartoffice_employee_code", "is", null)
      .order("id")
      .range(from, from + pageSize - 1);
    if (error) throw error;
    rows.push(...(data ?? []));
    if ((data?.length ?? 0) < pageSize) return rows;
  }
  throw new Error("PROFILE_PAGINATION_LIMIT_EXCEEDED");
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") {
    return new Response("ok", { headers: CORS_HEADERS });
  }
  if (request.method !== "POST") {
    return Response.json(
      { error: "METHOD_NOT_ALLOWED" },
      { status: 405, headers: CORS_HEADERS },
    );
  }
  const requestBody = await request.json().catch(() => ({}));
  const runtimeAnonKey = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
  if (requestBody?.action === "version") {
    return Response.json(
      {
        success: true,
        function: "biometric-attendance-sync",
        version: FUNCTION_VERSION,
        requiredBackendSchemaVersion: REQUIRED_BACKEND_SCHEMA_VERSION,
        projectAuthenticationConfigured: Boolean(runtimeAnonKey),
        authorizationMatchesProject:
          request.headers.get("authorization") ===
          `Bearer ${runtimeAnonKey}`,
        apiKeyMatchesProject:
          request.headers.get("apikey") === runtimeAnonKey,
      },
      { headers: CORS_HEADERS },
    );
  }
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const anonKey = runtimeAnonKey;
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !anonKey || !serviceRoleKey) {
    return Response.json(
      { error: "SERVER_NOT_CONFIGURED" },
      { status: 500, headers: CORS_HEADERS },
    );
  }
  const authorization = request.headers.get("authorization") ?? "";
  const requestApiKey = request.headers.get("apikey") ?? "";
  // Scheduled synchronization uses the project's existing publishable key.
  // It is additionally source-scoped, server-rate-limited, and accepts no
  // caller-supplied employee/punch payload. No custom secret is required.
  const isCron =
    request.headers.get("x-biometric-sync-source") === SYNC_SOURCE_HEADER &&
    authorization === `Bearer ${anonKey}` &&
    requestApiKey === anonKey;
  let requestedSource = "ADMIN";
  let requestedBy: string | null = null;
  let fromDate = formatISTDate();
  let toDate = fromDate;
  if (!isCron) {
    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authorization } },
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data: userData } = await userClient.auth.getUser();
    if (!userData.user) {
      return Response.json(
        { error: "UNAUTHORIZED" },
        { status: 401, headers: CORS_HEADERS },
      );
    }
    const { data: profile } = await userClient
      .from("profiles")
      .select("role,is_active")
      .eq("id", userData.user.id)
      .maybeSingle();
    if (
      !profile?.is_active ||
      !ADMIN_ROLES.has(String(profile.role).toUpperCase())
    ) {
      return Response.json(
        { error: "ADMIN_PERMISSION_REQUIRED" },
        { status: 403, headers: CORS_HEADERS },
      );
    }
    if (requestBody?.fromDate) fromDate = String(requestBody.fromDate);
    if (requestBody?.toDate) toDate = String(requestBody.toDate);
    requestedBy = userData.user.id;
    requestedSource = `ADMIN:${userData.user.id}`;
  } else {
    requestedSource = "PG_CRON";
  }
  const businessDate = formatISTDate();
  if (
    !isValidDateOnly(fromDate) ||
    !isValidDateOnly(toDate) ||
    fromDate > toDate ||
    toDate > businessDate ||
    dayNumber(toDate) - dayNumber(fromDate) + 1 > 31
  ) {
    return Response.json(
      { error: "INVALID_DATE_RANGE" },
      { status: 400, headers: CORS_HEADERS },
    );
  }
  const requestId = String(
    requestBody?.requestId ?? (isCron ? crypto.randomUUID() : ""),
  ).toLowerCase();
  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(
      requestId,
    )
  ) {
    return Response.json(
      { error: "INVALID_REQUEST_ID" },
      { status: 400, headers: CORS_HEADERS },
    );
  }
  requestedSource = `${requestedSource}:${fromDate}:${toDate}`;

  const admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: existingRequest, error: requestLookupError } = await admin
    .from("biometric_sync_requests")
    .select(
      "request_id,requested_by,source,from_date,to_date,status,response,error_message,updated_at",
    )
    .eq("request_id", requestId)
    .maybeSingle();
  if (requestLookupError) {
    return Response.json(
      {
        error: "SYNC_REQUEST_LOOKUP_FAILED",
        message: requestLookupError.message,
      },
      { status: 500, headers: CORS_HEADERS },
    );
  }
  if (
    existingRequest &&
    (existingRequest.source !== requestedSource ||
      existingRequest.requested_by !== requestedBy ||
      existingRequest.from_date !== fromDate ||
      existingRequest.to_date !== toDate)
  ) {
    return Response.json(
      { error: "SYNC_REQUEST_ID_CONFLICT" },
      { status: 409, headers: CORS_HEADERS },
    );
  }
  if (
    existingRequest?.status === "COMMITTED" &&
    existingRequest.response?.success === true
  ) {
    return Response.json(existingRequest.response, { headers: CORS_HEADERS });
  }

  const { data: existingBatch, error: batchLookupError } = await admin
    .from("biometric_import_batches")
    .select("id,source,status,row_count,payload_hash,result,error_message")
    .eq("id", requestId)
    .maybeSingle();
  if (batchLookupError) {
    return Response.json(
      { error: "SYNC_BATCH_LOOKUP_FAILED", message: batchLookupError.message },
      { status: 500, headers: CORS_HEADERS },
    );
  }
  if (existingBatch) {
    if (existingBatch.source !== requestedSource) {
      return Response.json(
        { error: "SYNC_BATCH_ID_CONFLICT" },
        { status: 409, headers: CORS_HEADERS },
      );
    }
    if (existingBatch.status === "APPLIED") {
      const recovered = confirmedResponseFromBatch(
        existingBatch,
        fromDate,
        toDate,
      );
      if (
        recovered.insertedPunches +
          recovered.duplicatePunches +
          recovered.rejectedPunches !==
        recovered.submittedPunches
      ) {
        return Response.json(
          { error: "SYNC_RECOVERY_COUNTS_INVALID" },
          { status: 500, headers: CORS_HEADERS },
        );
      }
      await admin.from("biometric_sync_requests").upsert({
        request_id: requestId,
        requested_by: requestedBy,
        source: requestedSource,
        from_date: fromDate,
        to_date: toDate,
        status: "COMMITTED",
        response: recovered,
        error_message: null,
        updated_at: new Date().toISOString(),
      });
      return Response.json(recovered, { headers: CORS_HEADERS });
    }
  }

  if (requestBody?.action === "status") {
    if (!existingRequest) {
      return Response.json(
        { error: "SYNC_REQUEST_NOT_FOUND", requestId },
        { status: 404, headers: CORS_HEADERS },
      );
    }
    return Response.json(
      {
        error:
          existingRequest.status === "PENDING"
            ? "SYNC_IN_PROGRESS"
            : "SYNC_PREVIOUSLY_FAILED",
        message: existingRequest.error_message,
        requestId,
      },
      {
        status: existingRequest.status === "PENDING" ? 202 : 409,
        headers: CORS_HEADERS,
      },
    );
  }

  const pendingAge = existingRequest?.updated_at
    ? Date.now() - Date.parse(existingRequest.updated_at)
    : Number.POSITIVE_INFINITY;
  if (
    existingRequest?.status === "PENDING" &&
    Number.isFinite(pendingAge) &&
    pendingAge < REQUEST_IN_PROGRESS_MS
  ) {
    return Response.json(
      { error: "SYNC_IN_PROGRESS", requestId },
      { status: 409, headers: CORS_HEADERS },
    );
  }
  const pendingRequest = {
    request_id: requestId,
    requested_by: requestedBy,
    source: requestedSource,
    from_date: fromDate,
    to_date: toDate,
    status: "PENDING",
    response: null,
    error_message: null,
    updated_at: new Date().toISOString(),
  };
  const requestMutation = existingRequest
    ? await admin
        .from("biometric_sync_requests")
        .update(pendingRequest)
        .eq("request_id", requestId)
    : await admin.from("biometric_sync_requests").insert(pendingRequest);
  if (requestMutation.error) {
    return Response.json(
      {
        error: "SYNC_REQUEST_CLAIM_FAILED",
        message: requestMutation.error.message,
      },
      { status: 500, headers: CORS_HEADERS },
    );
  }

  const { data: claimed, error: claimError } = await admin.rpc(
    "claim_biometric_attendance_sync",
    { minimum_interval_seconds: 30 },
  );
  if (claimError) {
    await admin
      .from("biometric_sync_requests")
      .update({
        status: "FAILED",
        error_message: claimError.message.slice(0, 1000),
        updated_at: new Date().toISOString(),
      })
      .eq("request_id", requestId);
    return Response.json(
      { error: "SYNC_CLAIM_FAILED", message: claimError.message },
      { status: 500, headers: CORS_HEADERS },
    );
  }
  if (!claimed) {
    await admin
      .from("biometric_sync_requests")
      .update({
        status: "FAILED",
        error_message: "Another biometric synchronization is running.",
        updated_at: new Date().toISOString(),
      })
      .eq("request_id", requestId);
    return Response.json(
      {
        error: "SYNC_BUSY",
        message: "Another biometric synchronization is running.",
        requestId,
      },
      { status: 409, headers: CORS_HEADERS },
    );
  }

  // Which part of the sync failed, reported with the error.
  let step = "SMARTOFFICE_FETCH";
  try {
    const exclusiveEnd = new Date(`${toDate}T00:00:00Z`);
    exclusiveEnd.setUTCDate(exclusiveEnd.getUTCDate() + 1);
    const toDateExclusive = exclusiveEnd.toISOString().slice(0, 10);
    const proxyUrl =
      `${supabaseUrl}/functions/v1/smartoffice-proxy` +
      `/api/v2/WebAPI/GetDeviceLogs?FromDate=${fromDate}&ToDate=${toDateExclusive}`;
    const response = await fetch(proxyUrl, {
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${serviceRoleKey}`,
        apikey: serviceRoleKey,
      },
    });
    if (!response.ok) {
      throw new Error(`SMARTOFFICE_HTTP_${response.status}`);
    }
    const body = await response.json();
    if (body?.status === false) {
      throw new Error(body.message || "SMARTOFFICE_API_ERROR");
    }
    const logs = extractLogs(body);

    step = "LOAD_EMPLOYEE_CODES";
    const employees = await fetchAllMappedProfiles(admin);

    const profileIdsByCode = new Map<string, string[]>();
    for (const employee of employees ?? []) {
      const code = String(employee.smartoffice_employee_code ?? "")
        .trim()
        .toLowerCase();
      if (code) {
        profileIdsByCode.set(code, [
          ...(profileIdsByCode.get(code) ?? []),
          employee.id,
        ]);
      }
    }
    const employeeByCode = new Map<string, string>();
    for (const [code, profileIds] of profileIdsByCode) {
      if (profileIds.length === 1) employeeByCode.set(code, profileIds[0]);
    }

    const deviceRows: Record<string, unknown>[] = [];
    const rawPunchRows: Record<string, unknown>[] = [];
    const dailyPunches = new Map<string, DailyPunch>();
    const uniquePunches = new Set<string>();
    const unmatchedEmployeeCodes = new Set<string>();
    let unmatchedPunches = 0;

    for (const log of logs) {
      const employeeCode = String(log.EmployeeCode ?? "").trim();
      const logDate = String(log.LogDate ?? "").trim();
      if (!employeeCode || !logDate) continue;

      const [datePart, timePart = "00:00:00"] = logDate.split(" ");
      if (datePart < fromDate || datePart > toDate) continue;
      const uniquePunchKey = `${employeeCode.toLowerCase()}_${datePart}_${timePart}`;
      if (uniquePunches.has(uniquePunchKey)) continue;
      uniquePunches.add(uniquePunchKey);

      const timestamp = toISTTimestamp(logDate);
      rawPunchRows.push({
        device_id: String(log.SerialNumber ?? log.DeviceId ?? "SMARTOFFICE").trim(),
        biometric_employee_code: employeeCode,
        punch_timestamp: timestamp,
        punch_direction: log.Direction ?? log.PunchDirection ?? null,
        source_event_id: log.EventId == null ? "" : String(log.EventId),
      });

      const userId = employeeByCode.get(employeeCode.toLowerCase()) ?? null;
      if (!userId) {
        unmatchedPunches += 1;
        unmatchedEmployeeCodes.add(employeeCode.toLowerCase());
      }

      if (!userId) continue;
      deviceRows.push({
        user_id: userId,
        employee_code: employeeCode,
        log_datetime: logDate,
        log_date: datePart,
        log_time: timePart,
        punch_timestamp: timestamp,
        punch_direction: log.Direction ?? log.PunchDirection ?? null,
        serial_number: log.SerialNumber ?? log.DeviceId ?? null,
        temperature: log.Temperature ?? null,
      });
      const key = `${userId}_${datePart}`;
      const existing = dailyPunches.get(key);
      if (!existing) {
        dailyPunches.set(key, {
          userId,
          date: datePart,
          timestamps: [timestamp],
        });
      } else {
        existing.timestamps.push(timestamp);
      }
    }

    let rawIngestResult: any = null;
    step = "INGEST_RAW_PUNCHES (ingest_biometric_punches)";
    if (rawPunchRows.length) {
      const { data, error } = await admin.rpc("ingest_biometric_punches", {
        p_punches: rawPunchRows,
      });
      if (error) throw error;
      rawIngestResult = Array.isArray(data) ? data[0] : data;
      if (
        rawIngestResult?.success !== true ||
        rawIngestResult?.transaction_status !== "COMMITTED"
      ) {
        throw new Error("RAW_BIOMETRIC_INGEST_CONFIRMATION_INVALID");
      }
    }

    let batchResult: any = null;
    step = "APPLY_BATCH (apply_biometric_import_batch_v4)";
    if (deviceRows.length) {
      const serializedRows = JSON.stringify(deviceRows);
      const digest = await crypto.subtle.digest(
        "SHA-256",
        new TextEncoder().encode(serializedRows),
      );
      const payloadHash = Array.from(new Uint8Array(digest))
        .map((value) => value.toString(16).padStart(2, "0"))
        .join("");
      const batchId = requestId;
      const { data, error } = await admin.rpc(
        "apply_biometric_import_batch_v4",
        {
          p_batch_id: batchId,
          p_source: requestedSource,
          p_source_file_hash: payloadHash,
          p_rows: deviceRows,
        },
      );
      if (error) throw error;
      batchResult = Array.isArray(data) ? data[0] : data;
      const submitted = Number(batchResult?.submitted_punches);
      const inserted = Number(batchResult?.inserted_punches);
      const duplicate = Number(batchResult?.duplicate_punches);
      const rejected = Number(batchResult?.rejected_punches);
      if (
        batchResult?.success !== true ||
        batchResult?.transaction_status !== "COMMITTED" ||
        !/^[0-9a-f-]{36}$/i.test(String(batchResult?.batch_id ?? "")) ||
        batchResult?.rollback_id !== batchResult?.batch_id ||
        batchResult?.source_file_hash !== payloadHash ||
        ![submitted, inserted, duplicate, rejected].every(Number.isInteger) ||
        submitted !== deviceRows.length ||
        inserted + duplicate + rejected !== submitted
      ) {
        throw new Error("DATABASE_IMPORT_CONFIRMATION_INVALID");
      }
    }

    const result = deviceRows.length
      ? {
          success: true,
          transaction_status: "COMMITTED",
          clientRequestId: requestId,
          fromDate,
          toDate,
          fetchedPunches: logs.length,
          submittedPunches: Number(batchResult.submitted_punches),
          insertedPunches: Number(batchResult.inserted_punches),
          duplicatePunches: Number(batchResult.duplicate_punches),
          rejectedPunches: Number(batchResult.rejected_punches),
          importBatchId: batchResult.batch_id,
          rollbackId: batchResult.rollback_id,
          matchedEmployees: dailyPunches.size,
          unmatchedPunches,
          unmatchedEmployeeCodes: unmatchedEmployeeCodes.size,
          checkedIn: batchResult.created,
          checkedOut: batchResult.checked_out,
          summariesUpdated: batchResult.attendance_days - batchResult.created,
          rawPunchIngest: rawIngestResult,
        }
      : {
          success: true,
          transaction_status: "NO_CHANGES",
          clientRequestId: requestId,
          reason: logs.length
            ? "NO_MATCHED_EMPLOYEE_CODES"
            : "NO_DEVICE_PUNCHES",
          fromDate,
          toDate,
          fetchedPunches: logs.length,
          submittedPunches: 0,
          insertedPunches: 0,
          duplicatePunches: 0,
          rejectedPunches: 0,
          importBatchId: null,
          rollbackId: null,
          matchedEmployees: 0,
          unmatchedPunches,
          unmatchedEmployeeCodes: unmatchedEmployeeCodes.size,
          checkedIn: 0,
          checkedOut: 0,
          summariesUpdated: 0,
          rawPunchIngest: rawIngestResult,
        };
    step = "SAVE_RESULT";
    if (deviceRows.length) {
      const { error: batchResultError } = await admin
        .from("biometric_import_batches")
        .update({
          result: {
            ...batchResult,
            edge_response: result,
          },
        })
        .eq("id", requestId)
        .eq("status", "APPLIED");
      if (batchResultError) throw batchResultError;
    }
    const { error: requestCommitError } = await admin
      .from("biometric_sync_requests")
      .update({
        status: "COMMITTED",
        response: result,
        error_message: null,
        updated_at: new Date().toISOString(),
      })
      .eq("request_id", requestId);
    if (requestCommitError) throw requestCommitError;
    await admin
      .from("biometric_sync_state")
      .update({
        last_completed_at: new Date().toISOString(),
        last_status: "SUCCESS",
        last_error: null,
        last_result: result,
      })
      .eq("singleton", true);
    return Response.json(result, { headers: CORS_HEADERS });
  } catch (error) {
    const message = `${step}: ${describeError(error)}`;
    console.error("[biometric-attendance-sync]", message);
    await admin
      .from("biometric_sync_requests")
      .update({
        status: "FAILED",
        error_message: message.slice(0, 1000),
        updated_at: new Date().toISOString(),
      })
      .eq("request_id", requestId);
    await admin
      .from("biometric_sync_state")
      .update({
        last_completed_at: new Date().toISOString(),
        last_status: "FAILED",
        last_error: message.slice(0, 1000),
      })
      .eq("singleton", true);
    return Response.json(
      { error: "BIOMETRIC_SYNC_FAILED", message },
      { status: 502, headers: CORS_HEADERS },
    );
  }
});
