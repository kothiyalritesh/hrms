import { Platform, ScrollView, ScrollViewProps, StyleSheet, View } from "react-native";
import { useTheme } from "@/hooks/useTheme";
import { useScreenInsets } from "@/hooks/useScreenInsets";

const isWeb = Platform.OS === "web";
const MAX_W = 960;

interface ScreenScrollViewProps extends ScrollViewProps {
  /** Set true when the screen renders its own PageHeader (avoids double top padding) */
  noPaddingTop?: boolean;
}

export function ScreenScrollView({
  children,
  contentContainerStyle,
  style,
  noPaddingTop,
  ...scrollViewProps
}: ScreenScrollViewProps) {
  const { theme } = useTheme();
  const { paddingTop, paddingBottom, scrollInsetBottom } = useScreenInsets();

  return (
    <ScrollView
      style={[styles.container, { backgroundColor: theme.backgroundRoot }, style]}
      contentContainerStyle={[
        {
          paddingTop: noPaddingTop ? 0 : paddingTop,
          paddingBottom,
        },
        isWeb && styles.webOuter,
        contentContainerStyle,
      ]}
      scrollIndicatorInsets={{ bottom: scrollInsetBottom }}
      {...scrollViewProps}
    >
      {isWeb ? (
        <View style={styles.webInner}>{children}</View>
      ) : (
        children
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  webOuter: {
    alignItems: "center" as any,
    paddingHorizontal: 0,
  },
  webInner: {
    width: "100%" as any,
    maxWidth: MAX_W,
    alignSelf: "center" as any,
  },
});
