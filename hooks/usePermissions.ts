import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/lib/supabase';

export interface ScopedPermission {
  permission: string;
  scope: 'GLOBAL' | 'OFFICE' | 'DEPARTMENT' | 'TEAM' | 'SELF';
  scope_id?: string | null;
}

// Simple in-memory cache to prevent redundant requests
let cachedPermissions: ScopedPermission[] | null = null;
let lastFetchUserId: string | null = null;
let fetchPromise: Promise<ScopedPermission[]> | null = null;

export function usePermissions() {
  const { user } = useAuth();
  
  // Initialize with cached data immediately if available for the current user
  const initialData = (user?.id && user.id === lastFetchUserId && cachedPermissions) ? cachedPermissions : [];
  const [scopedPermissions, setScopedPermissions] = useState<ScopedPermission[]>(initialData);
  const [loading, setLoading] = useState(!initialData.length);

  const loadPermissions = useCallback(async (forceRefresh = false) => {
    if (!user?.id) { 
      setLoading(false); 
      return; 
    }

    if (!forceRefresh && cachedPermissions && lastFetchUserId === user.id) {
      setScopedPermissions(cachedPermissions);
      setLoading(false);
      return;
    }

    // Deduplicate concurrent requests
    if (!fetchPromise || forceRefresh) {
      fetchPromise = (async () => {
        try {
          const { data, error } = await supabase.rpc('get_my_permissions');
          let parsedData = data;
          if (typeof data === 'string') {
            try { parsedData = JSON.parse(data); } catch(e) {}
          }
          
          if (!error && Array.isArray(parsedData)) {
            cachedPermissions = parsedData as ScopedPermission[];
            lastFetchUserId = user.id;
            return cachedPermissions;
          }
        } catch (err) {
          console.warn('Error loading permissions', err);
        }
        return [];
      })();
    }

    const result = await fetchPromise;
    setScopedPermissions(result);
    setLoading(false);
  }, [user?.id]);

  useEffect(() => { 
    void loadPermissions(); 
  }, [loadPermissions]);

  const hasPermission = useCallback((permName: string): boolean => {
    // SYSTEM_ADMIN and ADMIN always have full access — never blocked by permission guards
    if (user?.role === 'SYSTEM_ADMIN' || user?.role === 'ADMIN') return true;
    return scopedPermissions.some(p => p.permission === permName);
  }, [scopedPermissions, user?.role]);

  const getScopedPermission = useCallback((permName: string): ScopedPermission | null => {
    if (user?.role === 'SYSTEM_ADMIN' || user?.role === 'ADMIN') {
      return { permission: permName, scope: 'GLOBAL', scope_id: null };
    }
    return scopedPermissions.find(p => p.permission === permName) ?? null;
  }, [scopedPermissions, user?.role]);

  return { 
    scopedPermissions, 
    hasPermission, 
    getScopedPermission, 
    loading, 
    refreshPermissions: () => loadPermissions(true) 
  };
}
