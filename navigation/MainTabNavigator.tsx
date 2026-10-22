import React, { useEffect, useState } from "react";
import { createBottomTabNavigator } from "@react-navigation/bottom-tabs";
import { CommonActions } from "@react-navigation/native";
import Feather from "@expo/vector-icons/Feather";
import { ActivityIndicator, Platform, StyleSheet, View, Pressable, Dimensions } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import HomeStackNavigator from "@/navigation/HomeStackNavigator";
import TasksStackNavigator from "@/navigation/TasksStackNavigator";
import ProfileStackNavigator from "@/navigation/ProfileStackNavigator";
import AdminStackNavigator from "@/navigation/AdminStackNavigator";
import ReportsStackNavigator from "@/navigation/ReportsStackNavigator";
import { useTheme } from "@/hooks/useTheme";
import { useAuth } from "@/contexts/AuthContext";
import { usePermissions } from "@/hooks/usePermissions";
import { SCREEN_PERMISSIONS } from "@/constants/permissionCatalog";
import { ThemedText } from "@/components/ThemedText";
import { supabase } from "@/lib/supabase";
import { canAccessHRPanelRole, normalizeUserRole } from "@/utils/userRole";

const IS_WEB  = Platform.OS === "web";
const IS_WIDE = IS_WEB && Dimensions.get("window").width >= 768;

export type MainTabParamList = {
  HomeTab:    undefined;
  TasksTab:
    | {
        screen?: "Tasks";
        params?: { taskId?: string; eventId?: string };
        taskId?: string;
        eventId?: string;
      }
    | undefined;
  ProfileTab: undefined;
  AdminTab:   undefined;
  ReportsTab: undefined;
  MyTeamTab:  undefined;
};

const Tab = createBottomTabNavigator<MainTabParamList>();

function deferredScreen(loader: () => Promise<{ default: React.ComponentType<any> }>) {
  const Lazy = React.lazy(loader);
  return function DeferredTab(props: any) {
    return (
      <React.Suspense
        fallback={
          <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
            <ActivityIndicator />
          </View>
        }
      >
        <Lazy {...props} />
      </React.Suspense>
    );
  };
}

const MyTeamScreen = deferredScreen(() => import("@/screens/MyTeamScreen"));

const TAB_ICONS: Record<string, keyof typeof Feather.glyphMap> = {
  HomeTab:    "home",
  TasksTab:   "check-square",
  ProfileTab: "user",
  AdminTab:   "shield",
  ReportsTab: "bar-chart-2",
  MyTeamTab:  "users",
};

const TAB_ROOT_SCREENS: Record<string, string> = {
  HomeTab:    "Dashboard",
  TasksTab:   "Tasks",
  ProfileTab: "Profile",
  AdminTab:   "AdminDashboard",
  ReportsTab: "ReportsHub",
};

