const statusEl = document.querySelector("#status");
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
const openCreateTaskButton = document.querySelector("#openCreateTaskButton");
const cancelCreateTaskButton = document.querySelector("#cancelCreateTaskButton");
const confirmCreateTaskButton = document.querySelector("#confirmCreateTaskButton");
const createTaskHint = document.querySelector("#createTaskHint");
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
const drawerActionHint = document.querySelector("#drawerActionHint");
const taskLogCard = document.querySelector("#taskLogCard");
const taskLogDetails = document.querySelector("#taskLogDetails");
const taskLogText = document.querySelector("#taskLogText");

const MAX_TASKS = 5;
const supportedQuoteFileExtensions = new Set([
  ".pdf",
  ".xls",
  ".xlsx",
  ".jpg",
  ".jpeg",
  ".png",
  ".bmp",
  ".gif",
  ".tif",
  ".tiff",
  ".webp",
]);
const templateSchemaFiles = Object.freeze({
  caigouhetong: "caigouhetong",
  nonStandardNoInstall: "non-standard-no-install",
  nonStandardWithInstall: "non-standard-with-install",
  annualFramework: "annual-framework",
  professionalSubcontract: "professional-subcontract",
  laborSubcontract: "labor-subcontract",
});
const autoDateFieldKeys = Object.freeze(["signYear", "signMonth", "signDay", "signatureYear", "signatureMonth", "signatureDay"]);
const dateFieldGroups = Object.freeze([
  { id: "signDate", label: "签订日期", keys: ["signYear", "signMonth", "signDay"], suffixes: ["年", "月", "日"] },
  { id: "deliveryDate", label: "最迟交货日期", keys: ["deliveryYear", "deliveryMonth", "deliveryDay"], suffixes: ["年", "月", "日"] },
  { id: "signatureDate", label: "签署日期", keys: ["signatureYear", "signatureMonth", "signatureDay"], suffixes: ["年", "月", "日"] },
]);
const fieldGroupDefinitions = Object.freeze([
  { id: "basic", label: "基础信息", hint: "合同编号、项目、签订与签署信息" },
  { id: "parties", label: "甲乙方信息", hint: "签约主体、联系方式与代表人" },
  { id: "money", label: "金额与税率", hint: "合同金额、税率和系统计算金额" },
  { id: "delivery", label: "交付与质保", hint: "交货地点、货期、最迟交付和质保" },
  { id: "payment", label: "付款与发票", hint: "付款比例、账户、税号和发票相关字段" },
  { id: "other", label: "其他条款", hint: "模板中的其他补充字段" },
]);
const taxCalculationFieldKeys = Object.freeze(["totalAmount", "amountWithoutTax", "taxAmount", "taxRate"]);
const deliveryCalculationFieldKeys = Object.freeze(["deliveryDays"]);
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
let createPanelOpen = false;
let pendingQuoteFile = null;

function apiUrl(path) {
  return path;
}

function agentUrl(path) {
  const base = (agentAuth.baseUrl || authContext.agentBaseUrl || "").replace(/\/$/, "");
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  return base ? `${base}${normalizedPath}` : normalizedPath;
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
    throw new Error(body.message || body.detail || "刷新业务访问凭证失败");
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
  if (window.console?.debug) console.debug(text.trim());
}

function appendTaskLog(task, text) {
  task.log = `${task.log || ""}${text}`;
  renderTaskList();
  if (task.id === activeTaskId) syncTaskLogPanel(task);
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
  if (!drawerOpen) statusEl.scrollIntoView({ block: "nearest", behavior: "smooth" });
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
  if (!supportedQuoteFileExtensions.has(quoteFileExtension(file))) return "仅支持 PDF、Excel 和常见图片格式报价单。";
  return "";
}

function updateSelectedFile() {
  syncUploadPrompt();
}

function clearPendingQuoteFile() {
  pendingQuoteFile = null;
  quoteFile.value = "";
  syncUploadPrompt();
}

function uploadDisabledReason() {
  if (!sessionReady) return "完成钉钉免登后即可上传报价单。";
  if (incompleteTaskCount() >= MAX_TASKS) return `未完成任务已达到 ${MAX_TASKS} 个，请先完成或删除任务。`;
  return "";
}

function syncUploadPrompt() {
  const file = pendingQuoteFile || quoteFile.files?.[0];
  const disabledReason = uploadDisabledReason();
  uploadDropzone?.classList.toggle("has-file", Boolean(file));
  uploadDropzone?.classList.toggle("is-disabled", Boolean(disabledReason));
  uploadDropzone?.setAttribute("aria-disabled", disabledReason ? "true" : "false");
  if (!file) {
    if (fileNameText) fileNameText.textContent = disabledReason ? "暂不可上传报价单" : "拖拽或点击选择报价单文件";
    if (fileMetaText) fileMetaText.textContent = disabledReason || "支持 PDF、Excel 和常见图片格式；选择后点击确认创建任务";
    if (createTaskHint) createTaskHint.textContent = disabledReason || "选择合同模板并上传报价单后，再确认创建任务。";
    return;
  }
  if (fileNameText) fileNameText.textContent = file.name || "已选择报价单";
  if (fileMetaText) fileMetaText.textContent = `${formatFileSize(file.size)} · 已选择，点击确认后进入解析队列`;
  if (createTaskHint) createTaskHint.textContent = `${file.name || "报价单"} 已选择，确认后创建任务。`;
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
  const atLimit = incompleteTaskCount() >= MAX_TASKS;
  const controlsDisabled = !sessionReady;
  const activeBusy = taskIsBusy(current);
  const canEditCurrent = Boolean(current) && !activeBusy && current.status !== "completed";

  quoteFile.disabled = controlsDisabled || atLimit;
  templateType.disabled = controlsDisabled || atLimit;
  syncUploadPrompt();
  if (openCreateTaskButton) openCreateTaskButton.disabled = controlsDisabled || atLimit || createPanelOpen;
  if (cancelCreateTaskButton) cancelCreateTaskButton.disabled = controlsDisabled && !createPanelOpen;
  if (confirmCreateTaskButton) confirmCreateTaskButton.disabled = controlsDisabled || atLimit || !pendingQuoteFile;

  quoteTextPreview.disabled = !canEditCurrent || !current?.quoteText;
  if (extraInfoText) extraInfoText.disabled = !canEditCurrent || !current?.quoteText;
  if (identifyFieldsButton) {
    identifyFieldsButton.disabled = !canEditCurrent || !current?.upload || !quoteTextPreview.value.trim();
  }
  generateButton.disabled = !canEditCurrent || !current?.fieldPreview?.extractedData;

  if (taskQueueHint) {
    taskQueueHint.textContent = `未完成 ${incompleteTaskCount()} / ${MAX_TASKS}。处理中可关闭详情继续新建，已完成任务不占用额度。`;
  }
  syncDrawerActionHint(current);
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
  setPendingQuoteFile(file);
}

