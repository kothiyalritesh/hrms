import React, { useState } from "react";
import { StyleSheet, View, TextInput, Image, Pressable, ActivityIndicator, Platform, KeyboardAvoidingView, ScrollView } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Feather } from "@expo/vector-icons";
import { ThemedText } from "@/components/ThemedText";
import { ThemedView } from "@/components/ThemedView";
import { Button } from "@/components/Button";
import { useTheme } from "@/hooks/useTheme";
import { useAuth } from "@/contexts/AuthContext";
import { Spacing, BorderRadius, Colors } from "@/constants/theme";
import Spacer from "@/components/Spacer";
import { initializeMockData } from "@/utils/storage";

export default function LoginScreen() {
  const { theme, isDark } = useTheme();
  const { login, isLoading } = useAuth();
  const insets = useSafeAreaInsets();
  
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState("");

  const handleLogin = async () => {
    if (!email.trim()) {
      setError("Please enter your email");
      return;
    }
    if (!password.trim()) {
      setError("Please enter your password");
      return;
    }
    
    setError("");
    const success = await login(email, password);
    if (success) {
      await initializeMockData("user_" + Date.now());
    } else {
      setError("Login failed. Please try again.");
    }
  };

  const inputStyle = [
    styles.input,
    {
      backgroundColor: theme.backgroundDefault,
      color: theme.text,
      borderColor: error ? Colors.light.error : theme.border,
    },
  ];

  return (
    <ThemedView style={styles.container}>
      <KeyboardAvoidingView 
        behavior={Platform.OS === "ios" ? "padding" : "height"}
        style={styles.keyboardView}
      >
        <ScrollView 
          contentContainerStyle={[
            styles.scrollContent,
            { paddingTop: insets.top + Spacing["3xl"], paddingBottom: insets.bottom + Spacing.xl }
          ]}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
        >
          <View style={styles.logoContainer}>
            <Image
              source={require("../assets/images/icon.png")}
              style={styles.logo}
              resizeMode="contain"
            />
            <Spacer height={Spacing.lg} />
            <ThemedText type="h1" style={styles.title}>RE HRMS</ThemedText>
            <ThemedText type="small" style={[styles.subtitle, { color: theme.textSecondary }]}>
              Real Estate Human Resource Management
            </ThemedText>
          </View>

          <Spacer height={Spacing["3xl"]} />

          <View style={styles.formContainer}>
            <ThemedText type="h2" style={styles.welcomeText}>Welcome Back</ThemedText>
            <ThemedText type="small" style={[styles.welcomeSubtext, { color: theme.textSecondary }]}>
              Sign in to continue
            </ThemedText>

            <Spacer height={Spacing["2xl"]} />

            <View style={styles.fieldContainer}>
              <ThemedText type="small" style={styles.label}>Email</ThemedText>
              <View style={styles.inputWrapper}>
                <Feather name="mail" size={20} color={theme.textSecondary} style={styles.inputIcon} />
                <TextInput
                  style={[inputStyle, styles.inputWithIcon]}
                  value={email}
                  onChangeText={(text) => {
                    setEmail(text);
                    setError("");
                  }}
                  placeholder="Enter your email"
                  placeholderTextColor={theme.textSecondary}
                  keyboardType="email-address"
                  autoCapitalize="none"
                  autoCorrect={false}
                  returnKeyType="next"
                />
              </View>
            </View>

            <Spacer height={Spacing.lg} />

            <View style={styles.fieldContainer}>
              <ThemedText type="small" style={styles.label}>Password</ThemedText>
              <View style={styles.inputWrapper}>
                <Feather name="lock" size={20} color={theme.textSecondary} style={styles.inputIcon} />
                <TextInput
                  style={[inputStyle, styles.inputWithIcon, styles.passwordInput]}
                  value={password}
                  onChangeText={(text) => {
                    setPassword(text);
                    setError("");
                  }}
                  placeholder="Enter your password"
                  placeholderTextColor={theme.textSecondary}
                  secureTextEntry={!showPassword}
                  autoCapitalize="none"
                  returnKeyType="done"
                  onSubmitEditing={handleLogin}
                />
                <Pressable 
                  onPress={() => setShowPassword(!showPassword)}
                  style={styles.eyeIcon}
                  hitSlop={8}
                >
                  <Feather 
                    name={showPassword ? "eye-off" : "eye"} 
                    size={20} 
                    color={theme.textSecondary} 
                  />
                </Pressable>
              </View>
            </View>

            {error ? (
              <>
                <Spacer height={Spacing.md} />
                <View style={[styles.errorContainer, { backgroundColor: Colors.light.errorBg }]}>
                  <Feather name="alert-circle" size={16} color={Colors.light.error} />
                  <ThemedText type="small" style={[styles.errorText, { color: Colors.light.error }]}>
                    {error}
                  </ThemedText>
                </View>
              </>
            ) : null}

            <Spacer height={Spacing.xl} />

            <Button onPress={handleLogin} disabled={isLoading}>
              {isLoading ? (
                <ActivityIndicator color="#FFFFFF" size="small" />
              ) : (
                "Sign In"
              )}
            </Button>

            <Spacer height={Spacing.xl} />

            <View style={styles.infoContainer}>
              <ThemedText type="caption" style={[styles.infoText, { color: theme.textSecondary }]}>
                Demo: Use any email with "admin", "hr", or "manager" to login as that role
              </ThemedText>
            </View>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  keyboardView: {
    flex: 1,
  },
  scrollContent: {
    flexGrow: 1,
    paddingHorizontal: Spacing.xl,
  },
  logoContainer: {
    alignItems: "center",
    paddingTop: Spacing["2xl"],
  },
  logo: {
    width: 100,
    height: 100,
    borderRadius: BorderRadius.xl,
  },
  title: {
    textAlign: "center",
  },
  subtitle: {
    textAlign: "center",
    marginTop: Spacing.xs,
  },
  formContainer: {
    flex: 1,
  },
  welcomeText: {
    textAlign: "center",
  },
  welcomeSubtext: {
    textAlign: "center",
    marginTop: Spacing.xs,
  },
  fieldContainer: {
    width: "100%",
  },
  label: {
    marginBottom: Spacing.sm,
    fontWeight: "600",
  },
  inputWrapper: {
    position: "relative",
    flexDirection: "row",
    alignItems: "center",
  },
  inputIcon: {
    position: "absolute",
    left: Spacing.lg,
    zIndex: 1,
  },
  input: {
    height: Spacing.inputHeight,
    borderWidth: 1,
    borderRadius: BorderRadius.sm,
    paddingHorizontal: Spacing.lg,
    fontSize: 16,
    flex: 1,
  },
  inputWithIcon: {
    paddingLeft: Spacing.lg + 28,
  },
  passwordInput: {
    paddingRight: Spacing.lg + 28,
  },
  eyeIcon: {
    position: "absolute",
    right: Spacing.lg,
    padding: Spacing.xs,
  },
  errorContainer: {
    flexDirection: "row",
    alignItems: "center",
    padding: Spacing.md,
    borderRadius: BorderRadius.sm,
    gap: Spacing.sm,
  },
  errorText: {
    flex: 1,
  },
  infoContainer: {
    alignItems: "center",
  },
  infoText: {
    textAlign: "center",
  },
});
