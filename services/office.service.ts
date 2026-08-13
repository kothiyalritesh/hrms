import { supabase } from "@/lib/supabase";

export const OfficeService = {
  async getAllOffices() {
    const { data, error } = await supabase
      .from("offices")
      .select(
        "id, name, latitude, longitude, attendance_radius, allowed_radius_meters",
      )
      .eq("is_active", true);

    if (error) throw error;
    return data;
  },
};
