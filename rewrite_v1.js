const fs = require('fs');
let dump = fs.readFileSync('dump-postgres-202609011610.sql', 'utf8');

function extractBlock(signature) {
  let idx = dump.indexOf(signature);
  if (idx === -1) return "-- NOT FOUND: " + signature;
  
  let endIdx = dump.indexOf("$$;", idx);
  if (endIdx !== -1) endIdx += 3;
  else {
    endIdx = dump.indexOf("$$", idx + signature.length);
    if (endIdx !== -1) endIdx += 2;
  }
  
  return dump.substring(idx, endIdx);
}

let v1 = extractBlock("CREATE FUNCTION public.rpc_get_my_monthly_attendance(p_month date)");

v1 = v1.replace("CREATE FUNCTION", "CREATE OR REPLACE FUNCTION");

// The original logic checks weekly_off_rules. We want to ADD the check for profiles.weekly_off_day BEFORE it.
let weeklyOffCheck = `
      if v_status is null and exists (
        select 1 from public.weekly_off_rules weekly
`;

let newWeeklyOffCheck = `
      if v_status is null and v_profile.weekly_off_day is not null and v_profile.weekly_off_day = extract(dow from v_date)::integer then
        v_status := 'weeklyoff';
      end if;

      if v_status is null and exists (
        select 1 from public.weekly_off_rules weekly
`;

v1 = v1.replace(weeklyOffCheck, newWeeklyOffCheck);

// Also we need to make sure we query weekly_off_day in the initial profile select
v1 = v1.replace(
  "profile.role,\n    profile.joining_date",
  "profile.role,\n    profile.joining_date,\n    profile.weekly_off_day"
);

fs.writeFileSync('supabase/migrations/20260928000002_restore_v1_attendance.sql', v1, 'utf8');
console.log("Restoration file 2 created");
