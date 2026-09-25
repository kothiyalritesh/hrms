/**
 * Local SmartOffice Proxy Server
 * 
 * Proxies requests between local HRMS / testing tools and the biometric machine at:
 * http://122.176.140.154:81
 * 
 * Usage:
 *   node proxy-server.js
 */

const http = require("http");
const https = require("https");
const url = require("url");

const PORT = process.env.PORT || 3001;
const SMARTOFFICE_API_URL = process.env.SMARTOFFICE_API_URL || "http://122.176.140.154:81";
const API_KEY = process.env.SMARTOFFICE_API_KEY || "240916062617";
const API_ACCOUNT_NAME = process.env.SMARTOFFICE_API_ACCOUNT_NAME || "smart";

const server = http.createServer((req, res) => {
  // CORS Headers
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, apikey");

  if (req.method === "OPTIONS") {
    res.writeHead(200);
    res.end();
    return;
  }

  const parsedUrl = url.parse(req.url, true);
  const targetUrl = new URL(parsedUrl.pathname, SMARTOFFICE_API_URL);

  // Set API Credentials
  targetUrl.searchParams.set("APIKey", API_KEY);
  for (const [key, value] of Object.entries(parsedUrl.query)) {
    if (value) targetUrl.searchParams.set(key, value);
  }
  if (API_ACCOUNT_NAME && parsedUrl.pathname !== "/api/v2/WebAPI/GetDeviceLogs") {
    targetUrl.searchParams.set("APIAccountName", API_ACCOUNT_NAME);
  }

  console.log(`[Proxy] ${req.method} ${req.url} -> ${targetUrl.toString()}`);

  const client = targetUrl.protocol === "https:" ? https : http;
  const proxyReq = client.request(
    targetUrl.toString(),
    {
      method: req.method,
      headers: {
        Accept: "application/json",
      },
      timeout: 20000,
    },
    (proxyRes) => {
      res.writeHead(proxyRes.statusCode, {
        "Content-Type": proxyRes.headers["content-type"] || "application/json",
      });
      proxyRes.pipe(res);
    }
  );

  proxyReq.on("error", (err) => {
    console.error("[Proxy Error]", err.message);
    res.writeHead(502, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "SMARTOFFICE_UNAVAILABLE", message: err.message }));
  });

  req.pipe(proxyReq);
});

server.listen(PORT, () => {
  console.log(`=======================================================`);
  console.log(`SmartOffice Local Proxy running on http://localhost:${PORT}`);
  console.log(`Target: ${SMARTOFFICE_API_URL}`);
  console.log(`API Key: ${API_KEY}`);
  console.log(`Account Name: ${API_ACCOUNT_NAME}`);
  console.log(`=======================================================`);
});
