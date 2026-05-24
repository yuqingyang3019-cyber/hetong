const statusEl = document.querySelector("#status");
const logEl = document.querySelector("#log");
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
const taskCreatePanel = document.querySelector("#taskCreatePanel");
const taskList = document.querySelector("#taskList");
const taskQueueHint = document.querySelector("#taskQueueHint");
const activeTaskTitle = document.querySelector("#activeTaskTitle");
const activeTaskHint = document.querySelector("#activeTaskHint");
const userBar = document.querySelector("#userBar");
const userAvatar = document.querySelector("#userAvatar");
const userNameEl = document.querySelector("#userName");
const userDeptEl = document.querySelector("#userDept");
const userMobileEl = document.querySelector("#userMobile");
const userTitleEl = document.querySelector("#userTitle");
const userJobNumberEl = document.querySelector("#userJobNumber");
const userEmailEl = document.querySelector("#userEmail");
const userUseridEl = document.querySelector("#userUserid");
const userUnionidEl = document.querySelector("#userUnionid");
const loginHintEl = document.querySelector("#loginHint");
const uploadDropzone = document.querySelector("#uploadDropzone");
const fileNameText = document.querySelector("#fileNameText");
const fileMetaText = document.querySelector("#fileMetaText");
const progressHint = document.querySelector("#progressHint");
const progressSteps = Array.from(document.querySelectorAll("[data-step]"));
const accessModal = document.querySelector("#accessModal");
const accessModalMessage = document.querySelector("#accessModalMessage");
const closeAccessModalButton = document.querySelector("#closeAccessModalButton");
const taskDrawer = document.querySelector("#taskDrawer");
const taskDrawerBackdrop = document.querySelector("#taskDrawerBackdrop");
const closeTaskDrawerButton = document.querySelector("#closeTaskDrawerButton");

const MAX_TASKS = 5;
const templateSchemaFiles = Object.freeze({
  caigouhetong: "caigouhetong",
  nonStandardNoInstall: "non-standard-no-install",
  nonStandardWithInstall: "non-standard-with-install",
  annualFramework: "annual-framework",
  professionalSubcontract: "professional-subcontract",
  laborSubcontract: "labor-subcontract",
});
const autoDateFieldKeys = Object.freeze(["signYear", "signMonth", "signDay", "signatureYear", "signatureMonth", "signatureDay"]);
const busyStatuses = new Set(["uploading", "parsing", "identifying", "generating"]);
const completedStatuses = new Set(["completed"]);
const templateSchemaCache = new Map();
const tasks = [];

let authContext = { dingtalkConfigured: false, corpId: "", clientId: "", agentBaseUrl: "", agentTokenTtlSeconds: 1800 };
let agentAuth = { baseUrl: "", token: "", expiresAt: 0 };
let sessionReady = false;
let activeTaskId = null;
let drawerOpen = false;

function apiUrl(path) {
  return path;
}

function agentUrl(path) {
  const base = (agentAuth.baseUrl || authContext.agentBaseUrl || "").replace(/\/$/, "");
  if (!base) throw new Error("缺少 AgentRun 业务入口，请重新登录");
  return `${base}${path.startsWith("/") ? path : `/${path}`}`;
}

function fetchBff(url, options = {}) {
  const headers = { ...(options.headers || {}) };
  return fetch(url, {
    ...options,
    credentials: "include",
    headers,
  });
}

async function refreshAgentToken() {
  const response = await fetchBff(apiUrl("/bff/auth/agent-token"), { method: "POST" });
  const body = await response.json().catch(() => ({}));
  if (!response.ok || !body.ok) {
    throw new Error(body.message || body.detail || "刷新 AgentRun 访问凭证失败");
  }
  agentAuth = {
    baseUrl: body.agentBaseUrl || authContext.agentBaseUrl || "",
    token: body.agentAccessToken || "",
    expiresAt: Number(body.expiresAt || 0),
  };
  return agentAuth;
}

async function fetchAgent(path, options = {}, retry = true) {
  if (!agentAuth.token || (agentAuth.expiresAt && Date.now() / 1000 > agentAuth.expiresAt - 60)) {
    await refreshAgentToken();
  }
  const headers = { ...(options.headers || {}), Authorization: `Bearer ${agentAuth.token}` };
  const response = await fetch(agentUrl(path), { ...options, headers });
  if (response.status === 401 && retry) {
    const body = await response.clone().json().catch(() => ({}));
    if (body.code === "AGENT_TOKEN_EXPIRED" || body.code === "AUTH_REQUIRED") {
      await refreshAgentToken();
      return fetchAgent(path, options, false);
    }
  }
  return response;
}