function CustomTabBar({ state, descriptors, navigation }: any) {
  const { theme, isDark } = useTheme();
  const { user } = useAuth();
  const { canOpenScreen, hasPermission, isDataAdmin, hasReports } = usePermissions();
  const insets = useSafeAreaInsets();
  const [isEscalationMember, setIsEscalationMember] = useState(false);
  const [hasTeamMembers, setHasTeamMembers] = useState(false);

  // Tabs follow access, not role names: full data access (role setting in the
  // Permission Manager), the screens' permissions, and the reporting line.
  useEffect(() => {
    if (!user?.id || isDataAdmin) return;
    supabase
      .from("escalation_matrix")
      .select("id")
      .eq("user_id", user.id)
      .limit(1)
      .then(({ data }: { data: any[] | null }) => setIsEscalationMember(!!data?.length));
  }, [user?.id, isDataAdmin]);

  // The HR Panel is shown when at least one of its screens can be opened
  // through the user's own grants or role (same rules the screens and the
  // database enforce). Access that comes only from managing a team is used
  // through My Team instead, so every manager does not get the HR Panel.
  const hasAnyAdminPermission = Object.keys(SCREEN_PERMISSIONS).some(
    (route) => route !== "TVDisplay" && !route.startsWith("Reports") && canOpenScreen(route, { ignoreManager: true }),
  );
  const canSeeAdmin = isDataAdmin || hasAnyAdminPermission;

  // Fallback for servers without get_my_access (hasReports comes from it).
  useEffect(() => {
    if (!user?.id || isDataAdmin || hasReports) {
      setHasTeamMembers(false);
      return;
    }
    supabase
      .from("profiles")
      .select("id")
      .eq("reports_to", user.id)
      .eq("is_active", true)
      .limit(1)
      .then(({ data }: { data: any[] | null }) => setHasTeamMembers(!!data?.length));
  }, [user?.id, isDataAdmin, hasReports]);

  const canSeeReports = isDataAdmin || hasPermission("reports.view");
  let filtered = state.routes.filter(
    (r: any) =>
      (r.name !== "AdminTab" || canSeeAdmin) && (r.name !== "ReportsTab" || canSeeReports),
  );

  // My Team: anyone with people reporting to them (or on the escalation
  // matrix); full-data-access roles use the HR Panel instead.
  const showMyTeam = !isDataAdmin && (hasReports || hasTeamMembers || isEscalationMember);
  const routesToShow = showMyTeam
    ? filtered
    : filtered.filter((r: any) => r.name !== "MyTeamTab");

  const bottomPad = Math.max(insets.bottom, Platform.OS === "android" ? 6 : 0);

  // Shared nav item renderer
  const renderItems = (desktop: boolean) =>
    routesToShow.map((route: any) => {
      const { options } = descriptors[route.key];
      const label = options.tabBarLabel ?? options.title ?? route.name;
      const isFocused = state.routes[state.index]?.name === route.name;
      const iconName  = TAB_ICONS[route.name] ?? "circle";
      const onPress   = () => {
        const event = navigation.emit({ type: "tabPress", target: route.key, canPreventDefault: true });
        if (event.defaultPrevented) return;
        const root = TAB_ROOT_SCREENS[route.name];
        const nested = route.state;
        if (!isFocused) {
          // No stale { screen } params: a tab opened earlier into one of its
          // screens (e.g. HR Panel → Attendance) must not reopen that screen.
          navigation.navigate(route.name);
          return;
        }
        // Tapping the tab you are already on returns to its first screen.
        // React Navigation only does this when the stack has history; a tab
        // opened straight onto a screen (link, URL, notification) has none,
        // so the press used to do nothing and only a reload helped.
        // When the stack starts at its first screen, the stack's own popToTop
        // handles the tap; otherwise reset it (after that handler has run).
        if (root && nested?.key && nested.routes?.[0]?.name !== root) {
          const target = nested.key;
          requestAnimationFrame(() => {
            navigation.dispatch({
              ...CommonActions.reset({ index: 0, routes: [{ name: root }] }),
              target,
            });
          });
        }
      };

      if (desktop) {
        return (
          <Pressable
            key={route.key}
            onPress={onPress}
            style={({ pressed }) => [
              styles.deskItem,
              isFocused && { backgroundColor: theme.primary + "14", borderRadius: 14 },
              { opacity: pressed ? 0.75 : 1 },
            ]}
            accessibilityRole="button"
            accessibilityState={{ selected: isFocused }}
          >
            <View style={[styles.deskIconWrap, isFocused && { backgroundColor: theme.primary + "1A", borderRadius: 10 }]}>
              <Feather name={iconName} size={20} color={isFocused ? theme.primary : theme.tabIconDefault} />
            </View>
            <ThemedText style={[
              styles.deskLabel,
              { color: isFocused ? theme.primary : theme.tabIconDefault, fontWeight: isFocused ? "700" : "400" },
            ]}>
              {typeof label === "string" ? label : route.name}
            </ThemedText>
          </Pressable>
        );
      }

      // Mobile item
      return (
        <Pressable
          key={route.key}
          onPress={onPress}
          style={styles.tabItem}
          accessibilityRole="button"
          accessibilityState={{ selected: isFocused }}
          accessibilityLabel={typeof label === "string" ? label : route.name}
        >
          <View style={[styles.tabPill, isFocused && { backgroundColor: theme.primary + "18", borderRadius: 20 }]}>
            <Feather name={iconName} size={20} color={isFocused ? theme.primary : theme.tabIconDefault} />
          </View>
          <ThemedText
            type="caption"
            style={[styles.tabLabel, { color: isFocused ? theme.primary : theme.tabIconDefault, fontWeight: isFocused ? "700" : "400" }]}
          >
            {label}
          </ThemedText>
        </Pressable>
      );
    });

  // Desktop: full-width bottom bar, nav buttons centered
  if (IS_WIDE) {
    return (
      <View style={[
        styles.deskBar,
        {
          backgroundColor: theme.backgroundDefault,
          borderTopColor:  isDark ? theme.border : "rgba(109,27,109,0.10)",
          paddingBottom:   insets.bottom,
        },
      ]}>
        <View style={[styles.topAccent, { backgroundColor: theme.primary + "30" }]} />
        <View style={styles.deskNav}>
          {renderItems(true)}
        </View>
      </View>
    );
  }

  // Mobile: bottom tab bar
  return (
    <View style={[
      styles.tabBarOuter,
      {
        backgroundColor: theme.backgroundDefault,
        paddingBottom:   bottomPad + 6,
        borderTopColor:  isDark ? theme.border : "rgba(109,27,109,0.08)",
      },
    ]}>
      <View style={[styles.topAccent, { backgroundColor: theme.primary + "30" }]} />
      <View style={styles.tabsRow}>
        {routesToShow.length > 0 && renderItems(false)}
      </View>
    </View>
  );
}