function setPendingQuoteFile(file) {
  const validationMessage = validateQuoteFile(file);
  if (validationMessage) {
    setStatus(validationMessage, "error");
    pendingQuoteFile = null;
    quoteFile.value = "";
    updateActionAvailability();
    return false;
  }
  pendingQuoteFile = file;
  setStatus("");
  updateActionAvailability();
  return true;
}

function drawerStepForTask(task) {
  if (!task) return "";
  if (task.status === "completed") return "done";
  if (task.status === "generating") return "generate";
  if (task.status === "identifying" || task.status === "needs_fields") return "review";
  if (task.status === "needs_text") return "text";
  return "upload";
}

function setDrawerStep(currentStep) {
  const order = ["upload", "text", "review", "generate"];
  const normalizedStep = !currentStep ? "" : currentStep === "done" || order.includes(currentStep) ? currentStep : "review";
  const activeIndex = order.indexOf(normalizedStep);
  drawerStepItems.forEach((item) => {
    const itemIndex = order.indexOf(item.dataset.drawerStep);
    item.classList.remove("is-active", "is-complete");
    item.removeAttribute("aria-current");
    if (normalizedStep === "done") {
      item.classList.add("is-complete");
      return;
    }
    if (itemIndex >= 0 && itemIndex < activeIndex) item.classList.add("is-complete");
    if (item.dataset.drawerStep === normalizedStep) {
      item.classList.add("is-active");
      item.setAttribute("aria-current", "step");
    }
  });
}

function failedStepLabel(step) {
  return {
    upload: "上传报价单",
    parse: "解析报价单",
    identify: "识别合同字段",
    generate: "生成并上传合同",
  }[step] || "当前流程";
}

function taskStageLabel(task) {
  if (!task) return "准备中";
  if (task.status === "uploading" || task.status === "parsing") return "上传解析";
  if (task.status === "needs_text") return "确认文本";
  if (task.status === "identifying") return "字段识别";
  if (task.status === "needs_fields") return "确认字段";
  if (task.status === "generating") return "生成交付";
  if (task.status === "completed") return task.downloadState === "downloaded" ? "已开始下载" : "可下载";
  if (task.status === "failed") return `${failedStepLabel(task.failedStep)}失败`;
  return "准备中";
}

function taskNextAction(task) {
  if (!task) return "";
  if (task.status === "uploading") return "正在上传，可关闭详情继续新建任务。";
  if (task.status === "parsing") return "正在解析，完成后请确认文本。";
  if (task.status === "needs_text") return "下一步：核对解析文本，必要时补充说明，再识别字段。";
  if (task.status === "identifying") return "正在按模板匹配字段，完成后回来确认。";
  if (task.status === "needs_fields") return "下一步：补齐红色字段，确认后生成合同。";
  if (task.status === "generating") return "正在生成合同并上传钉盘。";
  if (task.status === "completed") {
    return task.downloadState === "downloaded" ? "已触发下载，请查看浏览器或钉钉默认下载目录。" : "合同已生成，可触发下载。";
  }
  if (task.status === "failed") return `失败环节：${failedStepLabel(task.failedStep)}。请查看日志后重试。`;
  return task.message || "等待处理。";
}

function syncDrawerActionHint(task) {
  if (!drawerActionHint) return;
  const message = taskNextAction(task);
  drawerActionHint.textContent = message;
  drawerActionHint.hidden = !message;
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

function syncTaskLogPanel(task) {
  if (!taskLogCard || !taskLogDetails || !taskLogText) return;
  const hasLog = Boolean(task?.log);
  taskLogCard.hidden = !hasLog;
  if (!hasLog) {
    taskLogText.textContent = "";
    return;
  }
  taskLogDetails.open = Boolean(task.logOpen);
  taskLogDetails.ontoggle = () => {
    task.logOpen = taskLogDetails.open;
  };
  taskLogText.textContent = task.log;
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
  if (userNameEl) {
    const base = user?.name || user?.nick || "已登录";
    const nick = user?.nick && user.nick !== user.name ? user.nick : null;
    userNameEl.textContent = nick ? `${base}（${nick}）` : base;
  }
  if (userBar) userBar.hidden = true;
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
      appendStageLog("刷新业务访问凭证失败", message);
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
    appendStageLog("免登完成", "已通过钉钉免登并获取业务访问凭证");
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

async function generateContract(task, quoteText, extraInfo, extractedData) {
  let userPreview = null;
  try {
    userPreview = JSON.parse(sessionStorage.getItem("hetong_user_preview") || "null");
  } catch {
    userPreview = null;
  }

  appendTaskLog(task, "开始生成合同并上传钉盘。");
  const response = await fetchAgent("/api/contracts/generate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      uploadId: task.upload.id,
      templateType: task.templateType,
      quoteText,
      extraInfo,
      extractedData,
      attachmentMode: task.attachmentMode || task.fieldPreview?.attachmentMode || null,
      dingtalkUser: userPreview,
    }),
  });

  const body = await response.json().catch(() => ({}));
  if (!response.ok || !body.ok) {
    throw new Error(body.message || body.detail || "生成请求失败");
  }
  const hasDownload = Boolean(body?.dingDrive?.spaceId && body?.dingDrive?.fileId);
  if (!hasDownload) {
    throw new Error("合同生成未返回钉盘文件下载信息，请重试。");
  }
  task.download = body;
  appendTaskLog(task, "合同已生成并已存入钉盘。");
  return body;
}

