const statusEl = document.querySelector("#status");
const logEl = document.querySelector("#log");
const downloadLink = document.querySelector("#downloadLink");
const parseButton = document.querySelector("#parseButton");
const generateButton = document.querySelector("#generateButton");
const identifyFieldsButton = document.querySelector("#identifyFieldsButton");
const quoteFile = document.querySelector("#quoteFile");
const previewCard = document.querySelector("#previewCard");
const fieldPreviewCard = document.querySelector("#fieldPreviewCard");
const quoteTextPreview = document.querySelector("#quoteTextPreview");
const extraInfoText = document.querySelector("#extraInfoText");
const fieldPreviewSummary = document.querySelector("#fieldPreviewSummary");
const contractPreviewEl = document.querySelector("#contractPreview");
const templateType = document.querySelector("#templateType");
const userBar = document.querySelector("#userBar");
const userAvatar = document.querySelector("#userAvatar");
const userNameEl = document.querySelector("#userName");
const userDeptEl = document.querySelector("#userDept");
const userMobileEl = document.querySelector("#userMobile");
const userTitleEl = document.querySelector("#userTitle");
const loginHintEl = document.querySelector("#loginHint");
const uploadDropzone = document.querySelector("#uploadDropzone");
const fileNameText = document.querySelector("#fileNameText");
const fileMetaText = document.querySelector("#fileMetaText");
const progressHint = document.querySelector("#progressHint");
const progressSteps = Array.from(document.querySelectorAll("[data-step]"));
const accessModal = document.querySelector("#accessModal");
const accessModalMessage = document.querySelector("#accessModalMessage");

const clientIdFromConfig = (window.__DINGTALK_CLIENT_ID__ || "").trim();
const corpIdFromConfig = (window.__DINGTALK_CORP_ID__ || "").trim();
const templateSchemaFiles = Object.freeze({
  caigouhetong: "caigouhetong",
  nonStandardNoInstall: "non-standard-no-install",
  nonStandardWithInstall: "non-standard-with-install",
  annualFramework: "annual-framework",
  professionalSubcontract: "professional-subcontract",
  laborSubcontract: "labor-subcontract",
});
const templateSchemaCache = new Map();

let parsedUpload = null;
let fieldPreview = null;
let authContext = { skipAuth: false, dingtalkConfigured: false, corpId: "" };
/** 是否允许使用上传、解析、生成（免登成功或开发跳过鉴权） */
let sessionReady = false;
let busy = false;

function apiUrl(path) {
  return path;
}

function fetchAuth(url, options = {}) {
  const headers = { ...(options.headers || {}) };
  return fetch(url, {
    ...options,
    credentials: "include",
    headers,
  });
}

function appendLog(text) {
  logEl.textContent += text;
  logEl.scrollTop = logEl.scrollHeight;
}

function formatError(error) {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  try {
    return JSON.stringify(error);
  } catch {
    return "未知错误";
  }
}

function appendStageLog(stage, message = "") {
  const time = new Date().toLocaleTimeString("zh-CN", { hour12: false });
  appendLog(`[${time}] ${stage}${message ? `：${message}` : ""}\n`);
}

function configState(value) {
  return value ? "已配置" : "缺失";
}

function setStatus(message, tone = "info") {
  statusEl.textContent = message;
  statusEl.classList.toggle("is-error", tone === "error");
  statusEl.classList.toggle("is-success", tone === "success");
}

function formatFileSize(size) {
  if (!Number.isFinite(size) || size <= 0) return "0 KB";
  if (size < 1024 * 1024) return `${Math.ceil(size / 1024)} KB`;
  return `${(size / 1024 / 1024).toFixed(1)} MB`;
}

function updateSelectedFile() {
  const file = quoteFile.files?.[0];
  uploadDropzone?.classList.toggle("has-file", Boolean(file));
  if (!file) {
    if (fileNameText) fileNameText.textContent = "点击选择报价单文件";
    if (fileMetaText) fileMetaText.textContent = "支持 PDF、Excel、TXT 格式";
    return;
  }
  if (fileNameText) fileNameText.textContent = file.name || "已选择报价单";
  if (fileMetaText) fileMetaText.textContent = `${formatFileSize(file.size)} · 已选择，点击可更换`;
}

