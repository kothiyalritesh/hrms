import { supabase } from "@/lib/supabase";
import { AuditLog } from "@/types/hrms.types";

export interface AuditLogFilters {
  tableName?: string;
  action?: 'INSERT' | 'UPDATE' | 'DELETE';
  performedBy?: string;
  dateFrom?: string;
  dateTo?: string;
  recordId?: string;
}

export const AuditLogService = {
  async getAll(filters?: AuditLogFilters, page: number = 1, pageSize: number = 50): Promise<{ logs: AuditLog[]; total: number }> {
    let query = supabase
      .from("audit_logs")
      .select("*, profiles(name)", { count: "exact" });

    if (filters?.tableName) {
      query = query.eq("table_name", filters.tableName);
    }
    if (filters?.action) {
      query = query.eq("action", filters.action);
    }
    if (filters?.performedBy) {
      query = query.eq("performed_by", filters.performedBy);
    }
    if (filters?.recordId) {
      query = query.eq("record_id", filters.recordId);
    }
    if (filters?.dateFrom) {
      query = query.gte("performed_at", filters.dateFrom);
    }
    if (filters?.dateTo) {
      query = query.lte("performed_at", filters.dateTo);
    }

    const { data, error, count } = await query
      .order("performed_at", { ascending: false })
      .range((page - 1) * pageSize, page * pageSize - 1);

    if (error) throw error;
    return { logs: data || [], total: count || 0 };
  },

  async getByRecord(tableName: string, recordId: string): Promise<AuditLog[]> {
    const { data, error } = await supabase
      .from("audit_logs")
      .select("*, profiles(name)")
      .eq("table_name", tableName)
      .eq("record_id", recordId)
      .order("performed_at", { ascending: false });
    if (error) throw error;
    return data || [];
  },

  async getRecent(limit: number = 20): Promise<AuditLog[]> {
    const { data, error } = await supabase
      .from("audit_logs")
      .select("*, profiles(name)")
      .order("performed_at", { ascending: false })
      .limit(limit);
    if (error) throw error;
    return data || [];
  },

  async getTables(): Promise<string[]> {
    const { data, error } = await supabase
      .from("audit_logs")
      .select("table_name")
      .order("table_name");
    if (error) throw error;
    return [...new Set((data || []).map((d: any) => d.table_name))] as string[];
  },
};

