const net = require("net");

const host = "122.176.140.154";
const concurrency = 200;
const timeout = 1200;

// Priority ports first
const priorityPorts = [
  80, 81, 82, 83, 84, 85, 88, 90, 443, 3000, 3001, 4370, 5000, 5001, 7001, 
  8000, 8001, 8080, 8081, 8082, 8085, 8088, 8090, 8181, 8282, 8443, 8888, 9000, 9090, 9999
];

// Wider range: 1 to 10000
const allPorts = Array.from(new Set([
  ...priorityPorts,
  ...Array.from({ length: 9999 }, (_, i) => i + 1)
]));

console.log(`Starting scan of ${allPorts.length} ports on ${host}...`);

const openPorts = [];

function checkPort(port) {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    socket.setTimeout(timeout);
    socket.on("connect", () => {
      openPorts.push(port);
      console.log(`>>> OPEN PORT FOUND: ${port} <<<`);
      socket.destroy();
      resolve(port);
    });
    socket.on("timeout", () => {
      socket.destroy();
      resolve(null);
    });
    socket.on("error", () => {
      socket.destroy();
      resolve(null);
    });
    socket.connect(port, host);
  });
}

async function runScan() {
  const startTime = Date.now();
  for (let i = 0; i < allPorts.length; i += concurrency) {
    const batch = allPorts.slice(i, i + concurrency);
    await Promise.all(batch.map(checkPort));
    if ((i + concurrency) % 2000 === 0 || i + concurrency >= allPorts.length) {
      console.log(`Scanned ${Math.min(i + concurrency, allPorts.length)} / ${allPorts.length} ports...`);
    }
  }

  console.log(`\nScan finished in ${((Date.now() - startTime) / 1000).toFixed(1)}s.`);
  console.log(`All open ports found on ${host}:`, openPorts);

  // Now probe each open port with HTTP / SmartOffice WebAPI
  for (const port of openPorts) {
    console.log(`\nTesting HTTP on open port ${port}...`);
    try {
      const url = `http://${host}:${port}/api/v2/WebAPI/GetDeviceLogs?APIKey=240916062617&FromDate=2026-08-26&ToDate=2026-08-26`;
      const res = await fetch(url, { signal: AbortSignal.timeout(3000) });
      console.log(`Port ${port} /api/v2/WebAPI/GetDeviceLogs -> HTTP ${res.status}`);
      const body = await res.text();
      console.log(`Response snippet:`, body.slice(0, 300));
    } catch (e) {
      console.log(`Port ${port} WebAPI query error:`, e.message);
      // Try root URL
      try {
        const resRoot = await fetch(`http://${host}:${port}/`, { signal: AbortSignal.timeout(2000) });
        console.log(`Port ${port} root URL / -> HTTP ${resRoot.status}`);
        const bodyRoot = await resRoot.text();
        console.log(`Root page title/snippet:`, bodyRoot.slice(0, 200));
      } catch (errRoot) {
        console.log(`Port ${port} root HTTP error:`, errRoot.message);
      }
    }
  }
}

runScan();
