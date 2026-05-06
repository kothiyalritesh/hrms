// ============================================================
// HRMS Core Types - Phase 1 Foundation
// ============================================================

export type EmploymentStatus = 
  | 'CANDIDATE' 
  | 'ONBOARDING' 
  | 'ACTIVE' 
  | 'SUSPENDED' 
  | 'NOTICE_PERIOD' 
  | 'EXITED';

export type AuditAction = 'INSERT' | 'UPDATE' | 'DELETE';

// Department
export interface Department {
  id: string;
  name: string;
  code?: string;
  description?: string;
  parent_id?: string | null;
  head_employee_id?: string | null;
  budget_allocated?: number;
  is_active: boolean;
  created_at: string;
  updated_at: string;
  deleted_at?: string | null;
}

// Designation
export interface Designation {
  id: string;
  name: string;
  code?: string;
  department_id?: string | null;
  level: number;
  description?: string;
  is_active: boolean;
  created_at: string;
  updated_at: string;
  deleted_at?: string | null;
}

// Employee Meta (KYC, Bank, Emergency)
export interface EmployeeMeta {
  id: string;
  employee_id: string;
  pan_number?: string;
  aadhaar_number?: string;
  passport_number?: string;
  voter_id?: string;
  driving_license?: string;
  bank_name?: string;
  bank_account_number?: string;
  bank_ifsc_code?: string;
  bank_branch?: string;
  emergency_contact_name?: string;
  emergency_contact_phone?: string;
  emergency_contact_relationship?: string;
  emergency_contact_address?: string;
  custom_fields?: Record<string, any>;
  created_at: string;
  updated_at: string;
}

// Audit Log
export interface AuditLog {
  id: string;
  table_name: string;
  record_id: string;
  action: AuditAction;
  old_values?: Record<string, any> | null;
  new_values?: Record<string, any> | null;
  changed_columns?: string[] | null;
  performed_by?: string | null;
  performed_at: string;
  ip_address?: string;
  user_agent?: string;
}

// Enhanced Employee (with department/designation)
export interface EnhancedEmployee {
  id: string;
  name: string;
  email: string;
  phone?: string;
  employee_number?: string;
  role_name: string;
  role_id: string;
  office_name: string;
  office_id: string;
  department_id?: string;
  department_name?: string;
  designation_id?: string;
  designation_name?: string;
  designation_level?: number;
  employment_status: EmploymentStatus;
  joining_date?: string;
  exit_date?: string;
  reporting_manager_id?: string;
  reporting_manager_name?: string;
  is_active: boolean;
  username?: string;
  created_at: string;
}

// Employee Lifecycle Event
export interface EmployeeLifecycleEvent {
  id: string;
  employee_id: string;
  from_status: EmploymentStatus;
  to_status: EmploymentStatus;
  reason?: string;
  triggered_by: string;
  triggered_at: string;
}

// Document with enhanced categorization
export interface EmployeeDocument {
  id: string;
  employee_id: string;
  document_type: 'KYC' | 'CONTRACT' | 'PAYSLIP' | 'POLICY' | 'CERTIFICATE' | 'OTHER';
  document_name: string;
  file_url: string;
  file_size?: number;
  mime_type?: string;
  expiry_date?: string;
  is_verified: boolean;
  verified_by?: string;
  verified_at?: string;
  uploaded_at: string;
}