function appendSystemLog(text) {
  logEl.textContent += text;
  logEl.scrollTop = logEl.scrollHeight;
}

function appendTaskLog(task, text) {
  task.log = `${task.log || ""}${text}`;
  renderTaskList();
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
  appendSystemLog(`[${time}] ${stage}${message ? `：${message}` : ""}\n`);
}

function configState(value) {
  return value ? "已配置" : "缺失";
}

function maskDiagnosticValue(value, prefix = 4, suffix = 4) {
  const text = String(value || "");
  if (!text) return "未配置";
  if (text.length <= prefix + suffix) return "***";
  return `${text.slice(0, prefix)}***${text.slice(-suffix)}`;
}

function setStatus(message, tone = "info") {
  if (!message) {
    statusEl.textContent = "";
    statusEl.hidden = true;
    statusEl.classList.remove("is-error", "is-success");
    return;
  }
  statusEl.hidden = false;
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
    if (fileMetaText) fileMetaText.textContent = "支持 PDF、Excel、图片格式";
    return;
  }
  if (fileNameText) fileNameText.textContent = file.name || "已选择报价单";
  if (fileMetaText) fileMetaText.textContent = `${formatFileSize(file.size)} · 已选择，点击可更换`;
}

function activeTask() {
  return tasks.find((task) => task.id === activeTaskId) || null;
}

function taskIsBusy(task) {
  return Boolean(task && busyStatuses.has(task.status));
}

function incompleteTaskCount() {
  return tasks.filter((task) => !completedStatuses.has(task.status)).length;
}

function updateActionAvailability() {
  const current = activeTask();
  const hasFile = Boolean(quoteFile.files?.[0]);
  const atLimit = incompleteTaskCount() >= MAX_TASKS;
  const controlsDisabled = !sessionReady;
  const activeBusy = taskIsBusy(current);
  const canEditCurrent = Boolean(current) && !activeBusy && current.status !== "completed";

  quoteFile.disabled = controlsDisabled || atLimit;
  templateType.disabled = controlsDisabled || atLimit;
  parseButton.disabled = controlsDisabled || !hasFile || atLimit;
  uploadDropzone?.classList.toggle("is-disabled", controlsDisabled || atLimit);

  quoteTextPreview.disabled = !canEditCurrent || !current?.quoteText;
  if (extraInfoText) extraInfoText.disabled = !canEditCurrent || !current?.quoteText;
  if (identifyFieldsButton) {
    identifyFieldsButton.disabled = !canEditCurrent || !current?.upload || !quoteTextPreview.value.trim();
  }
  generateButton.disabled = !canEditCurrent || !current?.fieldPreview?.extractedData;

  if (taskQueueHint) {
    taskQueueHint.textContent = `未完成 ${incompleteTaskCount()} / ${MAX_TASKS}。点击任务卡片可切换编辑，已完成任务不占用额度。`;
  }
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

  if (!window.dd?.runtime?.permission?.requestAuthCode) return false;
  if (platform === "notindingtalk") return false;
  if (platform) return true;
  return /dingtalk/i.test(userAgent);
}

function showAccessModal(message) {
  if (!accessModal) return;
  if (accessModalMessage) accessModalMessage.textContent = message;
  accessModal.hidden = false;
}

function closeAccessModal() {
  if (accessModal) accessModal.hidden = true;
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

  if (progressHint) {
    progressHint.textContent = message || "";
    progressHint.hidden = !message;
  }
}

function setAuthReadyProgress(message = "") {
  progressSteps.forEach((step) => {
    step.classList.remove("is-active", "is-complete", "is-error");
    if (step.dataset.step === "auth") step.classList.add("is-complete");
  });
  if (progressHint) {
    progressHint.textContent = message;
    progressHint.hidden = !message;
  }
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
      userDeptEl.classList.remove("muted");
    } else if (Array.isArray(ids) && ids.length) {
      userDeptEl.textContent = `部门 ID：${ids.join("、")}`;
      userDeptEl.classList.remove("muted");
    } else {
      userDeptEl.textContent = "部门：未返回";
      userDeptEl.classList.add("muted");
    }
  }
  setUserDetail(userMobileEl, "手机", user?.mobile, "未返回（需通讯录手机号权限）");
  setUserDetail(userTitleEl, "职位", user?.title);
  setUserDetail(userJobNumberEl, "工号", user?.jobNumber);
  setUserDetail(userEmailEl, "邮箱", user?.email, "未返回（需通讯录邮箱权限）");
  setUserDetail(userUseridEl, "UserID", compactIdentity(user?.userid));
  setUserDetail(userUnionidEl, "UnionID", compactIdentity(user?.unionid));
  if (loginHintEl && hint != null) {
    loginHintEl.textContent = hint;
  }
}

