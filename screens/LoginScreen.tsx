import React, { useEffect, useState, useRef } from "react";
import {
  StyleSheet, View, TextInput, Image, Pressable,
  ActivityIndicator, Platform, KeyboardAvoidingView, ScrollView,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Feather from "@expo/vector-icons/Feather";
import { ThemedText } from "@/components/ThemedText";
import { useTheme } from "@/hooks/useTheme";
import { useAuth } from "@/contexts/AuthContext";
import { Spacing, BorderRadius, Colors } from "@/constants/theme";
import Spacer from "@/components/Spacer";
import { Linking } from "react-native";

export default function LoginScreen() {
  const { theme } = useTheme();
  const { requestOTP, verifyOTP } = useAuth();
  const insets = useSafeAreaInsets();

  const [step, setStep] = useState<"phone" | "otp">("phone");
  const [phone, setPhone] = useState("");
  const [otp, setOtp] = useState(["", "", "", "", "", ""]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [resendTimer, setResendTimer] = useState(0);

  const otpRefs = useRef<(TextInput | null)[]>([]);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const cleanPhone = () => phone.replace(/\D/g, "");

  const clearResendTimer = () => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
  };

  const startResendTimer = () => {
    clearResendTimer();
    setResendTimer(30);
    timerRef.current = setInterval(() => {
      setResendTimer((t) => {
        if (t <= 1) { clearResendTimer(); return 0; }
        return t - 1;
      });
    }, 1000);
  };

  useEffect(() => () => clearResendTimer(), []);

  const handleSendOTP = async () => {
    if (!/^[6-9]\d{9}$/.test(cleanPhone())) {
      setError("Enter a valid Indian mobile number starting with 6, 7, 8, or 9");
      return;
    }
    setError("");
    setLoading(true);
    const { success, error: err } = await requestOTP(cleanPhone());
    setLoading(false);
    if (!success) { setError(err || "Failed to send OTP"); return; }
    setStep("otp");
    startResendTimer();
  };

  const handleOTPChange = (val: string, idx: number) => {
    if (!/^\d*$/.test(val)) return;
    const next = [...otp];
    next[idx] = val.slice(-1);
    setOtp(next);
    setError("");
    if (val && idx < 5) otpRefs.current[idx + 1]?.focus();
    if (next.every((d) => d !== "")) handleVerify(next.join(""));
  };

  const handleKeyPress = (e: any, idx: number) => {
    if (e.nativeEvent.key === "Backspace" && !otp[idx] && idx > 0) {
      otpRefs.current[idx - 1]?.focus();
    }
  };

  const handleVerify = async (code?: string) => {
    const otpCode = code ?? otp.join("");
    if (otpCode.length < 6) { setError("Enter the 6-digit OTP"); return; }
    setError("");
    setLoading(true);
    const { success, error: err } = await verifyOTP(cleanPhone(), otpCode);
    setLoading(false);
    if (!success) {
      setError(err || "Invalid OTP");
      setOtp(["", "", "", "", "", ""]);
      otpRefs.current[0]?.focus();
    }
  };

  const handleResend = async () => {
    if (resendTimer > 0) return;
    setOtp(["", "", "", "", "", ""]);
    setError("");
    setLoading(true);
    const { success, error: err } = await requestOTP(cleanPhone());
    setLoading(false);
    if (!success) {
      setError(err || "Failed to resend OTP");
      return;
    }
    startResendTimer();
  };

  return (
    <View style={[styles.container, { backgroundColor: theme.primary }]}>
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : "height"} style={styles.flex}>
        <ScrollView
          contentContainerStyle={[styles.scrollContent, { paddingTop: insets.top + Spacing.lg, paddingBottom: insets.bottom + Spacing.xl }]}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
        >
          {/* Hero */}
          <View style={styles.heroSection}>
            <View style={styles.logoWrapper}>
              <Image source={require("../assets/images/logo.png")} style={styles.logo} resizeMode="contain" />
            </View>
            <Spacer height={Spacing.md} />
            <ThemedText type="h1" style={styles.heroTitle}>Bop Realty HRMS</ThemedText>
            <ThemedText type="small" style={styles.heroSubtitle}>Human Resource Management System</ThemedText>
          </View>

          <Spacer height={Spacing.xl} />

          <Pressable onPress={() => Linking.openURL("https://bop.in/HRMS_download/")} style={styles.apkBanner}>
            <Feather name="download" size={14} color="#FFFFFF" />
            <ThemedText type="small" style={styles.apkBannerText}>Download HRMS App (APK)</ThemedText>
            <Feather name="external-link" size={12} color="rgba(255,255,255,0.7)" />
          </Pressable>

          <Spacer height={Spacing.md} />

          <View style={[styles.card, { backgroundColor: theme.backgroundDefault }]}>
            <View style={[styles.cardAccentBar, { backgroundColor: theme.primary }]} />
            <ThemedText type="h2" style={[styles.welcomeText, { color: theme.text }]}>Welcome Back</ThemedText>
            <ThemedText type="small" style={[styles.welcomeSubtext, { color: theme.textSecondary }]}>
              Sign in to your HRMS account
            </ThemedText>
            <Spacer height={Spacing.xl} />

            {step === "phone" ? (
              <>
                <ThemedText type="small" style={[styles.label, { color: theme.text }]}>Phone Number</ThemedText>
                <View style={[styles.inputWrapper, { backgroundColor: theme.backgroundSecondary, borderColor: error ? Colors.light.error : theme.border }]}>
                  <Feather name="phone" size={18} color={theme.primary} style={styles.inputIcon} />
                  <TextInput
                    style={[styles.input, { color: theme.text }]}
                    value={phone}
                    onChangeText={(t) => { setPhone(t); setError(""); }}
                    placeholder="10-digit mobile number"
                    placeholderTextColor={theme.textSecondary}
                    keyboardType="phone-pad"
                    autoCapitalize="none"
                    returnKeyType="done"
                    onSubmitEditing={handleSendOTP}
                    maxLength={10}
                  />
                </View>
                {error ? <ThemedText type="small" style={[styles.errorText, { color: Colors.light.error }]}>{error}</ThemedText> : null}
                <Spacer height={Spacing.xl} />
                <Pressable
                  onPress={handleSendOTP}
                  disabled={loading}
                  style={({ pressed }) => [styles.btn, { backgroundColor: theme.primary, opacity: pressed || loading ? 0.85 : 1 }]}
                >
                  {loading ? <ActivityIndicator color="#fff" size="small" /> : <ThemedText type="body" style={styles.btnText}>Send OTP</ThemedText>}
                </Pressable>
              </>
            ) : (
              <>
                <Pressable onPress={() => { clearResendTimer(); setResendTimer(0); setStep("phone"); setError(""); setOtp(["","","","","",""]); }} style={styles.backBtn}>
                  <Feather name="arrow-left" size={18} color={theme.primary} />
                  <ThemedText type="small" style={{ color: theme.primary, marginLeft: 4 }}>Change number</ThemedText>
                </Pressable>
                <Spacer height={Spacing.md} />
                <ThemedText type="small" style={[styles.label, { color: theme.textSecondary, textAlign: "center" }]}>
                  OTP sent to +91 {cleanPhone()}
                </ThemedText>
                <Spacer height={Spacing.md} />
                <View style={styles.otpRow}>
                  {otp.map((digit, idx) => (
                    <TextInput
                      key={idx}
                      ref={(r) => { otpRefs.current[idx] = r; }}
                      style={[styles.otpBox, { backgroundColor: theme.backgroundSecondary, borderColor: digit ? theme.primary : error ? Colors.light.error : theme.border, color: theme.text }]}
                      value={digit}
                      onChangeText={(v) => handleOTPChange(v, idx)}
                      onKeyPress={(e) => handleKeyPress(e, idx)}
                      keyboardType="number-pad"
                      maxLength={1}
                      textAlign="center"
                      selectTextOnFocus
                    />
                  ))}
                </View>
                {error ? <ThemedText type="small" style={[styles.errorText, { color: Colors.light.error }]}>{error}</ThemedText> : null}
                <Spacer height={Spacing.xl} />
                <Pressable
                  onPress={() => handleVerify()}
                  disabled={loading || otp.some((d) => !d)}
                  style={({ pressed }) => [styles.btn, { backgroundColor: theme.primary, opacity: pressed || loading || otp.some((d) => !d) ? 0.7 : 1 }]}
                >
                  {loading ? <ActivityIndicator color="#fff" size="small" /> : <ThemedText type="body" style={styles.btnText}>Verify & Login</ThemedText>}
                </Pressable>
                <Spacer height={Spacing.lg} />
                <Pressable onPress={handleResend} disabled={resendTimer > 0} style={styles.resendBtn}>
                  <ThemedText type="small" style={{ color: resendTimer > 0 ? theme.textSecondary : theme.primary, textAlign: "center" }}>
                    {resendTimer > 0 ? `Resend OTP in ${resendTimer}s` : "Resend OTP"}
                  </ThemedText>
                </Pressable>
              </>
            )}
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}

const styles = StyleSheet.create({
  apkBanner: {
    flexDirection: "row", alignItems: "center", justifyContent: "center",
    gap: Spacing.sm, backgroundColor: "rgba(255,255,255,0.14)",
    borderWidth: 1, borderColor: "rgba(255,255,255,0.28)",
    borderRadius: BorderRadius.full, paddingVertical: 7,
    paddingHorizontal: Spacing.md, alignSelf: "center",
  },
  apkBannerText: { color: "#FFFFFF", fontWeight: "600", fontSize: 12 },
  container: { flex: 1 },
  flex: { flex: 1 },
  scrollContent: {
    flexGrow: 1, paddingHorizontal: Spacing.xl,
    maxWidth: 440,
    ...(Platform.OS === "web" ? { alignSelf: "center", width: "100%" } : {}),
  },
  heroSection: { alignItems: "center", paddingTop: Spacing.xl },
  logoWrapper: {
    width: 88, height: 88, borderRadius: BorderRadius.xl,
    backgroundColor: "#FFFFFF", alignItems: "center", justifyContent: "center",
    ...(Platform.OS === "web"
      ? { boxShadow: "0 4px 16px rgba(0,0,0,0.18)" }
      : { shadowColor: "#000", shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.18, shadowRadius: 12, elevation: 8 }),
  },
  logo: { width: 68, height: 68, borderRadius: BorderRadius.lg },
  heroTitle: { color: "#FFFFFF", textAlign: "center", fontWeight: "800", marginTop: 2 },
  heroSubtitle: { color: "rgba(255,255,255,0.72)", textAlign: "center", marginTop: Spacing.xs, letterSpacing: 0.2 },
  card: {
    borderRadius: BorderRadius["2xl"], padding: Spacing.xl, overflow: "hidden",
    ...(Platform.OS === "web"
      ? { boxShadow: "0 8px 32px rgba(0,0,0,0.18)" }
      : { shadowColor: "#000", shadowOffset: { width: 0, height: 8 }, shadowOpacity: 0.18, shadowRadius: 24, elevation: 10 }),
  },
  cardAccentBar: { height: 3, borderRadius: 2, marginBottom: Spacing.lg, width: 48, alignSelf: "center" as any },
  welcomeText: { textAlign: "center", fontWeight: "700" },
  welcomeSubtext: { textAlign: "center", marginTop: 4, lineHeight: 18 },
  label: { marginBottom: Spacing.sm, fontWeight: "600", fontSize: 13 },
  inputWrapper: {
    flexDirection: "row", alignItems: "center",
    borderWidth: 1.5, borderRadius: BorderRadius.md,
    paddingHorizontal: Spacing.md, height: 52,
  },
  inputIcon: { marginRight: Spacing.sm },
  input: { flex: 1, fontSize: 15, height: "100%" },
  errorText: { marginTop: Spacing.sm, textAlign: "center" },
  btn: {
    height: 52, borderRadius: BorderRadius.md, alignItems: "center", justifyContent: "center",
    ...(Platform.OS === "web"
      ? { boxShadow: "0 3px 10px rgba(109,27,109,0.25)" }
      : { shadowColor: "#6D1B6D", shadowOffset: { width: 0, height: 3 }, shadowOpacity: 0.25, shadowRadius: 8, elevation: 4 }),
  },
  btnText: { color: "#FFFFFF", fontWeight: "700", fontSize: 16, letterSpacing: 0.3 },
  backBtn: { flexDirection: "row", alignItems: "center" },
  otpRow: { flexDirection: "row", justifyContent: "space-between", gap: 6 },
  otpBox: { width: 44, height: 52, borderWidth: 1.5, borderRadius: BorderRadius.md, fontSize: 22, fontWeight: "700" },
  resendBtn: { alignItems: "center" },
});
