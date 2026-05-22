const http = require("node:http");
const { createReadStream, existsSync, statSync } = require("node:fs");
const { extname, join, normalize } = require("node:path");

const root = __dirname;
const port = Number(process.env.PORT || 9000);
const agentEndpoint = process.env.AGENT_ENDPOINT || "http://127.0.0.1:9010";
const dingtalkCorpId = (process.env.DINGTALK_CORP_ID || "").trim();

const contentTypes = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
};

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

const server = http.createServer((req, res) => {
  if (req.url === "/config.js") {
    send(
      res,
      200,
      `window.__AGENT_ENDPOINT__ = ${JSON.stringify(agentEndpoint)};\n` +
        `window.__DINGTALK_CORP_ID__ = ${JSON.stringify(dingtalkCorpId)};\n`,
      "application/javascript; charset=utf-8",
    );
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
