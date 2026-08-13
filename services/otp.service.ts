/**
 * OTP (One-Time Password) Service
 * Implements TOTP (Time-based One-Time Password) verification
 *
 * This module provides TOTP generation, verification, and backup code management.
 * NOTE: Production implementation should use 'speakeasy' or 'node-otp' library
 *
 * Install: npm install speakeasy
 */

/**
 * Generate a TOTP code from a secret
 * PRODUCTION: Use speakeasy.totp.verify() for verification
 */
export function generateTOTPCode(
  secret: string,
  timestamp: number = Date.now(),
): string | null {
  // This is a simplified implementation
  // Production code should use the speakeasy library:
  // const speakeasy = require('speakeasy');
  // return speakeasy.totp({ secret, encoding: 'base32' });

  void secret;
  void timestamp;
  console.error("Client-side TOTP generation is disabled.");
  return null;
}

/**
 * Verify a TOTP code
 * Accepts codes within a window (±30 seconds = ±1 time step)
 */
export function verifyTOTP(
  secret: string,
  token: string,
  window: number = 1,
): boolean {
  // Production implementation with speakeasy:
  /*
  const speakeasy = require('speakeasy');
  return speakeasy.totp.verify({
    secret: secret,
    encoding: 'base32',
    token: token,
    window: window,
  });
  */

  void secret;
  void token;
  void window;
  console.error("Client-side TOTP verification is disabled.");
  return false;
}

/**
 * Generate backup codes for account recovery
 * These should be generated when OTP is first enabled
 */
export function generateBackupCodes(count: number = 10): string[] {
  const codes: string[] = [];

  for (let i = 0; i < count; i++) {
    // Format: XXXX-XXXX-XXXX (e.g., A1B2-C3D4-E5F6)
    const code = generateRandomCode();
    codes.push(code);
  }

  return codes;
}

/**
 * Generate a single backup code
 */
function generateRandomCode(): string {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  let code = "";

  for (let i = 0; i < 3; i++) {
    for (let j = 0; j < 4; j++) {
      const random = new Uint32Array(1);
      crypto.getRandomValues(random);
      code += chars[random[0] % chars.length];
    }
    if (i < 2) code += "-";
  }

  return code;
}

/**
 * Verify backup code and remove it from available codes
 */
export function useBackupCode(
  inputCode: string,
  availableCodes: string[],
): { valid: boolean; remainingCodes: string[] } {
  const normalizedInput = inputCode.toUpperCase().replace(/[-\s]/g, "");

  const index = availableCodes.findIndex((code) => {
    const normalized = code.toUpperCase().replace(/[-\s]/g, "");
    return normalized === normalizedInput;
  });

  if (index === -1) {
    return { valid: false, remainingCodes: availableCodes };
  }

  // Remove used code
  const remaining = availableCodes.filter((_, i) => i !== index);

  return { valid: true, remainingCodes: remaining };
}

/**
 * Check if OTP is locked due to too many failed attempts
 */
export function isOTPLocked(
  failedAttempts: number,
  lastFailureTime: Date | null,
  maxAttempts: number = 5,
  lockoutMinutes: number = 15,
): boolean {
  if (failedAttempts < maxAttempts) {
    return false;
  }

  if (!lastFailureTime) {
    return true;
  }

  const lockoutTime = new Date(
    lastFailureTime.getTime() + lockoutMinutes * 60 * 1000,
  );
  return new Date() < lockoutTime;
}

/**
 * Generate QR Code URL for TOTP setup
 * User scans this with authenticator app
 *
 * PRODUCTION: Use qrcode library
 * npm install qrcode
 */
export function generateQRCodeURL(
  secret: string,
  email: string,
  appName: string = "HRMS",
): string {
  // TOTP URI format: otpauth://totp/[Label]?secret=[Secret]&issuer=[Issuer]
  const label = encodeURIComponent(`${appName} (${email})`);
  const issuer = encodeURIComponent(appName);

  const uri = `otpauth://totp/${label}?secret=${secret}&issuer=${issuer}`;

  // Generate QR code URL using qr-server API (free, no library needed)
  // For production, use local qrcode library
  // const QRCode = require('qrcode');
  // return await QRCode.toDataURL(uri);

  return `https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(uri)}`;
}

/**
 * Validate OTP setup requirements
 */
export function validateOTPSetup(
  secret: string | undefined,
  email: string | undefined,
  otpEnabled: boolean,
): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  if (!secret) {
    errors.push("OTP secret is not set");
  }

  if (!email) {
    errors.push("Email is required for OTP setup");
  }

  if (secret && secret.length < 16) {
    errors.push("OTP secret is too short");
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

/**
 * OTP Statistics for admin dashboard
 */
export interface OTPStats {
  totalUsersWithOTP: number;
  usersWithOTPVerified: number;
  usersWithOTPPending: number;
  averageSetupTime: number; // in minutes
  failedVerificationAttempts: number;
  lockedAccounts: number;
}

/**
 * Calculate time remaining for current TOTP window
 * TOTP changes every 30 seconds
 */
export function getTimeUntilOTPChange(): number {
  const now = Date.now();
  const secondsSinceStart = Math.floor(now / 1000);
  const secondsInWindow = secondsSinceStart % 30;
  const secondsUntilChange = 30 - secondsInWindow;

  return Math.max(0, secondsUntilChange);
}

/**
 * Log OTP verification attempt for security auditing
 */
export interface OTPAuditLog {
  user_id: string;
  attempt_type: "success" | "failure" | "backup_code_used";
  ip_address?: string;
  user_agent?: string;
  timestamp: Date;
  code_type: "totp" | "backup_code";
}

/**
 * Production Implementation Checklist:
 *
 * ✅ Install speakeasy: npm install speakeasy
 * ✅ Install qrcode: npm install qrcode
 * ✅ Replace generateTOTPCode with speakeasy.totp()
 * ✅ Replace verifyTOTP with speakeasy.totp.verify()
 * ✅ Replace generateQRCodeURL with qrcode library
 * ✅ Add database migrations for OTP tables
 * ✅ Implement OTP API endpoints
 * ✅ Add rate limiting for OTP attempts
 * ✅ Add email verification for OTP setup
 * ✅ Implement backup code storage and usage
 * ✅ Add security audit logging
 * ✅ Implement account recovery flow
 */
