import React, { useState, useCallback } from 'react';
import { View, StyleSheet, FlatList, ActivityIndicator } from 'react-native';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { ThemedText } from '@/components/ThemedText';
import { ThemedView } from '@/components/ThemedView';
import { useTheme } from '@/hooks/useTheme';
import { supabase } from '@/lib/supabase';
import { Spacing, BorderRadius, Colors } from '@/constants/theme';
import Spacer from '@/components/Spacer';
import { PaginationControls } from '@/components/PaginationControls';
import Feather from '@expo/vector-icons/Feather';

const PAGE_SIZE = 20;

export default function AnonymousFeedbackScreen() {
  const { theme } = useTheme();
  const navigation = useNavigation();
  
  const [feedback, setFeedback] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [page, setPage] = useState(0);
  const [total, setTotal] = useState(0);

  const loadData = async (requestedPage = page) => {
    setLoading(true);
    try {
      const from = requestedPage * PAGE_SIZE;
      const to = from + PAGE_SIZE - 1;
      
      const { data, error, count } = await supabase
        .from('anonymous_feedback')
        .select('*', { count: 'exact' })
        .order('created_at', { ascending: false })
        .range(from, to);
        
      if (error) throw error;
      setFeedback(data || []);
      setTotal(count || 0);
      setPage(requestedPage);
    } catch (err) {
      console.warn("Failed to load feedback", err);
    } finally {
      setLoading(false);
    }
  };

  useFocusEffect(useCallback(() => { void loadData(0); }, []));

  return (
    <ThemedView style={styles.container}>
      <View style={{ padding: Spacing.lg, paddingBottom: 0 }}>
        <ThemedText type="h3">Anonymous Feedback</ThemedText>
        <ThemedText type="caption" style={{ color: theme.textSecondary }}>
          Suggestions and complaints from employees. Identities are hidden by design.
        </ThemedText>
      </View>

      {loading && feedback.length === 0 ? (
        <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
          <ActivityIndicator color={theme.primary} />
        </View>
      ) : (
        <FlatList
          contentContainerStyle={{ padding: Spacing.lg }}
          data={feedback}
          keyExtractor={item => item.id}
          renderItem={({ item }) => (
            <View style={[styles.card, { backgroundColor: theme.backgroundDefault, borderColor: theme.border }]}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                <View style={[styles.badge, { backgroundColor: Colors.light.primary + '20' }]}>
                  <ThemedText style={{ fontSize: 11, fontWeight: '700', color: Colors.light.primary }}>
                    {item.category.toUpperCase()}
                  </ThemedText>
                </View>
                <ThemedText type="caption" style={{ color: theme.textSecondary }}>
                  {new Date(item.created_at).toLocaleString()}
                </ThemedText>
              </View>
              
              <ThemedText type="body" style={{ color: theme.text, lineHeight: 22 }}>
                "{item.message}"
              </ThemedText>
              
              <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 12 }}>
                <Feather name="user-x" size={14} color={theme.textSecondary} style={{ marginRight: 6 }} />
                <ThemedText type="caption" style={{ color: theme.textSecondary, fontStyle: 'italic' }}>
                  Anonymous Submitter
                </ThemedText>
              </View>
            </View>
          )}
          ItemSeparatorComponent={() => <Spacer height={Spacing.md} />}
          ListEmptyComponent={
            <ThemedText style={{ textAlign: 'center', color: theme.textSecondary, marginTop: 40 }}>
              No anonymous feedback received yet.
            </ThemedText>
          }
        />
      )}

      {total > PAGE_SIZE && (
        <View style={{ padding: Spacing.md, borderTopWidth: 1, borderTopColor: theme.border }}>
          <PaginationControls
            page={page}
            pageSize={PAGE_SIZE} total={total}
            onPageChange={loadData}
          />
        </View>
      )}
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  card: { padding: Spacing.lg, borderRadius: BorderRadius.md, borderWidth: 1 },
  badge: { paddingHorizontal: 8, paddingVertical: 4, borderRadius: 12 },
});
