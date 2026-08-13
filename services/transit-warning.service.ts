import { supabase } from "@/lib/supabase";

export const TransitWarningService = {
  save(warningId: string | null, values: Record<string, unknown>) {
    return supabase.rpc("rpc_admin_save_transit_warning", {
      p_warning_id: warningId,
      p_values: values,
    });
  },
};
