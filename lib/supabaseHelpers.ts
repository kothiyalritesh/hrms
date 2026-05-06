// supabaseHelpers.ts
// Utility functions for common Supabase operations in RealtyHRM

import { supabase } from './supabase';
import type { PostgrestError } from '@supabase/supabase-js';

// ============================================================================
// TYPE DEFINITIONS
// ============================================================================

export interface Profile {
  id: string;
  auth_id?: string;
  first_name?: string;
  last_name?: string;
  name?: string;
  email?: string;
  phone?: string;
  username?: string;
  employee_number?: string;
  profile_pic_url?: string;
  role?: 'admin' | 'manager' | 'employee';
  office_id?: string;
  is_active?: boolean;
  date_of_birth?: string;
  created_at?: string;
  updated_at?: string;
}

export interface ActivityLog {
  id: string;
  user_id: string;
  activity_type: string;
  activity_subtype?: string;
  description?: string;
  location_latitude?: number;
  location_longitude?: number;
  location_address?: string;
  destination_latitude?: number;
  destination_longitude?: number;
  destination_address?: string;
  site_id?: string;
  office_id?: string;
  check_in_time?: string;
  check_out_time?: string;
  duration_minutes?: number;
  notes?: string;
  is_compliant?: boolean;
  compliance_notes?: string;
  created_at?: string;
  updated_at?: string;
}

export interface Leave {
  id: string;
  user_id: string;
  leave_type: string;
  from_date: string;
  to_date: string;
  duration_days: number;
  reason?: string;
  status: 'pending' | 'approved' | 'rejected';
  rejected_reason?: string;
  approved_by?: string;
  approval_date?: string;
  created_at?: string;
  updated_at?: string;
}

export interface Office {
  id: string;
  name: string;
  address?: string;
  city?: string;
  state?: string;
  postal_code?: string;
  country?: string;
  latitude?: number;
  longitude?: number;
  radius_km?: number;
  is_active?: boolean;
  created_at?: string;
  updated_at?: string;
}

export interface FieldVisit {
  id: string;
  user_id: string;
  site_id?: string;
  visit_date: string;
  check_in_time: string;
  check_out_time?: string;
  latitude?: number;
  longitude?: number;
  address?: string;
  purpose?: string;
  notes?: string;
  photos?: string[];
  is_approved?: boolean;
  approved_by?: string;
  created_at?: string;
  updated_at?: string;
}

// ============================================================================
// AUTHENTICATION HELPERS
// ============================================================================

export const AuthHelpers = {
  /**
   * Sign up a new user
   */
  async signUp(email: string, password: string) {
    try {
      const { data, error } = await supabase.auth.signUp({
        email,
        password,
      });

      if (error) throw error;
      return { data, error: null };
    } catch (error) {
      return { data: null, error };
    }
  },

  /**
   * Sign in user with email and password
   */
  async signIn(email: string, password: string) {
    try {
      const { data, error } = await supabase.auth.signInWithPassword({
        email,
        password,
      });

      if (error) throw error;
      return { data, error: null };
    } catch (error) {
      return { data: null, error };
    }
  },

  /**
   * Sign out current user
   */
  async signOut() {
    try {
      const { error } = await supabase.auth.signOut();
      if (error) throw error;
      return { error: null };
    } catch (error) {
      return { error };
    }
  },

  /**
   * Get current session
   */
  async getSession() {
    try {
      const { data, error } = await supabase.auth.getSession();
      if (error) throw error;
      return { data, error: null };
    } catch (error) {
      return { data: null, error };
    }
  },

  /**
   * Get current authenticated user
   */
  async getCurrentUser() {
    try {
      const { data, error } = await supabase.auth.getUser();
      if (error) throw error;
      return { data, error: null };
    } catch (error) {
      return { data: null, error };
    }
  },

  /**
   * Reset password
   */
  async resetPassword(email: string) {
    try {
      const { data, error } = await supabase.auth.resetPasswordForEmail(email);
      if (error) throw error;
      return { data, error: null };
    } catch (error) {
      return { data: null, error };
    }
  },
};

// ============================================================================
// PROFILE HELPERS
// ============================================================================