function updateActionAvailability() {
  const hasFile = Boolean(quoteFile.files?.[0]);
  const hasParsedText = Boolean(parsedUpload && quoteTextPreview.value.trim());
  const hasFieldPreview = Boolean(fieldPreview?.extractedData);
  const controlsDisabled = busy || !sessionReady;
  quoteFile.disabled = controlsDisabled;
  templateType.disabled = controlsDisabled;
  quoteTextPreview.disabled = controlsDisabled || !parsedUpload;
  if (extraInfoText) extraInfoText.disabled = controlsDisabled || !parsedUpload;
  parseButton.disabled = busy || !sessionReady || !hasFile;
  if (identifyFieldsButton) identifyFieldsButton.disabled = busy || !sessionReady || !hasParsedText;
  generateButton.disabled = busy || !sessionReady || !hasFieldPreview;
  uploadDropzone?.classList.toggle("is-disabled", controlsDisabled);
}

function setBusy(disabled) {
  busy = disabled;
  updateActionAvailability();
}

function setInteractionEnabled(enabled) {
  sessionReady = enabled;
  updateActionAvailability();
}

function getDingTalkPlatform() {
  return String(window.dd?.env?.platform || "").toLowerCase();
}

function isDingTalkClient() {
  const userAgent = window.navigator.userAgent || "";
  const platform = getDingTalkPlatform();

  if (!window.dd?.requestAuthCode) return false;
  if (platform === "notindingtalk") return false;
  if (platform) return true;
  return /dingtalk/i.test(userAgent);
}

function showAccessModal(message) {
  if (!accessModal) return;
  if (accessModalMessage) accessModalMessage.textContent = message;
  accessModal.hidden = false;
}

function blockNonDingTalkAccess(message = "请在钉钉客户端内打开合同生成助手。") {
  sessionReady = false;
  setInteractionEnabled(false);
  hideUserBar();
  appendStageLog("环境检查失败", message);
  setStatus("当前环境不可用", "error");
  showAccessModal("合同生成助手仅支持从钉钉微应用访问。请返回钉钉客户端后重新打开应用。");
  setProgress("auth", "error", "当前访问环境不是钉钉客户端，已禁止上传和生成。");
  if (loginHintEl) loginHintEl.textContent = message;
}

function setProgress(currentStep, state = "active", message = "") {
  const order = ["auth", "upload", "review", "generate"];
  const activeIndex = order.indexOf(currentStep);

  progressSteps.forEach((step) => {
    const stepIndex = order.indexOf(step.dataset.step);
    step.classList.remove("is-active", "is-complete", "is-error");

    if (currentStep === "done") {
      step.classList.add("is-complete");
      return;
    }
    if (stepIndex >= 0 && stepIndex < activeIndex) {
      step.classList.add("is-complete");
      return;
    }
    if (step.dataset.step === currentStep) {
      step.classList.add(state === "error" ? "is-error" : "is-active");
    }
  });

  if (progressHint && message) progressHint.textContent = message;
}

function showUserBar(user, hint) {
  if (!userBar) return;
  userBar.hidden = false;
  if (userAvatar) {
    if (user?.avatar) {
      userAvatar.src = user.avatar;
      userAvatar.hidden = false;
    } else {
      userAvatar.removeAttribute("src");
      userAvatar.hidden = true;
    }
  }
  if (userNameEl) {
    const base = user?.name || user?.nick || "已登录";
    const nick = user?.nick && user.nick !== user.name ? user.nick : null;
    userNameEl.textContent = nick ? `${base}（${nick}）` : base;
  }
  if (userDeptEl) {
    const names = user?.deptNames;
    const ids = user?.deptIds;
    if (Array.isArray(names) && names.length) {
      userDeptEl.textContent = `部门：${names.join("、")}`;
    } else if (Array.isArray(ids) && ids.length) {
      userDeptEl.textContent = `部门 ID：${ids.join("、")}`;
    } else {
      userDeptEl.textContent = "部门：—";
    }
  }
  if (userMobileEl) {
    if (user?.mobile) {
      userMobileEl.textContent = `手机：${user.mobile}`;
      userMobileEl.classList.remove("muted");
    } else {
      userMobileEl.textContent = "手机：未返回（需在钉钉开放平台开通通讯录手机号权限）";
      userMobileEl.classList.add("muted");
    }
  }
  if (userTitleEl) {
    userTitleEl.textContent = user?.title ? `职位：${user.title}` : "职位：—";
  }
  if (loginHintEl && hint != null) {
    loginHintEl.textContent = hint;
  }
}

function hideUserBar() {
  if (userBar) userBar.hidden = true;
}

