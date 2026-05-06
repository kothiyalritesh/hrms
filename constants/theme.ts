import { Platform } from "react-native";

const primaryPurple = "#60045d";
const primaryPurpleLight = "#8B1A87";
const primaryPurpleDark = "#3D0239";

export const Colors = {
  light: {
    text: "#111827",
    textSecondary: "#6B7280",
    buttonText: "#FFFFFF",
    tabIconDefault: "#9CA3AF",
    tabIconSelected: primaryPurple,
    link: primaryPurple,
    primary: primaryPurple,
    primaryLight: primaryPurpleLight,
    primaryDark: primaryPurpleDark,
    backgroundRoot: "#FAF5FA",
    backgroundDefault: "#FFFFFF",
    backgroundSecondary: "#F5EEF5",
    backgroundTertiary: "#EDE0ED",
    border: "#E8D5E8",
    borderLight: "#F5EEF5",
    success: "#10B981",
    successBg: "#DCFCE7",
    successText: "#16A34A",
    warning: "#F59E0B",
    warningBg: "#FEF3C7",
    warningText: "#D97706",
    error: "#EF4444",
    errorBg: "#FEE2E2",
    errorText: "#DC2626",
    info: "#3B82F6",
    infoBg: "#DBEAFE",
    infoText: "#1D4ED8",
  },
  dark: {
    text: "#F9FAFB",
    textSecondary: "#9CA3AF",
    buttonText: "#FFFFFF",
    tabIconDefault: "#6B7280",
    tabIconSelected: primaryPurpleLight,
    link: primaryPurpleLight,
    primary: primaryPurpleLight,
    primaryLight: "#A855A0",
    primaryDark: primaryPurple,
    backgroundRoot: "#1A0A1A",
    backgroundDefault: "#2D1A2D",
    backgroundSecondary: "#3D2A3D",
    backgroundTertiary: "#4D3A4D",
    border: "#4D2A4D",
    borderLight: "#2D1A2D",
    success: "#34D399",
    successBg: "#064E3B",
    successText: "#6EE7B7",
    warning: "#FBBF24",
    warningBg: "#78350F",
    warningText: "#FDE68A",
    error: "#F87171",
    errorBg: "#7F1D1D",
    errorText: "#FECACA",
    info: "#60A5FA",
    infoBg: "#1E3A8A",
    infoText: "#BFDBFE",
  },
};

export const Spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  "2xl": 32,
  "3xl": 48,
  "4xl": 56,
  "5xl": 64,
  inputHeight: 48,
  buttonHeight: 48,
  fabSize: 56,
  iconSize: 24,
  avatarSm: 32,
  avatarMd: 48,
  avatarLg: 80,
};

export const BorderRadius = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  "2xl": 24,
  "3xl": 28,
  full: 9999,
};

export const Typography = {
  h1: {
    fontSize: 28,
    fontWeight: "700" as const,
  },
  h2: {
    fontSize: 22,
    fontWeight: "600" as const,
  },
  h3: {
    fontSize: 18,
    fontWeight: "600" as const,
  },
  h4: {
    fontSize: 16,
    fontWeight: "600" as const,
  },
  body: {
    fontSize: 16,
    fontWeight: "400" as const,
  },
  small: {
    fontSize: 14,
    fontWeight: "400" as const,
  },
  caption: {
    fontSize: 12,
    fontWeight: "400" as const,
  },
  link: {
    fontSize: 16,
    fontWeight: "400" as const,
  },
};

export const Fonts = Platform.select({
  ios: {
    sans: "system-ui",
    serif: "ui-serif",
    rounded: "ui-rounded",
    mono: "ui-monospace",
  },
  default: {
    sans: "normal",
    serif: "serif",
    rounded: "normal",
    mono: "monospace",
  },
  web: {
    sans: "system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif",
    serif: "Georgia, 'Times New Roman', serif",
    rounded:
      "'SF Pro Rounded', 'Hiragino Maru Gothic ProN', Meiryo, 'MS PGothic', sans-serif",
    mono: "SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace",
  },
});

const _shadow = (h: number, opacity: number, radius: number, elevation: number) =>
  Platform.OS === "web"
    ? { boxShadow: `0 ${h}px ${radius}px rgba(0,0,0,${opacity})` }
    : { shadowColor: "#000", shadowOffset: { width: 0, height: h }, shadowOpacity: opacity, shadowRadius: radius, elevation };

export const Shadows = {
  sm:  _shadow(1, 0.05, 2, 1),
  md:  _shadow(2, 0.10, 4, 2),
  lg:  _shadow(4, 0.15, 8, 4),
  fab: _shadow(2, 0.10, 2, 4),
};
