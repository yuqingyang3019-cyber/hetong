const http = require("http");
const https = require("https");
const { createReadStream, existsSync, statSync } = require("fs");
const { extname, join, normalize } = require("path");
const crypto = require("crypto");
const dingtalkOauth = require("@alicloud/dingtalk/oauth2_1_0");
const OpenApi = require("@alicloud/openapi-client");

const root = __dirname;
const port = Number(process.env.PORT || 9000);
const agentEndpoint = process.env.AGENT_ENDPOINT || "http://127.0.0.1:9010";
const dingtalkClientId = (process.env.DINGTALK_CLIENT_ID || "").trim();
const dingtalkClientSecret = (process.env.DINGTALK_CLIENT_SECRET || "").trim();
const dingtalkCorpId = (process.env.DINGTALK_CORP_ID || "").trim();
const appSessionSecret = (process.env.APP_SESSION_SECRET || "").trim();
const agentTokenTtlSeconds = Number(process.env.AGENT_TOKEN_TTL_SEC || 1800);
const h5SessionTtlSeconds = Number(process.env.H5_SESSION_TTL_SEC || 7 * 24 * 3600);
const h5SessionCookieName = "hetong_h5_session";
const bffPrefix = "/bff/auth";
const dingtalkGetUserInfoUrl = "https://oapi.dingtalk.com/topapi/v2/user/getuserinfo";
const dingtalkUserGetUrl = "https://oapi.dingtalk.com/topapi/v2/user/get";
const dingtalkTokenCache = new Map();

const contentTypes = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
};
function send(res, status, body, contentType = "text/plain; charset=utf-8", headers = {}) {
  const data = Buffer.from(body);
  res.writeHead(status, {
    "Content-Type": contentType,
    "Content-Length": data.length,
    ...headers,
  });
  res.end(data);
}

function readRequestBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

function sendJson(res, status, payload, headers = {}) {
  send(res, status, JSON.stringify(payload), "application/json; charset=utf-8", headers);
}

function makeError(code, message, detail) {
  const payload = { ok: false, code, message };
  if (detail) payload.detail = detail;
  return payload;
}

function maskDiagnosticValue(value, prefix = 4, suffix = 4) {
  const text = String(value || "");
  if (!text) return "未配置";
  if (text.length <= prefix + suffix) return "***";
  return `${text.slice(0, prefix)}***${text.slice(-suffix)}`;
}

function base64url(input) {
  return Buffer.from(input).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function base64urlDecode(input) {
  const value = input.replace(/-/g, "+").replace(/_/g, "/");
  return Buffer.from(value.padEnd(value.length + ((4 - (value.length % 4)) % 4), "="), "base64");
}

function signPayload(payload) {
  if (!appSessionSecret) throw new Error("未配置 APP_SESSION_SECRET，无法签发登录态");
  const body = base64url(JSON.stringify(payload));
  const sig = crypto.createHmac("sha256", appSessionSecret).update(body).digest("hex");
  return `${body}.${sig}`;
}

function verifyPayload(raw, expectedType) {
  if (!raw || !appSessionSecret || !raw.includes(".")) return null;
  const [body, sig] = raw.split(".");
  const expected = crypto.createHmac("sha256", appSessionSecret).update(body).digest("hex");
  if (sig.length !== expected.length) return null;
  if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
  try {
    const payload = JSON.parse(base64urlDecode(body).toString("utf8"));
    if (!payload || payload.typ !== expectedType) return null;
    if (Date.now() / 1000 > Number(payload.exp || 0)) return null;
    return payload;
  } catch {
    return null;
  }
}

function readRequestBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

async function readJsonBody(req) {
  const raw = await readRequestBody(req);
  if (!raw.length) return {};
  const value = JSON.parse(raw.toString("utf8"));
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("请求体必须是 JSON 对象");
  }
  return value;
}

function filePathForUrl(url) {
  const path = new URL(url, "http://localhost").pathname;
  const name = path === "/" || path === "/h5" ? "/index.html" : path;
  const normalized = normalize(name).replace(/^(\.\.[/\\])+/, "");
  return join(root, normalized);
}

function getCookie(req, name) {
  const cookieHeader = req.headers.cookie || "";
  for (const part of cookieHeader.split(";")) {
    const [key, value] = part.trim().split("=");
    if (key === name) return value;
  }
  return "";
}

function publicUserFromSession(payload) {
  return {
    userid: payload.userid,
    name: payload.name,
    nick: payload.nick || null,
    mobile: payload.mobile || "",
    title: payload.title || "",
    jobNumber: payload.job_number || "",
    email: payload.email || "",
    avatar: payload.avatar || "",
    deptIds: payload.dept_ids || [],
    deptNames: payload.dept_names || [],
    unionid: payload.unionid || "",
  };
}

