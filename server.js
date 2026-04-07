const http = require("http");
const fs = require("fs");
const path = require("path");
const { URL } = require("url");
const { buildFallbackPayload, buildFreshPayload, buildPayload } = require("./lib/lists");

const PORT = process.env.PORT || 3001;
const PUBLIC_DIR = path.join(__dirname, "public");

const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
};

function sendJson(res, statusCode, payload) {
  res.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
  });
  res.end(JSON.stringify(payload));
}

function serveStatic(req, res) {
  let requestPath = req.url === "/" ? "/index.html" : req.url;
  requestPath = requestPath.split("?")[0];
  const safePath = path.normalize(requestPath).replace(/^(\.\.[/\\])+/, "");
  const filePath = path.join(PUBLIC_DIR, safePath);

  if (!filePath.startsWith(PUBLIC_DIR)) {
    sendJson(res, 403, { error: "Forbidden" });
    return;
  }

  fs.readFile(filePath, (err, contents) => {
    if (err) {
      sendJson(res, err.code === "ENOENT" ? 404 : 500, {
        error: err.code === "ENOENT" ? "Not found" : "Failed to read file",
      });
      return;
    }

    const ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, {
      "Content-Type": MIME_TYPES[ext] || "application/octet-stream",
      "Cache-Control": "no-store",
    });
    res.end(contents);
  });
}

const server = http.createServer(async (req, res) => {
  const requestUrl = new URL(req.url, `http://${req.headers.host}`);

  if (requestUrl.pathname === "/api/lists") {
    try {
      const shouldRefresh = requestUrl.searchParams.get("refresh") === "1";
      const payload = shouldRefresh ? await buildFreshPayload() : await buildPayload();
      sendJson(res, 200, payload);
    } catch (error) {
      sendJson(res, 200, buildFallbackPayload(error.message || "fetch failed"));
    }
    return;
  }

  serveStatic(req, res);
});

server.listen(PORT, () => {
  console.log(`Meet Congress Lists running at http://localhost:${PORT}`);
});