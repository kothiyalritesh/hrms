const fs = require('fs');
let code = fs.readFileSync('COMBINED_MIGRATIONS.sql', 'utf-8');

// 1. Fix observer summary (total_visits -> total_employees)
code = code.replace(/'total_visits',\s*COALESCE\(COUNT\(\*\)::int,\s*0\)/, "'total_employees', COALESCE(COUNT(*)::int, 0)");
code = code.replace(/'total_visits',\s*COALESCE\(COUNT\(\)::int,\s*0\)/, "'total_employees', COALESCE(COUNT(*)::int, 0)");
code = code.replace(/'in_transit',\s*COALESCE\(COUNT\(\*\)\s*FILTER\s*\(WHERE computed_status = 'IN_TRANSIT'\)::int,\s*0\)/, "'employees_in_transit', COALESCE(COUNT(*) FILTER (WHERE computed_status = 'IN_TRANSIT')::int, 0)");
code = code.replace(/'in_transit',\s*COALESCE\(COUNT\(\)\s*FILTER\s*\(WHERE computed_status = 'IN_TRANSIT'\)::int,\s*0\)/, "'employees_in_transit', COALESCE(COUNT(*) FILTER (WHERE computed_status = 'IN_TRANSIT')::int, 0)");
code = code.replace(/'at_site',\s*COALESCE\(COUNT\(\*\)\s*FILTER\s*\(WHERE computed_status = 'AT_SITE'\)::int,\s*0\)/, "'employees_at_site', COALESCE(COUNT(*) FILTER (WHERE computed_status = 'AT_SITE')::int, 0)");
code = code.replace(/'at_site',\s*COALESCE\(COUNT\(\)\s*FILTER\s*\(WHERE computed_status = 'AT_SITE'\)::int,\s*0\)/, "'employees_at_site', COALESCE(COUNT(*) FILTER (WHERE computed_status = 'AT_SITE')::int, 0)");
code = code.replace(/'completed',\s*COALESCE\(COUNT\(\*\)\s*FILTER\s*\(WHERE computed_status = 'COMPLETED'\)::int,\s*0\)/, "'employees_completed', COALESCE(COUNT(*) FILTER (WHERE computed_status = 'COMPLETED')::int, 0)");
code = code.replace(/'completed',\s*COALESCE\(COUNT\(\)\s*FILTER\s*\(WHERE computed_status = 'COMPLETED'\)::int,\s*0\)/, "'employees_completed', COALESCE(COUNT(*) FILTER (WHERE computed_status = 'COMPLETED')::int, 0)");
code = code.replace(/'signal_lost',\s*COALESCE\(COUNT\(\*\)\s*FILTER\s*\(WHERE computed_status = 'SIGNAL_LOST'\)::int,\s*0\)/, "'employees_signal_lost', COALESCE(COUNT(*) FILTER (WHERE computed_status = 'SIGNAL_LOST')::int, 0)");

// 2. Fix Birthday Feb 29
code = code.replace(/make_date\(\s*curr_year\.y,\s*extract\(month FROM date_of_birth\)::int,\s*extract\(day FROM date_of_birth\)::int\s*\)/g, "(date_of_birth + ((curr_year.y - extract(year FROM date_of_birth)::int) || ' years')::interval)::date");

// 3. Fix Gender fallback
code = code.replace(/IF upper\(v_emp\.gender\) = 'FEMALE' THEN\s*v_target := p_female_days;\s*ELSE\s*v_target := p_male_days;\s*END IF;/g, "IF upper(v_emp.gender) = 'FEMALE' THEN\n      v_target := p_female_days;\n    ELSIF upper(v_emp.gender) = 'MALE' THEN\n      v_target := p_male_days;\n    ELSE\n      CONTINUE;\n    END IF;");

// 4. Fix office_id in unified_activity_log
code = code.replace(/'Checked in at ' \|\| COALESCE\(office_id::text, 'Office'\) as description/g, "'Checked in' as description");

// 5. Hardening (Security Definer)
const secureStatements = `
-- ==========================================
-- SECURITY HARDENING (Least Privilege)
-- ==========================================
REVOKE ALL ON FUNCTION public.rpc_admin_reset_all_leave_balances(text, numeric, numeric, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.rpc_admin_reset_all_leave_balances(text, numeric, numeric, text) TO authenticated;

REVOKE ALL ON FUNCTION public.get_site_visit_observer_data(date, uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_site_visit_observer_data(date, uuid, uuid) TO authenticated;

REVOKE ALL ON FUNCTION public.rpc_admin_audit_logs_summary() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.rpc_admin_audit_logs_summary() TO authenticated;
`;
code = code.replace(/-- ==========================================\n-- COMBINED HRMS MIGRATIONS \(PHASE 3 & 4\)/, "-- ==========================================\n-- COMBINED HRMS MIGRATIONS (PHASE 3 & 4) - V3 (PRODUCTION HARDENED)");

code += "\n\n" + secureStatements;
fs.writeFileSync('COMBINED_MIGRATIONS_V3.sql', code);
console.log("Generated COMBINED_MIGRATIONS_V3.sql");
