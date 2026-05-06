import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useHeaderHeight } from "@react-navigation/elements";
import { Platform } from "react-native";
import { Spacing } from "@/constants/theme";

// Fixed tab bar height estimate: icon(22) + label(12) + padding(20) + safe area handled separately
const TAB_BAR_BASE_HEIGHT = 60;

export function useScreenInsets() {
  const insets = useSafeAreaInsets();
  const headerHeight = useHeaderHeight();
  // Total bottom = tab bar content + device bottom safe area (home indicator)
  const tabBarHeight = TAB_BAR_BASE_HEIGHT + insets.bottom;

  return {
    paddingTop: headerHeight + Spacing.xl,
    paddingBottom: tabBarHeight + Spacing.xl,
    scrollInsetBottom: tabBarHeight,
  };
}
