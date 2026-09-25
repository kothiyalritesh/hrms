const fs = require('fs');
const file = 'd:/download/RealtyHRM-fixed/RealtyHRM-fixed/screens/admin/TVDisplayScreen.tsx';
let content = fs.readFileSync(file, 'utf8');

const replace = `      const [canonicalData, alertResult, visitsResult, leavesResult] = await Promise.all([
        CanonicalAttendanceService.listDay(today),
        supabase.from("location_alerts")
          .select("user_id, alert_type, message, distance_m")
          .eq("resolved", false)
          .order("created_at", { ascending: false })
          .limit(10),
        supabase.from("field_visits").select("user_id").eq("status", "COMPLETED").gte("created_at", todayStart),
        supabase.from("leave_requests").select("user_id").eq("status", "approved").lte("start_date", tomStr).gte("end_date", tomStr),
      ]);`;

const rgx = /const\s+\[canonicalData,\s*alertResult,\s*visitsResult,\s*leavesResult\]\s*=\s*await\s+Promise\.all\(\[\s*CanonicalAttendanceService\.listDay\(today\),\s*supabase\.from\("location_alerts"\)[^\]]+\]\);/ms;

if (rgx.test(content)) {
  content = content.replace(rgx, replace);
  fs.writeFileSync(file, content, 'utf8');
  console.log("Fixed!");
} else {
  console.log("Regex not matched");
}