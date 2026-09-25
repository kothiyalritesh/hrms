const net = require("net");

async function scanSubnet() {
  console.log("Scanning local office subnet 192.168.1.x for port 81 (SmartOffice)...");
  const candidates = [];
  const promises = [];

  for (let i = 1; i <= 254; i++) {
    const ip = `192.168.1.${i}`;
    promises.push(new Promise((resolve) => {
      const socket = new net.Socket();
      socket.setTimeout(800);
      socket.on("connect", () => {
        candidates.push(ip);
        socket.destroy();
        resolve();
      });
      socket.on("timeout", () => {
        socket.destroy();
        resolve();
      });
      socket.on("error", () => {
        socket.destroy();
        resolve();
      });
      socket.connect(81, ip);
    }));
  }

  await Promise.all(promises);
  console.log("Scan complete. Found SmartOffice servers on local IPs:", candidates);
  
  for (const ip of candidates) {
    try {
      const res = await fetch(`http://${ip}:81/api/v2/WebAPI/GetDeviceLogs?APIKey=240916062617&FromDate=2026-08-26&ToDate=2026-08-26`, { signal: AbortSignal.timeout(3000) });
      const data = await res.json();
      console.log(`IP ${ip} returned status ${res.status}, records:`, Array.isArray(data) ? data.length : (data.records || []).length);
    } catch (e) {
      console.log(`IP ${ip} fetch error:`, e.message);
    }
  }
}

scanSubnet();
