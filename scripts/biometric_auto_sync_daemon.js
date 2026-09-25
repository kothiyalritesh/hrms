const { createClient } = require("@supabase/supabase-js");

const SUPABASE_URL = "https://fuchvtzbgwzdpzfaizbj.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_SVIfa_ezLPPgKaQ7xlw3mA_uS2_p4PX";

const MACHINE_URL = "http://122.176.140.154:81/api/v2/WebAPI/GetDeviceLogs?APIKey=240916062617";

// Real-time polling interval: 3 seconds (customizable via --interval flag or env)
const intervalArg = process.argv.find((a) => a.startsWith("--interval="));
const POLL_INTERVAL_MS = intervalArg
  ? Number(intervalArg.split("=")[1])
  : Number(process.env.POLL_INTERVAL_MS) || 3000;

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

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