export default function MainTabNavigator() {
  const { user } = useAuth();
  const normalizedRole = normalizeUserRole(user?.role);
  const opensHRPanel = canAccessHRPanelRole(normalizedRole);

  return (
    <Tab.Navigator
      initialRouteName={opensHRPanel ? "AdminTab" : "HomeTab"}
      tabBar={(props) => <CustomTabBar {...props} />}
      screenOptions={{ headerShown: false }}
    >
      <Tab.Screen name="HomeTab"    component={HomeStackNavigator}    options={{ title: "Home" }} />
      <Tab.Screen name="TasksTab"   component={TasksStackNavigator}   options={{ title: "Tasks" }} />
      <Tab.Screen name="ProfileTab" component={ProfileStackNavigator} options={{ title: "Profile" }} />
      <Tab.Screen name="AdminTab"   component={AdminStackNavigator}   options={{ title: "HR Panel" }} />
      <Tab.Screen name="ReportsTab" component={ReportsStackNavigator} options={{ title: "Reports" }} />
      <Tab.Screen name="MyTeamTab"  component={MyTeamScreen}         options={{ title: "My Team" }} />
    </Tab.Navigator>
  );
}

const styles = StyleSheet.create({
  // Desktop bottom bar
  deskBar: {
    position:       "absolute",
    bottom:         0,
    left:           0,
    right:          0,
    height:         68,
    borderTopWidth: 1,
    justifyContent: "center",
    alignItems:     "center",
    ...(IS_WEB ? { boxShadow: "0 -4px 24px rgba(109,27,109,0.09)" } as any : {}),
  },
  deskNav: {
    flexDirection:  "row",
    alignItems:     "center",
    justifyContent: "center",   // <-- buttons centered
    gap:            4,
  },
  deskItem: {
    flexDirection:     "row",
    alignItems:        "center",
    gap:               8,
    paddingHorizontal: 18,
    paddingVertical:   10,
  },
  deskIconWrap: {
    width:          34,
    height:         34,
    alignItems:     "center",
    justifyContent: "center",
  },
  deskLabel: {
    fontSize:      14,
    letterSpacing: 0.1,
  },

  // Mobile bottom bar
  tabBarOuter: {
    position:       "absolute",
    bottom:         0,
    left:           0,
    right:          0,
    paddingTop:     6,
    borderTopWidth: 1,
    elevation:      14,
    ...(IS_WEB ? { boxShadow: "0 -3px 16px rgba(109,27,109,0.09)" } as any : {
      shadowColor:   "#6D1B6D",
      shadowOffset:  { width: 0, height: -3 },
      shadowOpacity: 0.09,
      shadowRadius:  16,
    }),
  },
  topAccent: {
    height:   1,
    position: "absolute",
    top:      0,
    left:     0,
    right:    0,
  },
  tabsRow: {
    flexDirection:     "row",
    justifyContent:    "space-around",
    paddingHorizontal: 8,
  },
  tabItem: {
    flex:            1,
    alignItems:      "center",
    paddingVertical: 2,
  },
  tabPill: {
    width:          50,
    height:         30,
    alignItems:     "center",
    justifyContent: "center",
    marginBottom:   2,
  },
  tabLabel: {
    fontSize:      10,
    letterSpacing: 0.1,
  },
});







