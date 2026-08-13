import React from 'react';
import { View, StyleSheet, Pressable } from 'react-native';
import Feather from '@expo/vector-icons/Feather';
import { ThemedText } from '@/components/ThemedText';
import { Card } from '@/components/Card';
import { useTheme } from '@/hooks/useTheme';
import { Colors } from '@/constants/theme';

interface SmartOfficeActionCardProps {
  onImportFromSmartOffice: () => void;
  onAddManually: () => void;
  onDownloadSample: () => void;
  onBulkUpload: () => void;
  smartOfficeStatus: 'connected' | 'error' | 'unknown';
  isLoading?: boolean;
}

export function SmartOfficeActionCard({
  onImportFromSmartOffice,
  onAddManually,
  onDownloadSample,
  onBulkUpload,
  smartOfficeStatus,
  isLoading = false,
}: SmartOfficeActionCardProps) {
  const { theme } = useTheme();

  const getStatusColor = () => {
    switch (smartOfficeStatus) {
      case 'connected': return Colors.light.success;
      case 'error': return Colors.light.error;
      default: return Colors.light.warning;
    }
  };

  const getStatusText = () => {
    switch (smartOfficeStatus) {
      case 'connected': return 'SmartOffice Connected';
      case 'error': return 'SmartOffice Disconnected';
      default: return 'Testing Connection...';
    }
  };

  return (
    <Card style={styles.container}>
      <View style={styles.header}>
        <ThemedText style={styles.title}>Employee Import Options</ThemedText>
        <ThemedText style={styles.subtitle}>Choose how you want to import employees</ThemedText>
      </View>

      {/* SmartOffice Status */}
      <View style={[styles.statusContainer, { backgroundColor: getStatusColor() + '15' }]}>
        <View style={styles.statusRow}>
          <Feather
            name={smartOfficeStatus === 'connected' ? 'check-circle' : smartOfficeStatus === 'error' ? 'x-circle' : 'clock'}
            size={20}
            color={getStatusColor()}
          />
          <View style={styles.statusTextContainer}>
            <ThemedText style={[styles.statusTitle, { color: getStatusColor() }]}>
              {getStatusText()}
            </ThemedText>
            <ThemedText style={styles.statusSubtitle}>
              {smartOfficeStatus === 'connected'
                ? 'Protected server integration is available'
                : smartOfficeStatus === 'error'
                  ? 'Check the protected server integration'
                  : 'Checking connection status...'}
            </ThemedText>
          </View>
        </View>
      </View>

      {/* Import Methods */}
      <View style={styles.section}>
        <View style={styles.sectionHeader}>
          <Feather name="zap" size={16} color={Colors.light.primary} />
          <ThemedText style={styles.sectionTitle}>🚀 Import Methods</ThemedText>
        </View>

        {/* SmartOffice Import */}
        <Pressable
          style={[
            styles.actionButton,
            {
              backgroundColor: smartOfficeStatus === 'connected' ? Colors.light.success + '10' : Colors.light.backgroundSecondary + '10',
              borderColor: smartOfficeStatus === 'connected' ? Colors.light.success : Colors.light.backgroundSecondary,
              opacity: smartOfficeStatus === 'connected' && !isLoading ? 1 : 0.6,
            },
          ]}
          onPress={onImportFromSmartOffice}
          disabled={smartOfficeStatus !== 'connected' || isLoading}
        >
          <View style={styles.actionContent}>
            <View style={styles.actionHeader}>
              <Feather
                name="download-cloud"
                size={24}
                color={smartOfficeStatus === 'connected' ? Colors.light.success : Colors.light.backgroundSecondary}
              />
              <ThemedText style={[
                styles.actionTitle,
                { color: smartOfficeStatus === 'connected' ? Colors.light.success : Colors.light.backgroundSecondary },
              ]}>
                Import from SmartOffice (Recommended)
              </ThemedText>
            </View>
            <ThemedText style={styles.actionDescription}>
              Automatically fetch all employees with their SmartOffice employee codes
            </ThemedText>
            <View style={styles.smartCodeContainer}>
              <ThemedText style={styles.smartCodeLabel}>Smart Codes Available:</ThemedText>
              <ThemedText style={[styles.smartCodeValue, { color: Colors.light.primary }]}>
                Protected connection • Auto-sync enabled
              </ThemedText>
            </View>
          </View>
          <Feather name="chevron-right" size={20} color={theme.textSecondary} />
        </Pressable>

        {/* Manual Import */}
        <Pressable
          style={[
            styles.actionButton,
            {
              backgroundColor: Colors.light.primary + '10',
              borderColor: Colors.light.primary,
            },
          ]}
          onPress={onAddManually}
          disabled={isLoading}
        >
          <View style={styles.actionContent}>
            <View style={styles.actionHeader}>
              <Feather name="user-plus" size={24} color={Colors.light.primary} />
              <ThemedText style={[styles.actionTitle, { color: Colors.light.primary }]}>
                Add employees one by one
              </ThemedText>
            </View>
            <ThemedText style={styles.actionDescription}>
              Add employees individually with their SmartOffice employee codes
            </ThemedText>
            <View style={styles.smartCodeContainer}>
              <ThemedText style={styles.smartCodeLabel}>Required Fields:</ThemedText>
              <ThemedText style={[styles.smartCodeValue, { color: Colors.light.primary }]}>
                Name • Phone • Employee Code • Role
              </ThemedText>
            </View>
          </View>
          <Feather name="chevron-right" size={20} color={theme.textSecondary} />
        </Pressable>

        {/* Bulk Upload */}
        <Pressable
          style={[
            styles.actionButton,
            {
              backgroundColor: Colors.light.info + '10',
              borderColor: Colors.light.info,
            },
          ]}
          onPress={onBulkUpload}
          disabled={isLoading}
        >
          <View style={styles.actionContent}>
            <View style={styles.actionHeader}>
              <Feather name="upload" size={24} color={Colors.light.info} />
              <ThemedText style={[styles.actionTitle, { color: Colors.light.info }]}>
                Bulk upload via CSV/Excel
              </ThemedText>
            </View>
            <ThemedText style={styles.actionDescription}>
              Upload multiple employees using CSV or Excel file
            </ThemedText>
            <View style={styles.smartCodeContainer}>
              <ThemedText style={styles.smartCodeLabel}>Supported Columns:</ThemedText>
              <ThemedText style={[styles.smartCodeValue, { color: Colors.light.info }]}>
                SN • Name • Contact • Team • Designation • Office
              </ThemedText>
            </View>
          </View>
          <Feather name="chevron-right" size={20} color={theme.textSecondary} />
        </Pressable>

        {/* Sample Download */}
        <Pressable
          style={[
            styles.actionButton,
            styles.sampleButton,
            {
              backgroundColor: Colors.light.warning + '10',
              borderColor: Colors.light.warning,
            },
          ]}
          onPress={onDownloadSample}
        >
          <View style={styles.actionContent}>
            <View style={styles.actionHeader}>
              <Feather name="download" size={20} color={Colors.light.warning} />
              <ThemedText style={[styles.sampleTitle, { color: Colors.light.warning }]}>
                Download Sample CSV Template
              </ThemedText>
            </View>
            <ThemedText style={styles.sampleDescription}>
              Get the correct format for bulk upload
            </ThemedText>
          </View>
          <Feather name="external-link" size={16} color={Colors.light.warning} />
        </Pressable>
      </View>

      {/* Current Status */}
      <View style={styles.section}>
        <View style={styles.sectionHeader}>
          <Feather name="info" size={16} color={Colors.light.info} />
          <ThemedText style={styles.sectionTitle}>📋 Current Status</ThemedText>
        </View>

        <View style={styles.statusGrid}>
          <View style={styles.statusItem}>
            <ThemedText style={styles.statusItemLabel}>SmartOffice Server:</ThemedText>
            <View style={styles.statusBadge}>
              <Feather
                name={smartOfficeStatus === 'connected' ? 'check' : 'x'}
                size={12}
                color={smartOfficeStatus === 'connected' ? Colors.light.success : Colors.light.error}
              />
              <ThemedText style={[
                styles.statusBadgeText,
                { color: smartOfficeStatus === 'connected' ? Colors.light.success : Colors.light.error },
              ]}>
                {smartOfficeStatus === 'connected' ? 'Reachable' : 'Unreachable'}
              </ThemedText>
            </View>
          </View>

          <View style={styles.statusItem}>
            <ThemedText style={styles.statusItemLabel}>Connection Type:</ThemedText>
            <ThemedText style={styles.statusItemValue}>Web Interface</ThemedText>
          </View>

          <View style={styles.statusItem}>
            <ThemedText style={styles.statusItemLabel}>API Access:</ThemedText>
            <ThemedText style={[
              styles.statusItemValue,
              { color: smartOfficeStatus === 'connected' ? Colors.light.success : Colors.light.error },
            ]}>
              {smartOfficeStatus === 'connected' ? 'Available' : 'Not Available'}
            </ThemedText>
          </View>

          <View style={styles.statusItem}>
            <ThemedText style={styles.statusItemLabel}>Recommended Action:</ThemedText>
            <ThemedText style={[styles.statusItemValue, { color: Colors.light.primary, fontWeight: '600' }]}>
              {smartOfficeStatus === 'connected' ? 'Auto Import' : 'Manual Import'}
            </ThemedText>
          </View>
        </View>
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
  container: {
    padding: 20,
    margin: 16,
  },
  header: {
    marginBottom: 20,
    alignItems: 'center',
  },
  title: {
    fontSize: 20,
    fontWeight: '700',
    marginBottom: 4,
    textAlign: 'center',
  },
  subtitle: {
    fontSize: 14,
    opacity: 0.7,
    textAlign: 'center',
  },
  statusContainer: {
    padding: 16,
    borderRadius: 12,
    marginBottom: 20,
  },
  statusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  statusTextContainer: {
    flex: 1,
  },
  statusTitle: {
    fontSize: 16,
    fontWeight: '600',
    marginBottom: 2,
  },
  statusSubtitle: {
    fontSize: 12,
    opacity: 0.7,
  },
  section: {
    marginBottom: 20,
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 12,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '600',
  },
  actionButton: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 16,
    borderRadius: 12,
    borderWidth: 1,
    marginBottom: 12,
  },
  sampleButton: {
    padding: 12,
  },
  actionContent: {
    flex: 1,
  },
  actionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginBottom: 8,
  },
  actionTitle: {
    fontSize: 16,
    fontWeight: '600',
    flex: 1,
  },
  sampleTitle: {
    fontSize: 14,
    fontWeight: '600',
  },
  actionDescription: {
    fontSize: 14,
    opacity: 0.7,
    marginBottom: 8,
    lineHeight: 20,
  },
  sampleDescription: {
    fontSize: 12,
    opacity: 0.7,
  },
  smartCodeContainer: {
    marginTop: 4,
  },
  smartCodeLabel: {
    fontSize: 12,
    fontWeight: '500',
    opacity: 0.8,
    marginBottom: 2,
  },
  smartCodeValue: {
    fontSize: 12,
    fontWeight: '600',
  },
  statusGrid: {
    gap: 12,
  },
  statusItem: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  statusItemLabel: {
    fontSize: 14,
    fontWeight: '500',
    opacity: 0.7,
  },
  statusItemValue: {
    fontSize: 14,
    fontWeight: '500',
  },
  statusBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  statusBadgeText: {
    fontSize: 12,
    fontWeight: '600',
  },
});
