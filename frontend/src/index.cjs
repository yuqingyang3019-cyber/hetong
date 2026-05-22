const http = require("node:http");
const https = require("node:https");
const { createReadStream, existsSync, statSync } = require("node:fs");
const { extname, join, normalize } = require("node:path");

const root = __dirname;
const port = Number(process.env.PORT || 9000);
const agentEndpoint = process.env.AGENT_ENDPOINT || "http://127.0.0.1:9010";
const dingtalkClientId = (process.env.DINGTALK_CLIENT_ID || "").trim();
const dingtalkCorpId = (process.env.DINGTALK_CORP_ID || "").trim();

const contentTypes = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
};
const proxyPrefixes = ["/api", "/ag-ui", "/contracts", "/uploads"];
const hopByHopHeaders = new Set([
  "connection",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
  "content-length",
]);

function send(res, status, body, contentType = "text/plain; charset=utf-8") {
  const data = Buffer.from(body);
  res.writeHead(status, {
    "Content-Type": contentType,
    "Content-Length": data.length,
  });
  res.end(data);
}

function filePathForUrl(url) {
  const path = new URL(url, "http://localhost").pathname;
  const name = path === "/" || path === "/h5" ? "/index.html" : path;
  const normalized = normalize(name).replace(/^(\.\.[/\\])+/, "");
  return join(root, normalized);
}

function isProxyPath(url) {
  const path = new URL(url || "/", "http://localhost").pathname;
  return proxyPrefixes.some((prefix) => path === prefix || path.startsWith(`${prefix}/`));
}

function proxyRequestHeaders(req) {
  const headers = {};
  for (const [key, value] of Object.entries(req.headers)) {
    if (key === "host" || hopByHopHeaders.has(key)) {
      continue;
    }
    headers[key] = value;
  }

  if (req.headers.host) {
    headers["x-forwarded-host"] = req.headers.host;
  }
  headers["x-forwarded-proto"] = req.headers["x-forwarded-proto"] || "https";
  return headers;
}

function proxyResponseHeaders(headers) {
  const filtered = {};
  for (const [key, value] of Object.entries(headers)) {
    if (hopByHopHeaders.has(key)) {
      continue;
    }
    filtered[key] = value;
  }
  return filtered;
}

function proxyToAgent(req, res) {
  const targetUrl = new URL(req.url || "/", `${agentEndpoint.replace(/\/$/, "")}/`);
  const transport = targetUrl.protocol === "https:" ? https : http;
  const upstreamReq = transport.request(
    targetUrl,
    {
      method: req.method,
      headers: proxyRequestHeaders(req),
    },
    (upstreamRes) => {
      res.writeHead(upstreamRes.statusCode || 502, proxyResponseHeaders(upstreamRes.headers));
      upstreamRes.pipe(res);
    },
  );

  upstreamReq.on("error", (error) => {
    if (res.headersSent) {
      res.destroy(error);
      return;
    }

    send(
      res,
      502,
      JSON.stringify({ detail: `Agent proxy request failed: ${error.message}` }),
      "application/json; charset=utf-8",
    );
  });

  req.pipe(upstreamReq);
}

const server = http.createServer((req, res) => {
  if (new URL(req.url || "/", "http://localhost").pathname === "/config.js") {
    send(
      res,
      200,
      `window.__DINGTALK_CLIENT_ID__ = ${JSON.stringify(dingtalkClientId)};\n` +
        `window.__DINGTALK_CORP_ID__ = ${JSON.stringify(dingtalkCorpId)};\n`,
      "application/javascript; charset=utf-8",
    );
    return;
  }

  if (isProxyPath(req.url)) {
    proxyToAgent(req, res);
    return;
  }

  const filePath = filePathForUrl(req.url || "/");
  if (!existsSync(filePath) || !statSync(filePath).isFile()) {
    send(res, 404, "Not found");
    return;
  }

  res.writeHead(200, {
    "Content-Type": contentTypes[extname(filePath)] || "application/octet-stream",
  });
  createReadStream(filePath).pipe(res);
});

server.listen(port, "0.0.0.0", () => {
  console.log(`H5 frontend listening on ${port}`);
});
