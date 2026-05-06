import { supabase } from "@/lib/supabase";

export interface FieldVisit {
  id: string;
  user_id: string;
  activity_log_id?: string;
  visit_type: "site" | "meeting" | "office" | "others";
  location_name: string;
  location_address?: string;
  destination_coords?: { latitude: number; longitude: number };
  from_location_name?: string;
  from_coords?: { latitude: number; longitude: number };
  meeting_type?: "client" | "channel_partner";
  contact_name?: string;
  contact_phone?: string;
  company_name?: string;
  project_name?: string;
  notes?: string;
  checkin_time?: string;
  checkin_location?: { latitude: number; longitude: number };
  checkout_time?: string;
  checkout_location?: { latitude: number; longitude: number };
  checkout_notes?: string;
  arrived?: boolean;
  status: "PENDING" | "CHECKED_IN" | "COMPLETED" | "MISSED";
  date: string;
  created_at: string;
}

export const FieldVisitService = {
  async createVisit(params: {
    userId: string;
    activityLogId?: string;
    visitType: "site" | "meeting" | "office" | "others";
    locationName: string;
    locationAddress?: string;
    destinationCoords?: { latitude: number; longitude: number };
    fromLocationName?: string;
    fromCoords?: { latitude: number; longitude: number };
    meetingType?: "client" | "channel_partner";
    contactName?: string;
    contactPhone?: string;
    companyName?: string;
    projectName?: string;
    notes?: string;
  }): Promise<{ data: FieldVisit | null; error: any }> {
    const { data, error } = await supabase
      .from("field_visits")
      .insert({
        user_id: params.userId,
        activity_log_id: params.activityLogId,
        visit_type: params.visitType,
        location_name: params.locationName,
        location_address: params.locationAddress ?? null,
        destination_coords: params.destinationCoords ?? null,
        from_location_name: params.fromLocationName ?? null,
        from_coords: params.fromCoords ?? null,
        meeting_type: params.meetingType,
        contact_name: params.contactName,
        contact_phone: params.contactPhone,
        company_name: params.companyName,
        project_name: params.projectName,
        notes: params.notes,
        status: "PENDING",
        date: new Date().toISOString().split("T")[0],
      })
      .select()
      .single();
    return { data, error };
  },

  async getTodayVisits(userId: string): Promise<{ data: FieldVisit[]; error: any }> {
    const today = new Date().toISOString().split("T")[0];
    const { data, error } = await supabase
      .from("field_visits")
      .select("*")
      .eq("user_id", userId)
      .eq("date", today)
      .order("created_at", { ascending: true });
    return { data: data || [], error };
  },

  async getPendingVisits(userId: string): Promise<{ data: FieldVisit[]; error: any }> {
    const today = new Date().toISOString().split("T")[0];
    const { data, error } = await supabase
      .from("field_visits")
      .select("*")
      .eq("user_id", userId)
      .eq("date", today)
      .in("status", ["PENDING", "CHECKED_IN"])
      .order("created_at", { ascending: true });
    return { data: data || [], error };
  },

  async checkIn(
    visitId: string,
    location: { latitude: number; longitude: number }
  ): Promise<{ error: any }> {
    // Use local ISO string to preserve timezone offset
    const now = new Date();
    const localISO = new Date(now.getTime() - now.getTimezoneOffset() * 60000).toISOString();
    const { error } = await supabase
      .from("field_visits")
      .update({
        checkin_time: localISO,
        checkin_location: location,
        status: "CHECKED_IN",
      })
      .eq("id", visitId);
    return { error };
  },

  async checkOut(
    visitId: string,
    location: { latitude: number; longitude: number },
    notes?: string
  ): Promise<{ error: any }> {
    const now = new Date();
    const localISO = new Date(now.getTime() - now.getTimezoneOffset() * 60000).toISOString();
    const { error } = await supabase
      .from("field_visits")
      .update({
        checkout_time: localISO,
        checkout_location: location,
        checkout_notes: notes || null,
        status: "COMPLETED",
      })
      .eq("id", visitId);
    return { error };
  },

  async markMissed(visitId: string): Promise<{ error: any }> {
    const { error } = await supabase
      .from("field_visits")
      .update({ status: "MISSED" })
      .eq("id", visitId);
    return { error };
  },

  async getAllVisitsForAdmin(options?: {
    date?: string;
    userId?: string;
  }): Promise<{ data: any[]; error: any }> {
    const date = options?.date || new Date().toISOString().split("T")[0];
    let query = supabase
      .from("field_visits")
      .select(`*, profiles:user_id(name, employee_number, role)`)
      .eq("date", date)
      .order("created_at", { ascending: true });
    if (options?.userId) query = query.eq("user_id", options.userId);
    const { data, error } = await query;
    return { data: data || [], error };
  },
};
