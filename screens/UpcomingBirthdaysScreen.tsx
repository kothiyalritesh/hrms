import React, { useEffect, useState } from "react";
import { View, FlatList, StyleSheet } from "react-native";
import { supabase } from "@/lib/supabase";
import { ThemedText } from "@/components/ThemedText";
import Spacer from "@/components/Spacer";
import { Spacing, BorderRadius } from "@/constants/theme";
import { useTheme } from "@/hooks/useTheme";

type Birthday = {
  user_id: string;
  name: string;
  next_birthday: string;
};

export default function UpcomingBirthdaysScreen() {
  const { theme } = useTheme();
  const [birthdays, setBirthdays] = useState<Birthday[]>([]);
  const [loading, setLoading] = useState(true);

  const loadBirthdays = async () => {
    const { data, error } = await supabase
      .from("upcoming_birthdays_30_days")
      .select("*");

    if (error) {
      console.error("Birthday fetch error:", error);
    } else {
      setBirthdays(data || []);
    }
    setLoading(false);
  };

  useEffect(() => {
    loadBirthdays();
  }, []);

  if (loading) {
    return <ThemedText>Loading birthdays...</ThemedText>;
  }

  if (birthdays.length === 0) {
    return (
      <View style={styles.empty}>
        <ThemedText>No upcoming birthdays 🎂</ThemedText>
      </View>
    );
  }

  return (
    <FlatList
      contentContainerStyle={styles.list}
      data={birthdays}
      keyExtractor={(item) => item.user_id}
      renderItem={({ item }) => (
        <View style={[styles.card, { backgroundColor: theme.backgroundDefault }]}>
          <ThemedText type="body">{item.name}</ThemedText>
          <Spacer height={Spacing.xs} />
          <ThemedText type="caption">
            🎂 {new Date(item.next_birthday).toDateString()}
          </ThemedText>
        </View>
      )}
    />
  );
}

const styles = StyleSheet.create({
  list: {
    padding: Spacing.lg,
  },
  card: {
    padding: Spacing.lg,
    borderRadius: BorderRadius.md,
    marginBottom: Spacing.md,
  },
  empty: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
  },
});
