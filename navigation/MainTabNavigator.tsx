import React from "react";
import { createBottomTabNavigator } from "@react-navigation/bottom-tabs";
import { Feather } from "@expo/vector-icons";
import { Platform, StyleSheet, View, Pressable } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import HomeStackNavigator from "@/navigation/HomeStackNavigator";
import TasksStackNavigator from "@/navigation/TasksStackNavigator";
import ProfileStackNavigator from "@/navigation/ProfileStackNavigator";
import AdminStackNavigator from "@/navigation/AdminStackNavigator";
import { useTheme } from "@/hooks/useTheme";
import { useAuth } from "@/contexts/AuthContext";
import { ThemedText } from "@/components/ThemedText";

export type MainTabParamList = {
  HomeTab: undefined;
  TasksTab: { taskId?: string } | undefined;
  ProfileTab: undefined;
  AdminTab: undefined;
};

const Tab = createBottomTabNavigator<MainTabParamList>();

function CustomTabBar({ state, descriptors, navigation }: any) {
  const { theme } = useTheme();
  const { user } = useAuth();
  const isAdmin = ["SYSTEM_ADMIN", "ADMIN", "HR", "HRD"].includes(user?.role ?? "");

  const filteredRoutes = isAdmin
    ? state.routes
    : state.routes.filter((route: any) => route.name !== "AdminTab");

  const insets = useSafeAreaInsets();
  const bottomPad = Math.max(insets.bottom, Platform.OS === "android" ? 8 : 0);

  return (
    <>
      <View style={[styles.tabBarContainer, { backgroundColor: theme.backgroundRoot, paddingBottom: bottomPad + 8 }]}>
        <View style={styles.tabsContainer}>
          {filteredRoutes.map((route: any, index: number) => {
            const { options } = descriptors[route.key];
            const label =
              options.tabBarLabel !== undefined
                ? options.tabBarLabel
                : options.title !== undefined
                  ? options.title
                  : route.name;
            const isFocused = state.index === index;

            const onPress = () => {
              const event = navigation.emit({
                type: "tabPress",
                target: route.key,
                canPreventDefault: true,
              });
              if (!isFocused && !event.defaultPrevented) {
                navigation.navigate(route.name, route.params);
              }
            };

            return (
              <Pressable
                key={route.key}
                onPress={onPress}
                style={styles.tabItem}
              >
                <View style={[styles.tabIconWrapper, isFocused && { backgroundColor: theme.tabIconSelected + "18" }]}>
                  {options.tabBarIcon({
                    color: isFocused ? theme.tabIconSelected : theme.tabIconDefault,
                    size: 22,
                  })}
                </View>
                <ThemedText
                  type="caption"
                  style={[
                    styles.tabLabel,
                    { color: isFocused ? theme.tabIconSelected : theme.tabIconDefault, fontWeight: isFocused ? "700" : "400" },
                  ]}
                >
                  {label}
                </ThemedText>
              </Pressable>
            );
          })}
        </View>
      </View>
    </>
  );
}

export default function MainTabNavigator() {
  const { theme, isDark } = useTheme();

  return (
    <Tab.Navigator
      initialRouteName="HomeTab"
      tabBar={(props) => <CustomTabBar {...props} />}
      screenOptions={{
        headerShown: false,
      }}
    >
      <Tab.Screen
        name="HomeTab"
        component={HomeStackNavigator}
        options={{
          title: "Home",
          tabBarIcon: ({ color, size }) => (
            <Feather name="home" size={size} color={color} />
          ),
        }}
      />
      <Tab.Screen
        name="TasksTab"
        component={TasksStackNavigator}
        options={{
          title: "Tasks",
          tabBarIcon: ({ color, size }) => (
            <Feather name="check-square" size={size} color={color} />
          ),
        }}
      />
      <Tab.Screen
        name="ProfileTab"
        component={ProfileStackNavigator}
        options={{
          title: "Profile",
          tabBarIcon: ({ color, size }) => (
            <Feather name="user" size={size} color={color} />
          ),
        }}
      />
      <Tab.Screen
        name="AdminTab"
        component={AdminStackNavigator}
        options={{
          title: "Admin",
          tabBarIcon: ({ color, size }) => (
            <Feather name="settings" size={size} color={color} />
          ),
        }}
      />
    </Tab.Navigator>
  );
}

const styles = StyleSheet.create({
  tabBarContainer: {
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
    paddingTop: 10,
    paddingHorizontal: 16,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    shadowColor: "#60045d",
    shadowOffset: { width: 0, height: -2 },
    shadowOpacity: 0.08,
    shadowRadius: 8,
    elevation: 10,
  },
  tabsContainer: {
    flexDirection: "row",
    justifyContent: "space-around",
  },
  tabItem: {
    alignItems: "center",
    paddingVertical: 4,
    flex: 1,
  },
  tabIconWrapper: {
    width: 44,
    height: 32,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 2,
  },
  tabLabel: {
    fontSize: 10,
    marginTop: 0,
  },
});
