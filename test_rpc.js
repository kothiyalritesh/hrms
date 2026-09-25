const fetch = require('node-fetch'); // we can just use global fetch in modern node
async function test() {
  const url = "https://fuchvtzbgwzdpzfaizbj.supabase.co/rest/v1/rpc/rpc_admin_attendance_daily_v3";
  const body = {
    p_start: "2026-09-18",
    p_end: "2026-09-18",
    p_offset: 0,
    p_limit: 50
  };
  const res = await globalThis.fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "apikey": "sb_publishable_SVIfa_ezLPPgKaQ7xlw3mA_uS2_p4PX",
      // we don't have a user token, so this will either hit RLS or fail. 
      // But rpc_admin_attendance_daily_v3 has a SECURITY DEFINER, and internally calls require_profile_admin().
      // Without Auth token, auth.uid() is null. It should return ADMIN_REQUIRED.
    },
    body: JSON.stringify(body)
  });
  console.log(res.status);
  console.log(await res.text());
}
test();