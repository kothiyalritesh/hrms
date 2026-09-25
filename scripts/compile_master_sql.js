const fs = require('fs');
const path = require('path');

const migrations = [
  '20260908000000_site_visit_live_location_tracking.sql',
  '20260908010000_permissions_model.sql',
  '20260908050000_leave_admin_tools.sql',
  '20260908060000_employee_exit_archive.sql',
  '20260908070000_audit_logs_and_permission_scopes.sql',
  '20260908080000_rebuild_observer_rpc.sql',
  '20260908090000_enhanced_visit_reports.sql',
  '20260908100000_hrms_backlog_enhancements.sql',
  '20260908110000_production_performance_indexes.sql'
  '20260908110000_production_performance_indexes.sql',
  '20260909010000_multidimensional_permission_scopes.sql'
];

let output = `-- ==============================================================================
-- REALTYHRM MASTER ENHANCEMENTS DEPLOYMENT SCRIPT (2026-09-08)
--
-- This script encapsulates all 9 production-hardened migrations:
-- 1. Site Visit Live Location Tracking & Evidence Schema
-- 2. Fine-grained RBAC Permissions Engine
-- 3. Leave Balance Admin Adjustments & Audit Trail
-- 4. Employee Exit Archive Procedure
-- 5. Universal Audit Logs & Scoped Permissions (GLOBAL, BRANCH, DEPT, TEAM, SELF)
-- 6. Rebuilt Site Visit Observer RPC (get_site_visit_observer_data)
-- 7. Enhanced Visit Reports Export RPC (get_enhanced_visit_reports)
-- 8. Backlog Enhancements (Task on behalf, Attendance Exceptions, IP Allowlist, Field Feedback)
-- 9. Production Performance Indexes & RLS Hardening
-- ==============================================================================

`;

for (const m of migrations) {
  const filePath = path.join(__dirname, '../supabase/migrations', m);
  if (!fs.existsSync(filePath)) {
    console.error('Missing migration file:', m);
    process.exit(1);
  }
  const fileContent = fs.readFileSync(filePath, 'utf8').replace(/^\uFEFF/, '');
  output += `
-- ==============================================================================
-- BEGIN MIGRATION: ${m}
-- ==============================================================================

${fileContent}

-- ==============================================================================
-- END MIGRATION: ${m}
-- ==============================================================================
`;
}

const targetPath = path.join(__dirname, '../supabase/deploy_all_20260908_enhancements.sql');
fs.writeFileSync(targetPath, output, 'utf8');
console.log('Successfully compiled deploy_all_20260908_enhancements.sql');
console.log('Size:', fs.statSync(targetPath).size, 'bytes');

