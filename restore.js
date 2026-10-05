const fs = require('fs');
let dump = fs.readFileSync('dump-postgres-202609011610.sql', 'utf8');

function extract(startStr, stopStr) {
  let res = [];
  let idx = 0;
  while ((idx = dump.indexOf(startStr, idx)) !== -1) {
    let endIdx = dump.indexOf(stopStr, idx);
    if (endIdx === -1) break;
    res.push(dump.substring(idx, endIdx + stopStr.length));
    idx = endIdx + stopStr.length;
  }
  return res;
}

const fns = [
  ...extract('CREATE FUNCTION public.rpc_my_attendance_daily_v3', '$$;'),
  ...extract('CREATE VIEW public.v_attendance_daily_intelligence', ';'),
  ...extract('CREATE FUNCTION public.rpc_get_regularization_requests', '$$;')
];

const grants = [
  "GRANT SELECT ON public.v_attendance_daily_canonical TO authenticated;",
  "GRANT SELECT ON public.v_attendance_daily_canonical TO anon;",
  "GRANT SELECT ON public.v_attendance_daily_canonical TO service_role;"
];

fs.writeFileSync('supabase/migrations/20260928000001_restore_dropped_views.sql', [...grants, ...fns, "NOTIFY pgrst, 'reload schema';"].join('\n\n'), 'utf8');
console.log("Restoration file created");
