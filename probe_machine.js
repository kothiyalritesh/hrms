const http = require("http");

async function probe() {
  const dates = [
    { from: "2026-08-26", to: "2026-08-26" },
    { from: "2026-08-25", to: "2026-08-26" },
    { from: "2024-01-01", to: "2024-01-02" }
  ];

  for (const d of dates) {
    const target = `http://122.176.140.154:81/api/v2/WebAPI/GetDeviceLogs?APIKey=240916062617&FromDate=${d.from}&ToDate=${d.to}`;
    console.log(`Probing: ${target}`);
    try {
      const res = await fetch(target, { signal: AbortSignal.timeout(6000) });
      console.log(`Status: ${res.status}`);
      const text = await res.text();
      console.log(`Response length: ${text.length}`);
      console.log(`Preview: ${text.slice(0, 300)}`);
      break;
    } catch (e) {
      console.log(`Failed for ${d.from} -> ${d.to}: ${e.message}`);
    }
  }
}

probe();
