import React, { useState, useRef } from "react";
import {
  StyleSheet, View, TextInput, Image, Pressable,
  ActivityIndicator, Platform, KeyboardAvoidingView, ScrollView, TouchableOpacity,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Feather } from "@expo/vector-icons";
import { ThemedText } from "@/components/ThemedText";
import { useTheme } from "@/hooks/useTheme";
import { useAuth } from "@/contexts/AuthContext";
import { Spacing, BorderRadius, Colors } from "@/constants/theme";
import Spacer from "@/components/Spacer";

export default function LoginScreen() {
  const { theme } = useTheme();
  const { requestOTP, loginWithOTP, isLoading } = useAuth();
  const insets = useSafeAreaInsets();

  const [phone, setPhone] = useState("");
  const [otp, setOtp] = useState("");
  const [step, setStep] = useState<"phone" | "otp">("phone");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [resendTimer, setResendTimer] = useState(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const startTimer = () => {
    setResendTimer(60);
    if (timerRef.current) clearInterval(timerRef.current);
    timerRef.current = setInterval(() => {
      setResendTimer((t) => {
        if (t <= 1) { clearInterval(timerRef.current!); return 0; }
        return t - 1;
      });
    }, 1000);
  };

  const handleSendOTP = async () => {
    if (!phone.trim()) { setError("Please enter your phone number."); return; }
    setError("");
    setLoading(true);
    const result = await requestOTP(phone.trim());
    setLoading(false);
    if (!result.success) {
      setError("Phone number not found or account is inactive.\nContact your admin.");
      return;
    }
    setStep("otp");
    startTimer();
  };

  const handleVerify = async () => {
    if (otp.replace(/\D/g, "").length !== 6) return;
    setError("");
    setLoading(true);
    const ok = await loginWithOTP(phone.trim(), otp.trim());
    setLoading(false);
    if (!ok) setError("Incorrect OTP. Please try again.");
  };

  const handleResend = async () => {
    if (resendTimer > 0) return;
    setOtp("");
    setError("");
    setLoading(true);
    await requestOTP(phone.trim());
    setLoading(false);
    startTimer();
  };

  const handleBack = () => {
    setStep("phone");
    setOtp("");
    setError("");
    if (timerRef.current) clearInterval(timerRef.current);
    setResendTimer(0);
  };

  const isDisabled = loading || isLoading;

  return (
    <View style={[styles.root, { backgroundColor: theme.primary }]}>
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : "height"}
        style={{ flex: 1 }}
      >
        <ScrollView
          contentContainerStyle={[
            styles.scroll,
            { paddingTop: insets.top + Spacing.lg, paddingBottom: insets.bottom + Spacing.xl },
          ]}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
        >
          {/* Logo */}
          <View style={styles.hero}>
            <View style={styles.logoWrap}>
              <Image
                source={require("../assets/images/logo.png")}
                style={styles.logo}
                resizeMode="contain"
              />
            </View>
            <Spacer height={Spacing.lg} />
            <ThemedText type="h1" style={styles.heroTitle}>RealtyHRM</ThemedText>
            <ThemedText type="small" style={styles.heroSub}>
              Real Estate Human Resource Management
            </ThemedText>
          </View>

          <Spacer height={Spacing["2xl"]} />

          {/* Card */}
          <View style={[styles.card, { backgroundColor: theme.backgroundDefault }]}>

            {step === "phone" ? (
              <>
                <ThemedText type="h2" style={[styles.cardTitle, { color: theme.text }]}>
                  Welcome Back 👋
                </ThemedText>
                <ThemedText style={[styles.cardSub, { color: theme.textSecondary }]}>
                  Enter your registered mobile number
                </ThemedText>

                <Spacer height={Spacing.xl} />

                <ThemedText style={[styles.label, { color: theme.text }]}>Phone Number</ThemedText>
                <View style={[styles.inputRow, { backgroundColor: theme.backgroundSecondary, borderColor: theme.border }]}>
                  <Feather name="phone" size={17} color={theme.primary} />
                  <TextInput
                    style={[styles.input, { color: theme.text }]}
                    value={phone}
                    onChangeText={t => { setPhone(t); setError(""); }}
                    placeholder="Enter your phone number"
                    placeholderTextColor={theme.textSecondary}
                    keyboardType="phone-pad"
                    autoCapitalize="none"
                    returnKeyType="done"
                    onSubmitEditing={handleSendOTP}
                    autoFocus
                  />
                </View>

                {error ? <ErrorBox msg={error} /> : null}

                <Spacer height={Spacing.xl} />

                <Pressable
                  style={[styles.btn, { backgroundColor: theme.primary }, isDisabled && { opacity: 0.6 }]}
                  onPress={handleSendOTP}
                  disabled={isDisabled}
                >
                  {isDisabled
                    ? <ActivityIndicator color="#fff" size="small" />
                    : <ThemedText style={styles.btnTxt}>Send OTP</ThemedText>}
                </Pressable>
              </>
            ) : (
              <>
                {/* Back + phone display */}
                <View style={styles.otpHeader}>
                  <TouchableOpacity onPress={handleBack} style={styles.backBtn}>
                    <Feather name="arrow-left" size={20} color={theme.primary} />
                  </TouchableOpacity>
                  <View>
                    <ThemedText type="h2" style={[styles.cardTitle, { color: theme.text, marginBottom: 2 }]}>
                      Enter OTP
                    </ThemedText>
                    <ThemedText style={[styles.cardSub, { color: theme.textSecondary }]}>
                      Sent to {phone}
                    </ThemedText>
                  </View>
                </View>

                <Spacer height={Spacing.xl} />

                {/* 6-box OTP input */}
                <View style={{ alignItems: "center" }}>
                  <OTPBoxInput value={otp} onChange={v => { setOtp(v); setError(""); }} onComplete={handleVerify} />
                </View>

                {/* Resend */}
                <TouchableOpacity
                  onPress={handleResend}
                  disabled={resendTimer > 0}
                  style={styles.resendRow}
                >
                  <ThemedText style={{ color: theme.textSecondary, fontSize: 13 }}>
                    Didn't receive it?{" "}
                  </ThemedText>
                  <ThemedText style={{
                    fontSize: 13, fontWeight: "700",
                    color: resendTimer > 0 ? theme.textSecondary : theme.primary,
                  }}>
                    {resendTimer > 0 ? `Resend in ${resendTimer}s` : "Resend OTP"}
                  </ThemedText>
                </TouchableOpacity>

                {error ? <ErrorBox msg={error} /> : null}

                <Spacer height={Spacing.xl} />

                <Pressable
                  style={[styles.btn, { backgroundColor: theme.primary }, (isDisabled || otp.replace(/\D/g, "").length !== 6) && { opacity: 0.4 }]}
                  onPress={handleVerify}
                  disabled={isDisabled || otp.replace(/\D/g, "").length !== 6}
                >
                  {isDisabled
                    ? <ActivityIndicator color="#fff" size="small" />
                    : <ThemedText style={styles.btnTxt}>Verify & Sign In</ThemedText>}
                </Pressable>
              </>
            )}

            <Spacer height={Spacing.lg} />
            <ThemedText style={[styles.footer, { color: theme.textSecondary }]}>
              Contact your administrator if you need help.
            </ThemedText>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}

/** 6 individual OTP digit boxes */
function OTPBoxInput({
  value, onChange, onComplete,
}: {
  value: string;
  onChange: (v: string) => void;
  onComplete: () => void;
}) {
  const { theme } = useTheme();
  const inputs = useRef<(TextInput | null)[]>([]);

  const handleChange = (text: string, index: number) => {
    // Handle paste: if user pastes 6 digits at once
    const cleaned = text.replace(/\D/g, "");
    if (cleaned.length > 1) {
      const pasted = cleaned.slice(0, 6);
      onChange(pasted);
      const focusIndex = Math.min(pasted.length, 5);
      inputs.current[focusIndex]?.focus();
      if (pasted.length === 6) onComplete();
      return;
    }
    const digit = cleaned.slice(-1);
    const arr = (value + "      ").slice(0, 6).split("");
    arr[index] = digit;
    const next = arr.join("").trimEnd().slice(0, 6);
    onChange(next);
    if (digit && index < 5) {
      setTimeout(() => inputs.current[index + 1]?.focus(), 10);
    }
    if (next.replace(/ /g, "").length === 6) onComplete();
  };

  const handleKeyPress = (e: any, index: number) => {
    if (e.nativeEvent.key === "Backspace") {
      if (!value[index] && index > 0) {
        const arr = (value + "      ").slice(0, 6).split("");
        arr[index - 1] = "";
        onChange(arr.join("").trimEnd());
        setTimeout(() => inputs.current[index - 1]?.focus(), 10);
      } else {
        const arr = (value + "      ").slice(0, 6).split("");
        arr[index] = "";
        onChange(arr.join("").trimEnd());
      }
    }
  };

  const filled = value.replace(/\D/g, "");

  return (
    <View style={otpStyles.row}>
      {Array.from({ length: 6 }).map((_, i) => {
        const isFilled = !!filled[i];
        const isFocused = filled.length === i || (filled.length === 6 && i === 5);
        return (
          <TextInput
            key={i}
            ref={r => { inputs.current[i] = r; }}
            style={[
              otpStyles.box,
              {
                backgroundColor: isFilled ? theme.primary + "12" : theme.backgroundSecondary,
                borderColor: isFilled ? theme.primary : theme.border,
                color: theme.text,
              },
            ]}
            value={filled[i] || ""}
            onChangeText={t => handleChange(t, i)}
            onKeyPress={e => handleKeyPress(e, i)}
            keyboardType="number-pad"
            maxLength={Platform.OS === "web" ? 6 : 1}
            textAlign="center"
            autoFocus={i === 0}
            selectTextOnFocus
            caretHidden
          />
        );
      })}
    </View>
  );
}

const BOX_SIZE = 46;

const otpStyles = StyleSheet.create({
  row: {
    flexDirection: "row",
    justifyContent: "space-between",
    gap: 10,
    marginBottom: Spacing.md,
  },
  box: {
    width: BOX_SIZE,
    height: BOX_SIZE,
    borderRadius: 12,
    borderWidth: 2,
    fontSize: 22,
    fontWeight: "800" as const,
    textAlign: "center",
    ...(Platform.OS === "web"
      ? ({ outlineStyle: "none" } as any)
      : {}),
  },
});

function ErrorBox({ msg }: { msg: string }) {
  return (
    <>
      <Spacer height={Spacing.md} />
      <View style={[errStyles.box, { backgroundColor: Colors.light.errorBg }]}>
        <Feather name="alert-circle" size={15} color={Colors.light.error} style={{ marginTop: 1 }} />
        <ThemedText style={[errStyles.txt, { color: Colors.light.error }]}>{msg}</ThemedText>
      </View>
    </>
  );
}

const errStyles = StyleSheet.create({
  box: { flexDirection: "row", alignItems: "flex-start", gap: 8, padding: Spacing.md, borderRadius: BorderRadius.sm },
  txt: { flex: 1, fontSize: 13, lineHeight: 19 },
});

const styles = StyleSheet.create({
  root: { flex: 1 },
  scroll: { flexGrow: 1, paddingHorizontal: Spacing.xl },
  hero: { alignItems: "center", paddingTop: Spacing.xl },
  logoWrap: {
    width: 100, height: 100, borderRadius: BorderRadius.xl,
    backgroundColor: "#fff", alignItems: "center", justifyContent: "center",
    shadowColor: "#000", shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.2, shadowRadius: 8, elevation: 6,
  },
  logo: { width: 80, height: 80, borderRadius: BorderRadius.lg },
  heroTitle: { color: "#fff", textAlign: "center", fontWeight: "800" },
  heroSub: { color: "rgba(255,255,255,0.75)", textAlign: "center", marginTop: Spacing.xs },
  card: {
    borderRadius: BorderRadius["2xl"], padding: Spacing.xl,
    shadowColor: "#000", shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.15, shadowRadius: 16, elevation: 8,
  },
  cardTitle: { fontWeight: "700", marginBottom: 0 },
  cardSub: { fontSize: 13, marginTop: 4 },
  otpHeader: { flexDirection: "row", alignItems: "center", gap: 12 },
  backBtn: { padding: 4 },
  label: { fontSize: 13, fontWeight: "600", marginBottom: Spacing.sm },
  inputRow: {
    flexDirection: "row", alignItems: "center", gap: 10,
    borderWidth: 1.5, borderRadius: BorderRadius.md,
    paddingHorizontal: Spacing.md, height: 52,
  },
  input: { flex: 1, fontSize: 15 },
  btn: { height: 52, borderRadius: BorderRadius.md, alignItems: "center", justifyContent: "center" },
  btnTxt: { color: "#fff", fontWeight: "800", fontSize: 16 },
  resendRow: { flexDirection: "row", marginTop: Spacing.md },
  footer: { textAlign: "center", fontSize: 12 },
});