async function downloadContractBlob(path, fileName = "contract.docx") {
  const response = await fetchAuth(apiUrl(path));
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(body.detail || body.error || "下载失败");
  }
  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName || "contract.docx";
  a.rel = "noopener";
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function applyDownloadLink(value) {
  downloadLink.dataset.needsAuth = "";
  downloadLink.dataset.downloadPath = "";
  downloadLink.onclick = null;

  if (value.downloadDataUrl) {
    downloadLink.href = value.downloadDataUrl;
    downloadLink.download = value.fileName || `${value.contractId || "contract"}.docx`;
    downloadLink.hidden = false;
    return;
  }

  if (value.downloadPath) {
    downloadLink.href = "#";
    downloadLink.removeAttribute("download");
    downloadLink.dataset.needsAuth = "1";
    downloadLink.dataset.downloadPath = value.downloadPath;
    downloadLink.onclick = async (event) => {
      event.preventDefault();
      try {
        await downloadContractBlob(
          downloadLink.dataset.downloadPath,
          value.fileName || `${value.contractId || "contract"}.docx`,
        );
      } catch (error) {
        const message = error instanceof Error ? error.message : "下载失败";
        appendLog(`\n下载失败：${message}`);
      }
    };
    downloadLink.hidden = false;
    return;
  }

  downloadLink.href = value.downloadUrl;
  downloadLink.removeAttribute("download");
  downloadLink.hidden = false;
}

async function refreshAuthMe() {
  const response = await fetchAuth(apiUrl("/api/auth/me"));
  if (!response.ok) return null;
  return response.json();
}

function waitForDingTalkReady(timeoutMs = 8000) {
  return new Promise((resolve, reject) => {
    let settled = false;
    appendStageLog("dd.ready", "开始等待钉钉 JSAPI");
    const timer = window.setTimeout(() => {
      if (settled) return;
      settled = true;
      const error = new Error("等待钉钉 JSAPI 就绪失败：准备超时，请在钉钉客户端内重新打开");
      appendStageLog("dd.ready 失败", error.message);
      reject(error);
    }, timeoutMs);

    const finish = () => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timer);
      appendStageLog("dd.ready", "钉钉 JSAPI 已就绪");
      resolve();
    };

    try {
      if (window.dd?.ready) {
        window.dd.ready(finish);
      } else {
        finish();
      }
    } catch (error) {
      window.clearTimeout(timer);
      const message = formatError(error);
      appendStageLog("dd.ready 失败", message);
      reject(new Error(`等待钉钉 JSAPI 就绪失败：${message}`));
    }
  });
}

function requestDingTalkAuthCode(corpId, clientId, timeoutMs = 12000) {
  return new Promise((resolve, reject) => {
    appendStageLog("获取钉钉免登码", "开始调用 dd.requestAuthCode");
    if (!isDingTalkClient()) {
      const error = new Error("获取钉钉免登码失败：请在钉钉客户端内打开合同生成助手");
      appendStageLog("获取钉钉免登码失败", error.message);
      reject(error);
      return;
    }
    if (!clientId) {
      const error = new Error("获取钉钉免登码失败：缺少钉钉 Client ID，请联系管理员检查 DINGTALK_CLIENT_ID 配置");
      appendStageLog("获取钉钉免登码失败", error.message);
      reject(error);
      return;
    }

    let settled = false;
    const timer = window.setTimeout(() => {
      if (settled) return;
      settled = true;
      const error = new Error("获取钉钉免登码失败：获取免登授权码超时，请重新打开应用");
      appendStageLog("获取钉钉免登码失败", error.message);
      reject(error);
    }, timeoutMs);

    const finish = (callback) => (value) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timer);
      callback(value);
    };

    try {
      window.dd.requestAuthCode({
        corpId,
        clientId,
        onSuccess: finish((value) => {
          appendStageLog("获取钉钉免登码", value?.code ? "成功获取 code" : "成功回调但未返回 code");
          resolve(value);
        }),
        onFail: finish((err) => {
          const message = err?.errorMessage || err?.message || formatError(err);
          appendStageLog("获取钉钉免登码失败", message);
          reject(new Error(`获取钉钉免登码失败：${message}`));
        }),
      });
    } catch (error) {
      window.clearTimeout(timer);
      const message = formatError(error);
      appendStageLog("获取钉钉免登码失败", message);
      reject(new Error(`获取钉钉免登码失败：${message}`));
    }
  });
}

