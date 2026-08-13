import { Platform } from "react-native";

// ── Brand palette extracted from dashboard.jpeg / dashboard2.jpeg ────────────
const P   = "#6D1B6D";   // primary — rich deep purple
const PL  = "#8E2A8E";   // primary light
const PD  = "#4A0F4A";   // primary dark
const PXL = "#2E062E";   // primary xtra dark (TV header)

export const Colors = {
  light: {
    // text
    text:              "#1A1028",
    textSecondary:     "#6B6478",
    textTertiary:      "#A89CB0",
    buttonText:        "#FFFFFF",

    // nav
    tabIconDefault:    "#A89CB0",
    tabIconSelected:   P,
    link:              P,

    // brand
    primary:           P,
    primaryLight:      PL,
    primaryDark:       PD,

    // backgrounds
    backgroundRoot:    "#F5F0F8",
    backgroundDefault: "#FFFFFF",
    backgroundSecondary: "#F0EAF5",
    backgroundTertiary:  "#E8DEEE",

    // borders
    border:            "#E2D5EA",
    borderLight:       "#EDE5F2",

    // semantic
    success:           "#12966E",
    successBg:         "#E4F4EE",
    successText:       "#0A7354",

    warning:           "#D97706",
    warningBg:         "#FEF3C7",
    warningText:       "#92400E",

    error:             "#C8252D",
    errorBg:           "#FDEAEB",
    errorText:         "#9A1B22",

    info:              "#1A5FD4",
    infoBg:            "#E3EEFB",
    infoText:          "#123E9C",

    // card accents
    accent1:           "#F59B3C",
    accent2:           "#E84C8C",
    accent3:           "#3CB4F5",
    accent4:           "#7C3AED",
  },

  dark: {
    text:              "#F0EBF8",
    textSecondary:     "#9C8FAC",
    textTertiary:      "#6B6478",
    buttonText:        "#FFFFFF",
    tabIconDefault:    "#6B6478",
    tabIconSelected:   PL,
    link:              PL,
    primary:           PL,
    primaryLight:      "#A838A8",
    primaryDark:       P,
    backgroundRoot:    "#140E1C",
    backgroundDefault: "#1E1530",
    backgroundSecondary: "#281A3C",
    backgroundTertiary:  "#341F4C",
    border:            "#382248",
    borderLight:       "#281A3C",
    success:           "#1AB88A",
    successBg:         "#0A3828",
    successText:       "#6EE4C0",
    warning:           "#F5B040",
    warningBg:         "#3A1E08",
    warningText:       "#F8D08C",
    error:             "#EF7070",
    errorBg:           "#3C0A0A",
    errorText:         "#F8B0B0",
    info:              "#6098F8",
    infoBg:            "#0C1E50",
    infoText:          "#A8C8FC",
    accent1:           "#F59B3C",
    accent2:           "#E84C8C",
    accent3:           "#3CB4F5",
    accent4:           "#A870F8",
  },
};

export const Spacing = {
  xs:  4,
  sm:  8,
  md:  12,
  lg:  16,
  xl:  24,
  "2xl": 32,
  "3xl": 48,
  "4xl": 56,
  "5xl": 64,
  inputHeight: 52,
  buttonHeight: 52,
  fabSize: 56,
  iconSize: 24,
  avatarSm: 34,
  avatarMd: 50,
  avatarLg: 84,
};

export const BorderRadius = {
  xs:    4,
  sm:    8,
  md:    12,
  lg:    16,
  xl:    20,
  "2xl": 24,
  "3xl": 28,
  full:  9999,
};

export const Typography = {
  h1:      { fontSize: 28, fontWeight: "700" as const, letterSpacing: -0.6 },
  h2:      { fontSize: 22, fontWeight: "700" as const, letterSpacing: -0.4 },
  h3:      { fontSize: 17, fontWeight: "600" as const, letterSpacing: -0.2 },
  h4:      { fontSize: 15, fontWeight: "600" as const },
  body:    { fontSize: 15, fontWeight: "400" as const, lineHeight: 22 },
  small:   { fontSize: 13, fontWeight: "400" as const, lineHeight: 19 },
  caption: { fontSize: 11, fontWeight: "400" as const, lineHeight: 16 },
  link:    { fontSize: 15, fontWeight: "500" as const },
};

export const Fonts = Platform.select({
  ios: {
    sans:    "system-ui",
    serif:   "ui-serif",
    rounded: "ui-rounded",
    mono:    "ui-monospace",
  },
  default: {
    sans:    "normal",
    serif:   "serif",
    rounded: "normal",
    mono:    "monospace",
  },
  web: {
    sans:    "Inter, system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif",
    serif:   "Georgia, 'Times New Roman', serif",
    rounded: "'SF Pro Rounded', 'Hiragino Maru Gothic ProN', Meiryo, sans-serif",
    mono:    "SFMono-Regular, Menlo, Monaco, Consolas, 'Courier New', monospace",
  },
});

const _s = (h: number, op: number, r: number, el: number) =>
  Platform.OS === "web"
    ? { boxShadow: `0 ${h}px ${r}px rgba(109,27,109,${op})` }
    : { shadowColor: P, shadowOffset: { width: 0, height: h }, shadowOpacity: op, shadowRadius: r, elevation: el };

export const Shadows = {
  xs:  _s(1, 0.05, 2,  1),
  sm:  _s(2, 0.08, 5,  2),
  md:  _s(3, 0.12, 8,  4),
  lg:  _s(5, 0.16, 14, 6),
  fab: _s(4, 0.22, 10, 8),
};

// TV display color tokens
export const TV = {
  bg:        "#14101C",
  topbar:    "#140820",
  colBg:     "#1C1028",
  teamHdr:   "#241430",
  empRow:    "#201028",
  empRowAlt: "#1A0C24",
  border:    "#30183C",
  accent:    P,
  text:      "#F0EBF8",
  textSub:   "#9080A8",
  present:   "#12966E",
  absent:    "#C8252D",
  checkedOut:"#6B6478",
};
