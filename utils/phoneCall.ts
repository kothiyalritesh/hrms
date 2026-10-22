import { Alert, Linking } from "react-native";

/**
 * tel: link for an HRMS login phone. Login phones are stored as 10 digits
 * (sometimes with 91 / +91); 10-digit numbers are dialled as +91.
 */
export function telUrl(phone: string | null | undefined): string | null {
  const raw = String(phone ?? "").trim();
  if (!raw) return null;
  const digits = raw.replace(/\D/g, "");
  if (digits.length === 10) return `tel:+91${digits}`;
  if (digits.length === 12 && digits.startsWith("91")) return `tel:+${digits}`;
  if (digits.length >= 6 && digits.length <= 15) return `tel:${raw.startsWith("+") ? "+" : ""}${digits}`;
  return null;
}

/** Display form: +91 98765 43210 for Indian mobiles, otherwise as stored. */
export function formatPhone(phone: string | null | undefined): string {
  const url = telUrl(phone);
  if (!url) return "";
  const n = url.slice(4);
  const m = /^\+91(\d{5})(\d{5})$/.exec(n);
  return m ? `+91 ${m[1]} ${m[2]}` : n;
}

/** Opens the phone dialer (Android / iOS / mobile browser). */
export async function callPhone(phone: string | null | undefined, name?: string | null) {
  const url = telUrl(phone);
  if (!url) {
    Alert.alert("No phone number", `${name || "This employee"} has no phone number in HRMS.`);
    return;
  }
  try {
    await Linking.openURL(url);
  } catch {
    Alert.alert("Could not start the call", `Dial ${formatPhone(phone)} manually.`);
  }
}
