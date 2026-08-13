const express = require("express");
const path = require("path");

const app = express();
const distDirectory = path.resolve(__dirname, "..", "dist");
const port = Number(process.env.PORT || 8081);
const basePath = "/HRMS";

app.disable("x-powered-by");
app.use((request, response, next) => {
  response.setHeader("X-Content-Type-Options", "nosniff");
  response.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  response.setHeader("X-Frame-Options", "DENY");
  next();
});

app.get("/", (_request, response) => {
  response.redirect(302, `${basePath}/`);
});

app.use(
  basePath,
  express.static(distDirectory, {
    index: false,
    setHeaders(response, filePath) {
      const fileName = path.basename(filePath);
      if (fileName === "sw.js" || fileName === "manifest.webmanifest") {
        response.setHeader("Cache-Control", "no-cache");
      } else if (/[.-][a-f0-9]{20,}\./i.test(fileName)) {
        response.setHeader(
          "Cache-Control",
          "public, max-age=31536000, immutable",
        );
      }
    },
  }),
);

app.use((request, response) => {
  const acceptsHtml = request.accepts("html");
  const looksLikeAsset = /\.[a-z0-9]{1,8}(?:\?|$)/i.test(request.path);
  if (
    !["GET", "HEAD"].includes(request.method) ||
    !(request.path === basePath || request.path.startsWith(`${basePath}/`)) ||
    !acceptsHtml ||
    looksLikeAsset
  ) {
    response.status(404).type("text/plain").send("Not found");
    return;
  }
  response.setHeader("Cache-Control", "no-cache");
  response.sendFile(path.join(distDirectory, "index.html"));
});

app.listen(port, "0.0.0.0", () => {
  console.log(
    `Optimized HRMS web preview ready at http://localhost:${port}${basePath}/`,
  );
});
