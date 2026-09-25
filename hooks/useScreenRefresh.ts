import { useState, useCallback, useLayoutEffect } from 'react';
import { Platform, Pressable } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import React from 'react';
import Feather from '@expo/vector-icons/Feather';
import { useTheme } from './useTheme';

export function useScreenRefresh(onRefreshAction: () => Promise<void> | void) {
  const [refreshing, setRefreshing] = useState(false);
  const navigation = useNavigation();
  const { theme } = useTheme();

  const handleRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await onRefreshAction();
    } finally {
      setRefreshing(false);
    }
  }, [onRefreshAction]);

  useLayoutEffect(() => {
    if (Platform.OS === 'web') {
      navigation.setOptions({
        headerRight: () => (
          <Pressable 
            onPress={handleRefresh} 
            style={{ marginRight: 16, padding: 8, opacity: refreshing ? 0.5 : 1, flexDirection: 'row', alignItems: 'center' }}
            disabled={refreshing}
          >
            <Feather name="refresh-cw" size={18} color={theme.textSecondary} />
          </Pressable>
        ),
      });
    }
  }, [navigation, theme, handleRefresh, refreshing]);

  return { refreshing, onRefresh: handleRefresh };
}
