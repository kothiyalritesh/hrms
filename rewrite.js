const fs = require('fs');
let dump = fs.readFileSync('dump-postgres-202609011610.sql', 'utf8');

function extractBlock(signature) {
  let idx = dump.indexOf(signature);
  if (idx === -1) return "-- NOT FOUND: " + signature;
  
  // find the next SQL statement terminator. For functions it's usually $$; or just $$
  // but for views it's ;
  let endIdx = -1;
  if (signature.includes("FUNCTION")) {
    endIdx = dump.indexOf("$$;", idx);
    if (endIdx !== -1) endIdx += 3;
    else {
      endIdx = dump.indexOf("$$", idx + signature.length);
      if (endIdx !== -1) endIdx += 2;
    }
  } else {
    endIdx = dump.indexOf(";", idx);
    if (endIdx !== -1) endIdx += 1;
  }
  
  if (endIdx === -1) return "-- END NOT FOUND FOR: " + signature;
  return dump.substring(idx, endIdx);
}

let blocks = [
  "GRANT SELECT ON public.v_attendance_daily_canonical TO authenticated;",
  "GRANT SELECT ON public.v_attendance_daily_canonical TO anon;",
  "GRANT SELECT ON public.v_attendance_daily_canonical TO service_role;",
  extractBlock("CREATE OR REPLACE VIEW public.v_attendance_daily_intelligence"),
  extractBlock("CREATE VIEW public.v_attendance_daily_intelligence"), // in case it's not OR REPLACE
  extractBlock("CREATE FUNCTION public.rpc_my_attendance_daily_v3"),
  extractBlock("CREATE OR REPLACE FUNCTION public.rpc_my_attendance_daily_v3"),
  extractBlock("CREATE FUNCTION public.rpc_get_regularization_requests"),
  extractBlock("CREATE OR REPLACE FUNCTION public.rpc_get_regularization_requests"),
  "NOTIFY pgrst, 'reload schema';"
];

fs.writeFileSync('supabase/migrations/20260928000001_restore_dropped_views.sql', blocks.filter(b => !b.startsWith("-- NOT FOUND")).join('\n\n'), 'utf8');
console.log("Restoration file rewritten");
