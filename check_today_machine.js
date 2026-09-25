const net = require("net");

async function checkToday() {
  console.log("=== CHECKING BIOMETRIC MACHINE STATUS FOR TODAY (2026-08-27) ===");
  const host = "122.176.140.154";
  const port = 81;
  const apiKey = "240916062617";
  const today = "2026-08-27";

  // 1. Test TCP connection
  console.log(`1. Testing TCP Connection to ${host}:${port}...`);
  const tcpResult = await new Promise((resolve) => {
    const s = new net.Socket();
    s.setTimeout(4000);
    s.on("connect", () => { s.destroy(); resolve("SUCCESS"); });
    s.on("timeout", () => { s.destroy(); resolve("TIMEOUT"); });
    s.on("error", (err) => { s.destroy(); resolve(`ERROR: ${err.message}`); });
    s.connect(port, host);
  });
  console.log(`TCP Connection Result: ${tcpResult}`);

  // 2. Test HTTP API endpoint
  const url = `http://${host}:${port}/api/v2/WebAPI/GetDeviceLogs?APIKey=${apiKey}&FromDate=${today}&ToDate=${today}`;
  console.log(`\n2. Querying SmartOffice Device Logs for Today:`);
  console.log(`URL: ${url}`);
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(6000) });
    console.log(`HTTP Status: ${res.status}`);
    const data = await res.json();
    const records = Array.isArray(data) ? data : (data.records || data.result || []);
    console.log(`Total punches retrieved from machine for today: ${records.length}`);
    if (records.length > 0) {
      console.log("\nSample punches from machine today:");
      console.log(JSON.stringify(records.slice(0, 5), null, 2));
    }
  } catch (err) {
    console.log(`HTTP Query Result: ${err.message}`);
  }
}

checkToday();
