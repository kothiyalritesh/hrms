import { isBusinessDate } from "@/utils/businessDate";

export const MAX_BIOMETRIC_SYNC_DAYS = 31;

function utcDayNumber(value: string) {
  return (
    Date.UTC(
      Number(value.slice(0, 4)),
      Number(value.slice(5, 7)) - 1,
      Number(value.slice(8, 10)),
    ) / 86_400_000
  );
}

export function validateBiometricSyncRange(input: {
  fromDate: string;
  toDate: string;
  businessDate: string;
}) {
  const fromDate = input.fromDate.trim();
  const toDate = input.toDate.trim();
  if (
    !isBusinessDate(fromDate) ||
    !isBusinessDate(toDate) ||
    !isBusinessDate(input.businessDate)
  ) {
    throw new Error("Enter valid dates in YYYY-MM-DD format.");
  }
  if (fromDate > toDate) {
    throw new Error("From date cannot be after To date.");
  }
  if (toDate > input.businessDate) {
    throw new Error("Future biometric dates cannot be synchronized.");
  }
  const inclusiveDays = utcDayNumber(toDate) - utcDayNumber(fromDate) + 1;
  if (inclusiveDays > MAX_BIOMETRIC_SYNC_DAYS) {
    throw new Error(
      `Biometric synchronization is limited to ${MAX_BIOMETRIC_SYNC_DAYS} calendar days.`,
    );
  }
  return { fromDate, toDate, inclusiveDays };
}
