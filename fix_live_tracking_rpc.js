const fs = require('fs');
let content = fs.readFileSync('screens/admin/LiveTrackingScreen.tsx', 'utf8');

// Replace view query with RPC query
content = content.replace(
  /supabase\.from\("v_attendance_daily_canonical"\)[\s\S]*?\.range\(from, to\),/,
  `supabase.rpc("rpc_admin_attendance_daily_v3", { p_start: today, p_end: today, p_offset: from, p_limit: to - from + 1 })`
);

// We need to fetch all pages, but fetchAllPages uses range(). rpc doesn't support .range().
// Let's rewrite how it fetches the canonical data.
const replacement = `
      // Fetch canonical attendance via RPC instead of querying the view directly (which is revoked for security)
      const fetchCanonical = async () => {
        let all: any[] = [];
        let offset = 0;
        let limit = 500;
        let hasMore = true;
        while (hasMore) {
          const { data, error } = await supabase.rpc("rpc_admin_attendance_daily_v3", {
            p_start: today,
            p_end: today,
            p_offset: offset,
            p_limit: limit,
          });
          if (error) throw error;
          if (!data || data.length === 0) break;
          all = all.concat(data);
          if (data.length < limit) hasMore = false;
          offset += limit;
        }
        return { data: all, error: null };
      };

      const [alertRes, meetRes, officeRes, attRes, pingRes, canonicalRes] = await Promise.all([
        supabase.from("location_alerts")
          .select("id,user_id,alert_type,message,distance_m,resolved,created_at,escalation_level,escalated_at,metadata,profiles(name)")
          .eq("resolved", false)
          .order("escalation_level", { ascending: false })
          .order("created_at", { ascending: false })
          .order("id")
          .limit(250),
        fetchAllPages<any>((from, to) =>
          supabase.from("field_visits")
            .select("*, profiles:user_id(name, employee_number, role)")
            .eq("date", today)
            .eq("visit_type", "meeting")
            .order("id")
            .range(from, to),
        ),
        supabase.from("offices").select("id, name, latitude, longitude").eq("is_active", true),
        fetchAllPages<any>((from, to) =>
          supabase.from("attendance_logs")
            .select("id, user_id, checkin_location, checkin_time, office_id")
            .eq("date", today)
            .eq("status", "CHECKED_IN")
            .order("id")
            .range(from, to),
        ),
        supabase.from("location_tracking")
            .select("id, user_id, latitude, longitude, recorded_at")
            .gte("recorded_at", dayStart)
            .lte("recorded_at", dayEnd)
            .order("recorded_at", { ascending: false }),
        fetchCanonical()
      ]);
`;

let newContent = fs.readFileSync('screens/admin/LiveTrackingScreen.tsx', 'utf8');

// I will use a Regex to replace the entire Promise.all block up to canonicalRes
newContent = newContent.replace(
  /const \[alertRes, meetRes, officeRes, attRes, pingRes, canonicalRes\] = await Promise\.all\(\[[\s\S]*?\.range\(from, to\),\n        \),\n      \]\);/,
  replacement.trim()
);

fs.writeFileSync('screens/admin/LiveTrackingScreen.tsx', newContent);
console.log('Fixed LiveTrackingScreen canonical query');
