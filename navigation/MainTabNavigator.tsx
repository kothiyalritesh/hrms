import React, { useEffect, useState } from "react";
import { createBottomTabNavigator } from "@react-navigation/bottom-tabs";
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
import { ThemedText } from "@/components/ThemedText";
import { supabase } from "@/lib/supabase";
import {
  canAccessHRPanelRole,
  isAdminRole,
  isHRRole,
  normalizeUserRole,
} from "@/utils/userRole";

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

function CustomTabBar({ state, descriptors, navigation }: any) {
  const { theme, isDark } = useTheme();
  const { user } = useAuth();
  const insets = useSafeAreaInsets();

  const normalizedRole = normalizeUserRole(user?.role);
  const isAdmin = isAdminRole(normalizedRole);
  const isHR = isHRRole(normalizedRole);
  const [isEscalationMember, setIsEscalationMember] = useState(false);
  const [hasTeamMembers, setHasTeamMembers] = useState(false);

  const SALES_ROLES = [
    "SALES_EXECUTIVE","BDE","SENIOR_BDE","BDM","BDM_SALES",
    "ASSOCIATE_BDE","ASSOCIATE_BDM","ASSOCIATE_SALES_EXECUTIVE",
    "ASSOCIATE_PARTNER","SALES","TELECALLER","AGENT","CO-ORDINATOR",
  ];
  // SALES_MANAGER is intentionally excluded: managers with direct reports
  // receive the My Team tab and can monitor their assigned sales staff.
  const isSalesRole = SALES_ROLES.includes(normalizedRole);

  useEffect(() => {
    if (!user?.id || isAdmin || isHR || isSalesRole) return;
    supabase
      .from("escalation_matrix")
      .select("id")
      .eq("user_id", user.id)
      .limit(1)
      .then(({ data }: { data: any[] | null }) => setIsEscalationMember(!!data?.length));
  }, [user?.id, isAdmin, isHR, isSalesRole]);

  const canSeeAdmin = !isSalesRole && (isAdmin || isHR || isEscalationMember);

  // Check if user has team members
  useEffect(() => {
    if (!user?.id) {
      setHasTeamMembers(false);
      return;
    }
    // Hide My Team for admin roles completely
    if (isAdmin || isHR) {
      setHasTeamMembers(false);
      return;
    }
    if (isSalesRole) {
      setHasTeamMembers(false);
      return;
    }
    supabase
      .from("profiles")
      .select("id")
      .eq("reports_to", user.id)
      .eq("is_active", true)
      .then(({ data }: { data: any[] | null }) => setHasTeamMembers(!!data?.length));
  }, [user?.id, isAdmin, isHR, isSalesRole]);

  // Filter routes based on admin visibility
  let filtered = canSeeAdmin
    ? state.routes
    : state.routes.filter((r: any) => r.name !== "AdminTab" && r.name !== "ReportsTab");
  if (!isAdmin && !isHR) {
    filtered = filtered.filter((r: any) => r.name !== "ReportsTab");
  }

  // Filter out MyTeamTab if user doesn't have team members OR is admin/HR
  const showMyTeam = !isSalesRole && !isAdmin && !isHR && (isEscalationMember || hasTeamMembers);
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
        if (!isFocused && !event.defaultPrevented) navigation.navigate(route.name, route.params);
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
      // The key deliberately changes after an authoritative admin profile
      // replaces the restricted cached employee shell during session restore.
      // That remount sends privileged users to the HR panel after refresh too.
      key={opensHRPanel ? `hr-panel-${normalizedRole}` : "employee-panel"}
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
