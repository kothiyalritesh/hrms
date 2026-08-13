import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Platform, Dimensions } from "react-native";
import { Spacing } from "@/constants/theme";

const TAB_BAR_BASE_HEIGHT = 60;
const DESKTOP_NAV_HEIGHT = 68;
const IS_WIDE = Platform.OS === "web" && Dimensions.get("window").width >= 768;

export function useScreenInsets() {
  const insets = useSafeAreaInsets();
  const tabBarHeight = TAB_BAR_BASE_HEIGHT + insets.bottom;

  // Desktop: nav is at the bottom, 68px tall
  if (IS_WIDE) {
    return {
      paddingTop: Spacing.xl,
      paddingBottom: DESKTOP_NAV_HEIGHT + Spacing.xl,
      scrollInsetBottom: DESKTOP_NAV_HEIGHT,
    };
  }

  return {
    paddingTop: Spacing.xl,
    paddingBottom: tabBarHeight + Spacing.xl,
    scrollInsetBottom: tabBarHeight,
  };
}
