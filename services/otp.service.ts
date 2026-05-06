/**
 * OTP Service — HMAC-SHA1 TOTP (RFC 6238)
 * Pure JS implementation — works in React Native Hermes AND browsers.
 */

// ── Pure-JS SHA-1 ────────────────────────────────────────────────────────────
function sha1(data: number[]): number[] {
  let h0 = 0x67452301, h1 = 0xefcdab89, h2 = 0x98badcfe, h3 = 0x10325476, h4 = 0xc3d2e1f0;
  const msg = [...data, 0x80];
  while (msg.length % 64 !== 56) msg.push(0);
  const bitLen = data.length * 8;
  for (let i = 7; i >= 0; i--) msg.push((bitLen / Math.pow(2, i * 8)) & 0xff);
  for (let i = 0; i < msg.length; i += 64) {
    const w: number[] = [];
    for (let j = 0; j < 16; j++) w[j] = (msg[i+j*4]<<24)|(msg[i+j*4+1]<<16)|(msg[i+j*4+2]<<8)|msg[i+j*4+3];
    for (let j = 16; j < 80; j++) { const x = w[j-3]^w[j-8]^w[j-14]^w[j-16]; w[j] = (x<<1)|(x>>>31); }
    let a=h0,b=h1,c=h2,d=h3,e=h4;
    for (let j = 0; j < 80; j++) {
      let f=0,k=0;
      if(j<20){f=(b&c)|((~b)&d);k=0x5a827999;}
      else if(j<40){f=b^c^d;k=0x6ed9eba1;}
      else if(j<60){f=(b&c)|(b&d)|(c&d);k=0x8f1bbcdc;}
      else{f=b^c^d;k=0xca62c1d6;}
      const temp=(((a<<5)|(a>>>27))+f+e+k+w[j])>>>0;
      e=d;d=c;c=(b<<30)|(b>>>2);b=a;a=temp;
    }
    h0=(h0+a)>>>0;h1=(h1+b)>>>0;h2=(h2+c)>>>0;h3=(h3+d)>>>0;h4=(h4+e)>>>0;
  }
  return [h0,h1,h2,h3,h4].flatMap(h=>[h>>>24&0xff,h>>>16&0xff,h>>>8&0xff,h&0xff]);
}

function hmacSHA1(key: number[], data: number[]): number[] {
  const BLOCK = 64;
  let k = key.length > BLOCK ? sha1(key) : [...key];
  while (k.length < BLOCK) k.push(0);
  const ipad = k.map(b => b ^ 0x36);
  const opad = k.map(b => b ^ 0x5c);
  return sha1([...opad, ...sha1([...ipad, ...data])]);
}

function base32Decode(input: string): number[] {
  const alpha = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  const str = input.toUpperCase().replace(/=+$/, "");
  let bits = 0, value = 0;
  const out: number[] = [];
  for (const ch of str) {
    const idx = alpha.indexOf(ch);
    if (idx === -1) continue;
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) { out.push((value >>> (bits - 8)) & 0xff); bits -= 8; }
  }
  return out;
}

// ── Public API ───────────────────────────────────────────────────────────────

/** Generate a 6-digit TOTP code for the given base32 secret */
export function generateTOTPCode(
  secret: string,
  timestamp: number = Date.now()
): string {
  const key = base32Decode(secret);
  const counter = Math.floor(timestamp / 1000 / 30);
  const data: number[] = [0, 0, 0, 0];
  let c = counter;
  const counterBytes = [0, 0, 0, 0, 0, 0, 0, 0];
  for (let i = 7; i >= 0; i--) { counterBytes[i] = c & 0xff; c = Math.floor(c / 256); }
  const hmac = hmacSHA1(key, counterBytes);
  const offset = hmac[19] & 0x0f;
  const code = (((hmac[offset] & 0x7f) << 24) | ((hmac[offset+1] & 0xff) << 16) | ((hmac[offset+2] & 0xff) << 8) | (hmac[offset+3] & 0xff)) % 1_000_000;
  return code.toString().padStart(6, "0");
}

/** Verify a TOTP token — accepts ±1 time window (±30 seconds) */
export function verifyTOTP(
  secret: string,
  token: string,
  window: number = 1
): boolean {
  if (!/^\d{6}$/.test(token)) return false;
  const now = Date.now();
  for (let i = -window; i <= window; i++) {
    if (generateTOTPCode(secret, now + i * 30_000) === token) return true;
  }
  return false;
}

/** Generate backup codes for account recovery */
export function generateBackupCodes(count: number = 10): string[] {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  return Array.from({ length: count }, () => {
    let code = "";
    for (let i = 0; i < 3; i++) {
      for (let j = 0; j < 4; j++) code += chars[Math.floor(Math.random() * chars.length)];
      if (i < 2) code += "-";
    }
    return code;
  });
}

/** Verify and consume a backup code */
export function useBackupCode(
  inputCode: string,
  availableCodes: string[]
): { valid: boolean; remainingCodes: string[] } {
  const normalized = inputCode.toUpperCase().replace(/[-\s]/g, "");
  const index = availableCodes.findIndex(c => c.toUpperCase().replace(/[-\s]/g, "") === normalized);
  if (index === -1) return { valid: false, remainingCodes: availableCodes };
  return { valid: true, remainingCodes: availableCodes.filter((_, i) => i !== index) };
}

/** Check if OTP is locked due to too many failed attempts */
export function isOTPLocked(
  failedAttempts: number,
  lastFailureTime: Date | null,
  maxAttempts: number = 5,
  lockoutMinutes: number = 15
): boolean {
  if (failedAttempts < maxAttempts) return false;
  if (!lastFailureTime) return true;
  return new Date() < new Date(lastFailureTime.getTime() + lockoutMinutes * 60_000);
}

/** Generate QR code URL for TOTP setup */
export function generateQRCodeURL(secret: string, email: string, appName: string = "HRMS"): string {
  const label = encodeURIComponent(`${appName} (${email})`);
  const issuer = encodeURIComponent(appName);
  const uri = `otpauth://totp/${label}?secret=${secret}&issuer=${issuer}`;
  return `https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(uri)}`;
}

/** Seconds remaining until current TOTP window expires */
export function getTimeUntilOTPChange(): number {
  return 30 - (Math.floor(Date.now() / 1000) % 30);
}

export interface OTPAuditLog {
  user_id: string;
  attempt_type: "success" | "failure" | "backup_code_used";
  ip_address?: string;
  user_agent?: string;
  timestamp: Date;
  code_type: "totp" | "backup_code";
}