async function initAuth() {
  sessionReady = false;
  appendStageLog("免登初始化", "开始");
  appendStageLog(
    "免登配置",
    `api=同域代理 corpId=${configState(corpIdFromConfig)} clientId=${configState(clientIdFromConfig)}`,
  );
  appendStageLog(
    "运行环境",
    `platform=${getDingTalkPlatform() || "unknown"} dingtalkClient=${isDingTalkClient() ? "是" : "否"}`,
  );
  setProgress("auth", "active", "正在确认钉钉免登状态。");

  let statusResponse;
  try {
    appendStageLog("读取鉴权状态", "请求 /api/auth/status");
    statusResponse = await fetchAuth(apiUrl("/api/auth/status"));
    appendStageLog("读取鉴权状态", `HTTP ${statusResponse.status}`);
  } catch (error) {
    const message = `读取鉴权状态失败：${formatError(error)}`;
    appendStageLog("读取鉴权状态失败", message);
    setInteractionEnabled(false);
    setStatus(message, "error");
    setProgress("auth", "error", message);
    return;
  }
  if (!statusResponse.ok) {
    appendStageLog("读取鉴权状态失败", `HTTP ${statusResponse.status}`);
    setInteractionEnabled(false);
    setStatus(`读取鉴权状态失败：HTTP ${statusResponse.status}`, "error");
    setProgress("auth", "error", "读取鉴权状态失败，请稍后重试。");
    return;
  }
  authContext = await statusResponse.json();
  appendStageLog(
    "读取鉴权状态",
    `skipAuth=${authContext.skipAuth ? "是" : "否"} dingtalkConfigured=${authContext.dingtalkConfigured ? "是" : "否"} corpId=${configState(authContext.corpId)}`,
  );

  if (authContext.skipAuth) {
    appendStageLog("免登完成", "服务端跳过鉴权");
    setInteractionEnabled(true);
    showUserBar(
      { name: "开发模式", deptNames: [], mobile: "", title: "" },
      "后端未启用登录鉴权（未配置 APP_SESSION_SECRET 或已开启跳过）。",
    );
    setStatus("请选择报价单文件。");
    setProgress("upload", "active", "免登已就绪，请上传报价单。");
    return;
  }

  if (!isDingTalkClient()) {
    blockNonDingTalkAccess();
    return;
  }

  if (!authContext.dingtalkConfigured) {
    sessionReady = false;
    setInteractionEnabled(false);
    hideUserBar();
    appendStageLog("免登配置失败", "服务端未配置钉钉应用");
    setStatus("服务端未配置钉钉应用，无法免登。", "error");
    setProgress("auth", "error", "服务端未配置钉钉应用，无法免登。");
    if (loginHintEl) loginHintEl.textContent = "请联系管理员配置 DINGTALK_CLIENT_ID / DINGTALK_CLIENT_SECRET / DINGTALK_CORP_ID。";
    return;
  }

  let me = null;
  try {
    appendStageLog("检查已有登录态", "请求 /api/auth/me");
    me = await refreshAuthMe();
    appendStageLog("检查已有登录态", me?.loggedIn ? "已有有效登录态" : "未登录或登录态过期");
  } catch (error) {
    appendStageLog("检查已有登录态失败", formatError(error));
  }
  if (me?.loggedIn && me.user) {
    try {
      sessionStorage.setItem("hetong_user_preview", JSON.stringify(me.user));
    } catch {
      /* ignore */
    }
    setInteractionEnabled(true);
    showUserBar(me.user, "已通过钉钉免登。");
    setStatus("请选择报价单文件。");
    setProgress("upload", "active", "免登已就绪，请上传报价单。");
    return;
  }

  sessionReady = false;
  setInteractionEnabled(false);
  hideUserBar();
  setStatus("正在钉钉内免登…");
  if (loginHintEl) loginHintEl.textContent = "正在获取免登授权码…";

  const searchParams = new URLSearchParams(window.location.search);
  const corpIdFromUrl = searchParams.get("corpid") || searchParams.get("corpId") || "";
  const corpId = corpIdFromUrl || authContext.corpId || corpIdFromConfig || "";
  const clientId = clientIdFromConfig || "";

  if (!isDingTalkClient()) {
    blockNonDingTalkAccess();
    return;
  }

  if (!corpId) {
    sessionReady = false;
    appendStageLog("免登配置失败", "缺少 corpId");
    setStatus("缺少 corpId：请在微应用首页 URL 附带 corpId= 或在服务端配置 DINGTALK_CORP_ID。", "error");
    setProgress("auth", "error", "缺少 corpId，无法发起钉钉免登。");
    if (loginHintEl) loginHintEl.textContent = "config.js 可注入 __DINGTALK_CORP_ID__。";
    return;
  }
  if (!clientId) {
    sessionReady = false;
    appendStageLog("免登配置失败", "缺少 clientId");
    setStatus("缺少钉钉 Client ID，无法免登。", "error");
    setProgress("auth", "error", "缺少 DINGTALK_CLIENT_ID，无法发起钉钉免登。");
    if (loginHintEl) loginHintEl.textContent = "config.js 可注入 __DINGTALK_CLIENT_ID__。";
    return;
  }

  await waitForDingTalkReady().then(() => requestDingTalkAuthCode(corpId, clientId)).then(async (result) => {
    const code = result && result.code;
    if (!code) {
      throw new Error("获取钉钉免登码失败：未获取到免登授权码");
    }
    appendStageLog("提交免登码", "请求 /api/dingtalk/login");
    let loginResponse;
    try {
      loginResponse = await fetchAuth(apiUrl("/api/dingtalk/login"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code, corpId }),
      });
      appendStageLog("提交免登码", `HTTP ${loginResponse.status}`);
    } catch (error) {
      throw new Error(`提交免登码到服务端失败：${formatError(error)}`);
    }
    const body = await loginResponse.json().catch(() => ({}));
    if (!loginResponse.ok) {
      throw new Error(`提交免登码到服务端失败：${body.detail || body.message || `HTTP ${loginResponse.status}`}`);
    }
    if (!body.configured) {
      throw new Error(`提交免登码到服务端失败：${body.message || "钉钉未配置"}`);
    }
    if (body.user) {
      try {
        sessionStorage.setItem("hetong_user_preview", JSON.stringify(body.user));
      } catch {
        /* ignore */
      }
      showUserBar(body.user, "已通过钉钉免登。");
    }
    appendStageLog("免登完成", "已通过钉钉免登");
    setInteractionEnabled(true);
    setStatus("请选择报价单文件。");
    setProgress("upload", "active", "免登已就绪，请上传报价单。");
    if (loginHintEl) loginHintEl.textContent = "";
  }).catch((error) => {
    sessionReady = false;
    const message = error instanceof Error ? error.message : "免登失败";
    appendStageLog("免登失败", message);
    setStatus(message, "error");
    setProgress("auth", "error", message);
    if (loginHintEl) loginHintEl.textContent = message;
    setInteractionEnabled(false);
  });
}

