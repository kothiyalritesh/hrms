const fs = require('fs');
const content = fs.readFileSync('COMBINED_MIGRATIONS_V3.sql', 'utf-8');

const match = content.match(/CREATE OR REPLACE VIEW public\.v_attendance_daily_canonical[\s\S]*?;\n/);
if (match) {
  const sql = "DROP VIEW IF EXISTS public.v_attendance_daily_canonical CASCADE;\n" + match[0] + "GRANT SELECT ON public.v_attendance_daily_canonical TO authenticated, anon;\nNOTIFY pgrst, 'reload schema';\n";
  fs.writeFileSync('fix_view.sql', sql, 'utf-8');
  console.log("Extracted view definition");
} else {
  console.log("Not found");
}
