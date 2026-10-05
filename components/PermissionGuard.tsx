import React from 'react';
import { ActivityIndicator } from 'react-native';
import { usePermissions } from '@/hooks/usePermissions';
import { ThemedView } from '@/components/ThemedView';
import { ThemedText } from '@/components/ThemedText';
import Feather from '@expo/vector-icons/Feather';

export function withPermissionGuard<P extends object>(
  WrappedComponent: React.ComponentType<P>,
  requiredPermission: string | string[]
) {
  return function PermissionGuardedComponent(props: P) {
    const { hasPermission, loading } = usePermissions();

    if (loading) {
      return (
        <ThemedView style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
          <ActivityIndicator size="large" color="#6D1B6D" />
        </ThemedView>
      );
    }

    const hasAccess = Array.isArray(requiredPermission) ? requiredPermission.some(p => hasPermission(p)) : hasPermission(requiredPermission);
    if (!hasAccess) {
      return (
        <ThemedView style={{ flex: 1, justifyContent: 'center', alignItems: 'center', padding: 20 }}>
          <Feather name="lock" size={48} color="#EF4444" style={{ marginBottom: 16 }} />
          <ThemedText type="h3" style={{ marginBottom: 8 }}>Access Denied</ThemedText>
          <ThemedText type="body" style={{ textAlign: 'center', color: '#64748B' }}>
            You do not have permission to view this screen.
            (Required: {Array.isArray(requiredPermission) ? requiredPermission.join(', ') : requiredPermission})
          </ThemedText>
        </ThemedView>
      );
    }

    return <WrappedComponent {...props} />;
  };
}



