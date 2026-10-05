const fs = require("fs");
const path = require("path");

function patchFile(filepath, patchFn) {
  if (fs.existsSync(filepath)) {
    let code = fs.readFileSync(filepath, "utf-8");
    code = patchFn(code);
    fs.writeFileSync(filepath, code);
  }
}

// 1. Fix observer summary (total_visits)
patchFile("supabase/migrations/20260926125423_fix_observer_summary_aggregation.sql", (code) => {
  return code
    .replace(/'total_visits', COALESCE\(COUNT\(\)::int, 0\)/, "'total_employees', COALESCE(COUNT()::int, 0)")
    .replace(/'in_transit', COALESCE\(COUNT\(\) FILTER \(WHERE computed_status = 'IN_TRANSIT'\)::int, 0\)/, "'employees_in_transit', COALESCE(COUNT() FILTER (WHERE computed_status = 'IN_TRANSIT')::int, 0)")
    .replace(/'at_site', COALESCE\(COUNT\(\) FILTER \(WHERE computed_status = 'AT_SITE'\)::int, 0\)/, "'employees_at_site', COALESCE(COUNT() FILTER (WHERE computed_status = 'AT_SITE')::int, 0)")
    .replace(/'completed', COALESCE\(COUNT\(\) FILTER \(WHERE computed_status = 'COMPLETED'\)::int, 0\)/, "'employees_completed', COALESCE(COUNT() FILTER (WHERE computed_status = 'COMPLETED')::int, 0)")
    .replace(/'signal_lost', COALESCE\(COUNT\(\*\) FILTER \(WHERE computed_status = 'SIGNAL_LOST'\)::int, 0\)/, "'employees_signal_lost', COALESCE(COUNT(*) FILTER (WHERE computed_status = 'SIGNAL_LOST')::int, 0)");
});

// 2. Fix Birthday Feb 29
patchFile("supabase/migrations/20260926130514_employee_birthdays.sql", (code) => {
  return code.replace(/make_date\(curr_year\.y, extract\(month FROM date_of_birth\)::int, extract\(day FROM date_of_birth\)::int\)/g, "(date_of_birth + ((curr_year.y - extract(year FROM date_of_birth)::int) || ' years')::interval)::date");
});

// 4. Fix Gender fallback
patchFile("supabase/migrations/20260926130011_reset_all_leave_balances_rpc.sql", (code) => {
  return code.replace(/IF upper\(v_emp\.gender\) = 'FEMALE' THEN\s*v_target := p_female_days;\s*ELSE\s*v_target := p_male_days;\s*END IF;/g, "IF upper(v_emp.gender) = 'FEMALE' THEN\n      v_target := p_female_days;\n    ELSIF upper(v_emp.gender) = 'MALE' THEN\n      v_target := p_male_days;\n    ELSE\n      CONTINUE;\n    END IF;");
});

// 6. Fix office_id in unified_activity_log
patchFile("supabase/migrations/20260926132549_unified_activity_log.sql", (code) => {
  return code.replace(/'Checked in at ' \|\| COALESCE\(office_id::text, 'Office'\) as description/g, "'Checked in' as description");
});

// Now recombine!
const dir = "supabase/migrations";
const files = fs.readdirSync(dir)
  .filter(f => f.startsWith("20260926") && f.endsWith(".sql"))
  .sort();

let combined = "-- ==========================================\n-- COMBINED HRMS MIGRATIONS (PHASE 3 & 4) - V2 (FIXED)\n-- Run this entire script in your Supabase SQL Editor\n-- ==========================================\n\n";

for (const f of files) {
  combined += `\n\n-- >>> START: ${f} <<<\n\n`;
  combined += fs.readFileSync(path.join(dir, f), "utf-8");
  combined += `\n\n-- <<< END: ${f} >>>\n`;
}

fs.writeFileSync("COMBINED_MIGRATIONS_V2.sql", combined);
console.log(`Patched and combined into COMBINED_MIGRATIONS_V2.sql`);
