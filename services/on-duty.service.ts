import { supabase } from "@/lib/supabase";

export interface OnDutyEvent {
  id: string;
  user_id: string;
  event_date: string;
  event_name: string;
  event_type: "training" | "conference" | "client_visit" | "company_event" | "other";
  location?: string;
  start_time?: string;
  end_time?: string;
  description?: string;
  status: "pending" | "approved" | "rejected" | "completed";
  requested_by: string;
  approved_by?: string;
  approved_at?: string;
  created_at: string;
  employee_name?: string;
  employee_number?: string;
}

export const OnDutyService = {
  /**
   * Request outdoor duty
   */
  async requestOnDuty(
    userId: string,
    eventDate: string,
    eventName: string,
    eventType: string,
    location?: string,
    description?: string
  ): Promise<OnDutyEvent> {
    const { data, error } = await supabase
      .from("on_duty_events")
      .insert({
        user_id: userId,
        event_date: eventDate,
        event_name: eventName,
        event_type: eventType,
        location,
        description,
        status: "pending",
        requested_by: userId,
      })
      .select()
      .single();

    if (error) throw error;
    return data;
  },

  /**
   * Get pending on-duty requests for approval
   */
  async getPendingRequests(officeId?: string): Promise<OnDutyEvent[]> {
    let query = supabase
      .from("on_duty_events")
      .select(
        `
        *,
        profiles:requested_by(name, employee_number)
      `
      )
      .eq("status", "pending")
      .order("event_date", { ascending: false });

    if (officeId) {
      query = query.eq("profiles.office_id", officeId);
    }

    const { data, error } = await query;

    if (error) throw error;

    return (data || []).map((item: any) => ({
      ...item,
      employee_name: item.profiles?.name,
      employee_number: item.profiles?.employee_number,
    }));
  },

  /**
   * Get on-duty events for a user
   */
  async getUserOnDutyEvents(userId: string): Promise<OnDutyEvent[]> {
    const { data, error } = await supabase
      .from("on_duty_events")
      .select("*")
      .eq("user_id", userId)
      .order("event_date", { ascending: false });

    if (error) throw error;
    return data || [];
  },

  /**
   * Approve on-duty request
   */
  async approveRequest(eventId: string, approvedBy: string): Promise<OnDutyEvent> {
    const { data, error } = await supabase
      .from("on_duty_events")
      .update({
        status: "approved",
        approved_by: approvedBy,
        approved_at: new Date().toISOString(),
      })
      .eq("id", eventId)
      .select()
      .single();

    if (error) throw error;

    // Mark attendance as on-duty
    if (data) {
      await this.markAttendanceAsOnDuty(data.user_id, data.event_date, eventId);
    }

    return data;
  },

  /**
   * Reject on-duty request
   */
  async rejectRequest(eventId: string, approvedBy: string): Promise<OnDutyEvent> {
    const { data, error } = await supabase
      .from("on_duty_events")
      .update({
        status: "rejected",
        approved_by: approvedBy,
        approved_at: new Date().toISOString(),
      })
      .eq("id", eventId)
      .select()
      .single();

    if (error) throw error;
    return data;
  },

  /**
   * Mark attendance as on-duty (called when request is approved)
   */
  async markAttendanceAsOnDuty(userId: string, date: string, eventId: string) {
    // Check if attendance record exists
    const { data: existing } = await supabase
      .from("attendance_summary")
      .select("id")
      .eq("user_id", userId)
      .eq("date", date)
      .single();

    if (existing) {
      // Update existing record
      await supabase
        .from("attendance_summary")
        .update({
          is_on_duty: true,
          status: "on_duty",
          punch_in_time: null,
          punch_out_time: null,
          working_hours: 8,
          is_late: false,
          late_minutes: 0,
        })
        .eq("id", existing.id);
    } else {
      // Create new record
      const { data: profile } = await supabase
        .from("profiles")
        .select("office_id")
        .eq("id", userId)
        .single();

      const { data: office } = await supabase
        .from("offices")
        .select("name")
        .eq("id", profile?.office_id)
        .single();

      await supabase.from("attendance_summary").insert({
        user_id: userId,
        date,
        is_on_duty: true,
        status: "on_duty",
        working_hours: 8,
        office_id: profile?.office_id,
        office_name: office?.name,
      });
    }
  },

  /**
   * Get on-duty events for a date range (admin view)
   */
  async getOnDutyEventsByDateRange(
    startDate: string,
    endDate: string,
    status?: string
  ): Promise<OnDutyEvent[]> {
    let query = supabase
      .from("on_duty_events")
      .select(
        `
        *,
        profiles:requested_by(name, employee_number)
      `
      )
      .gte("event_date", startDate)
      .lte("event_date", endDate)
      .order("event_date", { ascending: false });

    if (status) {
      query = query.eq("status", status);
    }

    const { data, error } = await query;

    if (error) throw error;

    return (data || []).map((item: any) => ({
      ...item,
      employee_name: item.profiles?.name,
      employee_number: item.profiles?.employee_number,
    }));
  },

  /**
   * Cancel on-duty request (by employee)
   */
  async cancelRequest(eventId: string): Promise<OnDutyEvent> {
    const { data, error } = await supabase
      .from("on_duty_events")
      .update({ status: "rejected" })
      .eq("id", eventId)
      .select()
      .single();

    if (error) throw error;
    return data;
  },
};
