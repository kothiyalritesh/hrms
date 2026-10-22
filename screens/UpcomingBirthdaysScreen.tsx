import React, { useEffect, useState } from "react";
import { View, FlatList, StyleSheet, Platform, ActivityIndicator } from "react-native";
import Feather from "@expo/vector-icons/Feather";
import { useNavigation } from "@react-navigation/native";
import { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { usePermissions } from "@/hooks/usePermissions";
import { supabase } from "@/lib/supabase";
import { ThemedText } from "@/components/ThemedText";
import { PageHeader } from "@/components/PageHeader";
import { useTheme } from "@/hooks/useTheme";
import Spacer from "@/components/Spacer";
import { Spacing, BorderRadius } from "@/constants/theme";

type Birthday = { user_id: string; name: string; next_birthday: string };

function daysUntil(dateStr: string): number {
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const bday  = new Date(dateStr); bday.setHours(0, 0, 0, 0);
  return Math.round((bday.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
}

function BirthdayCard({ item }: { item: Birthday }) {
  const { theme } = useTheme();
  const days    = daysUntil(item.next_birthday);
  const isToday = days === 0;
  const accent  = isToday ? "#D97706" : theme.primary;

  return (
    <View style={[styles.card, { backgroundColor: theme.backgroundDefault, borderLeftColor: accent }]}>
      <View style={[styles.avatarCircle, { backgroundColor: accent + "18" }]}>
        <ThemedText style={{ fontSize: 20, color: accent }}>
          {item.name.charAt(0).toUpperCase()}
        </ThemedText>
      </View>
      <View style={{ flex: 1 }}>
        <ThemedText type="body" style={{ fontWeight: "700", color: theme.text }}>{item.name}</ThemedText>
        <ThemedText type="caption" style={{ color: theme.textSecondary, marginTop: 2 }}>
          {new Date(item.next_birthday).toLocaleDateString("en-IN", { day: "numeric", month: "long" })}
        </ThemedText>
      </View>
      <View style={[styles.daysBadge, { backgroundColor: isToday ? "#FEF3C7" : theme.backgroundSecondary }]}>
        {isToday
          ? <Feather name="gift" size={14} color="#D97706" />
          : <ThemedText type="caption" style={{ color: theme.primary, fontWeight: "700" }}>
              {days}d
            </ThemedText>
        }
      </View>
    </View>
  );
}

export default function UpcomingBirthdaysScreen() {
  const { theme } = useTheme();
    const navigation = useNavigation<NativeStackNavigationProp<any>>();
  // Only people allowed to see others' birthdays (View birthdays, or full data
  // access); the server returns only the people in their scope.
  const { canOpenScreen, loading: permissionsLoading } = usePermissions();
  const allowed = canOpenScreen("UpcomingBirthdays");
  const [birthdays, setBirthdays] = useState<Birthday[]>([]);
  const [loading,   setLoading]   = useState(true);

  useEffect(() => {
    if (!allowed) {
      setLoading(false);
      return;
    }
    supabase
      .from("upcoming_birthdays_30_days")
      .select("*")
      .then(({ data, error }: { data: Birthday[] | null; error: any }) => {
        if (!error) setBirthdays(data || []);
        setLoading(false);
      });
  }, [allowed]);

  if (!allowed && !permissionsLoading) {
    return (
      <View style={[styles.centered, { flex: 1, backgroundColor: theme.backgroundRoot }]}>
        <Feather name="lock" size={40} color={theme.textSecondary} />
        <Spacer height={Spacing.md} />
        <ThemedText type="body" style={{ color: theme.textSecondary, textAlign: "center" }}>
          Birthdays are visible to HR, administrators and people given the View birthdays permission.
        </ThemedText>
      </View>
    );
  }

  const today   = birthdays.filter((b) => daysUntil(b.next_birthday) === 0);
  const upcoming= birthdays.filter((b) => daysUntil(b.next_birthday) > 0);

  return (
    <View style={{ flex: 1, backgroundColor: theme.backgroundRoot }}>
      <PageHeader
        title="Upcoming Birthdays"
        subtitle={`${birthdays.length} birthday${birthdays.length !== 1 ? "s" : ""} in next 30 days`}
      />

      {loading
        ? <View style={styles.centered}>
            <ActivityIndicator size="large" color={theme.primary} />
          </View>
        : birthdays.length === 0
        ? <View style={styles.centered}>
            <Feather name="gift" size={44} color={theme.textSecondary} />
            <Spacer height={Spacing.md} />
            <ThemedText type="body" style={{ color: theme.textSecondary, textAlign: "center" }}>
              No upcoming birthdays
            </ThemedText>
          </View>
        : <FlatList
            data={birthdays}
            keyExtractor={(item) => item.user_id}
            contentContainerStyle={styles.list}
            ListHeaderComponent={
              today.length > 0
                ? <View style={[styles.todayBanner, { backgroundColor: "#FEF3C7", borderColor: "#F59E0B" }]}>
                    <Feather name="gift" size={16} color="#D97706" />
                    <ThemedText type="small" style={{ color: "#92400E", fontWeight: "700", flex: 1 }}>
                      {today.map((b) => b.name).join(", ")} {today.length === 1 ? "has" : "have"} a birthday today!
                    </ThemedText>
                  </View>
                : null
            }
            renderItem={({ item }) => <BirthdayCard item={item} />}
            ItemSeparatorComponent={() => <Spacer height={Spacing.sm} />}
          />
      }
    </View>
  );
}

const styles = StyleSheet.create({
  list: { padding: Spacing.lg },
  card: {
    flexDirection: "row", alignItems: "center",
    padding: Spacing.lg, borderRadius: 14, gap: Spacing.md,
    borderLeftWidth: 4,
    ...(Platform.OS === "web"
      ? { boxShadow: "0 2px 8px rgba(109,27,109,0.07)" }
      : { shadowColor: "#6D1B6D", shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.07, shadowRadius: 8, elevation: 2 }),
  },
  avatarCircle: {
    width: 44, height: 44, borderRadius: 22,
    alignItems: "center", justifyContent: "center",
  },
  daysBadge: {
    minWidth: 36, height: 28, borderRadius: 14,
    alignItems: "center", justifyContent: "center",
    paddingHorizontal: 8,
  },
  todayBanner: {
    flexDirection: "row", alignItems: "center", gap: Spacing.sm,
    padding: Spacing.md, borderRadius: 12, borderWidth: 1.5,
    marginBottom: Spacing.lg,
  },
  centered: {
    flex: 1, alignItems: "center", justifyContent: "center",
  },
});

