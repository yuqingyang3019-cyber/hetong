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
const loginHintEl = document.querySelector("#loginHint");
const uploadDropzone = document.querySelector("#uploadDropzone");
const fileNameText = document.querySelector("#fileNameText");
const fileMetaText = document.querySelector("#fileMetaText");
const accessModal = document.querySelector("#accessModal");
const accessModalMessage = document.querySelector("#accessModalMessage");
const closeAccessModalButton = document.querySelector("#closeAccessModalButton");
const taskDrawer = document.querySelector("#taskDrawer");
const taskDrawerBackdrop = document.querySelector("#taskDrawerBackdrop");
const closeTaskDrawerButton = document.querySelector("#closeTaskDrawerButton");
const processingCard = document.querySelector("#processingCard");
const processingTitle = document.querySelector("#processingTitle");
const processingHint = document.querySelector("#processingHint");
const drawerStepItems = Array.from(document.querySelectorAll("[data-drawer-step]"));
const drawerDownloadAction = document.querySelector("#drawerDownloadAction");

const MAX_TASKS = 5;
const supportedQuoteFileExtensions = new Set([".pdf", ".xls", ".xlsx", ".jpg", ".jpeg", ".png"]);
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
let drawerLastFocus = null;
let uploadDragDepth = 0;

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
    expiresAt: parseExpiresAt(body.expiresAt),
  };
  return agentAuth;
}