function activeGeneratingTask(taskId = "") {
  return tasks.find((task) => task.status === "generating" && task.id !== taskId) || null;
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

function dateFieldGroupForKey(key) {
  return dateFieldGroups.find((group) => group.keys.includes(key)) || null;
}

function dateFieldGroupCanRender(group, schemaKeys) {
  return group.keys.every((key) => schemaKeys.has(key));
}

function dateGroupValueForEditor(group, extractedData) {
  return group.keys
    .map((key, index) => {
      const value = fieldValueForEditor(getByDotPath(extractedData, key));
      return value ? `${value}${group.suffixes[index] || ""}` : "";
    })
    .filter(Boolean)
    .join("");
}

function dateGroupHasMissing(group, extractedData) {
  return group.keys.some((key) => isBlankField(getByDotPath(extractedData, key)));
}

function setDateGroupClass(element, group, extractedData) {
  const missing = dateGroupHasMissing(group, extractedData);
  element.classList.toggle("is-missing", missing);
  element.classList.toggle("is-recognized", !missing);
}

function scalarFieldGroupId(field, dateGroup = null) {
  const key = String(dateGroup?.id || field?.key || "");
  const label = String(dateGroup?.label || field?.label || "");
  const text = `${key} ${label}`.toLowerCase();
  if (["signdate", "signaturedate"].includes(key)) return "basic";
  if (key === "deliveryDate" || /delivery|交货|交付|货期|质保/.test(text)) return "delivery";
  if (/amount|price|taxrate|金额|税率|总价|单价|税金/.test(text)) return "money";
  if (/payment|bank|account|invoice|付款|预付款|发货款|验收款|到货款|质保金|开户|账号|税号|发票/.test(text)) return "payment";
  if (/buyer|supplier|party|representative|甲方|乙方|代表|联系人|联系地址|电话|邮箱/.test(text)) return "parties";
  if (/contract|project|subject|签订|签署|合同|项目|采购内容/.test(text)) return "basic";
  return "other";
}

function entryPreviewStats(entry, extractedData) {
  const stats = { recognized: 0, missing: 0 };
  if (entry.type === "date") {
    entry.group.keys.forEach((key) => markPreviewStat(stats, getByDotPath(extractedData, key)));
  } else {
    markPreviewStat(stats, getByDotPath(extractedData, entry.field.key));
  }
  return stats;
}

function createScalarFieldGroups(scalars, extractedData) {
  const schemaKeys = new Set(scalars.map((field) => field.key));
  const renderedDateGroups = new Set();
  const groups = new Map(fieldGroupDefinitions.map((group) => [group.id, { ...group, entries: [], stats: { recognized: 0, missing: 0 } }]));
  scalars.forEach((field) => {
    const dateGroup = dateFieldGroupForKey(field.key);
    if (dateGroup && dateFieldGroupCanRender(dateGroup, schemaKeys)) {
      if (renderedDateGroups.has(dateGroup.id)) return;
      renderedDateGroups.add(dateGroup.id);
      const entry = { type: "date", group: dateGroup };
      const group = groups.get(scalarFieldGroupId(field, dateGroup)) || groups.get("other");
      const stats = entryPreviewStats(entry, extractedData);
      group.stats.recognized += stats.recognized;
      group.stats.missing += stats.missing;
      group.entries.push(entry);
      return;
    }
    const entry = { type: "field", field };
    const group = groups.get(scalarFieldGroupId(field)) || groups.get("other");
    const stats = entryPreviewStats(entry, extractedData);
    group.stats.recognized += stats.recognized;
    group.stats.missing += stats.missing;
    group.entries.push(entry);
  });
  return Array.from(groups.values()).filter((group) => group.entries.length);
}

function parseDecimalField(value) {
  if (value == null) return null;
  const text = String(value).trim();
  if (!text) return null;
  const normalized = text.replace(/[,\s，￥¥元%]/g, "");
  if (!normalized) return null;
  const number = Number(normalized);
  return Number.isFinite(number) ? number : null;
}

function parseTaxRateField(value) {
  const number = parseDecimalField(value);
  if (number == null) return null;
  return Math.abs(number) > 1 ? number / 100 : number;
}

function formatCalculatedAmount(value) {
  if (!Number.isFinite(value)) return "";
  return String(Math.round((value + Number.EPSILON) * 100) / 100);
}

function integerToChineseAmount(integerText) {
  const digits = ["零", "壹", "贰", "叁", "肆", "伍", "陆", "柒", "捌", "玖"];
  const units = ["", "拾", "佰", "仟"];
  const sections = ["", "万", "亿", "兆"];
  const normalized = String(integerText || "").replace(/^0+(?=\d)/, "") || "0";
  if (normalized === "0") return "零";

  const sectionToChinese = (sectionNumber) => {
    let sectionResult = "";
    let zeroInSection = false;
    String(sectionNumber).padStart(4, "0").split("").forEach((char, index) => {
      const digit = Number(char);
      const unitIndex = 3 - index;
      if (digit === 0) {
        if (sectionResult) zeroInSection = true;
        return;
      }
      if (zeroInSection) {
        sectionResult += digits[0];
        zeroInSection = false;
      }
      sectionResult += `${digits[digit]}${units[unitIndex]}`;
    });
    return sectionResult;
  };

  const sectionNumbers = [];
  for (let cursor = normalized.length; cursor > 0; cursor -= 4) {
    sectionNumbers.unshift(Number(normalized.slice(Math.max(0, cursor - 4), cursor)));
  }

  let result = "";
  let needZero = false;
  sectionNumbers.forEach((sectionNumber, index) => {
    const sectionIndex = sectionNumbers.length - index - 1;
    if (sectionNumber === 0) {
      if (result) needZero = true;
      return;
    }
    if (result && (needZero || sectionNumber < 1000)) result += digits[0];
    result += `${sectionToChinese(sectionNumber)}${sections[sectionIndex] || ""}`;
    needZero = false;
  });
  return result.replace(/零+/g, "零").replace(/零$/g, "");
}

function formatChineseAmount(value) {
  const number = parseDecimalField(value);
  if (number == null || number < 0) return "";
  const fixed = number.toFixed(2);
  const [integerText, decimalText = "00"] = fixed.split(".");
  const integerPart = integerToChineseAmount(integerText);
  const jiao = Number(decimalText[0] || 0);
  const fen = Number(decimalText[1] || 0);
  let decimalPart = "";
  if (jiao) decimalPart += `${integerToChineseAmount(jiao)}角`;
  if (fen) decimalPart += `${integerToChineseAmount(fen)}分`;
  return `人民币${integerPart}元${decimalPart || "整"}`;
}

function schemaHasScalar(schema, key) {
  return Array.isArray(schema?.scalars) && schema.scalars.some((field) => field?.key === key);
}

function syncTotalAmountChinese(extractedData) {
  if (!extractedData || typeof extractedData !== "object") return new Set();
  const chineseAmount = formatChineseAmount(extractedData.totalAmount);
  if (!chineseAmount) {
    if (isBlankField(extractedData.totalAmountChinese)) return new Set();
    extractedData.totalAmountChinese = "";
    return new Set(["totalAmountChinese"]);
  }
  if (extractedData.totalAmountChinese === chineseAmount) return new Set();
  extractedData.totalAmountChinese = chineseAmount;
  return new Set(["totalAmountChinese"]);
}

function firstPresentAmountField(extractedData) {
  return ["totalAmount", "amountWithoutTax", "taxAmount"].find((key) => parseDecimalField(extractedData?.[key]) != null) || "";
}

function applyTaxCalculations(extractedData, changedKey = "", options = {}) {
  if (!extractedData || typeof extractedData !== "object") return new Set();
  const changed = new Set();
  if (options.defaultTaxRate && isBlankField(extractedData.taxRate)) {
    extractedData.taxRate = "13";
    changed.add("taxRate");
  }

  const rate = parseTaxRateField(extractedData.taxRate);
  if (rate == null || rate < 0) return changed;

  const amountKeys = new Set(["totalAmount", "amountWithoutTax", "taxAmount"]);
  let sourceKey = amountKeys.has(changedKey) && parseDecimalField(extractedData[changedKey]) != null
    ? changedKey
    : firstPresentAmountField(extractedData);
  if (!sourceKey) return changed;

  const sourceValue = parseDecimalField(extractedData[sourceKey]);
  if (sourceValue == null) return changed;

  let totalAmount;
  let amountWithoutTax;
  let taxAmount;
  if (sourceKey === "totalAmount") {
    totalAmount = sourceValue;
    amountWithoutTax = totalAmount / (1 + rate);
    taxAmount = amountWithoutTax * rate;
  } else if (sourceKey === "amountWithoutTax") {
    amountWithoutTax = sourceValue;
    taxAmount = amountWithoutTax * rate;
    totalAmount = amountWithoutTax + taxAmount;
  } else if (rate > 0) {
    taxAmount = sourceValue;
    amountWithoutTax = taxAmount / rate;
    totalAmount = amountWithoutTax + taxAmount;
  } else {
    return changed;
  }

  [
    ["totalAmount", totalAmount],
    ["amountWithoutTax", amountWithoutTax],
    ["taxAmount", taxAmount],
  ].forEach(([key, value]) => {
    if (key === sourceKey) return;
    const formatted = formatCalculatedAmount(value);
    if (formatted && extractedData[key] !== formatted) {
      extractedData[key] = formatted;
      changed.add(key);
    }
  });
  return changed;
}

function syncCalculatedScalarEditors(editors, extractedData, changedKeys) {
  if (!editors || !changedKeys?.size) return;
  changedKeys.forEach((key) => {
    const entry = editors.get(key);
    if (!entry) return;
    entry.editor.value = fieldValueForEditor(getByDotPath(extractedData, key));
    if (entry.syncCalculated) {
      entry.syncCalculated();
      return;
    }
    setRecognizedClass(entry.field, entry.editor.value);
  });
}

function parsePositiveIntegerField(value) {
  const number = parseDecimalField(typeof value === "string" ? value.replace(/[天日]/g, "") : value);
  if (number == null || number <= 0 || !Number.isInteger(number)) return null;
  return number;
}

function datePartsFromDate(date) {
  return {
    year: String(date.getUTCFullYear()),
    month: String(date.getUTCMonth() + 1).padStart(2, "0"),
    day: String(date.getUTCDate()).padStart(2, "0"),
  };
}

function addDaysToShanghaiDate(days, dateParts = currentShanghaiDateParts()) {
  const year = Number(dateParts.year);
  const month = Number(dateParts.month);
  const day = Number(dateParts.day);
  if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)) return null;
  const base = new Date(Date.UTC(year, month - 1, day));
  base.setUTCDate(base.getUTCDate() + days);
  return datePartsFromDate(base);
}

