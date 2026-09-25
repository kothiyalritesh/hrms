const apiKey = "240916062617";
const machineUrl = "http://122.176.140.154:81/api/v2/WebAPI/GetDeviceLogs?APIKey=240916062617&FromDate=2026-08-27&ToDate=2026-08-27";

async function fetchAndSummarize() {
  const res = await fetch(machineUrl);
  const data = await res.json();
  const records = Array.isArray(data) ? data : (data.records || data.result || []);
  console.log(`Retrieved ${records.length} punches from the machine for today.`);

  // Group by employee code
  const byCode = {};
  for (const r of records) {
    const code = String(r.EmployeeCode || "").trim();
    if (!code) continue;
    if (!byCode[code]) byCode[code] = [];
    byCode[code].push(r.LogDate);
  }

  console.log(`Unique employees who punched today (${Object.keys(byCode).length} employees):`);
  for (const [code, punches] of Object.entries(byCode)) {
    console.log(`  Code ${code}: ${punches.length} punch(es) -> First: ${punches[0]}, Last: ${punches[punches.length - 1]}`);
  }
}

fetchAndSummarize();
