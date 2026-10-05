const fs = require('fs');

let code = fs.readFileSync('COMBINED_MIGRATIONS_V2.sql', 'utf-8');

// Add REVOKE/GRANT to rpc_admin_reset_all_leave_balances
code = code.replace(
  /END;\s*\$\$;/g,
  "END;\n$$;\nREVOKE ALL ON FUNCTION public.rpc_admin_reset_all_leave_balances(text, numeric, numeric, text) FROM PUBLIC;\nGRANT EXECUTE ON FUNCTION public.rpc_admin_reset_all_leave_balances(text, numeric, numeric, text) TO authenticated;"
);

// We need to specifically replace only for that function, so let's do a more precise replacement.
// Actually, it's easier to just append the REVOKE/GRANT statements at the end of the combined file!
const secureStatements = `
-- SECURITY HARDENING
REVOKE ALL ON FUNCTION public.rpc_admin_reset_all_leave_balances(text, numeric, numeric, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.rpc_admin_reset_all_leave_balances(text, numeric, numeric, text) TO authenticated;

REVOKE ALL ON FUNCTION public.get_site_visit_observer_data(date, uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_site_visit_observer_data(date, uuid, uuid) TO authenticated;

REVOKE ALL ON FUNCTION public.rpc_admin_audit_logs_summary() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.rpc_admin_audit_logs_summary() TO authenticated;
`;

code += "\n\n" + secureStatements;
fs.writeFileSync('COMBINED_MIGRATIONS_V3.sql', code);
console.log("V3 Created.");