function parseExpiresAt(value) {
  if (typeof value === "number") return value;
  if (typeof value === "string" && value.trim()) {
    const numeric = Number(value);
    if (Number.isFinite(numeric)) return numeric;
    const millis = Date.parse(value);
    if (Number.isFinite(millis)) return Math.floor(millis / 1000);
  }
  return 0;
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
  if (!logEl) return;
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

function setStatus(message, tone = "info") {
  if (!statusEl) return;
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
  statusEl.scrollIntoView({ block: "nearest", behavior: "smooth" });
}

function formatFileSize(size) {
  if (!Number.isFinite(size) || size <= 0) return "0 KB";
  if (size < 1024 * 1024) return `${Math.ceil(size / 1024)} KB`;
  return `${(size / 1024 / 1024).toFixed(1)} MB`;
}

function quoteFileExtension(file) {
  const name = file?.name || "";
  const dotIndex = name.lastIndexOf(".");
  return dotIndex >= 0 ? name.slice(dotIndex).toLowerCase() : "";
}

function validateQuoteFile(file) {
  if (!file) return "请先选择报价单文件。";
  if (file.size === 0) return "报价单文件为空，请重新选择文件。";
  if (!supportedQuoteFileExtensions.has(quoteFileExtension(file))) return "仅支持 PDF、Excel、图片格式报价单。";
  return "";
}

function updateSelectedFile() {
  const file = quoteFile.files?.[0];
  uploadDropzone?.classList.toggle("has-file", Boolean(file));
  if (!file) {
    if (fileNameText) fileNameText.textContent = "拖拽或点击选择报价单文件";
    if (fileMetaText) fileMetaText.textContent = "支持 PDF、Excel、图片格式，拖到这里即可上传";
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
  const currentFile = quoteFile.files?.[0];
  const hasFile = Boolean(currentFile);
  const hasValidFile = hasFile && !validateQuoteFile(currentFile);
  const atLimit = incompleteTaskCount() >= MAX_TASKS;
  const controlsDisabled = !sessionReady;
  const activeBusy = taskIsBusy(current);
  const canEditCurrent = Boolean(current) && !activeBusy && current.status !== "completed";

  quoteFile.disabled = controlsDisabled || atLimit;
  templateType.disabled = controlsDisabled || atLimit;
  parseButton.disabled = controlsDisabled || !hasValidFile || atLimit;
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

function setUploadDragging(isDragging) {
  uploadDropzone?.classList.toggle("is-dragging", isDragging);
}

function handleUploadDragOver(event) {
  event.preventDefault();
  if (!event.dataTransfer) return;
  event.dataTransfer.dropEffect = quoteFile.disabled ? "none" : "copy";
}

function handleUploadDragEnter(event) {
  handleUploadDragOver(event);
  if (quoteFile.disabled) return;
  uploadDragDepth += 1;
  setUploadDragging(true);
}

function handleUploadDragLeave(event) {
  event.preventDefault();
  uploadDragDepth = Math.max(0, uploadDragDepth - 1);
  if (uploadDragDepth === 0) setUploadDragging(false);
}

function handleUploadDrop(event) {
  event.preventDefault();
  uploadDragDepth = 0;
  setUploadDragging(false);

  if (quoteFile.disabled) {
    setStatus("请先完成免登或释放任务额度后再上传报价单。", "error");
    return;
  }

  const files = Array.from(event.dataTransfer?.files || []);
  if (files.length !== 1) {
    setStatus("每次只能拖入一份报价单。", "error");
    return;
  }

  const [file] = files;
  startTaskFromFile(file);
}

function drawerStepForTask(task) {
  if (!task) return "";
  if (task.status === "completed") return "done";
  if (task.status === "generating") return "generate";
  if (task.status === "identifying" || task.status === "needs_fields") return "review";
  return "upload";
}

function setDrawerStep(currentStep) {
  const order = ["upload", "review", "generate"];
  const activeIndex = order.indexOf(currentStep);
  drawerStepItems.forEach((item) => {
    const itemIndex = order.indexOf(item.dataset.drawerStep);
    item.classList.remove("is-active", "is-complete");
    if (currentStep === "done") {
      item.classList.add("is-complete");
      return;
    }
    if (itemIndex >= 0 && itemIndex < activeIndex) item.classList.add("is-complete");
    if (item.dataset.drawerStep === currentStep) item.classList.add("is-active");
  });
}

function setDrawerBusy(task) {
  if (!taskDrawer) return;
  taskDrawer.setAttribute("aria-busy", taskIsBusy(task) ? "true" : "false");
}

function syncProcessingPanel(task) {
  if (!processingCard) return;
  const show = Boolean(task && (taskIsBusy(task) || (!task.quoteText && task.status === "failed")));
  processingCard.classList.remove("is-uploading", "is-parsing", "is-identifying", "is-generating", "is-failed");
  processingCard.hidden = !show;
  if (!show) return;
  processingCard.classList.add(`is-${task.status}`);
  const smartTitles = {
    uploading: "智能助手正在接收报价单",
    parsing: "AI 正在读取报价单内容",
    identifying: "字段识别中，请稍候",
    generating: "正在生成合同并交付钉盘",
    failed: "智能处理遇到问题",
  };
  const smartHints = {
    uploading: "可以关闭当前任务详情去新建任务，上传完成后会自动进入解析。",
    parsing: "可以先处理其他报价单，解析完成后回来确认文本即可。",
    identifying: "AI 正在按所选合同模板匹配字段。你可以关闭当前任务详情去新建任务，不用停在这里等待；完成后回来查看即可。",
    generating: "合同会根据你确认过的字段生成，可以先处理其他报价单。",
    failed: "任务处理失败，请返回任务卡片重试或删除。",
  };
  if (processingTitle) processingTitle.textContent = smartTitles[task.status] || statusLabel(task.status);
  if (processingHint) {
    processingHint.textContent = smartHints[task.status] || task.message || "请稍候，系统正在处理当前报价单。";
  }
}

function syncDrawerDownload(task) {
  if (!drawerDownloadAction) return;
  drawerDownloadAction.textContent = "";
  const node = task?.status === "completed" ? createTaskDownloadNode(task) : null;
  drawerDownloadAction.hidden = !node;
  if (node) drawerDownloadAction.append(node);
}

function setInteractionEnabled(enabled) {
  sessionReady = enabled;
  renderTaskList();
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
  window.setTimeout(() => closeAccessModalButton?.focus(), 0);
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
  if (loginHintEl) loginHintEl.textContent = message;
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
    if (Array.isArray(names) && names.length) {
      userDeptEl.textContent = `部门：${names.join("、")}`;
      userDeptEl.classList.remove("muted");
    } else {
      userDeptEl.textContent = "部门：未返回";
      userDeptEl.classList.add("muted");
    }
  }
  if (loginHintEl && hint != null) {
    loginHintEl.textContent = hint;
  }
}

function hideUserBar() {
  if (userBar) userBar.hidden = true;
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

function requestDingTalkAuthCode(corpId, clientId = "", timeoutMs = 12000) {
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
      const requestParams = {
        corpId,
        onSuccess: finish((value) => {
          const code = value?.code || "";
          appendStageLog("获取钉钉免登码", code ? `成功获取 code length=${code.length}` : "成功回调但未返回 code");
          resolve(value);
        }),
        onFail: finish((err) => {
          const message = err?.errorMessage || err?.message || formatError(err);
          appendStageLog("获取钉钉免登码失败", message);
          reject(new Error(`获取钉钉免登码失败：${message}`));
        }),
      };
      if (clientId) requestParams.clientId = clientId;
      window.dd.runtime.permission.requestAuthCode({
        ...requestParams,
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
    return;
  }
  if (!configResponse.ok) {
    appendStageLog("读取鉴权配置失败", `HTTP ${configResponse.status}`);
    setInteractionEnabled(false);
    setStatus(`读取鉴权配置失败：HTTP ${configResponse.status}`, "error");
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
    try {
      await refreshAgentToken();
      showUserBar(me.user, "已通过钉钉免登。");
      setInteractionEnabled(true);
      setStatus("");
    } catch (error) {
      const message = `登录态刷新失败：${formatError(error)}，请重新打开应用。`;
      appendStageLog("刷新 AgentRun 访问凭证失败", message);
      setInteractionEnabled(false);
      setStatus(message, "error");
      if (loginHintEl) loginHintEl.textContent = message;
    }
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
    if (loginHintEl) loginHintEl.textContent = "config.js 可注入 __DINGTALK_CORP_ID__。";
    return;
  }
  if (!clientId) {
    sessionReady = false;
    appendStageLog("免登配置失败", "缺少 clientId");
    setStatus("缺少钉钉 Client ID，无法免登。", "error");
    if (loginHintEl) loginHintEl.textContent = "config.js 可注入 __DINGTALK_CLIENT_ID__。";
    return;
  }

  appendStageLog(
    "免登诊断",
    `origin=${window.location.origin} corpId=${corpId} clientId=${clientId} jsapi=dd.runtime.permission.requestAuthCode`,
  );

  await waitForDingTalkReady().then(() => requestDingTalkAuthCode(corpId, clientId)).then(async (result) => {
    const code = result && result.code;
    if (!code) throw new Error("获取钉钉免登码失败：未获取到免登授权码");
    appendStageLog("免登码诊断", `length=${code.length}`);
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
      const reason = body.message || body.detail || `HTTP ${loginResponse.status}`;
      throw new Error(`提交免登码到 BFF 失败：${reason}`);
    }
    agentAuth = {
      baseUrl: body.agentBaseUrl || authContext.agentBaseUrl || "",
      token: body.agentAccessToken || "",
      expiresAt: parseExpiresAt(body.expiresAt),
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
    if (loginHintEl) loginHintEl.textContent = "";
  }).catch((error) => {
    sessionReady = false;
    const message = error instanceof Error ? error.message : "免登失败";
    appendStageLog("免登失败", message);
    setStatus(message, "error");
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

async function downloadDingDriveContract(payload) {
  const dingDrive = payload?.dingDrive || {};
  if (!dingDrive.spaceId || !dingDrive.fileId) throw new Error("未返回钉盘文件信息");
  const fileName = dingDrive.fileName || payload?.fileName || "合同.docx";
  const response = await fetchAgent("/api/dingdrive/download", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      spaceId: dingDrive.spaceId,
      fileId: dingDrive.fileId,
      fileName,
    }),
  });
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(body.message || body.detail || "下载合同失败");
  }
  const blob = await response.blob();
  const objectUrl = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = objectUrl;
  link.download = fileName;
  document.body.append(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(objectUrl), 30_000);
  return {
    fileName,
    savePathHint: payload?.download?.savePathHint || "文件将保存到浏览器或钉钉客户端的默认下载目录；如系统弹窗提示，请选择目标保存位置。",
  };
}

function parseSseChunk(chunk) {
  return chunk
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

function consumeSseBuffer(buffer) {
  const lastBoundary = buffer.lastIndexOf("\n\n");
  if (lastBoundary < 0) return { events: [], rest: buffer };
  const complete = buffer.slice(0, lastBoundary);
  return { events: parseSseChunk(complete.split("\n\n")), rest: buffer.slice(lastBoundary + 2) };
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
  let finished = false;
  let generated = null;
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const parsed = consumeSseBuffer(buffer);
    buffer = parsed.rest;
    for (const event of parsed.events) {
      if (event.type === "TEXT_MESSAGE_CONTENT") appendTaskLog(task, event.delta || "");
      if (event.type === "CUSTOM" && event.name === "contract_generated") {
        generated = event.value || {};
        task.download = generated;
      }
      if (event.type === "RUN_ERROR") throw new Error(event.message || "生成失败");
      if (event.type === "RUN_FINISHED") finished = true;
    }
  }
  const hasDownload = Boolean(generated?.dingDrive?.spaceId && generated?.dingDrive?.fileId);
  if (!finished || !generated || !hasDownload) {
    throw new Error("合同生成未返回钉盘文件下载信息，请重试。");
  }
  return generated;
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

function setByDotPath(data, key, value) {
  if (!data || typeof data !== "object" || !key) return;
  if (Object.prototype.hasOwnProperty.call(data, key) || !key.includes(".")) {
    data[key] = value;
    return;
  }

  const parts = key.split(".").filter(Boolean);
  let current = data;
  parts.slice(0, -1).forEach((part) => {
    if (!current[part] || typeof current[part] !== "object" || Array.isArray(current[part])) {
      current[part] = {};
    }
    current = current[part];
  });
  current[parts[parts.length - 1]] = value;
}

function isBlankField(value) {
  if (value == null) return true;
  if (typeof value === "string") return !value.trim();
  if (Array.isArray(value)) return value.length === 0;
  if (typeof value === "object") return Object.values(value).every(isBlankField);
  return false;
}

function fieldValueForEditor(value) {
  if (isBlankField(value)) return "";
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

function setRecognizedClass(element, value) {
  const missing = isBlankField(value);
  element.classList.toggle("is-missing", missing);
  element.classList.toggle("is-recognized", !missing);
}

function calculatePreviewStats(schema, extractedData) {
  const stats = { recognized: 0, missing: 0 };
  const scalars = Array.isArray(schema?.scalars) ? schema.scalars : [];
  scalars.forEach((field) => markPreviewStat(stats, getByDotPath(extractedData, field.key)));

  Object.entries(schema?.tables || {}).forEach(([tableName, tableDef]) => {
    const columns = Array.isArray(tableDef?.columns) ? tableDef.columns : [];
    const rows = Array.isArray(extractedData?.[tableName]) ? extractedData[tableName] : [];
    if (!rows.length) {
      stats.missing += 1;
      return;
    }
    rows.forEach((row) => {
      columns.forEach((column) => markPreviewStat(stats, getByDotPath(row, column.key)));
    });
  });
  return stats;
}

function syncFieldPreviewSummary(stats) {
  if (!fieldPreviewSummary) return;
  fieldPreviewSummary.className = `hint field-preview-summary${stats.missing ? " has-missing" : " all-recognized"}`;
  fieldPreviewSummary.textContent = stats.missing
    ? `按合同顺序展示：已识别 ${stats.recognized} 项，仍有 ${stats.missing} 项待填写。可直接修改字段，确认生成后空字段会在 Word 合同中留空。`
    : `按合同顺序展示：已识别 ${stats.recognized} 项，没有待填写字段。可直接修改字段后生成合同。`;
}

function refreshFieldPreviewSummary(schema, extractedData) {
  syncFieldPreviewSummary(calculatePreviewStats(schema, extractedData));
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
  const editor = createEl("textarea", "contract-field-editor");
  editor.rows = 2;
  editor.value = fieldValueForEditor(value);
  editor.placeholder = "待填写";
  editor.disabled = Boolean(options.disabled);
  editor.setAttribute("aria-label", `${prefix}${label}`);
  editor.addEventListener("input", () => {
    setByDotPath(options.extractedData, options.fieldKey, editor.value);
    setRecognizedClass(field, editor.value);
    refreshFieldPreviewSummary(options.schema, options.extractedData);
  });

  field.append(
    createEl("span", "contract-field-label", `${prefix}${label}`),
    editor,
  );
  if (options.autoFilled) field.append(createEl("span", "contract-field-badge", "系统自动填充"));
  return field;
}

function renderScalarPreview(paper, schema, extractedData, stats, autoFilledKeys, canEditPreview) {
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
      {
        autoFilled: autoFilledKeys?.has(field.key),
        extractedData,
        fieldKey: field.key,
        schema,
        disabled: !canEditPreview,
      },
    ));
  });

  section.append(body);
  paper.append(section);
}

function renderTablePreview(paper, schema, extractedData, stats, canEditPreview) {
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
    rows.forEach((row, rowIndex) => {
      const bodyRow = createEl("tr");
      columns.forEach((column) => {
        const value = row && typeof row === "object" ? getByDotPath(row, column.key) : null;
        markPreviewStat(stats, value);
        const cell = createEl("td", isBlankField(value) ? "is-missing" : "is-recognized");
        const editor = createEl("textarea", "contract-table-editor");
        editor.rows = 2;
        editor.value = fieldValueForEditor(value);
        editor.placeholder = "待填写";
        editor.disabled = !canEditPreview;
        editor.setAttribute("aria-label", `${tableDef?.label || tableName} 第 ${rowIndex + 1} 行 ${column.label || column.key}`);
        editor.addEventListener("input", () => {
          if (row && typeof row === "object") setByDotPath(row, column.key, editor.value);
          setRecognizedClass(cell, editor.value);
          refreshFieldPreviewSummary(schema, extractedData);
        });
        cell.append(editor);
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
  const canEditPreview = !taskIsBusy(task) && task.status !== "completed";
  const stats = { recognized: 0, missing: 0 };

  if (contractPreviewEl) {
    contractPreviewEl.textContent = "";
    const paper = createEl("article", "contract-preview-paper");
    const title = createEl("header", "contract-preview-header");
    title.append(
      createEl("p", "contract-preview-kicker", "合同字段确认稿"),
      createEl("h3", "", task.templateName || schema?.template?.id || "合同模板"),
      createEl("p", "contract-preview-muted", "以下内容按模板字段顺序生成，可直接修改后生成合同。"),
    );
    paper.append(title, createGhostParagraph(0));
    renderScalarPreview(paper, schema, extractedData, stats, autoFilledKeys, canEditPreview);
    renderTablePreview(paper, schema, extractedData, stats, canEditPreview);
    paper.append(createGhostParagraph(1));
    contractPreviewEl.append(paper);
  }

  syncFieldPreviewSummary(stats);
  if (fieldPreviewCard) fieldPreviewCard.hidden = false;
}

function resetFieldPreviewUi() {
  if (fieldPreviewCard) fieldPreviewCard.hidden = true;
  if (fieldPreviewSummary) {
    fieldPreviewSummary.className = "hint field-preview-summary";
    fieldPreviewSummary.textContent = "请按合同字段顺序确认识别结果，可直接修改字段；空字段生成到 Word 合同时会留空。";
  }
  if (contractPreviewEl) {
    contractPreviewEl.textContent = "";
    contractPreviewEl.append(createEl("p", "empty-state", "等待字段识别。"));
  }
}

function clearActiveEditor() {
  if (processingCard) processingCard.hidden = true;
  previewCard.hidden = true;
  resetFieldPreviewUi();
  syncDrawerDownload(null);
  setDrawerStep("");
  setDrawerBusy(null);
  quoteTextPreview.value = "";
  if (extraInfoText) extraInfoText.value = "";
  if (identifyFieldsButton) identifyFieldsButton.textContent = "识别当前任务字段";
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

function startTaskFromFile(file) {
  const validationMessage = validateQuoteFile(file);
  if (validationMessage) {
    setStatus(validationMessage, "error");
    updateActionAvailability();
    return false;
  }
  if (!sessionReady) {
    setStatus("请先完成钉钉免登后再上传报价单。", "error");
    return false;
  }
  if (incompleteTaskCount() >= MAX_TASKS) {
    setStatus("未完成任务已达到 5 个，请先完成或删除任务。", "error");
    return false;
  }

  const task = createTask(file);
  tasks.unshift(task);
  selectTask(task.id);
  quoteFile.value = "";
  updateSelectedFile();
  setStatus("已创建任务，正在上传解析...");
  void runParseTask(task);
  return true;
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
  setDrawerBusy(null);
  syncDrawerVisibility(false);
  renderTaskList();
  updateActionAvailability();
}

function openCreatePanel() {
  if (taskCreatePanel) taskCreatePanel.hidden = false;
  taskCreatePanel?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  setStatus("");
  updateActionAvailability();
}

function closeCreatePanel() {
  quoteFile.value = "";
  updateSelectedFile();
  setStatus("");
  updateActionAvailability();
}

function syncDrawerVisibility(hasContent) {
  const open = Boolean(drawerOpen && hasContent);
  if (taskDrawer) {
    const wasOpen = !taskDrawer.hidden;
    taskDrawer.hidden = !open;
    taskDrawer.setAttribute("aria-hidden", open ? "false" : "true");
    if (open && !wasOpen) {
      drawerLastFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      window.setTimeout(() => closeTaskDrawerButton?.focus(), 0);
    }
    if (!open && wasOpen && drawerLastFocus && document.contains(drawerLastFocus)) {
      drawerLastFocus.focus();
      drawerLastFocus = null;
    }
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
  if (payload.dingDrive?.fileId) {
    const button = createEl("button", "task-download", "下载合同文件");
    button.type = "button";
    button.addEventListener("click", async (event) => {
      event.stopPropagation();
      const markDownloadFailed = (error) => {
        const message = formatError(error);
        appendTaskLog(task, `下载失败：${message}\n`);
        setStatus(`下载失败：${message}`, "error");
      };
      try {
        setStatus("正在准备合同下载...");
        const result = await downloadDingDriveContract(payload);
        const message = `合同已开始下载：${result.fileName}。${result.savePathHint}`;
        appendTaskLog(task, `${message}\n`);
        setStatus(message, "success");
      } catch (error) {
        markDownloadFailed(error);
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
    createEl("strong", "", "+ 让 AI 处理一份报价单"),
    createEl("span", "", createCard.disabled ? "请先完成免登或释放任务额度" : "选择模板并上传，AI 会先解析字段"),
  );
  createCard.addEventListener("click", openCreatePanel);

  tasks.forEach((task, index) => {
    const card = createEl("article", [
      "task-card",
      task.id === activeTaskId ? "is-active" : "",
      taskIsBusy(task) ? "is-busy" : "",
      task.status === "failed" ? "is-error" : "",
      task.status === "completed" ? "is-complete" : "",
    ].filter(Boolean).join(" "));
    card.tabIndex = 0;
    card.setAttribute("role", "button");
    card.setAttribute("aria-current", task.id === activeTaskId ? "true" : "false");
    card.setAttribute("aria-busy", taskIsBusy(task) ? "true" : "false");
    card.setAttribute("aria-label", `${index + 1}. ${task.fileName}，${statusLabel(task.status)}，${task.message || "等待处理"}`);
    card.addEventListener("click", () => selectTask(task.id));
    card.addEventListener("keydown", (event) => {
      if (event.key !== "Enter" && event.key !== " ") return;
      event.preventDefault();
      selectTask(task.id);
    });

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
      details.open = Boolean(task.logOpen);
      details.addEventListener("click", (event) => {
        event.stopPropagation();
      });
      details.addEventListener("keydown", (event) => {
        if (event.key === "Enter" || event.key === " ") event.stopPropagation();
      });
      details.addEventListener("toggle", () => {
        task.logOpen = details.open;
      });
      const summary = createEl("summary", "", "查看任务日志");
      const pre = createEl("pre", "", task.log);
      details.append(summary, pre);
      card.append(details);
    }
    taskList.append(card);
  });
  taskList.append(createCard);
  updateActionAvailability();
}

async function syncActiveTaskEditor() {
  const task = activeTask();
  if (!task) {
    clearActiveEditor();
    return;
  }

  const hasEditorContent = Boolean(task.quoteText);
  const shouldOpenDrawer = hasEditorContent || taskIsBusy(task) || task.status === "failed" || task.status === "completed";
  syncDrawerVisibility(shouldOpenDrawer);
  setDrawerBusy(task);
  setDrawerStep(drawerStepForTask(task));
  syncProcessingPanel(task);
  syncDrawerDownload(task);

  if (activeTaskTitle) {
    activeTaskTitle.textContent = `${task.fileName} · ${statusLabel(task.status)}`;
  }
  if (activeTaskHint) {
    const helperHint = task.status === "needs_text"
      ? "AI 已整理出报价单文本，请像核对聊天记录一样检查，有问题直接改。"
      : task.status === "needs_fields"
        ? "AI 已按模板匹配字段，红色内容代表还需要人工补充或确认，可直接修改。"
        : task.message || "请按当前阶段继续处理任务。";
    activeTaskHint.textContent = `${task.templateName}。${helperHint}`;
  }
  if (generateButton) {
    generateButton.hidden = !hasEditorContent || task.status === "completed";
    if (task.status === "generating") generateButton.textContent = "正在生成合同...";
    else generateButton.textContent = "确认识别结果并生成合同";
  }
  if (identifyFieldsButton) {
    identifyFieldsButton.textContent = task.status === "identifying" ? "字段识别中，可先处理其他任务" : "识别当前任务字段";
  }

  previewCard.hidden = !hasEditorContent;
  if (!hasEditorContent) {
    quoteTextPreview.value = "";
    if (extraInfoText) extraInfoText.value = "";
    resetFieldPreviewUi();
    updateActionAvailability();
    return;
  }

  quoteTextPreview.value = task.quoteText || "";
  if (extraInfoText) extraInfoText.value = task.extraInfo || "";

  if (task.fieldPreview?.extractedData) {
    await renderFieldPreview(task);
  } else {
    resetFieldPreviewUi();
  }
  updateActionAvailability();
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
  } catch (error) {
    const message = formatError(error);
    setTaskStatus(task, "failed", `处理失败：${message}`, task.upload ? "parse" : "upload");
    setStatus(message, "error");
  }
}

async function runIdentifyTask(task) {
  if (!task.upload || !task.quoteText.trim()) return;
  try {
    task.extraInfo = extraInfoText?.value.trim() || task.extraInfo || "";
    task.fieldPreview = null;
    setTaskStatus(task, "identifying", "字段识别中：AI 正在匹配合同字段，可关闭当前任务详情并新建其他任务。");
    setStatus("字段识别中，可关闭当前任务详情去新建任务，不用停在这里等待。");
    task.fieldPreview = await previewQuoteFields(task.upload.id, task.quoteText.trim(), task.extraInfo, task.templateType);
    await renderFieldPreview(task);
    const missing = task.fieldPreview.missingFields?.length || 0;
    setTaskStatus(
      task,
      "needs_fields",
      missing > 0 ? `AI 已识别字段，仍有 ${missing} 项需要人工确认。` : "AI 已识别字段，未发现缺失字段。",
    );
    setStatus(missing > 0 ? "AI 已整理字段，请重点确认红色提示。" : "AI 已整理字段，未发现缺失字段。", missing > 0 ? "info" : "success");
  } catch (error) {
    const message = formatError(error);
    setTaskStatus(task, "failed", `字段识别失败：${message}`, "identify");
    setStatus(message, "error");
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
  } catch (error) {
    const message = formatError(error);
    setTaskStatus(task, "failed", `处理失败：${message}`, "generate");
    setStatus(message, "error");
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

uploadDropzone?.addEventListener("dragenter", handleUploadDragEnter);
uploadDropzone?.addEventListener("dragover", handleUploadDragOver);
uploadDropzone?.addEventListener("dragleave", handleUploadDragLeave);
uploadDropzone?.addEventListener("drop", handleUploadDrop);

quoteFile.addEventListener("change", () => {
  updateSelectedFile();
  const file = quoteFile.files?.[0];
  if (file) startTaskFromFile(file);
  else setStatus("");
  updateActionAvailability();
});

templateType.addEventListener("change", () => {
  setStatus("模板已切换，将用于下一份报价单。");
});

quoteTextPreview.addEventListener("input", () => {
  const task = activeTask();
  if (!task || taskIsBusy(task)) return;
  task.quoteText = quoteTextPreview.value;
  task.fieldPreview = null;
  if (task.status !== "failed") task.status = "needs_text";
  renderTaskList();
  resetFieldPreviewUi();
  setDrawerStep("text");
  setStatus("解析内容已修改，请重新识别合同字段。");
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
  setDrawerStep("text");
  setStatus("额外信息已修改，请重新识别合同字段。");
  updateActionAvailability();
});

parseButton.addEventListener("click", async () => {
  const file = quoteFile.files?.[0];
  startTaskFromFile(file);
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
document.addEventListener("keydown", (event) => {
  if (event.key !== "Escape") return;
  if (taskDrawer && !taskDrawer.hidden) {
    closeTaskDrawer();
    return;
  }
  if (accessModal && !accessModal.hidden) closeAccessModal();
});

updateSelectedFile();
renderTaskList();
clearActiveEditor();
updateActionAvailability();
void initAuth();