export const ProfileHelpers = {
  /**
   * Get user profile by ID
   */
  async getProfile(userId: string) {
    try {
      const { data, error } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', userId)
        .single();

      if (error) throw error;
      return { data, error: null };
    } catch (error) {
      return { data: null, error };
    }
  },

  /**
   * Get profile by auth_id
   */
  async getProfileByAuthId(authId: string) {
    try {
      const { data, error } = await supabase
        .from('profiles')
        .select('*')
        .eq('auth_id', authId)
        .single();

      if (error) throw error;
      return { data, error: null };
    } catch (error) {
      return { data: null, error };
    }
  },

  /**
   * Create new profile
   */
  async createProfile(profile: Partial<Profile>) {
    try {
      const { data, error } = await supabase
        .from('profiles')
        .insert([profile])
        .select()
        .single();

      if (error) throw error;
      return { data, error: null };
    } catch (error) {
      return { data: null, error };
    }
  },

  /**
   * Update profile
   */
  async updateProfile(userId: string, updates: Partial<Profile>) {
    try {
      const { data, error } = await supabase
        .from('profiles')
        .update(updates)
        .eq('id', userId)
        .select()
        .single();

      if (error) throw error;
      return { data, error: null };
    } catch (error) {
      return { data: null, error };
    }
  },

  /**
   * Get all active profiles (Admin only)
   */
  async getAllProfiles(filters?: { role?: string; office_id?: string }) {
    try {
      let query = supabase
        .from('profiles')
        .select('*')
        .eq('is_active', true);

      if (filters?.role) {
        query = query.eq('role', filters.role);
      }
      if (filters?.office_id) {
        query = query.eq('office_id', filters.office_id);
      }

      const { data, error } = await query;

      if (error) throw error;
      return { data, error: null };
    } catch (error) {
      return { data: null, error };
    }
  },

  /**
   * Search profiles
   */
  async searchProfiles(searchTerm: string) {
    try {
      const { data, error } = await supabase
        .from('profiles')
        .select('*')
        .or(
          `first_name.ilike.%${searchTerm}%,last_name.ilike.%${searchTerm}%,email.ilike.%${searchTerm}%,employee_number.ilike.%${searchTerm}%`
        )
        .eq('is_active', true);

      if (error) throw error;
      return { data, error: null };
    } catch (error) {
      return { data: null, error };
    }
  },
};

// ============================================================================
// ACTIVITY LOG HELPERS
// ============================================================================

export const ActivityLogHelpers = {
  /**
   * Create activity log entry
   */
  async createActivityLog(log: Partial<ActivityLog>) {
    try {
      const { data, error } = await supabase
        .from('activity_logs')
        .insert([log])
        .select()
        .single();

      if (error) throw error;
      return { data, error: null };
    } catch (error) {
      return { data: null, error };
    }
  },

  /**
   * Get activity logs for user
   */
  async getUserActivityLogs(userId: string, days: number = 30) {
    try {
      const fromDate = new Date();
      fromDate.setDate(fromDate.getDate() - days);

      const { data, error } = await supabase
        .from('activity_logs')
        .select('*')
        .eq('user_id', userId)
        .gte('created_at', fromDate.toISOString())
        .order('created_at', { ascending: false });

      if (error) throw error;
      return { data, error: null };
    } catch (error) {
      return { data: null, error };
    }
  },

  /**
   * Update activity log
   */
  async updateActivityLog(logId: string, updates: Partial<ActivityLog>) {
    try {
      const { data, error } = await supabase
        .from('activity_logs')
        .update(updates)
        .eq('id', logId)
        .select()
        .single();

      if (error) throw error;
      return { data, error: null };
    } catch (error) {
      return { data: null, error };
    }
  },

  /**
   * Get today's activity for user
   */
  async getTodayActivityLogs(userId: string) {
    try {
      const today = new Date().toISOString().split('T')[0];

      const { data, error } = await supabase
        .from('activity_logs')
        .select('*')
        .eq('user_id', userId)
        .gte('created_at', `${today}T00:00:00`)
        .lte('created_at', `${today}T23:59:59`)
        .order('created_at', { ascending: false });

      if (error) throw error;
      return { data, error: null };
    } catch (error) {
      return { data: null, error };
    }
  },

  /**
   * Get daily summary
   */
  async getDailySummary(userId: string, date: string) {
    try {
      const { data, error } = await supabase
        .from('daily_activity_summary')
        .select('*')
        .eq('user_id', userId)
        .eq('activity_date', date);

      if (error) throw error;
      return { data, error: null };
    } catch (error) {
      return { data: null, error };
    }
  },
};

