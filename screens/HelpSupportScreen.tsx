import React, { useState } from 'react';
import { View, StyleSheet, ScrollView, TextInput, Alert, ActivityIndicator, Pressable } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { ThemedText } from '@/components/ThemedText';
import { ThemedView } from '@/components/ThemedView';
import { useTheme } from '@/hooks/useTheme';
import { Button } from '@/components/Button';
import Spacer from '@/components/Spacer';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/contexts/AuthContext';
import { Spacing, BorderRadius, Colors } from '@/constants/theme';
import { PageHeader } from '@/components/PageHeader';

export default function HelpSupportScreen() {
  const { theme } = useTheme();
  const navigation = useNavigation();
  const { user } = useAuth();
  
  const [activeTab, setActiveTab] = useState<'ticket' | 'suggestion'>('ticket');
  const [category, setCategory] = useState('Feedback');
  const [message, setMessage] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async () => {
    if (!message.trim()) return Alert.alert('Error', 'Please enter a message');
    
    setSubmitting(true);
    try {
      if (activeTab === 'ticket') {
        // Just mock raising a ticket for now as per plan
        await new Promise(r => setTimeout(r, 1000));
        Alert.alert('Ticket Submitted', 'IT / HR has been notified.');
      } else {
        // Suggestion Box - Anonymous Feedback
        const { error } = await supabase.from('anonymous_feedback').insert({
          category: category,
          message: message,
          org_id: (user as any)?.org_id || null
        });
        if (error) throw error;
        Alert.alert('Feedback Submitted', 'Your anonymous feedback has been recorded safely.');
      }
      setMessage('');
    } catch (err: any) {
      Alert.alert('Error', err.message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <ThemedView style={styles.container}>
      {/* Tabs */}
      <View style={[styles.tabs, { backgroundColor: theme.backgroundSecondary, borderColor: theme.border }]}>
        <Pressable 
          style={[styles.tab, activeTab === 'ticket' && { backgroundColor: theme.primary, borderColor: theme.primary }]}
          onPress={() => setActiveTab('ticket')}
        >
          <ThemedText style={{ color: activeTab === 'ticket' ? '#fff' : theme.textSecondary, fontWeight: '600' }}>Raise Ticket</ThemedText>
        </Pressable>
        <Pressable 
          style={[styles.tab, activeTab === 'suggestion' && { backgroundColor: theme.primary, borderColor: theme.primary }]}
          onPress={() => setActiveTab('suggestion')}
        >
          <ThemedText style={{ color: activeTab === 'suggestion' ? '#fff' : theme.textSecondary, fontWeight: '600' }}>Suggestion Box</ThemedText>
        </Pressable>
      </View>

      <ScrollView contentContainerStyle={{ padding: Spacing.lg }}>
        {activeTab === 'ticket' ? (
          <View>
            <ThemedText type="h4" style={{ marginBottom: Spacing.sm }}>Raise a Support Ticket</ThemedText>
            <ThemedText type="body" style={{ color: theme.textSecondary, marginBottom: Spacing.lg }}>
              Describe your issue with the app, device, or attendance. Your name and details will be attached.
            </ThemedText>
          </View>
        ) : (
          <View>
            <ThemedText type="h4" style={{ marginBottom: Spacing.sm }}>Anonymous Suggestion Box</ThemedText>
            <ThemedText type="body" style={{ color: theme.textSecondary, marginBottom: Spacing.lg }}>
              Share your thoughts, feedback, or complaints anonymously. No one can see you.
            </ThemedText>
            
            <ThemedText type="caption" style={{ color: theme.textSecondary, marginBottom: 8 }}>Category</ThemedText>
            <View style={styles.chipContainer}>
              {['Feedback', 'Complaint', 'Culture', 'Facilities', 'Other'].map(cat => (
                <Pressable
                  key={cat}
                  style={[styles.chip, { backgroundColor: category === cat ? Colors.light.primary : theme.backgroundSecondary }]}
                  onPress={() => setCategory(cat)}
                >
                  <ThemedText type="caption" style={{ color: category === cat ? '#fff' : theme.text, fontWeight: '600' }}>{cat}</ThemedText>
                </Pressable>
              ))}
            </View>
            <Spacer height={Spacing.md} />
          </View>
        )}

        <ThemedText type="caption" style={{ color: theme.textSecondary, marginBottom: 8 }}>Message</ThemedText>
        <TextInput
          style={[styles.input, { color: theme.text, borderColor: theme.border, backgroundColor: theme.backgroundDefault }]}
          placeholder="Type your message here..."
          placeholderTextColor={theme.textSecondary}
          multiline
          numberOfLines={6}
          textAlignVertical="top"
          value={message}
          onChangeText={setMessage}
        />

        <Spacer height={Spacing.xl} />
        
        <Button 
          title={submitting ? "Submitting..." : (activeTab === 'ticket' ? "Submit Ticket" : "Submit Anonymously")}
          onPress={handleSubmit}
          disabled={submitting || !message.trim()}
        />
      </ScrollView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  tabs: { flexDirection: 'row', margin: Spacing.md, padding: 4, borderRadius: BorderRadius.md, borderWidth: 1 },
  tab: { flex: 1, paddingVertical: Spacing.sm, alignItems: 'center', borderRadius: BorderRadius.sm },
  input: {
    borderWidth: 1,
    borderRadius: BorderRadius.md,
    padding: Spacing.md,
    fontSize: 16,
    minHeight: 120,
  },
  chipContainer: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { paddingHorizontal: 16, paddingVertical: 8, borderRadius: 20 },
});