async function uploadQuote(file) {
  const data = await fileToDataUrl(file);
  const response = await fetchAuth(apiUrl("/api/uploads"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      originalName: file.name || "quote.bin",
      mimeType: file.type || "application/octet-stream",
      size: file.size,
      data,
    }),
  });
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(body.detail || body.error || "上传失败");
  }
  return response.json();
}

async function parseUploadedQuote(uploadId) {
  const response = await fetchAuth(apiUrl(`/api/uploads/${encodeURIComponent(uploadId)}/quote-text`), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ templateType: templateType.value }),
  });
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(body.detail || body.error || "解析报价单失败");
  }
  return response.json();
}

async function previewQuoteFields(uploadId, quoteText, extraInfo) {
  const response = await fetchAuth(apiUrl(`/api/uploads/${encodeURIComponent(uploadId)}/field-preview`), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      templateType: templateType.value,
      quoteText,
      extraInfo,
    }),
  });
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(body.detail || body.error || "字段识别失败");
  }
  return response.json();
}

function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(new Error("读取报价单文件失败"));
    reader.readAsDataURL(file);
  });
}

function parseSseBuffer(buffer) {
  return buffer
    .split("\n\n")
    .map((chunk) => chunk.trim())
    .filter(Boolean)
    .map((chunk) => chunk.replace(/^data:\s*/, ""))
    .map((chunk) => {
      try {
        return JSON.parse(chunk);
      } catch {
        return null;
      }
    })
    .filter(Boolean);
}

