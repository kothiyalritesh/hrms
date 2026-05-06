import { supabase } from "@/lib/supabase";
import { Department, Designation } from "@/types/hrms.types";

export const DepartmentService = {
  // ========== DEPARTMENTS ==========
  
  async getAll(): Promise<Department[]> {
    const { data, error } = await supabase
      .from("departments")
      .select("*")
      .is("deleted_at", null)
      .order("name", { ascending: true });
    if (error) throw error;
    return data || [];
  },

  async getActive(): Promise<Department[]> {
    const { data, error } = await supabase
      .from("departments")
      .select("*")
      .eq("is_active", true)
      .is("deleted_at", null)
      .order("name", { ascending: true });
    if (error) throw error;
    return data || [];
  },

  async getById(id: string): Promise<Department | null> {
    const { data, error } = await supabase
      .from("departments")
      .select("*")
      .eq("id", id)
      .single();
    if (error) return null;
    return data;
  },

  async create(dept: Partial<Department>): Promise<Department> {
    const { data, error } = await supabase
      .from("departments")
      .insert([dept])
      .select()
      .single();
    if (error) throw error;
    return data;
  },

  async update(id: string, dept: Partial<Department>): Promise<Department> {
    const { data, error } = await supabase
      .from("departments")
      .update({ ...dept, updated_at: new Date().toISOString() })
      .eq("id", id)
      .select()
      .single();
    if (error) throw error;
    return data;
  },

  async softDelete(id: string): Promise<void> {
    const { error } = await supabase
      .from("departments")
      .update({ deleted_at: new Date().toISOString(), is_active: false })
      .eq("id", id);
    if (error) throw error;
  },

  async getDepartmentHeadcount(): Promise<{ department_id: string; name: string; count: number }[]> {
    const { data, error } = await supabase.rpc("get_department_headcount");
    if (error) throw error;
    return data || [];
  },

  // ========== DESIGNATIONS ==========

  async getAllDesignations(): Promise<Designation[]> {
    const { data, error } = await supabase
      .from("designations")
      .select("*, departments(name)")
      .is("deleted_at", null)
      .order("level", { ascending: true });
    if (error) throw error;
    return (data || []).map((d: any) => ({
      ...d,
      department_name: d.departments?.name,
    }));
  },

  async getActiveDesignations(): Promise<Designation[]> {
    const { data, error } = await supabase
      .from("designations")
      .select("*, departments(name)")
      .eq("is_active", true)
      .is("deleted_at", null)
      .order("level", { ascending: true });
    if (error) throw error;
    return (data || []).map((d: any) => ({
      ...d,
      department_name: d.departments?.name,
    }));
  },

  async getDesignationsByDepartment(departmentId: string): Promise<Designation[]> {
    const { data, error } = await supabase
      .from("designations")
      .select("*")
      .eq("department_id", departmentId)
      .eq("is_active", true)
      .is("deleted_at", null)
      .order("level", { ascending: true });
    if (error) throw error;
    return data || [];
  },

  async createDesignation(desig: Partial<Designation>): Promise<Designation> {
    const { data, error } = await supabase
      .from("designations")
      .insert([desig])
      .select()
      .single();
    if (error) throw error;
    return data;
  },

  async updateDesignation(id: string, desig: Partial<Designation>): Promise<Designation> {
    const { data, error } = await supabase
      .from("designations")
      .update({ ...desig, updated_at: new Date().toISOString() })
      .eq("id", id)
      .select()
      .single();
    if (error) throw error;
    return data;
  },

  async softDeleteDesignation(id: string): Promise<void> {
    const { error } = await supabase
      .from("designations")
      .update({ deleted_at: new Date().toISOString(), is_active: false })
      .eq("id", id);
    if (error) throw error;
  },
};

