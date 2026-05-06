import { supabase } from "@/lib/supabase";
import { EmployeeMeta } from "@/types/hrms.types";

export const EmployeeMetaService = {
  async getByEmployeeId(employeeId: string): Promise<EmployeeMeta | null> {
    const { data, error } = await supabase
      .from("employee_meta")
      .select("*")
      .eq("employee_id", employeeId)
      .single();
    if (error) return null;
    return data;
  },

  async createOrUpdate(meta: Partial<EmployeeMeta> & { employee_id: string }): Promise<EmployeeMeta> {
    // Check if exists
    const existing = await this.getByEmployeeId(meta.employee_id);
    
    if (existing) {
      const { data, error } = await supabase
        .from("employee_meta")
        .update({
          ...meta,
          updated_at: new Date().toISOString(),
        })
        .eq("employee_id", meta.employee_id)
        .select()
        .single();
      if (error) throw error;
      return data;
    } else {
      const { data, error } = await supabase
        .from("employee_meta")
        .insert([meta])
        .select()
        .single();
      if (error) throw error;
      return data;
    }
  },

  async updateKyc(employeeId: string, kycData: {
    pan_number?: string;
    aadhaar_number?: string;
    passport_number?: string;
    voter_id?: string;
    driving_license?: string;
  }): Promise<EmployeeMeta> {
    return this.createOrUpdate({
      employee_id: employeeId,
      ...kycData,
    });
  },

  async updateBankDetails(employeeId: string, bankData: {
    bank_name?: string;
    bank_account_number?: string;
    bank_ifsc_code?: string;
    bank_branch?: string;
  }): Promise<EmployeeMeta> {
    return this.createOrUpdate({
      employee_id: employeeId,
      ...bankData,
    });
  },

  async updateEmergencyContact(employeeId: string, contactData: {
    emergency_contact_name?: string;
    emergency_contact_phone?: string;
    emergency_contact_relationship?: string;
    emergency_contact_address?: string;
  }): Promise<EmployeeMeta> {
    return this.createOrUpdate({
      employee_id: employeeId,
      ...contactData,
    });
  },

  async updateCustomFields(employeeId: string, customFields: Record<string, any>): Promise<EmployeeMeta> {
    const existing = await this.getByEmployeeId(employeeId);
    const mergedFields = existing?.custom_fields 
      ? { ...existing.custom_fields, ...customFields }
      : customFields;
    
    return this.createOrUpdate({
      employee_id: employeeId,
      custom_fields: mergedFields,
    });
  },
};