async function generateContract(uploadId, quoteText, extraInfo, extractedData) {
  let userPreview = null;
  try {
    userPreview = JSON.parse(sessionStorage.getItem("hetong_user_preview") || "null");
  } catch {
    userPreview = null;
  }

  const response = await fetchAuth(apiUrl("/ag-ui/agent"), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "text/event-stream",
    },
    body: JSON.stringify({
      threadId: `h5-${Date.now()}`,
      runId: `run-${Date.now()}`,
      state: {},
      messages: [{ id: "h5-message", role: "user", content: "生成合同" }],
      tools: [],
      context: userPreview ? [{ type: "user_profile", data: userPreview }] : [],
      forwardedProps: {
        uploadId,
        templateType: templateType.value,
        quoteText,
        extraInfo,
        extractedData,
        dingtalkUser: userPreview,
      },
    }),
  });

  if (!response.ok || !response.body) {
    throw new Error("生成请求失败");
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const events = parseSseBuffer(buffer);
    if (buffer.endsWith("\n\n")) buffer = "";
    for (const event of events) {
      if (event.type === "TEXT_MESSAGE_CONTENT") appendLog(event.delta || "");
      if (event.type === "CUSTOM" && event.name === "contract_generated") {
        applyDownloadLink(event.value || {});
      }
      if (event.type === "RUN_ERROR") throw new Error(event.message || "生成失败");
    }
  }
}

function createEl(tagName, className, text) {
  const el = document.createElement(tagName);
  if (className) el.className = className;
  if (text != null) el.textContent = text;
  return el;
}

async function loadTemplateSchema(templateValue) {
  const schemaName = templateSchemaFiles[templateValue] || templateSchemaFiles.caigouhetong;
  if (templateSchemaCache.has(schemaName)) return templateSchemaCache.get(schemaName);

  const response = await fetch(`/template-schemas/${schemaName}.placeholders.json`, { cache: "no-cache" });
  if (!response.ok) {
    throw new Error(`读取模板字段契约失败：HTTP ${response.status}`);
  }
  const schema = await response.json();
  templateSchemaCache.set(schemaName, schema);
  return schema;
}

function getByDotPath(data, key) {
  if (!data || typeof data !== "object") return null;
  if (Object.prototype.hasOwnProperty.call(data, key)) return data[key];
  return key.split(".").reduce((current, part) => (
    current && typeof current === "object" ? current[part] : undefined
  ), data);
}

function isBlankField(value) {
  if (value == null) return true;
  if (typeof value === "string") return !value.trim();
  if (Array.isArray(value)) return value.length === 0;
  if (typeof value === "object") return Object.values(value).every(isBlankField);
  return false;
}

function formatFieldValue(value) {
  if (isBlankField(value)) return "待填写";
  if (Array.isArray(value) || typeof value === "object") return JSON.stringify(value);
  return String(value);
}

function markPreviewStat(stats, value) {
  if (isBlankField(value)) stats.missing += 1;
  else stats.recognized += 1;
}

function createGhostParagraph(index) {
  const paragraph = createEl("p", "contract-preview-ghost");
  paragraph.append(
    createEl("span", "ghost-line is-wide"),
    createEl("span", index % 2 ? "ghost-line is-mid" : "ghost-line is-short"),
  );
  return paragraph;
}

function createContractField(label, value, stats, prefix = "") {
  const missing = isBlankField(value);
  markPreviewStat(stats, value);
  const field = createEl("div", `contract-preview-field ${missing ? "is-missing" : "is-recognized"}`);
  field.append(
    createEl("span", "contract-field-label", `${prefix}${label}`),
    createEl("span", "contract-field-value", formatFieldValue(value)),
  );
  return field;
}

function renderScalarPreview(paper, schema, extractedData, stats) {
  const scalars = Array.isArray(schema?.scalars) ? schema.scalars : [];
  if (!scalars.length) return;

  const section = createEl("section", "contract-preview-section");
  section.append(createEl("h4", "", "合同条款字段"));
  const body = createEl("div", "contract-preview-flow");

  scalars.forEach((field, index) => {
    if (index > 0 && index % 8 === 0) body.append(createGhostParagraph(index));
    body.append(createContractField(field.label || field.key, getByDotPath(extractedData, field.key), stats, `${index + 1}. `));
  });

  section.append(body);
  paper.append(section);
}