function dingtalkConfigured() {
  return Boolean(dingtalkClientId && dingtalkClientSecret && dingtalkCorpId);
}

function createOAuthClient() {
  const config = new OpenApi.Config({});
  config.protocol = "https";
  config.regionId = "central";
  return new dingtalkOauth.default(config);
}

async function getDingtalkAccessToken(corpId) {
  const cached = dingtalkTokenCache.get(corpId);
  const now = Date.now() / 1000;
  if (cached && now < cached.expiresAt - 120) return cached.token;

  const client = createOAuthClient();
  const request = new dingtalkOauth.GetTokenRequest({
    clientId: dingtalkClientId,
    clientSecret: dingtalkClientSecret,
    grantType: "client_credentials",
  });
  const response = await client.getToken(corpId, request);
  const body = response.body || response;
  const token = body.accessToken || body.access_token;
  if (!token) throw new Error("钉钉 OAuth2 SDK 未返回 access_token");
  const expiresIn = Number(body.expiresIn || body.expires_in || 7200);
  dingtalkTokenCache.set(corpId, { token, expiresAt: now + Math.max(60, expiresIn) });
  return token;
}

async function postJson(url, payload, operation) {
  const body = JSON.stringify(payload);
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body,
  });
  const text = await response.text();
  let parsed;
  try {
    parsed = text ? JSON.parse(text) : {};
  } catch {
    throw new Error(`${operation} 响应不是合法 JSON`);
  }
  if (!response.ok) {
    const code = parsed.code || parsed.errcode;
    const message = parsed.message || parsed.errmsg || text.slice(0, 200);
    throw new Error(`${operation} 失败：HTTP ${response.status} code=${code || ""} message=${message || ""}`);
  }
  if (Object.prototype.hasOwnProperty.call(parsed, "errcode") && Number(parsed.errcode) !== 0) {
    throw new Error(`${operation} 失败：errcode=${parsed.errcode} errmsg=${parsed.errmsg || ""}`);
  }
  return parsed;
}

async function dingtalkTopapiPost(url, accessToken, payload, operation) {
  const target = `${url}?${new URLSearchParams({ access_token: accessToken })}`;
  return postJson(target, payload, operation);
}

function parseDeptIds(raw) {
  if (!raw) return [];
  if (Array.isArray(raw)) return raw.map((item) => Number(item)).filter(Number.isFinite);
  if (typeof raw === "string") {
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) return parseDeptIds(parsed);
    } catch {
      // ignore
    }
    const value = Number(raw);
    return Number.isFinite(value) ? [value] : [];
  }
  const value = Number(raw);
  return Number.isFinite(value) ? [value] : [];
}

async function exchangeDingtalkCode(code, corpId) {
  if (!dingtalkConfigured()) throw new Error("未配置钉钉新版服务端 SDK 凭证");
  const accessToken = await getDingtalkAccessToken(corpId);
  const userInfo = await dingtalkTopapiPost(
    "https://oapi.dingtalk.com/topapi/v2/user/getuserinfo",
    accessToken,
    { code },
    "通过免登码获取钉钉用户信息",
  );
  const result = userInfo.result || {};
  const userid = String(result.userid || "").trim();
  if (!userid) throw new Error("钉钉免登未返回 userid");
  const userDetail = await dingtalkTopapiPost(
    "https://oapi.dingtalk.com/topapi/v2/user/get",
    accessToken,
    { userid, language: "zh_CN" },
    "获取钉钉用户详情",
  );
  const detail = userDetail.result || {};
  return {
    userid,
    name: detail.name || result.name || userid,
    nick: detail.nick || result.name || "",
    mobile: String(detail.mobile || ""),
    title: String(detail.title || ""),
    job_number: String(detail.job_number || ""),
    email: String(detail.email || ""),
    avatar: String(detail.avatar || result.avatar || ""),
    dept_ids: parseDeptIds(detail.dept_id_list),
    dept_names: [],
    unionid: String(detail.unionid || result.unionid || ""),
  };
}

function signAgentToken(sessionPayload) {
  const exp = Date.now() / 1000 + agentTokenTtlSeconds;
  const token = signPayload({
    typ: "agent",
    iss: "hetong-h5-bff",
    exp,
    userid: sessionPayload.userid,
    name: sessionPayload.name,
    nick: sessionPayload.nick || "",
    mobile: sessionPayload.mobile || "",
    title: sessionPayload.title || "",
    job_number: sessionPayload.job_number || "",
    email: sessionPayload.email || "",
    avatar: sessionPayload.avatar || "",
    dept_ids: sessionPayload.dept_ids || [],
    dept_names: sessionPayload.dept_names || [],
    unionid: sessionPayload.unionid || "",
  });
  return { token, exp };
}