function hideUserBar() {
  if (userBar) userBar.hidden = true;
}

function setUserDetail(el, label, value, emptyText = "未返回") {
  if (!el) return;
  const text = value == null ? "" : String(value).trim();
  if (text) {
    el.textContent = `${label}：${text}`;
    el.classList.remove("muted");
  } else {
    el.textContent = `${label}：${emptyText}`;
    el.classList.add("muted");
  }
}

function compactIdentity(value) {
  const text = String(value || "").trim();
  if (text.length <= 18) return text;
  return `${text.slice(0, 8)}…${text.slice(-6)}`;
}

async function refreshAuthMe() {
  const response = await fetchBff(apiUrl("/bff/auth/me"));
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

function requestDingTalkAuthCode(corpId, timeoutMs = 12000) {
  return new Promise((resolve, reject) => {
    appendStageLog("获取钉钉免登码", "开始调用 dd.runtime.permission.requestAuthCode");
    if (!isDingTalkClient()) {
      const error = new Error("获取钉钉免登码失败：当前环境不支持 dd.runtime.permission.requestAuthCode，请在钉钉客户端内打开合同生成助手");
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
      window.dd.runtime.permission.requestAuthCode({
        corpId,
        onSuccess: finish((value) => {
          const code = value?.code || "";
          appendStageLog(
            "获取钉钉免登码",
            code ? `成功获取 code length=${code.length} code=${maskDiagnosticValue(code, 6, 6)}` : "成功回调但未返回 code",
          );
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
    "运行环境",
    `platform=${getDingTalkPlatform() || "unknown"} dingtalkClient=${isDingTalkClient() ? "是" : "否"}`,
  );
  setProgress("auth", "active", "正在确认钉钉免登状态。");

  let configResponse;
  try {
    appendStageLog("读取鉴权配置", "请求 /bff/auth/config");
    configResponse = await fetchBff(apiUrl("/bff/auth/config"));
    appendStageLog("读取鉴权配置", `HTTP ${configResponse.status}`);
  } catch (error) {
    const message = `读取鉴权配置失败：${formatError(error)}`;
    appendStageLog("读取鉴权配置失败", message);
    setInteractionEnabled(false);
    setStatus(message, "error");
    setProgress("auth", "error", message);
    return;
  }
  if (!configResponse.ok) {
    appendStageLog("读取鉴权配置失败", `HTTP ${configResponse.status}`);
    setInteractionEnabled(false);
    setStatus(`读取鉴权配置失败：HTTP ${configResponse.status}`, "error");
    setProgress("auth", "error", "读取鉴权配置失败，请稍后重试。");
    return;
  }
  authContext = await configResponse.json();
  agentAuth.baseUrl = authContext.agentBaseUrl || "";
  appendStageLog(
    "读取鉴权配置",
    `agent=${configState(authContext.agentBaseUrl)} corpId=${configState(authContext.corpId)} clientId=${configState(authContext.clientId)}`,
  );

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
    if (loginHintEl) loginHintEl.textContent = "请联系管理员配置钉钉新版 SDK 凭证。";
    return;
  }

  let me = null;
  try {
    appendStageLog("检查已有登录态", "请求 /bff/auth/me");
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
    await refreshAgentToken();
    showUserBar(me.user, "已通过钉钉免登。");
    setInteractionEnabled(true);
    setStatus("");
    setAuthReadyProgress("");
    return;
  }

  sessionReady = false;
  setInteractionEnabled(false);
  hideUserBar();
  setStatus("正在钉钉内免登…");
  if (loginHintEl) loginHintEl.textContent = "正在获取免登授权码…";

  const searchParams = new URLSearchParams(window.location.search);
  const corpIdFromUrl = searchParams.get("corpid") || searchParams.get("corpId") || "";
  const corpId = corpIdFromUrl || authContext.corpId || "";
  const clientId = authContext.clientId || "";

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

  appendStageLog(
    "免登诊断",
    `origin=${window.location.origin} corpId=${corpId} clientId=${clientId} clientSecret=${authContext.clientSecretHint || "未知"} jsapi=dd.runtime.permission.requestAuthCode`,
  );

  await waitForDingTalkReady().then(() => requestDingTalkAuthCode(corpId)).then(async (result) => {
    const code = result && result.code;
    if (!code) throw new Error("获取钉钉免登码失败：未获取到免登授权码");
    appendStageLog("免登码诊断", `length=${code.length} code=${maskDiagnosticValue(code, 6, 6)}`);
    appendStageLog("提交免登码", "请求 /bff/auth/dingtalk-login");
    let loginResponse;
    try {
      loginResponse = await fetchBff(apiUrl("/bff/auth/dingtalk-login"), {
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
      const reason = body.detail || body.message || `HTTP ${loginResponse.status}`;
      throw new Error(`提交免登码到 BFF 失败：${reason}`);
    }
    agentAuth = {
      baseUrl: body.agentBaseUrl || authContext.agentBaseUrl || "",
      token: body.agentAccessToken || "",
      expiresAt: Number(body.expiresAt || 0),
    };
    if (body.user) {
      try {
        sessionStorage.setItem("hetong_user_preview", JSON.stringify(body.user));
      } catch {
        /* ignore */
      }
      showUserBar(body.user, "已通过钉钉免登。");
    }
    appendStageLog("免登完成", "已通过钉钉免登并获取 AgentRun 访问凭证");
    setInteractionEnabled(true);
    setStatus("");
    setAuthReadyProgress("");
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
  const response = await fetchAgent("/api/uploads", {
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
    throw new Error(body.message || body.detail || body.error || "上传失败");
  }
  return response.json();
}

async function parseUploadedQuote(uploadId, taskTemplateType) {
  const response = await fetchAgent(`/api/uploads/${encodeURIComponent(uploadId)}/quote-text`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ templateType: taskTemplateType }),
  });
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(body.message || body.detail || body.error || "解析报价单失败");
  }
  return response.json();
}

async function previewQuoteFields(uploadId, quoteText, extraInfo, taskTemplateType) {
  const response = await fetchAgent(`/api/uploads/${encodeURIComponent(uploadId)}/field-preview`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      templateType: taskTemplateType,
      quoteText,
      extraInfo,
    }),
  });
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(body.message || body.detail || body.error || "字段识别失败");
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

function openDingTalkPreview(payload) {
  const preview = payload?.preview || {};
  const url = preview.previewUrl || preview.openUrl || payload?.previewUrl || payload?.openUrl;
  if (!url) throw new Error("未返回钉盘预览入口");
  if (window.dd?.openLink) {
    window.dd.openLink({ url });
    return;
  }
  if (window.dd?.biz?.util?.openLink) {
    window.dd.biz.util.openLink({ url });
    return;
  }
  window.open(url, "_blank", "noopener");
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

async function generateContract(task, quoteText, extraInfo, extractedData) {
  let userPreview = null;
  try {
    userPreview = JSON.parse(sessionStorage.getItem("hetong_user_preview") || "null");
  } catch {
    userPreview = null;
  }

  const response = await fetchAgent("/ag-ui/agent", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "text/event-stream",
    },
    body: JSON.stringify({
      threadId: `h5-${task.id}`,
      runId: `run-${task.id}-${Date.now()}`,
      state: {},
      messages: [{ id: `message-${task.id}`, role: "user", content: "生成合同" }],
      tools: [],
      context: userPreview ? [{ type: "user_profile", data: userPreview }] : [],
      forwardedProps: {
        uploadId: task.upload.id,
        templateType: task.templateType,
        quoteText,
        extraInfo,
        extractedData,
        dingtalkUser: userPreview,
      },
    }),
  });

  if (!response.ok || !response.body) {
    const body = await response.json().catch(() => ({}));
    throw new Error(body.message || body.detail || "生成请求失败");
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
      if (event.type === "TEXT_MESSAGE_CONTENT") appendTaskLog(task, event.delta || "");
      if (event.type === "CUSTOM" && event.name === "contract_generated") {
        task.download = event.value || {};
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

function currentShanghaiDateParts() {
  const parts = new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const getPart = (type) => parts.find((part) => part.type === type)?.value || "";
  return {
    year: getPart("year"),
    month: getPart("month"),
    day: getPart("day"),
  };
}

function autoDateValueForKey(key, dateParts) {
  if (key === "signYear" || key === "signatureYear") return dateParts.year;
  if (key === "signMonth" || key === "signatureMonth") return dateParts.month;
  if (key === "signDay" || key === "signatureDay") return dateParts.day;
  return null;
}

function applyAutoDateDefaults(extractedData) {
  if (!extractedData || typeof extractedData !== "object") return new Set();
  const dateParts = currentShanghaiDateParts();
  const autoFilledKeys = new Set();
  autoDateFieldKeys.forEach((key) => {
    if (!isBlankField(extractedData[key])) return;
    const value = autoDateValueForKey(key, dateParts);
    if (!value) return;
    extractedData[key] = value;
    autoFilledKeys.add(key);
  });
  return autoFilledKeys;
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

function createContractField(label, value, stats, prefix = "", options = {}) {
  const missing = isBlankField(value);
  markPreviewStat(stats, value);
  const field = createEl("div", [
    "contract-preview-field",
    missing ? "is-missing" : "is-recognized",
    options.autoFilled ? "is-auto-filled" : "",
  ].filter(Boolean).join(" "));
  field.append(
    createEl("span", "contract-field-label", `${prefix}${label}`),
    createEl("span", "contract-field-value", formatFieldValue(value)),
  );
  if (options.autoFilled) field.append(createEl("span", "contract-field-badge", "系统自动填充"));
  return field;
}

function renderScalarPreview(paper, schema, extractedData, stats, autoFilledKeys) {
  const scalars = Array.isArray(schema?.scalars) ? schema.scalars : [];
  if (!scalars.length) return;

  const section = createEl("section", "contract-preview-section");
  section.append(createEl("h4", "", "合同条款字段"));
  const body = createEl("div", "contract-preview-flow");

  scalars.forEach((field, index) => {
    if (index > 0 && index % 8 === 0) body.append(createGhostParagraph(index));
    body.append(createContractField(
      field.label || field.key,
      getByDotPath(extractedData, field.key),
      stats,
      `${index + 1}. `,
      { autoFilled: autoFilledKeys?.has(field.key) },
    ));
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

async function renderFieldPreview(task) {
  const schema = await loadTemplateSchema(task.templateType);
  const extractedData = task.fieldPreview?.extractedData && typeof task.fieldPreview.extractedData === "object" ? task.fieldPreview.extractedData : {};
  const autoFilledKeys = applyAutoDateDefaults(extractedData);
  const stats = { recognized: 0, missing: 0 };

  if (contractPreviewEl) {
    contractPreviewEl.textContent = "";
    const paper = createEl("article", "contract-preview-paper");
    const title = createEl("header", "contract-preview-header");
    title.append(
      createEl("p", "contract-preview-kicker", "合同字段确认稿"),
      createEl("h3", "", task.templateName || schema?.template?.id || "合同模板"),
      createEl("p", "contract-preview-muted", "以下内容按模板字段顺序生成，灰色文本为合同正文位置示意。"),
    );
    paper.append(title, createGhostParagraph(0));
    renderScalarPreview(paper, schema, extractedData, stats, autoFilledKeys);
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

function resetFieldPreviewUi() {
  if (fieldPreviewCard) fieldPreviewCard.hidden = true;
  if (fieldPreviewSummary) {
    fieldPreviewSummary.className = "hint field-preview-summary";
    fieldPreviewSummary.textContent = "请按合同字段顺序确认识别结果，红色字段会在合同中显示为待填写。";
  }
  if (contractPreviewEl) {
    contractPreviewEl.textContent = "";
    contractPreviewEl.append(createEl("p", "empty-state", "等待字段识别。"));
  }
}

function clearActiveEditor() {
  previewCard.hidden = true;
  resetFieldPreviewUi();
  quoteTextPreview.value = "";
  if (extraInfoText) extraInfoText.value = "";
  syncDrawerVisibility(false);
}

function statusLabel(status) {
  return {
    uploading: "上传中",
    parsing: "解析中",
    needs_text: "待确认文本",
    identifying: "字段识别中",
    needs_fields: "待确认字段",
    generating: "生成并上传钉盘中",
    completed: "已完成",
    failed: "失败",
  }[status] || "等待中";
}

function setTaskStatus(task, status, message = "", failedStep = null) {
  task.status = status;
  task.message = message;
  task.failedStep = failedStep;
  if (message) appendTaskLog(task, `${message}\n`);
  renderTaskList();
  syncActiveTaskEditor();
  updateActionAvailability();
}

function createTask(file) {
  const selected = templateType.selectedOptions?.[0];
  return {
    id: `task_${Date.now()}_${Math.random().toString(16).slice(2, 8)}`,
    file,
    fileName: file.name || "报价单",
    templateType: templateType.value,
    templateName: selected?.textContent || templateType.value,
    status: "uploading",
    message: "等待上传报价单",
    log: "",
    quoteText: "",
    extraInfo: "",
    fieldPreview: null,
    upload: null,
    download: null,
    failedStep: null,
  };
}

function selectTask(taskId) {
  activeTaskId = taskId;
  drawerOpen = Boolean(activeTaskId);
  renderTaskList();
  syncActiveTaskEditor();
  updateActionAvailability();
}

function closeTaskDrawer() {
  drawerOpen = false;
  if (taskDrawer) {
    taskDrawer.hidden = true;
    taskDrawer.setAttribute("aria-hidden", "true");
  }
  if (taskDrawerBackdrop) taskDrawerBackdrop.hidden = true;
}

function openCreatePanel() {
  if (taskCreatePanel) taskCreatePanel.hidden = false;
  setStatus("");
  updateActionAvailability();
}

function closeCreatePanel() {
  if (taskCreatePanel) taskCreatePanel.hidden = true;
  quoteFile.value = "";
  updateSelectedFile();
  setStatus("");
  updateActionAvailability();
}

function syncDrawerVisibility(hasContent) {
  const open = Boolean(drawerOpen && hasContent);
  if (taskDrawer) {
    taskDrawer.hidden = !open;
    taskDrawer.setAttribute("aria-hidden", open ? "false" : "true");
  }
  if (taskDrawerBackdrop) taskDrawerBackdrop.hidden = !open;
}

function removeTask(taskId) {
  const index = tasks.findIndex((task) => task.id === taskId);
  if (index < 0 || taskIsBusy(tasks[index])) return;
  tasks.splice(index, 1);
  if (activeTaskId === taskId) {
    activeTaskId = tasks[0]?.id || null;
    drawerOpen = Boolean(activeTaskId);
  }
  renderTaskList();
  syncActiveTaskEditor();
  updateActionAvailability();
}

function createTaskDownloadNode(task) {
  if (!task.download) return null;
  const payload = task.download;
  const url = payload.preview?.previewUrl || payload.preview?.openUrl || payload.previewUrl || payload.openUrl;
  if (url) {
    const button = createEl("button", "task-download", "预览钉盘合同");
    button.type = "button";
    button.addEventListener("click", (event) => {
      event.stopPropagation();
      try {
        openDingTalkPreview(payload);
      } catch (error) {
        appendTaskLog(task, `预览失败：${formatError(error)}\n`);
      }
    });
    return button;
  }
  if (payload.filePath || payload.dingDrive?.filePath) {
    return createEl("p", "task-file-path", `已存入钉盘：${payload.filePath || payload.dingDrive.filePath}`);
  }
  return createEl("p", "task-file-path", "合同已存入钉盘。");
}

function renderTaskList() {
  if (!taskList) return;
  taskList.textContent = "";
  const createCard = createEl("button", "new-task-card", "");
  createCard.type = "button";
  createCard.disabled = !sessionReady || incompleteTaskCount() >= MAX_TASKS;
  createCard.append(
    createEl("strong", "", "+ 新建合同任务"),
    createEl("span", "", createCard.disabled ? "请先完成免登或释放任务额度" : "点击后选择模板并上传报价单"),
  );
  createCard.addEventListener("click", openCreatePanel);
  taskList.append(createCard);
  if (!tasks.length) {
    updateActionAvailability();
    return;
  }

  tasks.forEach((task, index) => {
    const card = createEl("article", [
      "task-card",
      task.id === activeTaskId ? "is-active" : "",
      task.status === "failed" ? "is-error" : "",
      task.status === "completed" ? "is-complete" : "",
    ].filter(Boolean).join(" "));
    card.addEventListener("click", () => selectTask(task.id));

    const header = createEl("div", "task-card-header");
    const title = createEl("div", "task-title");
    title.append(
      createEl("strong", "", `${index + 1}. ${task.fileName}`),
      createEl("small", "", task.templateName),
    );
    header.append(title, createEl("span", `task-status status-${task.status}`, statusLabel(task.status)));

    const message = createEl("p", "task-message", task.message || "等待处理");
    const meta = createEl("p", "task-file-path", `${task.templateName} · ${task.fileName}`);
    const actions = createEl("div", "task-actions");
    const selectButton = createEl("button", "task-secondary-button", task.id === activeTaskId && drawerOpen ? "正在查看" : "查看详情");
    selectButton.type = "button";
    selectButton.addEventListener("click", (event) => {
      event.stopPropagation();
      selectTask(task.id);
    });
    actions.append(selectButton);

    if (task.status === "failed") {
      const retryButton = createEl("button", "task-secondary-button", "重试");
      retryButton.type = "button";
      retryButton.addEventListener("click", (event) => {
        event.stopPropagation();
        retryTask(task);
      });
      actions.append(retryButton);
    }

    const deleteButton = createEl("button", "task-secondary-button is-danger", "删除");
    deleteButton.type = "button";
    deleteButton.disabled = taskIsBusy(task);
    deleteButton.addEventListener("click", (event) => {
      event.stopPropagation();
      removeTask(task.id);
    });
    actions.append(deleteButton);

    card.append(header, meta, message, actions);
    const downloadNode = createTaskDownloadNode(task);
    if (downloadNode) card.append(downloadNode);
    if (task.log) {
      const details = createEl("details", "task-log");
      const summary = createEl("summary", "", "查看任务日志");
      const pre = createEl("pre", "", task.log);
      details.append(summary, pre);
      card.append(details);
    }
    taskList.append(card);
  });
  updateActionAvailability();
}

async function syncActiveTaskEditor() {
  const task = activeTask();
  if (!task || !task.quoteText) {
    clearActiveEditor();
    syncDrawerVisibility(false);
    return;
  }
  previewCard.hidden = false;
  syncDrawerVisibility(true);
  if (activeTaskTitle) activeTaskTitle.textContent = `${task.fileName} · 文本确认`;
  if (activeTaskHint) activeTaskHint.textContent = `${task.templateName}。当前状态：${statusLabel(task.status)}。`;
  quoteTextPreview.value = task.quoteText || "";
  if (extraInfoText) extraInfoText.value = task.extraInfo || "";

  if (task.fieldPreview?.extractedData) {
    await renderFieldPreview(task);
  } else {
    resetFieldPreviewUi();
  }
}

async function runParseTask(task) {
  try {
    setTaskStatus(task, "uploading", "正在上传报价单...");
    if (!task.upload) {
      task.upload = await uploadQuote(task.file);
      appendTaskLog(task, `已上传：${task.upload.originalName}\n`);
    }
    setTaskStatus(task, "parsing", "正在解析报价单内容...");
    const parsed = await parseUploadedQuote(task.upload.id, task.templateType);
    task.quoteText = parsed.quoteText || "";
    task.extraInfo = "";
    task.fieldPreview = null;
    setTaskStatus(task, "needs_text", `解析完成：${parsed.textLength || 0} 字符，请确认文本并识别字段。`);
    setStatus("任务解析完成，请确认文本。");
    setProgress("review", "active", "解析完成，请选择任务继续识别字段。");
  } catch (error) {
    const message = formatError(error);
    setTaskStatus(task, "failed", `处理失败：${message}`, task.upload ? "parse" : "upload");
    setStatus(message, "error");
    setProgress("upload", "error", message);
  }
}

async function runIdentifyTask(task) {
  if (!task.upload || !task.quoteText.trim()) return;
  try {
    task.extraInfo = extraInfoText?.value.trim() || task.extraInfo || "";
    task.fieldPreview = null;
    setTaskStatus(task, "identifying", "正在结合报价单文本和额外信息识别字段...");
    task.fieldPreview = await previewQuoteFields(task.upload.id, task.quoteText.trim(), task.extraInfo, task.templateType);
    await renderFieldPreview(task);
    const missing = task.fieldPreview.missingFields?.length || 0;
    setTaskStatus(
      task,
      "needs_fields",
      missing > 0 ? `字段识别完成，仍有 ${missing} 项待填写。` : "字段识别完成，未发现缺失字段。",
    );
    setStatus(missing > 0 ? "字段识别完成，请确认红色提示。" : "字段识别完成，未发现缺失字段。", missing > 0 ? "info" : "success");
    setProgress("review", "active", "字段识别完成，请确认后生成合同。");
  } catch (error) {
    const message = formatError(error);
    setTaskStatus(task, "failed", `字段识别失败：${message}`, "identify");
    setStatus(message, "error");
    setProgress("review", "error", message);
  }
}

async function runGenerateTask(task) {
  if (!task.upload || !task.fieldPreview?.extractedData) return;
  try {
    task.quoteText = quoteTextPreview.value.trim() || task.quoteText;
    task.extraInfo = extraInfoText?.value.trim() || task.extraInfo || "";
    task.download = null;
    setTaskStatus(task, "generating", "正在生成合同并上传钉盘...");
    await generateContract(task, task.quoteText, task.extraInfo, task.fieldPreview.extractedData);
    setTaskStatus(task, "completed", "合同已生成并存入钉盘。");
    setStatus("合同已生成并存入钉盘。", "success");
    setProgress("done", "active", "合同已生成并存入钉盘。");
  } catch (error) {
    const message = formatError(error);
    setTaskStatus(task, "failed", `处理失败：${message}`, "generate");
    setStatus(message, "error");
    setProgress("generate", "error", message);
  }
}

function retryTask(task) {
  if (task.failedStep === "upload" || task.failedStep === "parse") {
    void runParseTask(task);
    return;
  }
  if (task.failedStep === "identify") {
    void runIdentifyTask(task);
    return;
  }
  if (task.failedStep === "generate") {
    void runGenerateTask(task);
  }
}

quoteFile.addEventListener("change", () => {
  updateSelectedFile();
  setStatus(quoteFile.files?.[0] ? "文件已选择，可以创建任务。" : "");
  if (quoteFile.files?.[0]) {
    setProgress("upload", "active", "文件已选择，点击创建任务。");
  } else {
    setAuthReadyProgress("");
  }
  updateActionAvailability();
});

templateType.addEventListener("change", () => {
  setStatus("模板已切换，将用于后续新任务。");
  setProgress("upload", "active", "模板已切换，已创建任务不会被修改。");
});

quoteTextPreview.addEventListener("input", () => {
  const task = activeTask();
  if (!task || taskIsBusy(task)) return;
  task.quoteText = quoteTextPreview.value;
  task.fieldPreview = null;
  if (task.status !== "failed") task.status = "needs_text";
  renderTaskList();
  resetFieldPreviewUi();
  updateActionAvailability();
});

extraInfoText?.addEventListener("input", () => {
  const task = activeTask();
  if (!task || taskIsBusy(task)) return;
  task.extraInfo = extraInfoText.value;
  task.fieldPreview = null;
  if (task.status !== "failed") task.status = "needs_text";
  renderTaskList();
  resetFieldPreviewUi();
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
  if (incompleteTaskCount() >= MAX_TASKS) {
    setStatus("未完成任务已达到 5 个，请先完成或删除任务。", "error");
    return;
  }
  const task = createTask(file);
  tasks.unshift(task);
  selectTask(task.id);
  quoteFile.value = "";
  updateSelectedFile();
  closeCreatePanel();
  setStatus("已创建任务，正在上传解析...");
  setProgress("upload", "active", "任务已创建，正在上传解析。");
  void runParseTask(task);
});

identifyFieldsButton?.addEventListener("click", async () => {
  const task = activeTask();
  if (!task) {
    setStatus("请先选择任务。", "error");
    return;
  }
  const quoteText = quoteTextPreview.value.trim();
  if (!quoteText) {
    setStatus("解析文本为空，请补充后再识别字段。", "error");
    return;
  }
  task.quoteText = quoteText;
  await runIdentifyTask(task);
});

generateButton.addEventListener("click", async () => {
  const task = activeTask();
  if (!task) {
    setStatus("请先选择任务。", "error");
    return;
  }
  const quoteText = quoteTextPreview.value.trim();
  if (!quoteText) {
    setStatus("解析文本为空，请补充后再生成合同。", "error");
    return;
  }
  if (!task.fieldPreview?.extractedData) {
    setStatus("请先识别并确认合同字段。", "error");
    return;
  }
  task.quoteText = quoteText;
  await runGenerateTask(task);
});

closeTaskDrawerButton?.addEventListener("click", closeTaskDrawer);
taskDrawerBackdrop?.addEventListener("click", closeTaskDrawer);
closeAccessModalButton?.addEventListener("click", closeAccessModal);

updateSelectedFile();
renderTaskList();
clearActiveEditor();
updateActionAvailability();
void initAuth();
