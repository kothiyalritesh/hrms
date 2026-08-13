import React, { useState, useEffect } from 'react';
import {
  View,
  StyleSheet,
  Alert,
  ScrollView,
  RefreshControl,
  FlatList,
  Text,
  Pressable,
} from 'react-native';
import Feather from '@expo/vector-icons/Feather';
import { ThemedText } from '@/components/ThemedText';
import { ThemedView } from '@/components/ThemedView';
import { Button } from '@/components/Button';
import { Card } from '@/components/Card';
import { PageHeader } from '@/components/PageHeader';
import { useTheme } from '@/hooks/useTheme';
import { smartOfficeService } from '@/services/smartoffice.service';

interface EmployeeMatch {
  localEmployee: {
    id: string;
    name: string;
    email?: string;
    phone?: string;
    employee_number?: string;
  };
  smartOfficeEmployee?: {
    employee_code: string;
    name: string;
    email?: string;
    phone?: string;
    department?: string;
    designation?: string;
  };
  matchStatus: 'MATCHED' | 'NOT_FOUND' | 'MULTIPLE_MATCHES' | 'PENDING';
  confidence?: number;
}

interface SyncResult {
  totalLocal: number;
  totalSmartOffice: number;
  matched: number;
  notFound: number;
  multipleMatches: number;
  lastSync?: string;
}

