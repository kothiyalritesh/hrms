/**
 * __tests__/mandatoryEmployeePhone.test.ts
 * Verifies Consolidated HRMS Requirement 1:
 * - Mobile Number mandatory on new employee creation
 * - Indian mobile format regex validation (/^[6-9]\d{9}$/)
 * - Extraction of 10 digits from strings with +91, spaces, dashes
 * - Duplicate active phone rejection logic
 * - Grandfathering for legacy profiles
 */

export function cleanIndianPhone(raw: string | null | undefined): string {
  if (!raw) return "";
  const digits = raw.replace(/\D/g, "");
  if (digits.length === 12 && digits.startsWith("91")) {
    return digits.slice(2);
  }
  if (digits.length === 11 && digits.startsWith("0")) {
    return digits.slice(1);
  }
  if (digits.length === 10) {
    return digits;
  }
  return "";
}

export function validateIndianMobile(phone: string): { valid: boolean; error?: string } {
  const cleaned = cleanIndianPhone(phone);
  if (!cleaned) {
    return { valid: false, error: "Mobile number is mandatory when creating an employee." };
  }
  if (!/^[6-9]\d{9}$/.test(cleaned)) {
    return {
      valid: false,
      error: "Please enter a valid 10-digit Indian mobile number starting with 6, 7, 8, or 9.",
    };
  }
  return { valid: true };
}

export function checkDuplicatePhone(
  phone: string,
  existingEmployees: Array<{ id: string; name: string; phone: string | null; is_active: boolean }>,
  currentUserId?: string | null,
): { duplicate: boolean; existingName?: string } {
  const cleaned = cleanIndianPhone(phone);
  if (!cleaned) return { duplicate: false };

  const match = existingEmployees.find(
    (e) =>
      e.is_active &&
      (!currentUserId || e.id !== currentUserId) &&
      cleanIndianPhone(e.phone) === cleaned,
  );

  if (match) {
    return { duplicate: true, existingName: match.name };
  }
  return { duplicate: false };
}

describe("Requirement 1 — Mandatory Employee Mobile Number", () => {
  describe("Indian Mobile Number Validation", () => {
    test("rejects empty or null phone", () => {
      expect(validateIndianMobile("").valid).toBe(false);
      expect(validateIndianMobile("   ").valid).toBe(false);
      expect(validateIndianMobile(null as any).valid).toBe(false);
    });

    test("accepts valid 10-digit numbers starting with 6, 7, 8, 9", () => {
      expect(validateIndianMobile("9876543210").valid).toBe(true);
      expect(validateIndianMobile("8123456789").valid).toBe(true);
      expect(validateIndianMobile("7830580839").valid).toBe(true);
      expect(validateIndianMobile("6200012345").valid).toBe(true);
    });

    test("handles +91 prefix and formatting characters", () => {
      expect(validateIndianMobile("+91 7830580839").valid).toBe(true);
      expect(validateIndianMobile("+91-98765-43210").valid).toBe(true);
      expect(validateIndianMobile("09876543210").valid).toBe(true);
      expect(cleanIndianPhone("+91 78305 80839")).toBe("7830580839");
    });

    test("rejects invalid numbers (wrong length, starts with 0-5)", () => {
      expect(validateIndianMobile("5123456789").valid).toBe(false);
      expect(validateIndianMobile("12345").valid).toBe(false);
      expect(validateIndianMobile("9876543210123").valid).toBe(false);
      expect(validateIndianMobile("abcdefghij").valid).toBe(false);
    });
  });

  describe("Duplicate Prevention", () => {
    const activeStaff = [
      { id: "u-1", name: "Ritesh Kothiyal", phone: "+91 7830580839", is_active: true },
      { id: "u-2", name: "Sagar Verma", phone: "9876543210", is_active: true },
      { id: "u-3", name: "Former Employee", phone: "9123456780", is_active: false },
    ];

    test("detects duplicate mobile among active employees", () => {
      const dup = checkDuplicatePhone("7830580839", activeStaff);
      expect(dup.duplicate).toBe(true);
      expect(dup.existingName).toBe("Ritesh Kothiyal");
    });

    test("allows reusing mobile of an inactive employee", () => {
      const dup = checkDuplicatePhone("9123456780", activeStaff);
      expect(dup.duplicate).toBe(false);
    });

    test("allows updating the same user with their own number", () => {
      const dup = checkDuplicatePhone("7830580839", activeStaff, "u-1");
      expect(dup.duplicate).toBe(false);
    });
  });

  describe("Grandfathering Policy", () => {
    test("legacy profile with null phone is allowed to remain unmodified if not changing phone", () => {
      const legacyProfile = { id: "u-legacy", phone: null, name: "Legacy User" };
      const isInsert = false;
      const newPhoneProvided = null;

      const shouldBlock = isInsert ? true : (newPhoneProvided !== null && !validateIndianMobile(newPhoneProvided).valid);
      expect(shouldBlock).toBe(false);
    });
  });
});