function renderTablePreview(paper, schema, extractedData, stats) {
  const tableEntries = Object.entries(schema?.tables || {});
  if (!tableEntries.length) return;

  tableEntries.forEach(([tableName, tableDef], tableIndex) => {
    const columns = Array.isArray(tableDef?.columns) ? tableDef.columns : [];
    const rowsValue = extractedData?.[tableName];
    const rows = Array.isArray(rowsValue) ? rowsValue : [];
    const section = createEl("section", "contract-preview-section");
    section.append(createEl("h4", "", `${tableIndex + 1}. ${tableDef?.label || tableName}`));

    if (!rows.length) {
      stats.missing += 1;
      const empty = createEl("div", "contract-preview-table-empty is-missing", "待填写：未识别到明细行");
      section.append(empty);
      paper.append(section);
      return;
    }

    const tableWrap = createEl("div", "contract-preview-table-wrap");
    const table = createEl("table", "contract-preview-table");
    const thead = createEl("thead");
    const headRow = createEl("tr");
    columns.forEach((column) => headRow.append(createEl("th", "", column.label || column.key)));
    thead.append(headRow);
    table.append(thead);

    const tbody = createEl("tbody");
    rows.forEach((row) => {
      const bodyRow = createEl("tr");
      columns.forEach((column) => {
        const value = row && typeof row === "object" ? row[column.key] : null;
        markPreviewStat(stats, value);
        const cell = createEl("td", isBlankField(value) ? "is-missing" : "is-recognized", formatFieldValue(value));
        bodyRow.append(cell);
      });
      tbody.append(bodyRow);
    });
    table.append(tbody);
    tableWrap.append(table);
    section.append(tableWrap);
    paper.append(section);
  });
}

async function renderFieldPreview(preview) {
  const schema = await loadTemplateSchema(templateType.value);
  const extractedData = preview?.extractedData && typeof preview.extractedData === "object" ? preview.extractedData : {};
  const stats = { recognized: 0, missing: 0 };

  if (contractPreviewEl) {
    contractPreviewEl.textContent = "";
    const paper = createEl("article", "contract-preview-paper");
    const title = createEl("header", "contract-preview-header");
    title.append(
      createEl("p", "contract-preview-kicker", "合同字段确认稿"),
      createEl("h3", "", templateType.selectedOptions?.[0]?.textContent || schema?.template?.id || "合同模板"),
      createEl("p", "contract-preview-muted", "以下内容按模板字段顺序生成，灰色文本为合同正文位置示意。"),
    );
    paper.append(title, createGhostParagraph(0));
    renderScalarPreview(paper, schema, extractedData, stats);
    renderTablePreview(paper, schema, extractedData, stats);
    paper.append(createGhostParagraph(1));
    contractPreviewEl.append(paper);
  }

  if (fieldPreviewSummary) {
    fieldPreviewSummary.className = `hint field-preview-summary${stats.missing ? " has-missing" : " all-recognized"}`;
    fieldPreviewSummary.textContent = stats.missing
      ? `按合同顺序展示：已识别 ${stats.recognized} 项，仍有 ${stats.missing} 项待填写。红色字段会在合同中保留待填写提示。`
      : `按合同顺序展示：已识别 ${stats.recognized} 项，没有待填写字段。请确认预览后生成合同。`;
  }
  if (fieldPreviewCard) fieldPreviewCard.hidden = false;
}

function resetFieldPreview() {
  fieldPreview = null;
  if (fieldPreviewCard) fieldPreviewCard.hidden = true;
  if (fieldPreviewSummary) {
    fieldPreviewSummary.className = "hint field-preview-summary";
    fieldPreviewSummary.textContent = "请按合同字段顺序确认识别结果，红色字段会在合同中显示为待填写。";
  }
  if (contractPreviewEl) {
    contractPreviewEl.textContent = "";
    contractPreviewEl.append(createEl("p", "empty-state", "等待字段识别。"));
  }
  updateActionAvailability();
}

function resetPreview() {
  parsedUpload = null;
  resetFieldPreview();
  previewCard.hidden = true;
  quoteTextPreview.value = "";
  if (extraInfoText) extraInfoText.value = "";
  downloadLink.hidden = true;
  downloadLink.removeAttribute("download");
  downloadLink.dataset.needsAuth = "";
  downloadLink.dataset.downloadPath = "";
  downloadLink.onclick = null;
  updateActionAvailability();
}

quoteFile.addEventListener("change", () => {
  resetPreview();
  updateSelectedFile();
  setStatus(quoteFile.files?.[0] ? "文件已选择，可以上传解析。" : "请选择报价单文件。");
  logEl.textContent = "";
  setProgress("upload", "active", quoteFile.files?.[0] ? "文件已选择，点击上传并解析。" : "请选择报价单文件。");
});

templateType.addEventListener("change", () => {
  resetPreview();
  setStatus("模板已切换，请重新解析报价单。");
  setProgress("upload", "active", "模板已切换，请重新上传或解析报价单。");
});

quoteTextPreview.addEventListener("input", () => {
  resetFieldPreview();
  updateActionAvailability();
});