export function SmartOfficeIntegrationScreen() {
  const { theme } = useTheme();
  const [isLoading, setIsLoading] = useState(false);
  const [employees, setEmployees] = useState<EmployeeMatch[]>([]);
  const [syncResult, setSyncResult] = useState<SyncResult | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const loadEmployees = async () => {
    // This would load the current matching status
    // For now, we'll load when sync is performed
  };

  const handleTestConnection = async () => {
    setIsLoading(true);
    try {
      const result = await smartOfficeService.testConnection();
      
      if (result.success) {
        Alert.alert(
          'Connection Successful! ✓',
          `${result.message}\n\nSmartOffice API is working correctly.\nYou can now import employees.`
        );
      } else {
        Alert.alert(
          'Connection Failed ✗',
          `${result.message}\n\nPlease check your SmartOffice server and try again.`
        );
      }
    } catch (error: any) {
      Alert.alert(
        'Connection Error',
        `Unable to connect to SmartOffice:\n\n${error.message}`
      );
    } finally {
      setIsLoading(false);
    }
  };

  const handleSync = async () => {
    setIsLoading(true);
    try {
      // Step 1: Test connection first
      Alert.alert('Testing Connection...', 'Connecting to SmartOffice API...');
      
      const testResult = await smartOfficeService.testConnection();
      
      if (!testResult.success) {
        throw new Error(testResult.message);
      }

      Alert.alert(
        'Connection Successful!', 
        testResult.message,
        [
          {
            text: 'Continue Sync', 
            onPress: async () => {
              await performFullSync();
            }
          },
          { text: 'Cancel', style: 'cancel' }
        ]
      );
      
    } catch (error: any) {
      Alert.alert(
        'Connection Failed', 
        `Could not connect to SmartOffice API:\n\n${error.message}\n\nPlease check:\n• Network connection\n• SmartOffice server is running\n• API key is correct`
      );
    } finally {
      setIsLoading(false);
    }
  };

  const performFullSync = async () => {
    setIsLoading(true);
    try {
      // Step 1: Get employees from both systems
      Alert.alert('Syncing...', 'Fetching employees from SmartOffice and local database...');
      
      const [smartOfficeEmployees, localStats] = await Promise.all([
        smartOfficeService.getEmployeeDetails(),
        smartOfficeService.getSyncStatus()
      ]);

      if (!smartOfficeEmployees || !Array.isArray(smartOfficeEmployees)) {
        throw new Error('Could not fetch SmartOffice employees');
      }

      // Step 2: Perform auto-matching
      const matchResult = await smartOfficeService.autoMatchEmployees();
      
      // Step 3: Create employee list with match status
      const employeeMatches: EmployeeMatch[] = [];
      
      // Add matched employees
      for (let i = 0; i < Math.min(50, smartOfficeEmployees.length); i++) {
        const soEmp = smartOfficeEmployees[i];
        employeeMatches.push({
          localEmployee: {
            id: `so_${soEmp.employee_code}`,
            name: soEmp.name,
            email: soEmp.email,
            phone: soEmp.phone,
            employee_number: soEmp.employee_code,
          },
          smartOfficeEmployee: soEmp,
          matchStatus: 'MATCHED',
          confidence: 100
        });
      }

      setEmployees(employeeMatches);
      setSyncResult({
        totalLocal: localStats.totalLocal,
        totalSmartOffice: smartOfficeEmployees.length,
        matched: matchResult.matched,
        notFound: smartOfficeEmployees.length - matchResult.matched,
        multipleMatches: matchResult.suggestions.length,
        lastSync: new Date().toISOString(),
      });

      Alert.alert(
        'Sync Complete!',
        `Found ${smartOfficeEmployees.length} SmartOffice employees\n` +
        `Auto-matched: ${matchResult.matched}\n` +
        `Need review: ${matchResult.suggestions.length}`
      );
      
    } catch (error: any) {
      Alert.alert('Sync Failed', error.message || 'Unknown error occurred');
    } finally {
      setIsLoading(false);
    }
  };

  const onRefresh = async () => {
    setRefreshing(true);
    await loadEmployees();
    setRefreshing(false);
  };

  const renderEmployeeItem = ({ item }: { item: EmployeeMatch }) => {
    const getStatusColor = () => {
      switch (item.matchStatus) {
        case 'MATCHED': return theme.success;
        case 'NOT_FOUND': return theme.error;
        case 'MULTIPLE_MATCHES': return theme.warning;
        default: return theme.textSecondary;
      }
    };

    const getStatusIcon = () => {
      switch (item.matchStatus) {
        case 'MATCHED': return 'check-circle';
        case 'NOT_FOUND': return 'x-circle';
        case 'MULTIPLE_MATCHES': return 'alert-triangle';
        default: return 'clock';
      }
    };

    return (
      <Card style={styles.employeeCard}>
        <View style={styles.employeeRow}>
          <View style={styles.employeeInfo}>
            <ThemedText style={styles.employeeName}>
              {item.localEmployee.name}
            </ThemedText>
            <ThemedText style={styles.employeeDetails}>
              {item.localEmployee.phone || 'No phone'} • {item.localEmployee.employee_number || 'No ID'}
            </ThemedText>
            {item.smartOfficeEmployee && (
              <ThemedText style={styles.smartOfficeDetails}>
                SO: {item.smartOfficeEmployee.name} ({item.smartOfficeEmployee.employee_code})
              </ThemedText>
            )}
          </View>
          
          <View style={styles.statusContainer}>
            <Feather 
              name={getStatusIcon() as any} 
              size={24} 
              color={getStatusColor()} 
            />
            <ThemedText style={[styles.statusText, { color: getStatusColor() }]}>
              {item.matchStatus.replace('_', ' ')}
            </ThemedText>
          </View>
        </View>
      </Card>
    );
  };

  return (
    <ThemedView style={styles.container}>
      <PageHeader title="SmartOffice Employee Sync" />
      
      <ScrollView
        style={styles.content}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} />
        }
      >
        {/* Sync Button */}
        <Card style={styles.syncCard}>
          <ThemedText style={styles.syncTitle}>Employee Import & Matching</ThemedText>
          <ThemedText style={styles.syncSubtitle}>
            Import employees from SmartOffice biometric system and match with local database
          </ThemedText>
          
          <View style={styles.buttonContainer}>
            <Button
              title="Test Connection"
              onPress={handleTestConnection}
              loading={isLoading}
              variant="secondary"
              style={styles.testButton}
            />
            
            <Button
              title="Import & Match Employees"
              onPress={handleSync}
              loading={isLoading}
              style={styles.syncButton}
            />
          </View>
        </Card>

        {/* Sync Results Summary */}
        {syncResult && (
          <Card style={styles.resultsCard}>
            <ThemedText style={styles.resultsTitle}>Sync Results</ThemedText>
            
            <View style={styles.resultsGrid}>
              <View style={styles.resultItem}>
                <ThemedText style={styles.resultNumber}>{syncResult.totalSmartOffice}</ThemedText>
                <ThemedText style={styles.resultLabel}>SmartOffice Employees</ThemedText>
              </View>
              
              <View style={styles.resultItem}>
                <ThemedText style={[styles.resultNumber, { color: theme.success }]}>
                  {syncResult.matched}
                </ThemedText>
                <ThemedText style={styles.resultLabel}>Matched</ThemedText>
              </View>
              
              <View style={styles.resultItem}>
                <ThemedText style={[styles.resultNumber, { color: theme.error }]}>
                  {syncResult.notFound}
                </ThemedText>
                <ThemedText style={styles.resultLabel}>Not Found</ThemedText>
              </View>
              
              <View style={styles.resultItem}>
                <ThemedText style={[styles.resultNumber, { color: theme.warning }]}>
                  {syncResult.multipleMatches}
                </ThemedText>
                <ThemedText style={styles.resultLabel}>Need Review</ThemedText>
              </View>
            </View>
            
            <ThemedText style={styles.lastSync}>
              Last sync: {new Date(syncResult.lastSync || '').toLocaleString()}
            </ThemedText>
          </Card>
        )}

        {/* Employee List */}
        {employees.length > 0 && (
          <Card style={styles.listCard}>
            <ThemedText style={styles.listTitle}>
              Employees ({employees.length})
            </ThemedText>
            
            <FlatList
              data={employees}
              renderItem={renderEmployeeItem}
              keyExtractor={(item) => item.localEmployee.id}
              scrollEnabled={false}
              style={styles.employeeList}
            />
          </Card>
        )}
      </ScrollView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  content: {
    flex: 1,
    padding: 16,
  },
  syncCard: {
    marginBottom: 16,
    padding: 20,
    alignItems: 'center',
  },
  syncTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    marginBottom: 8,
  },
  syncSubtitle: {
    fontSize: 14,
    opacity: 0.7,
    textAlign: 'center',
    marginBottom: 20,
  },
  syncButton: {
    flex: 1,
    marginLeft: 8,
  },
  testButton: {
    flex: 1,
    marginRight: 8,
  },
  buttonContainer: {
    flexDirection: 'row',
    width: '100%',
  },
  resultsCard: {
    marginBottom: 16,
  },
  resultsTitle: {
    fontSize: 18,
    fontWeight: '600',
    marginBottom: 16,
  },
  resultsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    marginBottom: 16,
  },
  resultItem: {
    width: '48%',
    alignItems: 'center',
    padding: 12,
    marginBottom: 8,
  },
  resultNumber: {
    fontSize: 24,
    fontWeight: 'bold',
  },
  resultLabel: {
    fontSize: 12,
    opacity: 0.7,
    marginTop: 4,
  },
  lastSync: {
    fontSize: 12,
    opacity: 0.6,
    textAlign: 'center',
  },
  listCard: {
    marginBottom: 16,
  },
  listTitle: {
    fontSize: 18,
    fontWeight: '600',
    marginBottom: 16,
  },
  employeeList: {
    maxHeight: 600,
  },
  employeeCard: {
    marginBottom: 8,
    padding: 12,
  },
  employeeRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  employeeInfo: {
    flex: 1,
    marginRight: 12,
  },
  employeeName: {
    fontSize: 16,
    fontWeight: '600',
  },
  employeeDetails: {
    fontSize: 14,
    opacity: 0.7,
    marginTop: 2,
  },
  smartOfficeDetails: {
    fontSize: 12,
    opacity: 0.5,
    marginTop: 2,
  },
  statusContainer: {
    alignItems: 'center',
  },
  statusText: {
    fontSize: 10,
    fontWeight: '500',
    marginTop: 2,
    textTransform: 'capitalize',
  },
});
