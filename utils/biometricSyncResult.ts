const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type ConfirmedBiometricSync = {
  success: true;
  clientRequestId: string;
  transactionStatus: "COMMITTED" | "NO_CHANGES" | "SKIPPED";
  fromDate: string;
  toDate: string;
  importBatchId: string | null;
  rollbackId: string | null;
  fetchedPunches: number;
  submittedPunches: number;
  insertedPunches: number;
  duplicatePunches: number;
  rejectedPunches: number;
  matchedEmployees: number;
  unmatchedEmployeeCodes: number;
  checkedIn: number;
  checkedOut: number;
  summariesUpdated: number;
  reason?: string;
};

const integer = (value: unknown, field: string) => {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    throw new Error(`Biometric sync returned an invalid ${field}.`);
  }
  return parsed;
};

export function requireConfirmedBiometricSync(
  value: unknown,
  expectedRange: { fromDate: string; toDate: string; requestId?: string },
): ConfirmedBiometricSync {
  const row = Array.isArray(value) ? value[0] : value;
  if (!row || typeof row !== "object") {
    throw new Error("Biometric sync returned no confirmation.");
  }
  const data = row as Record<string, unknown>;
  const transactionStatus = String(
    data.transaction_status ?? data.transactionStatus ?? "",
  ) as ConfirmedBiometricSync["transactionStatus"];
  if (
    data.success !== true ||
    !["COMMITTED", "NO_CHANGES", "SKIPPED"].includes(transactionStatus)
  ) {
    throw new Error("Biometric sync was not committed by the server.");
  }

  const fromDate = String(data.fromDate ?? data.from_date ?? "");
  const toDate = String(data.toDate ?? data.to_date ?? "");
  if (fromDate !== expectedRange.fromDate || toDate !== expectedRange.toDate) {
    throw new Error("Biometric sync confirmed a different date range.");
  }
  const clientRequestId = String(
    data.clientRequestId ?? data.requestId ?? data.request_id ?? "",
  );
  if (
    expectedRange.requestId &&
    clientRequestId.toLowerCase() !== expectedRange.requestId.toLowerCase()
  ) {
    throw new Error("Biometric sync confirmed a different request identity.");
  }
  if (!UUID_PATTERN.test(clientRequestId)) {
    throw new Error("Biometric sync returned an invalid request identity.");
  }

  const fetchedPunches = integer(data.fetchedPunches, "fetched count");
  const submittedPunches = integer(data.submittedPunches, "submitted count");
  const insertedPunches = integer(data.insertedPunches, "inserted count");
  const duplicatePunches = integer(data.duplicatePunches, "duplicate count");
  const rejectedPunches = integer(data.rejectedPunches, "rejected count");
  const matchedEmployees = integer(
    data.matchedEmployees,
    "matched employee-day count",
  );
  const unmatchedEmployeeCodes = integer(
    data.unmatchedEmployeeCodes,
    "unmatched code count",
  );
  const checkedIn = integer(data.checkedIn, "check-in count");
  const checkedOut = integer(data.checkedOut, "checkout count");
  const summariesUpdated = integer(data.summariesUpdated, "summary count");

  if (
    insertedPunches + duplicatePunches + rejectedPunches !==
    submittedPunches
  ) {
    throw new Error("Biometric sync counts do not reconcile.");
  }

  const importBatchId =
    data.importBatchId == null ? null : String(data.importBatchId);
  const rollbackId = data.rollbackId == null ? null : String(data.rollbackId);
  if (transactionStatus === "COMMITTED") {
    if (
      !importBatchId ||
      !UUID_PATTERN.test(importBatchId) ||
      importBatchId.toLowerCase() !== clientRequestId.toLowerCase() ||
      rollbackId !== importBatchId
    ) {
      throw new Error(
        "Biometric sync did not return a valid batch and rollback identifier.",
      );
    }
  } else if (
    importBatchId !== null ||
    rollbackId !== null ||
    submittedPunches !== 0 ||
    insertedPunches !== 0 ||
    duplicatePunches !== 0 ||
    rejectedPunches !== 0
  ) {
    throw new Error(
      "A no-change biometric response contained batch mutations.",
    );
  }

  return {
    success: true,
    clientRequestId,
    transactionStatus,
    fromDate,
    toDate,
    importBatchId,
    rollbackId,
    fetchedPunches,
    submittedPunches,
    insertedPunches,
    duplicatePunches,
    rejectedPunches,
    matchedEmployees,
    unmatchedEmployeeCodes,
    checkedIn,
    checkedOut,
    summariesUpdated,
    reason: data.reason ? String(data.reason) : undefined,
  };
}
