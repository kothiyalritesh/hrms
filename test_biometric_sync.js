const https = require("https");
const http = require("http");

async function check() {
  const machineUrl = "http://122.176.140.154:81/api/v2/WebAPI/GetDeviceLogs?APIKey=240916062617&FromDate=2026-08-26&ToDate=2026-08-27";
  console.log("1. Testing direct connection to machine:", machineUrl);
  try {
    const res = await fetch(machineUrl, { signal: AbortSignal.timeout(10000) });
    const data = await res.json();
    const records = Array.isArray(data) ? data : data.records || data.result || [];
    console.log("Direct machine returned records:", records.length);
    if (records.length > 0) {
      console.log("Sample punch:", records[0]);
    }
  } catch (err) {
    console.log("Direct machine fetch note:", err.message);
  }

  const anonKey = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImppZGJyd3B6ZnBidXJzaWh0dnBnIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQ0MTg3OTgsImV4cCI6MjA4OTk5NDc5OH0.P-j0skFmSd-WtqV5-wi51ArxAwE4ZBt3ctYBtY-mj-0";
  const edgeUrl = "https://jidbrwpzfpbursihtvpg.supabase.co/functions/v1/biometric-attendance-sync";
  console.log("\n2. Triggering biometric-attendance-sync edge function for today...");
  try {
    const edgeRes = await fetch(edgeUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${anonKey}`,
        "apikey": anonKey,
        "x-biometric-sync-source": "pg_cron"
      },
      body: JSON.stringify({
        fromDate: "2026-08-26",
        toDate: "2026-08-26"
      })
    });
    console.log("Edge function status:", edgeRes.status);
    const edgeData = await edgeRes.json();
    console.log("Edge function response:", JSON.stringify(edgeData, null, 2));
  } catch (err) {
    console.log("Edge function error:", err.message);
  }
}

check();
