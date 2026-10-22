import { supabase } from "@/lib/supabase";

/**
 * Task visibility along the reporting hierarchy.
 * Contracts: supabase/migrations/20261015130000_task_hierarchy_visibility.sql
 */

export type TaskRelation = "ASSIGNED" | "CREATED" | "SHARED";
export type TaskSharedVia = "CREATOR_DIRECT_REPORTS" | "FORWARDED" | null;
export type TaskShareScope = "DIRECT_REPORTS" | "PRIVATE";

/** Extra columns rpc_my_tasks adds to every task row. */
export interface TaskVisibilityFields {
  created_by?: string | null;
  assigned_by?: string | null;
  share_scope?: TaskShareScope | null;
  assigned_to_name?: string | null;
  assigned_by_name?: string | null;
  created_by_name?: string | null;
  relation?: TaskRelation | null;
  shared_via?: TaskSharedVia;
  shared_by_name?: string | null;
  can_update?: boolean | null;
  can_forward?: boolean | null;
  forwarded_count?: number | null;
}

export interface DirectReport {
  id: string;
  name: string | null;
  employee_number: string | null;
}

export interface TaskForwardResult {
  success: boolean;
  added?: number;
  error?:
    | "NO_DIRECT_REPORTS"
    | "NOT_YOUR_TEAM"
    | "FORBIDDEN"
    | "NOT_FOUND"
    | "AUTHENTICATION_REQUIRED"
    | string;
  message?: string;
}

export const TaskSharingService = {
  /** Tasks assigned to me, created/assigned by me, or shared/forwarded to me. */
  async getMyTasks<T extends object>(
    statuses: string[] | null,
    limit: number,
    offset = 0,
  ): Promise<(T & TaskVisibilityFields)[]> {
    const { data, error } = await supabase.rpc("rpc_my_tasks", {
      p_statuses: statuses,
      p_limit: limit,
      p_offset: offset,
    });
    if (error) throw error;
    return Array.isArray(data) ? (data as (T & TaskVisibilityFields)[]) : [];
  },

  /** Forward a task to my direct reports; null/empty ids = all of them. */
  async forwardTask(
    taskId: string,
    userIds: string[] | null,
  ): Promise<TaskForwardResult> {
    const { data, error } = await supabase.rpc("rpc_task_forward", {
      p_task_id: taskId,
      p_user_ids: userIds && userIds.length > 0 ? userIds : null,
    });
    if (error) throw error;
    return (data || { success: false, message: "No response from server." }) as TaskForwardResult;
  },

  async getMyDirectReports(): Promise<DirectReport[]> {
    const { data, error } = await supabase.rpc("rpc_my_direct_reports");
    if (error) throw error;
    return Array.isArray(data) ? (data as DirectReport[]) : [];
  },
};