function h5Cookie(token) {
  return `${h5SessionCookieName}=${token}; Max-Age=${h5SessionTtlSeconds}; Path=/; HttpOnly; SameSite=Lax`;
}

async function handleBff(req, res, pathname) {
  if (req.method === "GET" && pathname === `${bffPrefix}/config`) {
    sendJson(res, 200, {
      ok: true,
      corpId: dingtalkCorpId || null,
      clientId: dingtalkClientId || null,
      clientSecretConfigured: Boolean(dingtalkClientSecret),
      clientSecretHint: maskDiagnosticValue(dingtalkClientSecret),
      agentBaseUrl: agentEndpoint.replace(/\/$/, ""),
      agentTokenTtlSeconds,
      dingtalkConfigured: dingtalkConfigured(),
    });
    return;
  }

  if (req.method === "GET" && pathname === `${bffPrefix}/me`) {
    const session = verifyPayload(getCookie(req, h5SessionCookieName), "h5");
    if (!session) {
      sendJson(res, 200, { ok: true, loggedIn: false, user: null });
      return;
    }
    sendJson(res, 200, {
      ok: true,
      loggedIn: true,
      user: publicUserFromSession(session),
      agentTokenExpiresAt: session.agent_exp,
    });
    return;
  }

  if (req.method === "POST" && pathname === `${bffPrefix}/dingtalk-login`) {
    try {
      const payload = await readJson(req);
      const code = String(payload.code || "").trim();
      const corpId = String(payload.corpId || dingtalkCorpId || "").trim();
      if (!code) {
        sendJson(res, 400, makeError("INVALID_ARGUMENT", "缺少免登授权码 code"));
        return;
      }
      if (!corpId) {
        sendJson(res, 400, makeError("INVALID_ARGUMENT", "缺少 corpId"));
        return;
      }
      console.log(
        "[bff-auth] dingtalk-login",
        JSON.stringify({
          origin: req.headers.origin || "",
          host: req.headers.host || "",
          corpId,
          clientId: dingtalkClientId,
          clientSecret: maskDiagnosticValue(dingtalkClientSecret),
          codeLength: code.length,
          code: maskDiagnosticValue(code, 6, 6),
        }),
      );
      const sessionPayload = await exchangeDingtalkCode(code, corpId);
      sessionPayload.typ = "h5";
      sessionPayload.exp = Date.now() / 1000 + h5SessionTtlSeconds;
      const agent = signAgentToken(sessionPayload);
      sessionPayload.agent_exp = agent.exp;
      const sessionToken = signPayload(sessionPayload);
      sendJson(
        res,
        200,
        {
          ok: true,
          user: publicUserFromSession(sessionPayload),
          agentBaseUrl: agentEndpoint.replace(/\/$/, ""),
          agentAccessToken: agent.token,
          expiresAt: agent.exp,
        },
        { "Set-Cookie": h5Cookie(sessionToken) },
      );
    } catch (error) {
      sendJson(res, 502, makeError("DINGTALK_AUTH_FAILED", "钉钉免登失败", error.message));
    }
    return;
  }

  if (req.method === "POST" && pathname === `${bffPrefix}/agent-token`) {
    const session = verifyPayload(getCookie(req, h5SessionCookieName), "h5");
    if (!session) {
      sendJson(res, 401, makeError("AUTH_REQUIRED", "登录已失效，请重新进入钉钉应用"));
      return;
    }
    const agent = signAgentToken(session);
    session.agent_exp = agent.exp;
    const sessionToken = signPayload(session);
    sendJson(
      res,
      200,
      {
        ok: true,
        agentBaseUrl: agentEndpoint.replace(/\/$/, ""),
        agentAccessToken: agent.token,
        expiresAt: agent.exp,
      },
      { "Set-Cookie": h5Cookie(sessionToken) },
    );
    return;
  }

  sendJson(res, 404, makeError("NOT_FOUND", "接口不存在"));
}

async function readJson(req) {
  const raw = await readRequestBody(req);
  if (!raw.length) return {};
  const parsed = JSON.parse(raw.toString("utf8"));
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("请求体必须是 JSON 对象");
  return parsed;
}

const server = http.createServer(async (req, res) => {
  const pathname = new URL(req.url || "/", "http://localhost").pathname;
  if (pathname === "/config.js") {
    send(
      res,
      200,
      `window.__DINGTALK_CLIENT_ID__ = ${JSON.stringify(dingtalkClientId)};\n` +
        `window.__DINGTALK_CORP_ID__ = ${JSON.stringify(dingtalkCorpId)};\n`,
      "application/javascript; charset=utf-8",
    );
    return;
  }

  if (pathname.startsWith(`${bffPrefix}/`)) {
    await handleBff(req, res, pathname);
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
