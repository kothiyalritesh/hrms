const net = require("net");
const host = "122.176.140.154";
const timeout = 1000;
const concurrency = 250;

// High port candidate list
const highPorts = [];
for (let p = 10000; p <= 65535; p += 10) highPorts.push(p);
for (let p = 10001; p <= 15000; p++) highPorts.push(p);

console.log(`Checking ${highPorts.length} high ports on ${host}...`);
const open = [];

function check(port) {
  return new Promise((resolve) => {
    const s = new net.Socket();
    s.setTimeout(timeout);
    s.on("connect", () => {
      open.push(port);
      console.log(`FOUND HIGH OPEN PORT: ${port}`);
      s.destroy();
      resolve();
    });
    s.on("timeout", () => { s.destroy(); resolve(); });
    s.on("error", () => { s.destroy(); resolve(); });
    s.connect(port, host);
  });
}

async function run() {
  for (let i = 0; i < highPorts.length; i += concurrency) {
    await Promise.all(highPorts.slice(i, i + concurrency).map(check));
  }
  console.log("High ports scan complete. Open ports:", open);
}
run();