extraInfoText?.addEventListener("input", () => {
  resetFieldPreview();
  updateActionAvailability();
});

parseButton.addEventListener("click", async () => {
  const file = quoteFile.files?.[0];
  if (!file) {
    setStatus("请先选择报价单文件。", "error");
    return;
  }
  if (file.size === 0) {
    setStatus("报价单文件为空，请重新选择文件。", "error");
    return;
  }
  setBusy(true);
  logEl.textContent = "";
  downloadLink.hidden = true;
  previewCard.hidden = true;
  resetFieldPreview();
  try {
    setStatus("正在上传报价单...");
    setProgress("upload", "active", "正在上传报价单文件。");
    const upload = await uploadQuote(file);
    appendLog(`已上传：${upload.originalName}\n`);
    setStatus("正在解析报价单...");
    setProgress("upload", "active", "正在解析报价单内容。");
    const parsed = await parseUploadedQuote(upload.id);
    parsedUpload = upload;
    quoteTextPreview.value = parsed.quoteText || "";
    if (extraInfoText) extraInfoText.value = "";
    previewCard.hidden = false;
    previewCard.scrollIntoView({ behavior: "smooth", block: "start" });
    appendLog(`已解析：${parsed.textLength || 0} 字符\n`);
    setStatus("请确认报价单解析文本，并补充额外信息后识别字段。");
    setProgress("review", "active", "解析完成，请补充信息并识别合同字段。");
  } catch (error) {
    const message = error instanceof Error ? error.message : "处理失败";
    setStatus(message, "error");
    appendLog(`\n处理失败：${message}`);
    setProgress("upload", "error", message);
  } finally {
    setBusy(false);
  }
});

identifyFieldsButton?.addEventListener("click", async () => {
  if (!parsedUpload) {
    setStatus("请先上传并解析报价单。", "error");
    return;
  }
  const quoteText = quoteTextPreview.value.trim();
  if (!quoteText) {
    setStatus("解析文本为空，请补充后再识别字段。", "error");
    return;
  }
  setBusy(true);
  downloadLink.hidden = true;
  resetFieldPreview();
  try {
    const extraInfo = extraInfoText?.value.trim() || "";
    setStatus("正在识别合同字段...");
    setProgress("review", "active", "正在结合报价单文本和额外信息识别字段。");
    fieldPreview = await previewQuoteFields(parsedUpload.id, quoteText, extraInfo);
    await renderFieldPreview(fieldPreview);
    appendLog(`字段识别完成：已识别 ${fieldPreview.recognizedFields?.length || 0} 项，未识别 ${fieldPreview.missingFields?.length || 0} 项\n`);
    setStatus(
      (fieldPreview.missingFields?.length || 0) > 0
        ? "字段识别完成，请查看红色未识别提示。"
        : "字段识别完成，未发现缺失字段。",
      (fieldPreview.missingFields?.length || 0) > 0 ? "info" : "success",
    );
    setProgress("review", "active", "字段识别完成，请确认后生成合同。");
  } catch (error) {
    const message = error instanceof Error ? error.message : "字段识别失败";
    setStatus(message, "error");
    appendLog(`\n字段识别失败：${message}`);
    setProgress("review", "error", message);
  } finally {
    setBusy(false);
  }
});

generateButton.addEventListener("click", async () => {
  if (!parsedUpload) {
    setStatus("请先上传并解析报价单。", "error");
    return;
  }
  const quoteText = quoteTextPreview.value.trim();
  if (!quoteText) {
    setStatus("解析文本为空，请补充后再生成合同。", "error");
    return;
  }
  if (!fieldPreview?.extractedData) {
    setStatus("请先识别并确认合同字段。", "error");
    return;
  }
  setBusy(true);
  downloadLink.hidden = true;
  logEl.textContent = "";
  try {
    setStatus("正在生成合同...");
    setProgress("generate", "active", "正在生成合同文件。");
    await generateContract(parsedUpload.id, quoteText, extraInfoText?.value.trim() || "", fieldPreview.extractedData);
    setStatus("合同已生成。", "success");
    setProgress("done", "active", "合同已生成，可以下载。");
  } catch (error) {
    const message = error instanceof Error ? error.message : "处理失败";
    setStatus(message, "error");
    appendLog(`\n处理失败：${message}`);
    setProgress("generate", "error", message);
  } finally {
    setBusy(false);
  }
});

updateSelectedFile();
updateActionAvailability();
void initAuth();
