import { requireConfirmedBiometricSync } from "../biometricSyncResult";

const range = { fromDate: "2026-07-29", toDate: "2026-07-30" };
const committed = {
  success: true,
  transaction_status: "COMMITTED",
  fromDate: range.fromDate,
  toDate: range.toDate,
  clientRequestId: "2ec55ed7-6e4f-4f7e-831c-40cb3317c7dc",
  importBatchId: "2ec55ed7-6e4f-4f7e-831c-40cb3317c7dc",
  rollbackId: "2ec55ed7-6e4f-4f7e-831c-40cb3317c7dc",
  fetchedPunches: 10,
  submittedPunches: 10,
  insertedPunches: 7,
  duplicatePunches: 2,
  rejectedPunches: 1,
  matchedEmployees: 4,
  unmatchedEmployeeCodes: 1,
  checkedIn: 4,
  checkedOut: 3,
  summariesUpdated: 4,
};

describe("biometric sync confirmation", () => {
  it("accepts a committed, reconciled server result", () => {
    expect(requireConfirmedBiometricSync(committed, range)).toMatchObject({
      transactionStatus: "COMMITTED",
      insertedPunches: 7,
    });
  });

  it("rejects transport-level success without a committed business result", () => {
    expect(() =>
      requireConfirmedBiometricSync({ ...committed, success: false }, range),
    ).toThrow("not committed");
  });

  it("rejects mismatched ranges, counts and rollback identities", () => {
    expect(() =>
      requireConfirmedBiometricSync(
        { ...committed, fromDate: "2026-07-28" },
        range,
      ),
    ).toThrow("different date range");
    expect(() =>
      requireConfirmedBiometricSync(
        { ...committed, duplicatePunches: 1 },
        range,
      ),
    ).toThrow("do not reconcile");
    expect(() =>
      requireConfirmedBiometricSync(
        { ...committed, rollbackId: "6cc96399-2f64-45e6-b382-568503118317" },
        range,
      ),
    ).toThrow("rollback identifier");
  });

  it("accepts a no-change response only when it contains no mutation batch", () => {
    const noChanges = {
      ...committed,
      transaction_status: "NO_CHANGES",
      importBatchId: null,
      rollbackId: null,
      fetchedPunches: 0,
      submittedPunches: 0,
      insertedPunches: 0,
      duplicatePunches: 0,
      rejectedPunches: 0,
      matchedEmployees: 0,
      unmatchedEmployeeCodes: 0,
      checkedIn: 0,
      checkedOut: 0,
      summariesUpdated: 0,
    };
    expect(
      requireConfirmedBiometricSync(noChanges, range).transactionStatus,
    ).toBe("NO_CHANGES");
    expect(() =>
      requireConfirmedBiometricSync(
        { ...noChanges, importBatchId: committed.importBatchId },
        range,
      ),
    ).toThrow("batch mutations");
  });
});
