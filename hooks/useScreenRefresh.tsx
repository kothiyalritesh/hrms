import { useState, useCallback, useLayoutEffect, useRef } from 'react';
import { Pressable } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import React from 'react';
import Feather from '@expo/vector-icons/Feather';
import { useTheme } from './useTheme';

export function useScreenRefresh(onRefreshAction: () => Promise<void> | void) {
  const [refreshing, setRefreshing] = useState(false);
  const navigation = useNavigation();
  const { theme } = useTheme();
  // Keep the latest action without re-creating the handler (and re-setting the
  // header) on every render.
  const actionRef = useRef(onRefreshAction);
  actionRef.current = onRefreshAction;
  const runningRef = useRef(false);

  const handleRefresh = useCallback(async () => {
    if (runningRef.current) return;
    runningRef.current = true;
    setRefreshing(true);
    try {
      await actionRef.current();
    } catch (error) {
      console.warn('Refresh failed:', error);
    } finally {
      runningRef.current = false;
      setRefreshing(false);
    }
  }, []);

  useLayoutEffect(() => {
    navigation.setOptions({
      headerRight: () => (
        <Pressable
          onPress={handleRefresh}
          style={{ marginRight: 16, padding: 8, opacity: refreshing ? 0.5 : 1, flexDirection: 'row', alignItems: 'center' }}
          disabled={refreshing}
          accessibilityLabel="Refresh"
        >
          <Feather name="refresh-cw" size={18} color={theme.textSecondary} />
        </Pressable>
      ),
    });
  }, [navigation, theme, handleRefresh, refreshing]);

  return { refreshing, onRefresh: handleRefresh };
}
