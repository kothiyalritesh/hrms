import { supabase } from "@/lib/supabase";

/**
 * User Credentials Service
 * Handles user account creation, credential generation, and OTP functionality
 */

interface UserCredentials {
  username: string;
  temporaryPassword: string;
  otpEnabled: boolean;
  otpSecret?: string;
}

interface UserCreationParams {
  employeeId: string;
  name: string;
  email: string;
  phone: string;
  roleId: string;
  officeId: string;
  employeeNumber: string; // Used to generate username
}

/**
 * Generate username from employee number
 */
export function generateUsername(employeeNumber: string): string {
  // Format: EMP{employeeNumber} - e.g., EMP001
  return `EMP${employeeNumber.toString().padStart(4, "0")}`;
}

/**
 * Generate a secure temporary password
 * Requirements: 12 chars, mix of upper, lower, numbers, special chars
 */
export function generateTemporaryPassword(): string {
  const upper = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
  const lower = "abcdefghijklmnopqrstuvwxyz";
  const numbers = "0123456789";
  const special = "!@#$%^&*";

  const allChars = upper + lower + numbers + special;
  let password = "";

  // Ensure at least one of each type
  password += upper[Math.floor(Math.random() * upper.length)];
  password += lower[Math.floor(Math.random() * lower.length)];
  password += numbers[Math.floor(Math.random() * numbers.length)];
  password += special[Math.floor(Math.random() * special.length)];

  // Fill the rest randomly
  for (let i = password.length; i < 12; i++) {
    password += allChars[Math.floor(Math.random() * allChars.length)];
  }

  // Shuffle the password
  return password
    .split("")
    .sort(() => Math.random() - 0.5)
    .join("");
}

/**
 * Generate OTP secret for 2FA (Time-based One-Time Password)
 * Returns a base32-encoded secret
 */
export function generateOTPSecret(): string {
  // Simple implementation - in production, use speakeasy or similar
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let secret = "";
  for (let i = 0; i < 32; i++) {
    secret += chars[Math.floor(Math.random() * chars.length)];
  }
  return secret;
}

/**
 * Create new user with credentials
 */
export async function createUserWithCredentials(
  params: UserCreationParams,
): Promise<UserCredentials> {
  const username = generateUsername(params.employeeNumber);
  const temporaryPassword = generateTemporaryPassword();
  const otpSecret = generateOTPSecret();

  try {
    // Create user credentials record in database
    const { data, error } = await supabase
      .from("user_credentials")
      .insert({
        user_id: params.employeeId,
        username: username,
        password_hash: btoa(temporaryPassword), // Base64 encode for demo (use bcrypt in production)
        email: params.email,
        phone: params.phone,
        is_temporary: true,
        otp_secret: otpSecret,
        otp_enabled: true,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .select();

    if (error) {
      throw new Error(`Failed to create credentials: ${error.message}`);
    }

    // Update user profile with username
    const { error: updateError } = await supabase
      .from("profiles")
      .update({
        username: username,
        phone: params.phone,
      })
      .eq("id", params.employeeId);

    if (updateError) {
      console.warn("Failed to update profile:", updateError);
    }

    return {
      username,
      temporaryPassword,
      otpEnabled: true,
      otpSecret,
    };
  } catch (error) {
    console.error("Error creating user credentials:", error);
    throw error;
  }
}

/**
 * Check if OTP is enabled for user
 */
export async function checkOTPStatus(userId: string): Promise<boolean> {
  try {
    const { data, error } = await supabase
      .from("user_credentials")
      .select("otp_enabled")
      .eq("user_id", userId)
      .single();

    if (error) {
      console.warn("OTP check error:", error);
      return false;
    }

    return data?.otp_enabled ?? false;
  } catch (error) {
    console.error("Error checking OTP status:", error);
    return false;
  }
}

/**
 * Enable/Disable OTP for user
 */
export async function toggleOTP(
  userId: string,
  enabled: boolean,
): Promise<boolean> {
  try {
    const { error } = await supabase
      .from("user_credentials")
      .update({ otp_enabled: enabled, updated_at: new Date().toISOString() })
      .eq("user_id", userId);

    if (error) {
      throw new Error(`Failed to toggle OTP: ${error.message}`);
    }

    return true;
  } catch (error) {
    console.error("Error toggling OTP:", error);
    throw error;
  }
}

/**
 * Reset password for user
 */
export async function resetPassword(userId: string): Promise<string> {
  const newPassword = generateTemporaryPassword();

  try {
    const { error } = await supabase
      .from("user_credentials")
      .update({
        password_hash: btoa(newPassword),
        is_temporary: true,
        updated_at: new Date().toISOString(),
      })
      .eq("user_id", userId);

    if (error) {
      throw new Error(`Failed to reset password: ${error.message}`);
    }

    return newPassword;
  } catch (error) {
    console.error("Error resetting password:", error);
    throw error;
  }
}

/**
 * Get user credentials (admin only)
 */
export async function getUserCredentials(userId: string) {
  try {
    const { data, error } = await supabase
      .from("user_credentials")
      .select("username, email, phone, otp_enabled, created_at")
      .eq("user_id", userId)
      .single();

    if (error) {
      console.warn("Error fetching credentials:", error);
      return null;
    }

    return data;
  } catch (error) {
    console.error("Error getting user credentials:", error);
    return null;
  }
}