function applyDeliveryDateCalculation(extractedData, options = {}) {
  if (!extractedData || typeof extractedData !== "object") return new Set();
  const deliveryDays = parsePositiveIntegerField(extractedData.deliveryDays);
  if (deliveryDays == null) return new Set();
  const parts = addDaysToShanghaiDate(deliveryDays);
  if (!parts) return new Set();
  const changed = new Set();
  [
    ["deliveryYear", parts.year],
    ["deliveryMonth", parts.month],
    ["deliveryDay", parts.day],
  ].forEach(([key, value]) => {
    if (!options.force && !isBlankField(extractedData[key])) return;
    if (extractedData[key] !== value) {
      extractedData[key] = value;
      changed.add(key);
    }
  });
  return changed;
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

function attachmentModeEnabled(mode) {
  return Boolean(mode && typeof mode === "object" && mode.enabled);
}

function attachmentModeText(mode) {
  if (!attachmentModeEnabled(mode)) return "";
  const rowCount = Number(mode.rowCount || 0);
  const sheetCount = Number(mode.sheetCount || 0);
  const parts = [];
  if (sheetCount > 1) parts.push(`${sheetCount} 个工作表`);
  if (rowCount > 0) parts.push(`${rowCount} 行明细`);
  const detail = parts.length ? `（${parts.join("，")}）` : "";
  return `当前报价单已启用附件模式${detail}：AI 只识别合同主字段，完整报价明细会追加到 Word 合同末尾。`;
}

function syncFieldPreviewSummary(stats) {
  if (!fieldPreviewSummary) return;
  fieldPreviewSummary.className = `hint field-preview-summary${stats.missing ? " has-missing" : " all-recognized"}`;
  fieldPreviewSummary.textContent = "";
  const message = stats.missing
    ? `按合同顺序展示：已识别 ${stats.recognized} 项，仍有 ${stats.missing} 项待填写。可直接修改字段，确认生成后空字段会在 Word 合同中留空。`
    : `按合同顺序展示：已识别 ${stats.recognized} 项，没有待填写字段。可直接修改字段后生成合同。`;
  fieldPreviewSummary.append(document.createTextNode(message));
  const task = activeTask();
  const attachmentText = attachmentModeText(task?.fieldPreview?.attachmentMode || task?.attachmentMode);
  if (attachmentText) {
    fieldPreviewSummary.append(document.createElement("br"), document.createTextNode(attachmentText));
  }
  if (stats.missing) {
    const jumpButton = createEl("button", "field-preview-jump", "定位第一个待填写字段");
    jumpButton.type = "button";
    jumpButton.addEventListener("click", scrollToFirstMissingField);
    const filterButton = createEl(
      "button",
      "field-preview-filter",
      contractPreviewEl?.classList.contains("show-missing-only") ? "查看全部字段" : "只看待补字段",
    );
    filterButton.type = "button";
    filterButton.addEventListener("click", toggleMissingOnlyPreview);
    fieldPreviewSummary.append(jumpButton, filterButton);
  } else {
    contractPreviewEl?.classList.remove("show-missing-only");
  }
}

function refreshFieldPreviewSummary(schema, extractedData) {
  syncFieldPreviewSummary(calculatePreviewStats(schema, extractedData));
}

function supplierPatchNotice(supplierPatch) {
  if (!supplierPatch) return "";
  const supplierName = supplierPatch.supplierName ? `「${supplierPatch.supplierName}」` : "当前乙方";
  const missingFields = Array.isArray(supplierPatch.missingYonbipFields) ? supplierPatch.missingYonbipFields : [];
  if (supplierPatch.matched && missingFields.length) {
    return `用友供应商档案缺少${supplierName}的部分抬头信息，请到用友系统补充后重试或先手动填写。`;
  }
  if (supplierPatch.matched || supplierPatch.appliedFields?.length) return "";
  const reason = supplierPatch.reason || "";
  if (reason === "not_found") return `未在用友供应商档案找到${supplierName}的抬头信息，请到用友系统补充后重试或先手动填写。`;
  if (reason === "ambiguous") return `用友供应商档案中存在多个${supplierName}匹配项，乙方抬头信息未自动补齐，请人工确认。`;
  if (reason === "missing_supplier_name") return "未识别到乙方名称，无法从用友供应商档案匹配抬头信息。";
  if (reason === "lookup_error") return "读取用友供应商档案失败，乙方抬头信息未自动补齐，请稍后重试或先手动填写。";
  return "";
}

function scrollToFirstMissingField() {
  const target = contractPreviewEl?.querySelector(
    ".contract-preview-field.is-missing, .contract-preview-table td.is-missing, .contract-preview-table-empty.is-missing",
  );
  if (!target) {
    setStatus("当前确认稿没有待填写字段。", "success");
    return;
  }
  target.scrollIntoView({ behavior: "smooth", block: "center" });
  const focusable = target.querySelector?.("textarea, input, button");
  window.setTimeout(() => focusable?.focus?.({ preventScroll: true }), 220);
}

function toggleMissingOnlyPreview() {
  if (!contractPreviewEl) return;
  contractPreviewEl.classList.toggle("show-missing-only");
  const stats = activeTask()?.fieldPreview?.extractedData
    ? calculatePreviewStats(templateSchemaCache.get(templateSchemaFiles[activeTask().templateType] || templateSchemaFiles.caigouhetong), activeTask().fieldPreview.extractedData)
    : null;
  const filterButton = fieldPreviewSummary?.querySelector(".field-preview-filter");
  if (filterButton) {
    filterButton.textContent = contractPreviewEl.classList.contains("show-missing-only") ? "查看全部字段" : "只看待补字段";
  }
  if (contractPreviewEl.classList.contains("show-missing-only")) scrollToFirstMissingField();
  if (stats) syncFieldPreviewSummary(stats);
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
  editor.disabled = Boolean(options.disabled || options.readonly);
  editor.setAttribute("aria-label", `${prefix}${label}`);
  if (options.scalarEditors && options.fieldKey) {
    options.scalarEditors.set(options.fieldKey, { editor, field });
  }
  editor.addEventListener("input", () => {
    setByDotPath(options.extractedData, options.fieldKey, editor.value);
    if (taxCalculationFieldKeys.includes(options.fieldKey)) {
      const changedKeys = applyTaxCalculations(options.extractedData, options.fieldKey);
      syncCalculatedScalarEditors(options.scalarEditors, options.extractedData, changedKeys);
    }
    if (deliveryCalculationFieldKeys.includes(options.fieldKey)) {
      const changedKeys = applyDeliveryDateCalculation(options.extractedData, { force: true });
      syncCalculatedScalarEditors(options.scalarEditors, options.extractedData, changedKeys);
    }
    if (schemaHasScalar(options.schema, "totalAmountChinese")) {
      const changedKeys = syncTotalAmountChinese(options.extractedData);
      syncCalculatedScalarEditors(options.scalarEditors, options.extractedData, changedKeys);
    }
    setRecognizedClass(field, editor.value);
    refreshFieldPreviewSummary(options.schema, options.extractedData);
  });

  field.append(createEl("span", "contract-field-label", `${prefix}${label}`));
  field.append(editor);
  if (options.autoFilled) field.append(createEl("span", "contract-field-badge", "系统自动填充"));
  return field;
}

function createContractDateField(group, stats, prefix = "", options = {}) {
  group.keys.forEach((key) => markPreviewStat(stats, getByDotPath(options.extractedData, key)));
  const missing = dateGroupHasMissing(group, options.extractedData);
  const field = createEl("div", [
    "contract-preview-field",
    "contract-date-field",
    missing ? "is-missing" : "is-recognized",
    group.keys.some((key) => options.autoFilledKeys?.has(key)) ? "is-auto-filled" : "",
  ].filter(Boolean).join(" "));
  const editorGroup = createEl("div", "contract-date-editors");

  group.keys.forEach((key, index) => {
    const editorWrap = createEl("label", "contract-date-part");
    const editor = createEl("input", "contract-date-editor");
    editor.type = "text";
    editor.inputMode = "numeric";
    editor.value = fieldValueForEditor(getByDotPath(options.extractedData, key));
    editor.placeholder = group.suffixes[index] || "";
    editor.disabled = Boolean(options.disabled);
    editor.setAttribute("aria-label", `${prefix}${group.label}${group.suffixes[index] || ""}`);
    if (options.scalarEditors) {
      options.scalarEditors.set(key, {
        editor,
        field,
        syncCalculated: () => {
          setDateGroupClass(field, group, options.extractedData);
        },
      });
    }
    editor.addEventListener("input", () => {
      setByDotPath(options.extractedData, key, editor.value);
      setDateGroupClass(field, group, options.extractedData);
      refreshFieldPreviewSummary(options.schema, options.extractedData);
    });
    editorWrap.append(editor, createEl("span", "contract-date-suffix", group.suffixes[index] || ""));
    editorGroup.append(editorWrap);
  });

  field.append(createEl("span", "contract-field-label", `${prefix}${group.label}`));
  field.append(editorGroup);
  if (group.keys.some((key) => options.autoFilledKeys?.has(key))) field.append(createEl("span", "contract-field-badge", "系统自动填充"));
  return field;
}

function renderScalarPreview(paper, schema, extractedData, stats, autoFilledKeys, canEditPreview) {
  const scalars = Array.isArray(schema?.scalars) ? schema.scalars : [];
  if (!scalars.length) return;

  const section = createEl("section", "contract-preview-section");
  section.append(createEl("h4", "", "合同条款字段"));
  const body = createEl("div", "contract-preview-groups");
  const scalarEditors = new Map();
  const groups = createScalarFieldGroups(scalars, extractedData);
  let displayIndex = 1;

  groups.forEach((group) => {
    const groupCard = createEl("section", [
      "contract-field-group",
      group.stats.missing ? "has-missing" : "is-complete",
    ].join(" "));
    const groupHeader = createEl("div", "contract-field-group-header");
    const title = createEl("div", "");
    title.append(
      createEl("h5", "", group.label),
      createEl("p", "contract-field-group-hint", group.hint),
    );
    const stat = createEl(
      "span",
      "contract-field-group-stat",
      group.stats.missing ? `${group.stats.missing} 项待补` : "已完整",
    );
    groupHeader.append(title, stat);
    const groupBody = createEl("div", "contract-preview-flow");

    group.entries.forEach((entry) => {
      if (entry.type === "date") {
        groupBody.append(createContractDateField(
          entry.group,
          stats,
          `${displayIndex}. `,
          {
            autoFilledKeys,
            extractedData,
            scalarEditors,
            schema,
            disabled: !canEditPreview,
          },
        ));
      } else {
        const field = entry.field;
        groupBody.append(createContractField(
          field.label || field.key,
          getByDotPath(extractedData, field.key),
          stats,
          `${displayIndex}. `,
          {
            autoFilled: autoFilledKeys?.has(field.key) || field.key === "totalAmountChinese",
            extractedData,
            fieldKey: field.key,
            readonly: field.key === "totalAmountChinese",
            scalarEditors,
            schema,
            disabled: !canEditPreview,
          },
        ));
      }
      displayIndex += 1;
    });

    groupCard.append(groupHeader, groupBody);
    body.append(groupCard);
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
  const attachmentMode = task.fieldPreview?.attachmentMode || task.attachmentMode;
  const previewSchema = attachmentModeEnabled(attachmentMode)
    ? { ...schema, tables: {} }
    : schema;
  const extractedData = task.fieldPreview?.extractedData && typeof task.fieldPreview.extractedData === "object" ? task.fieldPreview.extractedData : {};
  const autoFilledKeys = applyAutoDateDefaults(extractedData);
  if (schemaHasScalar(schema, "taxRate")) {
    applyTaxCalculations(extractedData, "taxRate", { defaultTaxRate: true }).forEach((key) => autoFilledKeys.add(key));
  }
  if (schemaHasScalar(schema, "totalAmountChinese")) {
    syncTotalAmountChinese(extractedData).forEach((key) => autoFilledKeys.add(key));
    if (!isBlankField(extractedData.totalAmountChinese)) autoFilledKeys.add("totalAmountChinese");
  }
  if (schemaHasScalar(schema, "deliveryDays")) {
    applyDeliveryDateCalculation(extractedData).forEach((key) => autoFilledKeys.add(key));
  }
  const canEditPreview = !taskIsBusy(task) && task.status !== "completed";
  const stats = { recognized: 0, missing: 0 };

  if (contractPreviewEl) {
    contractPreviewEl.textContent = "";
    const paper = createEl("article", "contract-preview-paper");
    const title = createEl("header", "contract-preview-header");
    title.append(
      createEl("p", "contract-preview-kicker", "合同字段确认稿"),
      createEl("h3", "", task.templateName || schema?.template?.id || "合同模板"),
      createEl("p", "contract-preview-muted", attachmentModeEnabled(attachmentMode)
        ? "以下只展示合同主字段；报价单明细将作为附件追加到 Word 合同末尾。"
        : "以下内容按模板字段顺序生成，可直接修改后生成合同。"),
    );
    paper.append(title);
    renderScalarPreview(paper, previewSchema, extractedData, stats, autoFilledKeys, canEditPreview);
    renderTablePreview(paper, previewSchema, extractedData, stats, canEditPreview);
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
  if (taskLogCard) taskLogCard.hidden = true;
  if (taskLogText) taskLogText.textContent = "";
  previewCard.hidden = true;
  resetFieldPreviewUi();
  syncDrawerDownload(null);
  setDrawerStep("");
  setDrawerBusy(null);
  quoteTextPreview.value = "";
  if (extraInfoText) extraInfoText.value = "";
  if (identifyFieldsButton) {
    identifyFieldsButton.hidden = true;
    identifyFieldsButton.textContent = "识别当前任务字段";
  }
  if (generateButton) generateButton.hidden = true;
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
    attachmentMode: null,
    upload: null,
    download: null,
    downloadState: "ready",
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
  closeCreatePanel({ clearFile: true, keepStatus: true });
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
  if (incompleteTaskCount() >= MAX_TASKS) {
    setStatus("未完成任务已达到 5 个，请先完成或删除任务。", "error");
    updateActionAvailability();
    return;
  }
  createPanelOpen = true;
  setStatus("");
  renderTaskList();
  taskCreatePanel?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  window.setTimeout(() => templateType?.focus(), 0);
}

function closeCreatePanel(options = {}) {
  createPanelOpen = false;
  if (taskCreatePanel) taskCreatePanel.hidden = true;
  if (options.clearFile !== false) clearPendingQuoteFile();
  if (!options.keepStatus) setStatus("");
  renderTaskList();
}

function confirmCreateTask() {
  if (!pendingQuoteFile) {
    setStatus("请先选择或拖入报价单文件。", "error");
    updateActionAvailability();
    return;
  }
  startTaskFromFile(pendingQuoteFile);
}

function syncDrawerVisibility(hasContent) {
  const open = Boolean(drawerOpen && hasContent);
  document.body.classList.toggle("drawer-open", open);
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
    const isDownloading = task.downloadState === "downloading";
    const isDownloaded = task.downloadState === "downloaded";
    const button = createEl(
      "button",
      `btn-download task-download${isDownloading ? " is-loading" : ""}${isDownloaded ? " is-downloaded" : ""}`,
      isDownloading ? "正在准备下载..." : isDownloaded ? "再次触发下载" : "下载合同文件",
    );
    button.type = "button";
    button.disabled = isDownloading;
    button.addEventListener("click", async () => {
      const markDownloadFailed = (error) => {
        const message = formatError(error);
        task.downloadState = "ready";
        appendTaskLog(task, `下载失败：${message}\n`);
        setStatus(`下载失败：${message}`, "error");
        renderTaskList();
        syncDrawerDownload(task);
        updateActionAvailability();
      };
      try {
        task.downloadState = "downloading";
        renderTaskList();
        syncDrawerDownload(task);
        updateActionAvailability();
        setStatus("正在准备合同下载...");
        const result = await downloadDingDriveContract(payload);
        const message = `已触发下载：${result.fileName}。${result.savePathHint}`;
        task.downloadState = "downloaded";
        appendTaskLog(task, `${message}\n`);
        setStatus(message, "success");
        renderTaskList();
        syncDrawerDownload(task);
        updateActionAvailability();
      } catch (error) {
        markDownloadFailed(error);
      }
    });
    return button;
  }
  if (payload.filePath || payload.dingDrive?.filePath) {
    return createEl("p", "task-file-path", `合同已存入钉盘：${payload.filePath || payload.dingDrive.filePath}`);
  }
    return createEl("p", "task-file-path", "合同已存入钉盘，可在钉盘目录查看。");
}

function renderTaskList() {
  if (!taskList) return;
  taskList.textContent = "";
  const hasTasks = tasks.length > 0;
  const createCard = createEl("button", `new-task-card${hasTasks ? "" : " is-empty"}`, "");
  createCard.type = "button";
  createCard.disabled = !sessionReady || incompleteTaskCount() >= MAX_TASKS;
  createCard.append(
    createEl("strong", "", hasTasks ? "+ 新建报价单任务" : "还没有任务，上传第一份报价单"),
    createEl("span", "", createCard.disabled ? uploadDisabledReason() : "点击新建任务，选择模板和报价单后开始解析"),
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
    card.setAttribute("aria-current", task.id === activeTaskId ? "true" : "false");
    card.setAttribute("aria-busy", taskIsBusy(task) ? "true" : "false");

    const header = createEl("div", "task-card-header");
    const title = createEl("div", "task-title");
    title.append(
      createEl("strong", "", `${index + 1}. ${task.fileName}`),
      createEl("small", "", task.templateName),
    );
    header.append(title, createEl("span", `task-status status-${task.status}`, statusLabel(task.status)));

    const message = createEl("p", "task-message", task.message || "等待处理");
    const stage = createEl("p", "task-stage", `${taskStageLabel(task)} · ${taskNextAction(task)}`);
    const meta = createEl("p", "task-file-path", `${task.templateName} · ${task.fileName}`);
    const actions = createEl("div", "task-actions");
    const selectButton = createEl("button", "btn-secondary task-secondary-button", task.id === activeTaskId && drawerOpen ? "正在查看" : "查看详情");
    selectButton.type = "button";
    selectButton.addEventListener("click", () => {
      selectTask(task.id);
    });
    actions.append(selectButton);

    if (task.status === "failed") {
      const retryButton = createEl("button", "btn-secondary task-secondary-button", "重试");
      retryButton.type = "button";
      retryButton.addEventListener("click", () => {
        retryTask(task);
      });
      actions.append(retryButton);
    }

    const deleteButton = createEl("button", "btn-danger task-secondary-button", "删除");
    deleteButton.type = "button";
    deleteButton.disabled = taskIsBusy(task);
    deleteButton.addEventListener("click", () => {
      removeTask(task.id);
    });
    actions.append(deleteButton);

    card.append(header, stage, meta, message, actions);
    const downloadNode = createTaskDownloadNode(task);
    if (downloadNode) card.append(downloadNode);
    taskList.append(card);
  });
  if (createPanelOpen && taskCreatePanel) {
    taskCreatePanel.hidden = false;
    taskCreatePanel.classList.add("is-creating");
    taskList.append(taskCreatePanel);
  } else {
    if (taskCreatePanel) {
      taskCreatePanel.hidden = true;
      taskCreatePanel.classList.remove("is-creating");
    }
    taskList.append(createCard);
  }
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
  syncTaskLogPanel(task);

  if (activeTaskTitle) {
    activeTaskTitle.textContent = `${task.fileName} · ${statusLabel(task.status)}`;
  }
  if (activeTaskHint) {
    const helperHint = task.status === "needs_text"
      ? "AI 已整理出报价单文本，请先校对识别内容；有问题直接修改，再识别字段。"
      : task.status === "needs_fields"
        ? "AI 已按模板匹配字段，红色内容代表还需要人工补充或确认，可直接修改。"
        : task.message || "请按当前阶段继续处理任务。";
    activeTaskHint.textContent = `${task.templateName}。${helperHint}`;
  }
  if (generateButton) {
    generateButton.hidden = !(hasEditorContent && task.status === "needs_fields");
    const generatingTask = activeGeneratingTask(task.id);
    generateButton.disabled = Boolean(generatingTask);
    generateButton.textContent = generatingTask ? "已有合同生成中，请稍候" : "确认识别结果并生成合同";
  }
  if (identifyFieldsButton) {
    identifyFieldsButton.hidden = !(hasEditorContent && task.status === "needs_text");
    identifyFieldsButton.textContent = "识别当前任务字段";
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
    task.attachmentMode = parsed.parser?.attachmentMode || null;
    const attachmentHint = attachmentModeText(task.attachmentMode);
    setTaskStatus(task, "needs_text", `解析完成：${parsed.textLength || 0} 字符，请确认文本并识别字段。`);
    if (attachmentHint) appendTaskLog(task, `${attachmentHint}\n`);
    setStatus(attachmentHint || "任务解析完成，请确认文本。", attachmentHint ? "info" : "success");
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
    task.attachmentMode = task.fieldPreview.attachmentMode || task.attachmentMode;
    await renderFieldPreview(task);
    const missing = task.fieldPreview.missingFields?.length || 0;
    const supplierPatched = task.fieldPreview.supplierPatch?.overwrittenFields?.length || task.fieldPreview.supplierPatch?.appliedFields?.length || 0;
    const supplierHint = supplierPatched ? ` 已从用友供应商档案回填 ${supplierPatched} 项乙方信息。` : "";
    const supplierNotice = supplierPatchNotice(task.fieldPreview.supplierPatch);
    const attachmentHint = attachmentModeText(task.attachmentMode);
    const supplierStatus = supplierPatched
      ? `AI 已整理字段，并从用友供应商档案回填 ${supplierPatched} 项乙方信息。`
      : supplierNotice || (missing > 0 ? "AI 已整理字段，请重点确认红色提示。" : "AI 已整理字段，未发现缺失字段。");
    setTaskStatus(
      task,
      "needs_fields",
      missing > 0
        ? `AI 已识别主字段，仍有 ${missing} 项需要人工确认。${supplierHint}${supplierNotice ? ` ${supplierNotice}` : ""}${attachmentHint ? ` ${attachmentHint}` : ""}`
        : `AI 已识别字段，未发现缺失字段。${supplierHint}${supplierNotice ? ` ${supplierNotice}` : ""}${attachmentHint ? ` ${attachmentHint}` : ""}`,
    );
    setStatus(
      attachmentHint || supplierStatus,
      attachmentHint || supplierNotice || missing > 0 ? "info" : "success",
    );
  } catch (error) {
    const message = formatError(error);
    setTaskStatus(task, "failed", `字段识别失败：${message}`, "identify");
    setStatus(message, "error");
  }
}

async function runGenerateTask(task) {
  if (!task.upload || !task.fieldPreview?.extractedData) return;
  const generatingTask = activeGeneratingTask(task.id);
  if (generatingTask) {
    setStatus("已有合同正在生成，请等待当前生成完成后再继续。", "error");
    appendTaskLog(task, `等待任务「${generatingTask.title || generatingTask.fileName || generatingTask.id}」生成完成后再提交。`);
    return;
  }
  try {
    task.quoteText = quoteTextPreview.value.trim() || task.quoteText;
    task.extraInfo = extraInfoText?.value.trim() || task.extraInfo || "";
    task.download = null;
    task.downloadState = "ready";
    setTaskStatus(task, "generating", "正在生成合同并上传钉盘...");
    await generateContract(task, task.quoteText, task.extraInfo, task.fieldPreview.extractedData);
    setTaskStatus(task, "completed", "合同已生成并存入钉盘。");
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
  const file = quoteFile.files?.[0];
  if (file) setPendingQuoteFile(file);
  else clearPendingQuoteFile();
  updateActionAvailability();
});

openCreateTaskButton?.addEventListener("click", openCreatePanel);
cancelCreateTaskButton?.addEventListener("click", () => {
  closeCreatePanel({ clearFile: true });
});
confirmCreateTaskButton?.addEventListener("click", confirmCreateTask);

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
  if (createPanelOpen) {
    closeCreatePanel({ clearFile: true });
    return;
  }
  if (accessModal && !accessModal.hidden) closeAccessModal();
});

updateSelectedFile();
renderTaskList();
updateSupplierSyncUi();
clearActiveEditor();
updateActionAvailability();
void initAuth();
