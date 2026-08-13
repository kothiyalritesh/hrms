// metro.config.js
const { getDefaultConfig } = require("expo/metro-config");
const https = require("https");
const path = require("path");

const config = getDefaultConfig(__dirname);

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

const generatedDirectories = [
  "dist",
  ".bop-hosting-package",
  ".bop-backend-package",
  ".expo-check-20260725",
  ".expo-check-biometric-20260727",
  ".expo-check-event-checkout-20260727",
];
const generatedBlockList = generatedDirectories.map((directory) => {
  const absoluteParts = path.resolve(__dirname, directory).split(path.sep);
  const portablePath = absoluteParts.map(escapeRegExp).join("[\\\\/]");
  return new RegExp(`^${portablePath}[\\\\/].*`);
});
const defaultBlockList = config.resolver.blockList;
config.resolver.blockList = [
  ...(Array.isArray(defaultBlockList)
    ? defaultBlockList
    : defaultBlockList
      ? [defaultBlockList]
      : []),
  ...generatedBlockList,
];

// ── Dev-server CORS proxy for Mappls APIs ─────────────────────────────────────
// Mappls (atlas.mappls.com) does not send CORS headers for browser requests.
// This middleware intercepts /mappls-api/* and /mappls-auth/* and forwards
// them server-side (Node.js has no CORS restriction), then injects CORS headers.
config.server = {
  enhanceMiddleware: (middleware) => {
    return (req, res, next) => {
      // Handle CORS preflight
      if (req.method === "OPTIONS") {
        res.writeHead(204, {
          "access-control-allow-origin": "*",
          "access-control-allow-methods": "GET, POST, OPTIONS",
          "access-control-allow-headers": "Content-Type, Authorization",
        });
        res.end();
        return;
      }

      // /mappls-api/* → https://atlas.mappls.com/api/*
      if (req.url.startsWith("/mappls-api/")) {
        const path = req.url.slice("/mappls-api/".length); // e.g. "places/search/json?query=..."
        return proxyTo(req, res, "atlas.mappls.com", "/api/" + path);
      }

      // /mappls-auth/* → https://outpost.mappls.com/api/*
      if (req.url.startsWith("/mappls-auth/")) {
        const path = req.url.slice("/mappls-auth/".length);
        return proxyTo(req, res, "outpost.mappls.com", "/api/" + path);
      }

      return middleware(req, res, next);
    };
  },
};

function proxyTo(req, res, hostname, path) {
  console.log(`[Mappls Proxy] ${req.method} https://${hostname}${path}`);

  const options = {
    hostname,
    port: 443,
    path,
    method: req.method,
    headers: {
      accept: "application/json",
      "accept-language": "en",
      "user-agent": "RealtyHRMS/1.0",
      "content-type": req.headers["content-type"] || "application/json",
    },
  };

  const proxyReq = https.request(options, (proxyRes) => {
    console.log(`[Mappls Proxy] Response: ${proxyRes.statusCode}`);
    const headers = {
      "content-type": proxyRes.headers["content-type"] || "application/json",
      "access-control-allow-origin": "*",
      "access-control-allow-methods": "GET, POST, OPTIONS",
      "access-control-allow-headers": "Content-Type, Authorization",
    };
    res.writeHead(proxyRes.statusCode, headers);
    proxyRes.pipe(res, { end: true });
  });

  proxyReq.on("error", (err) => {
    console.error("[Mappls Proxy] Request error:", err.message);
    if (!res.headersSent) {
      res.writeHead(502, {
        "content-type": "application/json",
        "access-control-allow-origin": "*",
      });
      res.end(JSON.stringify({ error: "proxy_error", message: err.message }));
    }
  });

  if (req.method === "POST" || req.method === "PUT") {
    req.pipe(proxyReq, { end: true });
  } else {
    proxyReq.end();
  }
}

module.exports = config;