// ============================================================================
// LEAVE HELPERS
// ============================================================================

export const LeaveHelpers = {
  /**
   * Request leave
   */
  async requestLeave(leave: Partial<Leave>) {
    try {
      const { data, error } = await supabase
        .from('leaves')
        .insert([leave])
        .select()
        .single();

      if (error) throw error;
      return { data, error: null };
    } catch (error) {
      return { data: null, error };
    }
  },

  /**
   * Get leaves for user
   */
  async getUserLeaves(userId: string, filters?: { status?: string }) {
    try {
      let query = supabase
        .from('leaves')
        .select('*')
        .eq('user_id', userId)
        .order('from_date', { ascending: false });

      if (filters?.status) {
        query = query.eq('status', filters.status);
      }

      const { data, error } = await query;

      if (error) throw error;
      return { data, error: null };
    } catch (error) {
      return { data: null, error };
    }
  },

  /**
   * Get pending leaves (for approvers)
   */
  async getPendingLeaves(officeId?: string) {
    try {
      let query = supabase
        .from('leaves')
        .select('*, profiles!leaves_user_id_fkey(name, employee_number)')
        .eq('status', 'pending')
        .order('from_date', { ascending: true });

      if (officeId) {
        query = query.eq('profiles.office_id', officeId);
      }

      const { data, error } = await query;

      if (error) throw error;
      return { data, error: null };
    } catch (error) {
      return { data: null, error };
    }
  },

  /**
   * Approve leave
   */
  async approveLeave(leaveId: string, approvedBy: string) {
    try {
      const { data, error } = await supabase
        .from('leaves')
        .update({
          status: 'approved',
          approved_by: approvedBy,
          approval_date: new Date().toISOString(),
        })
        .eq('id', leaveId)
        .select()
        .single();

      if (error) throw error;
      return { data, error: null };
    } catch (error) {
      return { data: null, error };
    }
  },

  /**
   * Reject leave
   */
  async rejectLeave(leaveId: string, rejectionReason: string) {
    try {
      const { data, error } = await supabase
        .from('leaves')
        .update({
          status: 'rejected',
          rejected_reason: rejectionReason,
        })
        .eq('id', leaveId)
        .select()
        .single();

      if (error) throw error;
      return { data, error: null };
    } catch (error) {
      return { data: null, error };
    }
  },
};

// ============================================================================
// FIELD VISIT HELPERS
// ============================================================================

export const FieldVisitHelpers = {
  /**
   * Create field visit
   */
  async createFieldVisit(visit: Partial<FieldVisit>) {
    try {
      const { data, error } = await supabase
        .from('field_visits')
        .insert([visit])
        .select()
        .single();

      if (error) throw error;
      return { data, error: null };
    } catch (error) {
      return { data: null, error };
    }
  },

  /**
   * Get user's field visits
   */
  async getUserFieldVisits(userId: string, days: number = 30) {
    try {
      const fromDate = new Date();
      fromDate.setDate(fromDate.getDate() - days);

      const { data, error } = await supabase
        .from('field_visits')
        .select('*')
        .eq('user_id', userId)
        .gte('visit_date', fromDate.toISOString().split('T')[0])
        .order('visit_date', { ascending: false });

      if (error) throw error;
      return { data, error: null };
    } catch (error) {
      return { data: null, error };
    }
  },

  /**
   * Update field visit
   */
  async updateFieldVisit(visitId: string, updates: Partial<FieldVisit>) {
    try {
      const { data, error } = await supabase
        .from('field_visits')
        .update(updates)
        .eq('id', visitId)
        .select()
        .single();

      if (error) throw error;
      return { data, error: null };
    } catch (error) {
      return { data: null, error };
    }
  },
};

// ============================================================================
// OFFICE HELPERS
// ============================================================================

