const http = require("http");

async function checkLocal() {
  const ports = [80, 81, 8080, 8081, 8000, 3000, 3001, 8888, 5000];
  console.log("Checking local machine ports for SmartOffice WebAPI...");
  for (const port of ports) {
    try {
      const url = `http://127.0.0.1:${port}/api/v2/WebAPI/GetDeviceLogs?APIKey=240916062617&FromDate=2026-08-26&ToDate=2026-08-26`;
      const res = await fetch(url, { signal: AbortSignal.timeout(1500) });
      console.log(`FOUND WebAPI on local port ${port}! Status: ${res.status}`);
      const data = await res.json();
      console.log(`Records count: ${Array.isArray(data) ? data.length : (data.records || []).length}`);
    } catch (e) {
      // not on this port
    }
  }
  console.log("Local probe finished.");
}
checkLocal();
