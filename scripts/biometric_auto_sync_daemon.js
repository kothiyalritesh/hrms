const { createClient } = require("@supabase/supabase-js");

// rpc_sync_biometric_punches is restricted to the service role
// (migration 20261006101000), so this daemon needs the service-role key.
// Never commit these values; set them in the environment of the machine
// that runs the daemon.
const SUPABASE_URL = process.env.SUPABASE_URL || "https://fuchvtzbgwzdpzfaizbj.supabase.co";
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const SMARTOFFICE_URL = process.env.SMARTOFFICE_URL || "http://122.176.140.154:81";
const SMARTOFFICE_API_KEY = process.env.SMARTOFFICE_API_KEY;

if (!SUPABASE_SERVICE_ROLE_KEY || !SMARTOFFICE_API_KEY) {
  console.error(
    "Missing SUPABASE_SERVICE_ROLE_KEY or SMARTOFFICE_API_KEY environment variable.",
  );
  process.exit(1);
}

const MACHINE_URL = `${SMARTOFFICE_URL}/api/v2/WebAPI/GetDeviceLogs?APIKey=${encodeURIComponent(SMARTOFFICE_API_KEY)}`;

// Real-time polling interval: 3 seconds (customizable via --interval flag or env)
const intervalArg = process.argv.find((a) => a.startsWith("--interval="));
const POLL_INTERVAL_MS = intervalArg
  ? Number(intervalArg.split("=")[1])
  : Number(process.env.POLL_INTERVAL_MS) || 3000;

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

function getTodayIST() {
  const now = new Date();
  const istOffset = 5.5 * 60 * 60 * 1000;
  const istDate = new Date(now.getTime() + istOffset);
  return istDate.toISOString().slice(0, 10);
}

let lastRecordCount = -1;
let lastLatestPunch = "";
let isSyncing = false;

async function syncPunches() {
  if (isSyncing) return;
  isSyncing = true;

  const today = getTodayIST();
  const timestamp = new Date().toLocaleTimeString();
  const url = `${MACHINE_URL}&FromDate=${today}&ToDate=${today}`;

  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(5000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    const records = Array.isArray(data) ? data : (data.records || data.result || []);

    if (records.length === 0) {
      if (lastRecordCount !== 0) {
        console.log(`[${timestamp}] [REALTIME] No punches on machine yet for ${today}.`);
        lastRecordCount = 0;
      }
      return;
    }

    // Find the latest punch timestamp in the batch
    const latestRecord = records[records.length - 1];
    const latestPunch = latestRecord?.LogDate || "";

    // Check if new punches arrived since last check
    const hasNewPunches = records.length !== lastRecordCount || latestPunch !== lastLatestPunch;

    if (hasNewPunches) {
      console.log(`[${timestamp}] [REALTIME] Detected new punches! Machine count: ${records.length} (Previous: ${lastRecordCount}). Syncing to Supabase...`);

      // Call Supabase RPC to check-in users automatically
      const { data: result, error } = await supabase.rpc("rpc_sync_biometric_punches", {
        p_punches: records,
      });

      if (error) {
        console.error(`[${timestamp}] [REALTIME] Database sync error:`, error.message);
      } else {
        lastRecordCount = records.length;
        lastLatestPunch = latestPunch;
        console.log(`[${timestamp}] [REALTIME] Check-in Complete! Attendance updated in realtime:`, result);
      }
    }
  } catch (err) {
    console.error(`[${timestamp}] [REALTIME] Sync check error:`, err.message);
  } finally {
    isSyncing = false;
  }
}

// Initial sync
console.log(`[REALTIME] Starting Biometric Realtime Sync Stream (Polling interval: ${POLL_INTERVAL_MS}ms / ${POLL_INTERVAL_MS / 1000}s)...`);
syncPunches();

// Daemon loop
if (process.argv.includes("--daemon") || process.argv.includes("-d") || !process.argv.includes("--once")) {
  setInterval(syncPunches, POLL_INTERVAL_MS);
}