export const OfficeHelpers = {
  /**
   * Get all offices
   */
  async getAllOffices() {
    try {
      const { data, error } = await supabase
        .from('offices')
        .select('*')
        .eq('is_active', true)
        .order('name', { ascending: true });

      if (error) throw error;
      return { data, error: null };
    } catch (error) {
      return { data: null, error };
    }
  },

  /**
   * Get office by ID
   */
  async getOffice(officeId: string) {
    try {
      const { data, error } = await supabase
        .from('offices')
        .select('*')
        .eq('id', officeId)
        .single();

      if (error) throw error;
      return { data, error: null };
    } catch (error) {
      return { data: null, error };
    }
  },

  /**
   * Create office
   */
  async createOffice(office: Partial<Office>) {
    try {
      const { data, error } = await supabase
        .from('offices')
        .insert([office])
        .select()
        .single();

      if (error) throw error;
      return { data, error: null };
    } catch (error) {
      return { data: null, error };
    }
  },

  /**
   * Update office
   */
  async updateOffice(officeId: string, updates: Partial<Office>) {
    try {
      const { data, error } = await supabase
        .from('offices')
        .update(updates)
        .eq('id', officeId)
        .select()
        .single();

      if (error) throw error;
      return { data, error: null };
    } catch (error) {
      return { data: null, error };
    }
  },
};

// ============================================================================
// LOCATION COMPLIANCE HELPERS
// ============================================================================

export const LocationComplianceHelpers = {
  /**
   * Get compliance summary
   */
  async getComplianceSummary(userId?: string) {
    try {
      let query = supabase.from('compliance_summary').select('*');

      if (userId) {
        query = query.eq('user_id', userId);
      }

      const { data, error } = await query;

      if (error) throw error;
      return { data, error: null };
    } catch (error) {
      return { data: null, error };
    }
  },

  /**
   * Get user compliance for date range
   */
  async getUserComplianceRange(userId: string, fromDate: string, toDate: string) {
    try {
      const { data, error } = await supabase
        .from('location_compliance')
        .select('*')
        .eq('user_id', userId)
        .gte('log_date', fromDate)
        .lte('log_date', toDate)
        .order('log_date', { ascending: true });

      if (error) throw error;
      return { data, error: null };
    } catch (error) {
      return { data: null, error };
    }
  },
};

// ============================================================================
// GENERAL HELPERS
// ============================================================================

export const GeneralHelpers = {
  /**
   * Upload file to Supabase storage
   */
  async uploadFile(bucket: string, path: string, file: File | Blob) {
    try {
      const { data, error } = await supabase.storage
        .from(bucket)
        .upload(path, file, { upsert: true });

      if (error) throw error;
      return { data, error: null };
    } catch (error) {
      return { data: null, error };
    }
  },

  /**
   * Get public URL for file
   */
  getPublicUrl(bucket: string, path: string) {
    try {
      const { data } = supabase.storage.from(bucket).getPublicUrl(path);
      return data?.publicUrl || null;
    } catch (error) {
      return null;
    }
  },

  /**
   * Calculate distance between two coordinates (in km)
   */
  calculateDistance(lat1: number, lon1: number, lat2: number, lon2: number) {
    const R = 6371; // Earth's radius in km
    const dLat = ((lat2 - lat1) * Math.PI) / 180;
    const dLon = ((lon2 - lon1) * Math.PI) / 180;
    const a =
      Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos((lat1 * Math.PI) / 180) *
        Math.cos((lat2 * Math.PI) / 180) *
        Math.sin(dLon / 2) *
        Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
  },

  /**
   * Check if location is within radius
   */
  isLocationWithinRadius(
    userLat: number,
    userLon: number,
    centerLat: number,
    centerLon: number,
    radiusKm: number
  ) {
    const distance = this.calculateDistance(userLat, userLon, centerLat, centerLon);
    return distance <= radiusKm;
  },
};

export default {
  AuthHelpers,
  ProfileHelpers,
  ActivityLogHelpers,
  LeaveHelpers,
  FieldVisitHelpers,
  OfficeHelpers,
  LocationComplianceHelpers,
  GeneralHelpers,
};
