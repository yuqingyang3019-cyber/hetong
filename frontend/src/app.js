const statusEl = document.querySelector("#status");
const generateButton = document.querySelector("#generateButton");
const identifyFieldsButton = document.querySelector("#identifyFieldsButton");
const quoteFile = document.querySelector("#quoteFile");
const previewCard = document.querySelector("#previewCard");
const fieldPreviewCard = document.querySelector("#fieldPreviewCard");
const quoteTextPreview = document.querySelector("#quoteTextPreview");
const extraInfoText = document.querySelector("#extraInfoText");
const tableModeField = document.querySelector("#tableModeField");
const tableModeInputs = Array.from(document.querySelectorAll("input[name='tableMode']"));
const tableAttachmentMode = document.querySelector("#tableAttachmentMode");
const tableModeStatus = document.querySelector("#tableModeStatus");
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
const userNameEl = document.querySelector("#userName");
const uploadDropzone = document.querySelector("#uploadDropzone");
const fileNameText = document.querySelector("#fileNameText");
const fileMetaText = document.querySelector("#fileMetaText");
const accessModal = document.querySelector("#accessModal");
const accessModalMessage = document.querySelector("#accessModalMessage");
const closeAccessModalButton = document.querySelector("#closeAccessModalButton");
const supplierPatchModal = document.querySelector("#supplierPatchModal");
const supplierPatchModalBody = document.querySelector("#supplierPatchModalBody");
const supplierPatchModalSubtitle = document.querySelector("#supplierPatchModalSubtitle");
const closeSupplierPatchModalButton = document.querySelector("#closeSupplierPatchModalButton");
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
const MAX_QUOTE_ORIGINAL_NAME_BYTES = 512;
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
const DEFAULT_TEMPLATE_TYPE = "simpleContract";
const templateSchemaFiles = Object.freeze({
  caigouhetong: "caigouhetong",
  nonStandardNoInstall: "non-standard-no-install",
  nonStandardWithInstall: "non-standard-with-install",
  annualFramework: "annual-framework",
  professionalSubcontract: "professional-subcontract",
  laborSubcontract: "labor-subcontract",
  simpleContract: "simple-contract",
  supplementaryAgreement: "supplementary-agreement",
});
const autoDateFieldKeys = Object.freeze(["signYear", "signMonth", "signDay", "signatureYear", "signatureMonth", "signatureDay"]);
const dateFieldGroups = Object.freeze([
  { id: "signDate", label: "签订日期", keys: ["signYear", "signMonth", "signDay"], suffixes: ["年", "月", "日"] },
  { id: "originalSignDate", label: "原合同签订日期", keys: ["originalSignYear", "originalSignMonth", "originalSignDay"], suffixes: ["年", "月", "日"] },
  { id: "deliveryDate", label: "最迟交货日期", keys: ["deliveryYear", "deliveryMonth", "deliveryDay"], suffixes: ["年", "月", "日"] },
  { id: "signatureDate", label: "签署日期", keys: ["signatureYear", "signatureMonth", "signatureDay"], suffixes: ["年", "月", "日"] },
]);
const SUPPLIER_FIELD_LABELS = Object.freeze({
  supplierName: "乙方名称",
  supplierAddress: "乙方联系地址",
  supplierBank: "乙方开户银行",
  supplierAccount: "乙方银行账号",
  supplierTaxNo: "乙方税号",
  supplierPhone: "乙方电话",
  supplierRepresentativeName: "乙方代表姓名",
  supplierRepresentativePhone: "乙方代表电话",
  supplierRepresentativeEmail: "乙方代表邮箱",
});
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
const PAYMENT_TERMS_OVERRIDE_TEMPLATE = "caigouhetong";
const PAYMENT_TERMS_OVERRIDE_KEY = "paymentTermsOverride";
const SUPPLEMENTARY_AGREEMENT_TEMPLATE = "supplementaryAgreement";
const ITEMS_CONTENT_OVERRIDE_KEY = "itemsContentOverride";
const SUPPLEMENT_TABLE_SCALAR_KEYS = Object.freeze([
  "totalAmount",
  "totalAmountChinese",
  "discountAmountChinese",
  "amountWithoutTax",
]);
const busyStatuses = new Set(["uploading", "parsing", "identifying", "generating"]);
const completedStatuses = new Set(["completed"]);
const templateSchemaCache = new Map();
const tasks = [];

let authContext = { dingtalkConfigured: false, corpId: "", clientId: "", agentBaseUrl: "" };
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
  const message = String(text || "").replace(/\s+$/, "");
  if (!message) return;
  const time = new Date().toLocaleTimeString("zh-CN", { hour12: false });
  const entry = message.split("\n").map((line) => `[${time}] ${line}`).join("\n");
  task.log = `${task.log || ""}${entry}\n`;
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
  const fileName = file.name || "";
  if (fileName && new TextEncoder().encode(fileName).length > MAX_QUOTE_ORIGINAL_NAME_BYTES) {
    return "文件名过长，请缩短后重试（建议不超过 80 个汉字）。";
  }
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
    if (createTaskHint) createTaskHint.textContent = disabledReason || "选择合同模板后即可创建任务；上传报价单将自动解析，不上传则进入手工填写。";
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
  if (confirmCreateTaskButton) confirmCreateTaskButton.disabled = controlsDisabled || atLimit;

  quoteTextPreview.disabled = !canEditCurrent || !current?.quoteText;
  if (extraInfoText) extraInfoText.disabled = !canEditCurrent || !current?.quoteText;
  if (identifyFieldsButton) {
    identifyFieldsButton.disabled = !canEditCurrent || !current?.upload || !quoteTextPreview.value.trim();
  }
  generateButton.disabled = !canEditCurrent || !current?.fieldPreview?.extractedData || (!current?.manualEntry && !current?.upload);

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

function setDrawerStep(currentStep, task = null) {
  const order = ["upload", "text", "review", "generate"];
  const normalizedStep = !currentStep ? "" : currentStep === "done" || order.includes(currentStep) ? currentStep : "review";
  const activeIndex = order.indexOf(normalizedStep);
  const skipUploadAndText = Boolean(task?.manualEntry && normalizedStep === "review");
  drawerStepItems.forEach((item) => {
    const itemIndex = order.indexOf(item.dataset.drawerStep);
    item.classList.remove("is-active", "is-complete");
    item.removeAttribute("aria-current");
    if (normalizedStep === "done") {
      item.classList.add("is-complete");
      return;
    }
    if (skipUploadAndText && (item.dataset.drawerStep === "upload" || item.dataset.drawerStep === "text")) {
      item.classList.add("is-complete");
    } else if (itemIndex >= 0 && itemIndex < activeIndex) {
      item.classList.add("is-complete");
    }
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
  if (task.manualEntry && task.status === "needs_fields") return "手工填写";
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
  if (task.status === "needs_fields") {
    return task.manualEntry
      ? "下一步：在字段确认稿中手工补充合同字段，确认后生成合同。"
      : "下一步：补齐红色字段，确认后生成合同。";
  }
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
  processingCard.hidden = !show;
  if (!show) return;
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
  appendStageLog("环境检查失败", message);
  setStatus("当前环境不可用", "error");
  showAccessModal("合同生成助手仅支持从钉钉微应用访问。请返回钉钉客户端后重新打开应用。");
}

function showUserBar(user) {
  if (userNameEl) {
    const base = user?.name || user?.nick || "已登录";
    const nick = user?.nick && user.nick !== user.name ? user.nick : null;
    userNameEl.textContent = nick ? `${base}（${nick}）` : base;
  }
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
    appendStageLog("免登配置失败", "服务端未配置钉钉应用");
    setStatus("服务端未配置钉钉应用，无法免登。", "error");
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
      showUserBar(me.user);
      setInteractionEnabled(true);
      setStatus("");
    } catch (error) {
      const message = `登录态刷新失败：${formatError(error)}，请重新打开应用。`;
      appendStageLog("刷新业务访问凭证失败", message);
      setInteractionEnabled(false);
      setStatus(message, "error");
    }
    return;
  }

  sessionReady = false;
  setInteractionEnabled(false);
  setStatus("正在钉钉内免登…");

  const searchParams = new URLSearchParams(window.location.search);
  const corpIdFromUrl = searchParams.get("corpid") || searchParams.get("corpId") || "";
  const corpId = corpIdFromUrl || authContext.corpId || "";
  const clientId = authContext.clientId || "";

  if (!corpId) {
    sessionReady = false;
    appendStageLog("免登配置失败", "缺少 corpId");
    setStatus("缺少 corpId：请在微应用首页 URL 附带 corpId= 或在服务端配置 DINGTALK_CORP_ID。", "error");
    return;
  }
  if (!clientId) {
    sessionReady = false;
    appendStageLog("免登配置失败", "缺少 clientId");
    setStatus("缺少钉钉 Client ID，无法免登。", "error");
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
      showUserBar(body.user);
    }
    appendStageLog("免登完成", "已通过钉钉免登并获取业务访问凭证");
    setInteractionEnabled(true);
    setStatus("");
  }).catch((error) => {
    sessionReady = false;
    const message = error instanceof Error ? error.message : "免登失败";
    appendStageLog("免登失败", message);
    setStatus(message, "error");
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

async function lookupSupplierByName(supplierName) {
  const response = await fetchAgent("/api/suppliers/lookup", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ supplierName }),
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(body.message || body.detail || body.error || "用友查询失败");
  }
  return body;
}

async function previewQuoteFields(uploadId, quoteText, extraInfo, taskTemplateType, tableMode = "auto") {
  const response = await fetchAgent(`/api/uploads/${encodeURIComponent(uploadId)}/field-preview`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      templateType: taskTemplateType,
      quoteText,
      extraInfo,
      tableMode,
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
    reader.onerror = () => reject(new Error("读取文件失败，请重新选择后再试"));
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
  const payload = {
    templateType: task.templateType,
    extractedData,
    dingtalkUser: userPreview,
  };
  if (task.upload?.id) {
    payload.uploadId = task.upload.id;
    payload.quoteText = quoteText;
    payload.extraInfo = extraInfo;
    payload.tableMode = effectiveTableMode(task);
    payload.attachmentMode = task.attachmentMode || task.fieldPreview?.attachmentMode || null;
  }
  const response = await fetchAgent("/api/contracts/generate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
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
  const schemaName = templateSchemaFiles[templateValue] || templateSchemaFiles[DEFAULT_TEMPLATE_TYPE];
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
  if (["signdate", "signaturedate", "originalsigndate"].includes(key)) return "basic";
  if (key === "deliveryDate" || /delivery|交货|交付|货期|质保/.test(text)) return "delivery";
  if (/amount|price|taxrate|金额|税率|总价|单价|税金/.test(text)) return "money";
  if (/payment|bank|account|invoice|付款|预付款|发货款|验收款|到货款|质保金|开户|账号|税号|发票/.test(text)) return "payment";
  if (/buyer|supplier|party|representative|甲方|乙方|代表|联系人|联系地址|电话|邮箱/.test(text)) return "parties";
  if (/amendment|补充事由/.test(text)) return "other";
  if (/originalcontract|原合同/.test(text)) return "basic";
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

function supportsPaymentTermsOverride(templateType) {
  return templateType === PAYMENT_TERMS_OVERRIDE_TEMPLATE;
}

function supportsItemsContentOverride(templateType) {
  return templateType === SUPPLEMENTARY_AGREEMENT_TEMPLATE;
}

function itemsContentOverrideActive(task) {
  return supportsItemsContentOverride(task?.templateType) && Boolean(String(task?.itemsContentOverrideText || "").trim());
}

function previewScalars(scalars, task = null) {
  const skipKeys = new Set([PAYMENT_TERMS_OVERRIDE_KEY, ITEMS_CONTENT_OVERRIDE_KEY]);
  if (itemsContentOverrideActive(task)) {
    SUPPLEMENT_TABLE_SCALAR_KEYS.forEach((key) => skipKeys.add(key));
  }
  return (Array.isArray(scalars) ? scalars : []).filter((field) => !skipKeys.has(field?.key));
}

function cloneExtractedData(data) {
  return JSON.parse(JSON.stringify(data && typeof data === "object" ? data : {}));
}

function taskHasWorkbench(task) {
  return Boolean(task && (task.manualEntry || task.quoteText));
}

function tableSupportsLineItemCalculation(columns) {
  const keys = new Set((Array.isArray(columns) ? columns : []).map((column) => column?.key).filter(Boolean));
  return keys.has("quantity") && keys.has("unitPrice") && keys.has("totalPrice");
}

function createEmptyTableRow(columns) {
  const row = {};
  (Array.isArray(columns) ? columns : []).forEach((column) => {
    if (column?.key) row[column.key] = "";
  });
  return row;
}

const ATTACHMENT_DETAIL_REF = "详情见附件";
const ATTACHMENT_TITLE_SCALAR_KEYS = ["purchaseSubject", "workDescription", "projectName", "engineeringScope"];
const ATTACHMENT_TITLE_COLUMN_KEYS = ["name", "laborItem", "node"];
const ATTACHMENT_DETAIL_COLUMN_KEYS = ["spec", "remark", "progressDescription"];

function firstNonEmptyScalar(data, keys) {
  for (const key of keys) {
    const value = String(data?.[key] ?? "").trim();
    if (value) return value;
  }
  return "";
}

function firstColumnKey(columns, candidates) {
  const keys = new Set((Array.isArray(columns) ? columns : []).map((column) => column?.key).filter(Boolean));
  return candidates.find((candidate) => keys.has(candidate)) || null;
}

function buildAttachmentSummaryRow(columns, extractedData) {
  const columnKeys = (Array.isArray(columns) ? columns : []).map((column) => column?.key).filter(Boolean);
  const row = Object.fromEntries(columnKeys.map((key) => [key, ""]));
  if ("index" in row) row.index = "1";
  const titleColumn = firstColumnKey(columns, ATTACHMENT_TITLE_COLUMN_KEYS);
  if (titleColumn) row[titleColumn] = firstNonEmptyScalar(extractedData, ATTACHMENT_TITLE_SCALAR_KEYS);
  const detailColumn = firstColumnKey(columns, ATTACHMENT_DETAIL_COLUMN_KEYS);
  if (detailColumn) row[detailColumn] = ATTACHMENT_DETAIL_REF;
  if ("totalPrice" in row) row.totalPrice = String(extractedData?.totalAmount ?? "").trim();
  return row;
}

function buildEmptyExtractedData(schema) {
  const data = {};
  previewScalars(schema?.scalars).forEach((field) => {
    if (field?.key) data[field.key] = "";
  });
  Object.entries(schema?.tables || {}).forEach(([tableName, tableDef]) => {
    const columns = Array.isArray(tableDef?.columns) ? tableDef.columns : [];
    data[tableName] = [createEmptyTableRow(columns)];
  });
  return data;
}

async function buildManualFieldPreview(templateType) {
  const schema = await loadTemplateSchema(templateType);
  return {
    extractedData: buildEmptyExtractedData(schema),
    recognizedFields: [],
    missingFields: [],
    tableMode: "template",
    attachmentMode: { enabled: false, tableMode: "template" },
  };
}

function applyLineItemCalculations(row) {
  const changed = new Set();
  if (!row || typeof row !== "object") return changed;
  const quantity = parseDecimalField(row.quantity);
  const unitPrice = parseDecimalField(row.unitPrice);
  if (quantity == null || unitPrice == null) return changed;
  const formatted = formatCalculatedAmount(quantity * unitPrice);
  if (formatted && row.totalPrice !== formatted) {
    row.totalPrice = formatted;
    changed.add("totalPrice");
  }
  return changed;
}

function syncCalculatedTableEditors(rowEditors, row, changedKeys) {
  if (!rowEditors || !changedKeys?.size) return;
  changedKeys.forEach((key) => {
    const entry = rowEditors.get(key);
    if (!entry) return;
    entry.editor.value = fieldValueForEditor(row[key]);
    setRecognizedClass(entry.cell, entry.editor.value);
    if (key === "totalPrice") {
      entry.cell.classList.toggle("is-auto-filled", !isBlankField(entry.editor.value));
    }
  });
}

function applyLineItemCalculationsForTables(extractedData, schema) {
  Object.entries(schema?.tables || {}).forEach(([tableName, tableDef]) => {
    const columns = Array.isArray(tableDef?.columns) ? tableDef.columns : [];
    if (!tableSupportsLineItemCalculation(columns)) return;
    const rows = extractedData?.[tableName];
    if (!Array.isArray(rows)) return;
    rows.forEach((row) => applyLineItemCalculations(row));
  });
}

function syncLineItemCalculations(extractedData, schema, task) {
  if (!extractedData || typeof extractedData !== "object" || tableModeUsesAttachment(task)) return;
  applyLineItemCalculationsForTables(extractedData, schema);
}

function handleTableCellEdit({
  row,
  column,
  editor,
  cell,
  rowEditors,
  supportsLineItemCalculation,
  schema,
  extractedData,
}) {
  if (row && typeof row === "object") setByDotPath(row, column.key, editor.value);
  if (supportsLineItemCalculation) {
    const changedKeys = applyLineItemCalculations(row);
    syncCalculatedTableEditors(rowEditors, row, changedKeys);
  }
  setRecognizedClass(cell, editor.value);
  refreshFieldPreviewSummary(schema, extractedData);
}

function buildExtractedDataForGenerate(task, schema) {
  const extractedData = cloneExtractedData(task.fieldPreview?.extractedData);
  const overrideText = String(task.paymentTermsOverrideText || "").trim();
  if (supportsPaymentTermsOverride(task.templateType) && overrideText) {
    extractedData[PAYMENT_TERMS_OVERRIDE_KEY] = overrideText;
  } else {
    delete extractedData[PAYMENT_TERMS_OVERRIDE_KEY];
  }
  const itemsOverrideText = String(task.itemsContentOverrideText || "").trim();
  if (supportsItemsContentOverride(task.templateType) && itemsOverrideText) {
    extractedData[ITEMS_CONTENT_OVERRIDE_KEY] = itemsOverrideText;
  } else {
    delete extractedData[ITEMS_CONTENT_OVERRIDE_KEY];
  }
  if (schema) syncLineItemCalculations(extractedData, schema, task);
  return extractedData;
}

function createScalarFieldGroups(scalars, extractedData, task = null) {
  const schemaKeys = new Set(previewScalars(scalars, task).map((field) => field.key));
  const renderedDateGroups = new Set();
  const groups = new Map(fieldGroupDefinitions.map((group) => [group.id, { ...group, entries: [], stats: { recognized: 0, missing: 0 } }]));
  previewScalars(scalars, task).forEach((field) => {
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

function calculatePreviewStats(schema, extractedData, task = null) {
  const stats = { recognized: 0, missing: 0 };
  previewScalars(schema?.scalars, task).forEach((field) => markPreviewStat(stats, getByDotPath(extractedData, field.key)));

  if (itemsContentOverrideActive(task)) {
    return stats;
  }

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

function quoteIsExcelTask(task) {
  return Boolean(task?.attachmentMode && typeof task.attachmentMode === "object");
}

function normalizeTableMode(value) {
  return value === "attachment" || value === "template" ? value : "auto";
}

function defaultTableMode(attachmentMode) {
  return "template";
}

function effectiveTableMode(task) {
  const mode = normalizeTableMode(task?.tableMode);
  if (mode !== "auto") return mode;
  return defaultTableMode(task?.attachmentMode);
}

function tableModeUsesAttachment(task) {
  return effectiveTableMode(task) === "attachment";
}

function attachmentModeText(mode) {
  if (!attachmentModeEnabled(mode)) return "";
  const rowCount = Number(mode.rowCount || 0);
  const sheetCount = Number(mode.sheetCount || 0);
  const parts = [];
  if (sheetCount > 1) parts.push(`${sheetCount} 个工作表`);
  if (rowCount > 0) parts.push(`${rowCount} 行明细`);
  const detail = parts.length ? `（${parts.join("，")}）` : "";
  return `Excel 明细将作为附件追加到合同末尾${detail}。`;
}

function taskAttachmentModeText(task) {
  if (!tableModeUsesAttachment(task)) return "";
  return attachmentModeText(task?.fieldPreview?.attachmentMode || task?.attachmentMode)
    || "Excel 明细将作为附件追加到合同末尾。";
}

function syncTableModeStatus(task, disabled = false) {
  if (!tableModeStatus) return;
  const selectedAttachment = tableModeUsesAttachment(task);
  tableModeStatus.classList.toggle("is-attachment", selectedAttachment);
  tableModeStatus.classList.toggle("is-default", !selectedAttachment);
  if (disabled) {
    tableModeStatus.hidden = false;
    tableModeStatus.textContent = "已进入下一阶段，如需补充信息请重新开始。";
    return;
  }
  if (!selectedAttachment) {
    tableModeStatus.hidden = true;
    tableModeStatus.textContent = "";
    return;
  }
  tableModeStatus.hidden = false;
  tableModeStatus.textContent = "只识别主字段，Excel 明细会附到合同末尾。";
}

function syncTableModeControls(task) {
  if (!tableModeField || !tableAttachmentMode) return;
  const show = Boolean(task && quoteIsExcelTask(task) && task.status !== "completed");
  tableModeField.hidden = !show;
  if (!show) {
    tableAttachmentMode.checked = false;
    tableAttachmentMode.closest(".table-mode-option")?.classList.remove("is-selected", "is-disabled");
    if (tableModeStatus) tableModeStatus.textContent = "";
    return;
  }
  const selectedMode = effectiveTableMode(task);
  const disabled = taskIsBusy(task) || task.status !== "needs_text";
  tableAttachmentMode.checked = selectedMode === "attachment";
  tableAttachmentMode.disabled = disabled;
  tableAttachmentMode.closest(".table-mode-option")?.classList.toggle("is-selected", tableAttachmentMode.checked);
  tableAttachmentMode.closest(".table-mode-option")?.classList.toggle("is-disabled", disabled);
  syncTableModeStatus(task, disabled);
}

function setTaskTableMode(task, mode) {
  if (!task) return;
  task.tableMode = normalizeTableMode(mode);
  task.attachmentMode = task.attachmentMode || null;
  task.fieldPreview = null;
  const attachmentSelected = tableModeUsesAttachment(task);
  setTaskStatus(task, "needs_text", "请重新识别字段。");
  setStatus(
    attachmentSelected ? "已启用附件模式，请重新识别字段。" : "已恢复默认方式，请重新识别字段。",
    "info",
  );
  syncTableModeControls(task);
  resetFieldPreviewUi();
  updateActionAvailability();
}

function buildSupplierPatchSummary(supplierPatch, schema) {
  if (!supplierPatch || supplierPatch.reason === "not_attempted") return null;
  const result = buildSupplierPatchResult(supplierPatch, schema);
  if (!result) return null;
  if (result.errorMessage) {
    return {
      tone: "warning",
      text: result.errorMessage,
      showDetail: true,
    };
  }
  const foundCount = result.foundLabels.length;
  const missingCount = result.missingLabels.length;
  if (missingCount > 0) {
    return {
      tone: "warning",
      text: `用友已读取 ${foundCount} 项，仍有 ${missingCount} 项需在确认稿中补充或到用友维护档案。`,
      showDetail: true,
    };
  }
  if (foundCount > 0) {
    return {
      tone: "success",
      text: `已从用友读取 ${foundCount} 项乙方抬头。`,
      showDetail: false,
    };
  }
  return null;
}

function collectYonbipFilledKeys(supplierPatch) {
  const keys = new Set();
  if (!supplierPatch) return keys;
  const sources = [
    supplierPatch.overwrittenFields,
    supplierPatch.appliedFields,
    supplierPatch.patch && typeof supplierPatch.patch === "object" ? Object.keys(supplierPatch.patch) : [],
  ];
  sources.forEach((list) => {
    if (!Array.isArray(list)) return;
    list.forEach((key) => {
      if (key) keys.add(key);
    });
  });
  return keys;
}

function partiesGroupBadgeLabel(supplierPatch) {
  if (!supplierPatch || supplierPatch.reason === "not_attempted") return "";
  const missingCount = Array.isArray(supplierPatch.missingYonbipFields) ? supplierPatch.missingYonbipFields.length : 0;
  if (!supplierPatch.matched) return "待补抬头";
  if (missingCount > 0) return "用友部分缺失";
  return "用友已参与";
}

function syncFieldPreviewSummary(stats) {
  if (!fieldPreviewSummary) return;
  const task = activeTask();
  const supplierPatch = task?.fieldPreview?.supplierPatch;
  const previewSchema = task
    ? templateSchemaCache.get(templateSchemaFiles[task.templateType] || templateSchemaFiles[DEFAULT_TEMPLATE_TYPE])
    : null;
  const supplierSummary = buildSupplierPatchSummary(supplierPatch, previewSchema);
  const supplierWarning = supplierSummary?.tone === "warning";
  fieldPreviewSummary.className = [
    "hint",
    "field-preview-summary",
    "is-sticky",
    stats.missing ? "has-missing" : "all-recognized",
    supplierWarning ? "has-supplier-warning" : "",
  ].filter(Boolean).join(" ");
  fieldPreviewSummary.textContent = "";
  const message = stats.missing
    ? `按合同顺序展示：已识别 ${stats.recognized} 项，仍有 ${stats.missing} 项待填写。可直接修改字段，确认生成后空字段会在 Word 合同中留空。`
    : `按合同顺序展示：已识别 ${stats.recognized} 项，没有待填写字段。可直接修改字段后生成合同。`;
  fieldPreviewSummary.append(document.createTextNode(message));
  const attachmentText = taskAttachmentModeText(task);
  if (attachmentText) {
    fieldPreviewSummary.append(document.createElement("br"), document.createTextNode(attachmentText));
  }
  if (task && supportsPaymentTermsOverride(task.templateType)) {
    const overrideText = String(task.paymentTermsOverrideText || "").trim();
    const overrideHint = overrideText
      ? "已填写付款期限覆盖：生成时将替换默认 5 条付款条款。"
      : "未填写付款期限覆盖：生成时将使用付款比例字段生成默认条款。";
    fieldPreviewSummary.append(document.createElement("br"), document.createTextNode(overrideHint));
  }
  if (task && supportsItemsContentOverride(task.templateType)) {
    const itemsOverrideText = String(task.itemsContentOverrideText || "").trim();
    const itemsOverrideHint = itemsOverrideText
      ? "已填写协议内容覆盖：生成时将替换设备明细表格（含合计与金额行）。"
      : "未填写协议内容覆盖：生成时将使用下方明细表。";
    fieldPreviewSummary.append(document.createElement("br"), document.createTextNode(itemsOverrideHint));
  }
  if (supplierSummary) {
    const hint = createEl("p", "supplier-inline-hint", supplierSummary.text);
    fieldPreviewSummary.append(hint);
    if (supplierSummary.showDetail) {
      const detailButton = createEl("button", "field-preview-supplier-detail", "查看用友详情");
      detailButton.type = "button";
      detailButton.addEventListener("click", () => {
        openSupplierPatchModal("result", supplierPatch, previewSchema);
      });
      fieldPreviewSummary.append(detailButton);
    }
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

function supplierFieldLabel(key, schema) {
  const scalar = previewScalars(schema?.scalars).find((field) => field.key === key);
  return scalar?.label || SUPPLIER_FIELD_LABELS[key] || key;
}

let activeSupplierLookupButton = null;

function buildSupplierPatchResult(supplierPatch, schema) {
  if (!supplierPatch) return null;
  const patch = supplierPatch.patch && typeof supplierPatch.patch === "object" ? supplierPatch.patch : {};
  const foundLabels = Object.entries(patch)
    .filter(([, value]) => !isBlankField(value))
    .map(([key]) => supplierFieldLabel(key, schema));
  const missingFields = Array.isArray(supplierPatch.missingYonbipFields) ? supplierPatch.missingYonbipFields : [];
  const missingLabels = missingFields.map((key) => supplierFieldLabel(key, schema));
  let errorMessage = "";
  if (!supplierPatch.matched) {
    const reason = supplierPatch.reason || "";
    if (reason === "not_found") errorMessage = "用友未找到该乙方，请手动填写抬头。";
    else if (reason === "ambiguous") errorMessage = "用友存在多个匹配乙方，请人工确认抬头。";
    else if (reason === "missing_supplier_name") errorMessage = "未识别到乙方名称，请手动填写抬头。";
    else if (reason === "lookup_error") errorMessage = "用友查询失败，请手动填写抬头。";
  }
  return {
    matched: Boolean(supplierPatch.matched),
    foundLabels,
    missingLabels,
    errorMessage,
  };
}

function shouldShowSupplierPatchModal(supplierPatch) {
  if (!supplierPatch) return false;
  if (supplierPatch.reason === "not_attempted") return false;
  const autoPopupReasons = new Set(["not_found", "ambiguous", "lookup_error", "missing_supplier_name"]);
  return autoPopupReasons.has(supplierPatch.reason);
}

function setSupplierLookupButtonLoading(button, loading) {
  if (!button) return;
  if (loading) {
    activeSupplierLookupButton = button;
    button.disabled = true;
    button.classList.add("is-loading");
    button.textContent = "查询中…";
    return;
  }
  button.disabled = false;
  button.classList.remove("is-loading");
  button.textContent = "查询用友抬头";
  if (activeSupplierLookupButton === button) activeSupplierLookupButton = null;
}

function resetSupplierLookupButton() {
  if (activeSupplierLookupButton) {
    setSupplierLookupButtonLoading(activeSupplierLookupButton, false);
  }
}

function renderSupplierPatchModalLoading() {
  if (!supplierPatchModalBody) return;
  supplierPatchModalBody.textContent = "";
  supplierPatchModalBody.className = "supplier-patch-modal-body";
  const wrap = createEl("div", "supplier-patch-loading");
  const progress = createEl("div", "supplier-patch-progress");
  progress.setAttribute("role", "progressbar");
  progress.setAttribute("aria-label", "正在查询用友供应商档案");
  wrap.append(progress, createEl("p", "", "正在查询用友供应商档案…"));
  supplierPatchModalBody.append(wrap);
}

function appendSupplierPatchSection(container, title, labels, variant) {
  const section = createEl("section", `supplier-patch-section is-${variant}`);
  section.append(createEl("h3", "", title));
  section.append(createEl("p", "supplier-patch-list", labels.join("、")));
  container.append(section);
}

function renderSupplierPatchModalResult(supplierPatch, schema) {
  if (!supplierPatchModalBody) return;
  supplierPatchModalBody.textContent = "";
  supplierPatchModalBody.className = "supplier-patch-modal-body";
  const result = buildSupplierPatchResult(supplierPatch, schema);
  if (!result) return;

  if (result.errorMessage) {
    const section = createEl("section", "supplier-patch-section is-error");
    section.append(createEl("p", "supplier-patch-list", result.errorMessage));
    supplierPatchModalBody.append(section);
    return;
  }

  if (result.foundLabels.length) {
    appendSupplierPatchSection(supplierPatchModalBody, "已从用友读取", result.foundLabels, "found");
  }
  if (result.missingLabels.length) {
    appendSupplierPatchSection(supplierPatchModalBody, "未能读取", result.missingLabels, "missing");
    supplierPatchModalBody.append(createEl(
      "p",
      "supplier-patch-footnote",
      "请手动填写未能读取的字段，或到用友系统补充供应商档案。",
    ));
    return;
  }
  if (result.matched) {
    const section = createEl("section", "supplier-patch-section is-found");
    section.append(createEl("p", "supplier-patch-list", "全部抬头字段已从用友读取。"));
    supplierPatchModalBody.append(section);
  }
}

function openSupplierPatchModal(mode, supplierPatch, schema) {
  if (!supplierPatchModal) return;
  if (mode === "loading") {
    renderSupplierPatchModalLoading();
    if (supplierPatchModalSubtitle) {
      supplierPatchModalSubtitle.hidden = true;
      supplierPatchModalSubtitle.textContent = "";
    }
  } else {
    renderSupplierPatchModalResult(supplierPatch, schema);
    const supplierName = String(supplierPatch?.patch?.supplierName || supplierPatch?.supplierName || "").trim();
    if (supplierPatchModalSubtitle) {
      if (supplierName) {
        supplierPatchModalSubtitle.hidden = false;
        supplierPatchModalSubtitle.textContent = `乙方：${supplierName}`;
      } else {
        supplierPatchModalSubtitle.hidden = true;
        supplierPatchModalSubtitle.textContent = "";
      }
    }
  }
  supplierPatchModal.hidden = false;
  window.setTimeout(() => closeSupplierPatchModalButton?.focus(), 0);
}

function closeSupplierPatchModal() {
  if (supplierPatchModal) supplierPatchModal.hidden = true;
  resetSupplierLookupButton();
}

function applySupplierPatchToExtracted(extractedData, supplierPatch) {
  const patch = supplierPatch?.patch;
  if (!patch || typeof patch !== "object") return new Set();
  const changed = new Set();
  Object.entries(patch).forEach(([key, value]) => {
    const text = String(value ?? "").trim();
    if (!text) return;
    if (String(extractedData[key] ?? "").trim() !== text) {
      extractedData[key] = text;
      changed.add(key);
    }
  });
  supplierPatch.appliedFields = [...changed].sort();
  supplierPatch.overwrittenFields = [...changed].sort();
  return changed;
}

async function lookupSupplierTitle(task, schema, lookupButton) {
  const extractedData = task.fieldPreview?.extractedData;
  if (!extractedData || typeof extractedData !== "object") return;
  const supplierName = String(extractedData.supplierName ?? "").trim();
  if (!supplierName) {
    setStatus("请先填写乙方名称。", "error");
    return;
  }
  setSupplierLookupButtonLoading(lookupButton, true);
  openSupplierPatchModal("loading");
  try {
    const body = await lookupSupplierByName(supplierName);
    const supplierPatch = body.supplierPatch || {};
    applySupplierPatchToExtracted(extractedData, supplierPatch);
    task.fieldPreview.supplierPatch = supplierPatch;
    await renderFieldPreview(task);
    openSupplierPatchModal("result", supplierPatch, schema);
    setStatus("用友抬头查询完成。", "success");
  } catch (error) {
    closeSupplierPatchModal();
    setStatus(formatError(error), "error");
  } finally {
    if (supplierPatchModal?.hidden) {
      resetSupplierLookupButton();
    }
  }
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
    ? calculatePreviewStats(templateSchemaCache.get(templateSchemaFiles[activeTask().templateType] || templateSchemaFiles[DEFAULT_TEMPLATE_TYPE]), activeTask().fieldPreview.extractedData)
    : null;
  const filterButton = fieldPreviewSummary?.querySelector(".field-preview-filter");
  if (filterButton) {
    filterButton.textContent = contractPreviewEl.classList.contains("show-missing-only") ? "查看全部字段" : "只看待补字段";
  }
  if (contractPreviewEl.classList.contains("show-missing-only")) scrollToFirstMissingField();
  if (stats) syncFieldPreviewSummary(stats);
}

function createContractField(label, value, stats, prefix = "", options = {}) {
  const missing = isBlankField(value);
  markPreviewStat(stats, value);
  const field = createEl("div", [
    "contract-preview-field",
    missing ? "is-missing" : "is-recognized",
    options.autoFilled ? "is-auto-filled" : "",
    options.yonbipFilled ? "is-yonbip-filled" : "",
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

  const labelRow = createEl("span", "contract-field-label-row");
  labelRow.append(createEl("span", "contract-field-label", `${prefix}${label}`));
  if (options.yonbipFilled) {
    labelRow.append(createEl("span", "yonbip-field-badge", "用友"));
  }
  field.append(labelRow);
  if (options.lookupSupplier) {
    const editorRow = createEl("div", "contract-supplier-name-editor-row");
    editorRow.append(editor);
    const lookupButton = createEl("button", "btn-secondary contract-supplier-lookup", "查询用友抬头");
    lookupButton.type = "button";
    lookupButton.disabled = Boolean(options.disabled || options.readonly);
    lookupButton.addEventListener("click", () => {
      void lookupSupplierTitle(options.lookupSupplier.task, options.lookupSupplier.schema, lookupButton);
    });
    editorRow.append(lookupButton);
    field.append(editorRow);
  } else {
    field.append(editor);
  }
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
  return field;
}

function appendItemsContentOverrideField(container, task, canEditPreview) {
  const field = createEl("div", "contract-preview-field payment-terms-override-field items-content-override-field is-recognized");
  field.append(createEl("span", "contract-field-label", "协议内容覆盖（可选）"));
  field.append(createEl(
    "p",
    "payment-terms-override-hint",
    "填写后将替换协议内容补充表格（含合计与金额行）；留空则使用下方明细表。",
  ));
  const status = createEl("p", "payment-terms-override-status");
  status.setAttribute("aria-live", "polite");
  const editor = createEl("textarea", "contract-field-editor payment-terms-override-editor");
  editor.rows = 8;
  editor.value = task.itemsContentOverrideText || "";
  editor.placeholder = "可粘贴自定义协议补充内容，支持多行";
  editor.disabled = !canEditPreview;
  editor.setAttribute("aria-label", "协议内容覆盖");
  const syncStatus = () => {
    const hasValue = Boolean(String(editor.value || "").trim());
    field.classList.toggle("has-value", hasValue);
    status.textContent = hasValue
      ? "已填写协议内容覆盖：生成时会替换设备明细表格。"
      : "未填写协议内容覆盖：将使用下方明细表。";
  };
  editor.addEventListener("input", () => {
    task.itemsContentOverrideText = editor.value;
    syncStatus();
    void renderFieldPreview(task);
  });
  syncStatus();
  field.append(status, editor);
  container.append(field);
}

function appendPaymentTermsOverrideField(groupBody, task, canEditPreview) {
  const field = createEl("div", "contract-preview-field payment-terms-override-field is-recognized");
  field.append(createEl("span", "contract-field-label", "付款期限覆盖（可选）"));
  field.append(createEl(
    "p",
    "payment-terms-override-hint",
    "填写后将替换合同「付款期限」下 5 条默认条款；留空则使用下方付款比例字段生成。",
  ));
  const status = createEl("p", "payment-terms-override-status");
  status.setAttribute("aria-live", "polite");
  const editor = createEl("textarea", "contract-field-editor payment-terms-override-editor");
  editor.rows = 6;
  editor.value = task.paymentTermsOverrideText || "";
  editor.placeholder = "可粘贴自定义付款期限条款，支持多行";
  editor.disabled = !canEditPreview;
  editor.setAttribute("aria-label", "付款期限覆盖内容");
  const syncStatus = () => {
    const hasValue = Boolean(String(editor.value || "").trim());
    field.classList.toggle("has-value", hasValue);
    status.textContent = hasValue
      ? "已填写自定义付款期限：生成时会覆盖默认 5 条付款条款。"
      : "未填写自定义付款期限：将按付款比例字段自动生成默认条款。";
  };
  editor.addEventListener("input", () => {
    task.paymentTermsOverrideText = editor.value;
    syncStatus();
    refreshFieldPreviewSummary(task.fieldPreview?.schema || {}, task.fieldPreview?.extractedData || {});
  });
  syncStatus();
  field.append(status, editor);
  groupBody.append(field);
}

function renderScalarPreview(paper, schema, extractedData, stats, autoFilledKeys, canEditPreview, task, yonbipFilledKeys = new Set()) {
  const scalars = previewScalars(schema?.scalars, task);
  if (!scalars.length && !supportsPaymentTermsOverride(task?.templateType)) return;

  const section = createEl("section", "contract-preview-section");
  section.append(createEl("h4", "", "合同条款字段"));
  const body = createEl("div", "contract-preview-groups");
  const scalarEditors = new Map();
  const groups = createScalarFieldGroups(scalars, extractedData, task);
  const supplierPatch = task?.fieldPreview?.supplierPatch;
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
    groupHeader.append(title);
    if (group.id === "parties") {
      const badgeLabel = partiesGroupBadgeLabel(supplierPatch);
      if (badgeLabel) {
        const missingCount = Array.isArray(supplierPatch?.missingYonbipFields) ? supplierPatch.missingYonbipFields.length : 0;
        const badgeClass = supplierPatch?.matched && missingCount === 0 ? "parties-group-badge" : "parties-group-badge is-warning";
        groupHeader.append(createEl("span", badgeClass, badgeLabel));
      }
    }
    groupHeader.append(stat);
    const groupBody = createEl("div", "contract-preview-flow");

    if (supportsPaymentTermsOverride(task?.templateType) && group.id === "payment") {
      appendPaymentTermsOverrideField(groupBody, task, canEditPreview);
    }

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
            yonbipFilled: yonbipFilledKeys.has(field.key),
            extractedData,
            fieldKey: field.key,
            readonly: field.key === "totalAmountChinese",
            scalarEditors,
            schema,
            disabled: !canEditPreview,
            lookupSupplier: field.key === "supplierName" ? { task, schema } : null,
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

function renderTablePreview(paper, schema, extractedData, stats, canEditPreview, task) {
  const tableEntries = Object.entries(schema?.tables || {});
  if (!tableEntries.length && !supportsItemsContentOverride(task?.templateType)) return;
  const overrideActive = itemsContentOverrideActive(task);
  const attachmentSummaryMode = tableModeUsesAttachment(task);
  const enableLineItemCalculation = !attachmentSummaryMode && !overrideActive;
  const enableRowActions = canEditPreview && enableLineItemCalculation;

  if (supportsItemsContentOverride(task?.templateType)) {
    const overrideSection = createEl("section", "contract-preview-section");
    overrideSection.append(createEl("h4", "", "协议内容补充"));
    appendItemsContentOverrideField(overrideSection, task, canEditPreview);
    paper.append(overrideSection);
    if (overrideActive) return;
  }

  tableEntries.forEach(([tableName, tableDef], tableIndex) => {
    const columns = Array.isArray(tableDef?.columns) ? tableDef.columns : [];
    const rowsValue = extractedData?.[tableName];
    const rows = attachmentSummaryMode
      ? [buildAttachmentSummaryRow(columns, extractedData)]
      : (Array.isArray(rowsValue) ? rowsValue : []);
    const section = createEl("section", "contract-preview-section");
    section.append(createEl("h4", "", `${tableIndex + 1}. ${tableDef?.label || tableName}`));
    if (attachmentSummaryMode) {
      section.append(createEl(
        "p",
        "contract-preview-muted",
        "附件模式下正文表格仅保留一行总结，完整 Excel 明细将附到 Word 合同末尾。",
      ));
    }

    if (!rows.length) {
      stats.missing += 1;
      const empty = createEl("div", "contract-preview-table-empty is-missing", "待填写：未识别到明细行");
      section.append(empty);
      if (enableRowActions) {
        const addButton = createEl("button", "btn-secondary contract-table-add-row", "添加明细行");
        addButton.type = "button";
        addButton.addEventListener("click", () => {
          extractedData[tableName] = [createEmptyTableRow(columns)];
          void renderFieldPreview(task);
        });
        section.append(addButton);
      }
      paper.append(section);
      return;
    }

    const supportsLineItemCalculation = enableLineItemCalculation && tableSupportsLineItemCalculation(columns);
    const tableWrap = createEl("div", "contract-preview-table-wrap");
    const table = createEl("table", "contract-preview-table");
    const thead = createEl("thead");
    const headRow = createEl("tr");
    if (enableRowActions) headRow.append(createEl("th", "contract-table-action-col", ""));
    columns.forEach((column) => headRow.append(createEl("th", "", column.label || column.key)));
    thead.append(headRow);
    table.append(thead);

    const tbody = createEl("tbody");
    rows.forEach((row, rowIndex) => {
      const bodyRow = createEl("tr");
      const rowEditors = new Map();
      if (enableRowActions) {
        const actionCell = createEl("td", "contract-table-action-col");
        const deleteButton = createEl("button", "btn-secondary contract-table-delete-row", "删除");
        deleteButton.type = "button";
        deleteButton.disabled = rows.length <= 1;
        deleteButton.setAttribute("aria-label", `删除 ${tableDef?.label || tableName} 第 ${rowIndex + 1} 行`);
        deleteButton.addEventListener("click", () => {
          const currentRows = extractedData[tableName];
          if (!Array.isArray(currentRows) || currentRows.length <= 1) return;
          currentRows.splice(rowIndex, 1);
          void renderFieldPreview(task);
        });
        actionCell.append(deleteButton);
        bodyRow.append(actionCell);
      }
      columns.forEach((column) => {
        const value = row && typeof row === "object" ? getByDotPath(row, column.key) : null;
        if (!attachmentSummaryMode) markPreviewStat(stats, value);
        const autoFilled = supportsLineItemCalculation
          && column.key === "totalPrice"
          && parseDecimalField(row?.quantity) != null
          && parseDecimalField(row?.unitPrice) != null;
        const cell = createEl("td", [
          attachmentSummaryMode || !isBlankField(value) ? "is-recognized" : "is-missing",
          autoFilled ? "is-auto-filled" : "",
        ].filter(Boolean).join(" "));
        const editor = createEl("textarea", "contract-table-editor");
        editor.rows = 2;
        editor.value = fieldValueForEditor(value);
        editor.placeholder = attachmentSummaryMode ? "" : "待填写";
        editor.disabled = !canEditPreview || attachmentSummaryMode;
        editor.setAttribute("aria-label", `${tableDef?.label || tableName} 第 ${rowIndex + 1} 行 ${column.label || column.key}`);
        rowEditors.set(column.key, { editor, cell });
        const onCellEdit = () => handleTableCellEdit({
          row,
          column,
          editor,
          cell,
          rowEditors,
          supportsLineItemCalculation,
          schema,
          extractedData,
        });
        editor.addEventListener("input", onCellEdit);
        editor.addEventListener("change", onCellEdit);
        cell.append(editor);
        bodyRow.append(cell);
      });
      tbody.append(bodyRow);
    });
    table.append(tbody);
    tableWrap.append(table);
    section.append(tableWrap);
    if (enableRowActions) {
      const actions = createEl("div", "contract-preview-table-actions");
      const addButton = createEl("button", "btn-secondary contract-table-add-row", "添加明细行");
      addButton.type = "button";
      addButton.addEventListener("click", () => {
        if (!Array.isArray(extractedData[tableName])) extractedData[tableName] = [];
        extractedData[tableName].push(createEmptyTableRow(columns));
        void renderFieldPreview(task);
      });
      actions.append(addButton);
      section.append(actions);
    }
    paper.append(section);
  });
}

async function renderFieldPreview(task) {
  const schema = await loadTemplateSchema(task.templateType);
  const previewSchema = schema;
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
  syncLineItemCalculations(extractedData, previewSchema, task);
  const yonbipFilledKeys = collectYonbipFilledKeys(task.fieldPreview?.supplierPatch);
  const canEditPreview = !taskIsBusy(task) && task.status !== "completed";
  const stats = { recognized: 0, missing: 0 };

  if (contractPreviewEl) {
    contractPreviewEl.textContent = "";
    const paper = createEl("article", "contract-preview-paper");
    const title = createEl("header", "contract-preview-header");
    title.append(
      createEl("p", "contract-preview-kicker", "合同字段确认稿"),
      createEl("h3", "", task.templateName || schema?.template?.id || "合同模板"),
      createEl("p", "contract-preview-muted", task.manualEntry
        ? "未上传报价单，请按模板字段顺序手工补充内容后生成合同。"
        : tableModeUsesAttachment(task)
          ? "以下展示合同主字段；正文表格仅保留一行总结，完整 Excel 明细将附到 Word 合同末尾。"
          : "以下内容按模板字段顺序生成，可直接修改后生成合同。"),
    );
    paper.append(title);
    renderScalarPreview(paper, previewSchema, extractedData, stats, autoFilledKeys, canEditPreview, task, yonbipFilledKeys);
    renderTablePreview(paper, previewSchema, extractedData, stats, canEditPreview, task);
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
  syncTableModeControls(null);
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
    manualEntry: false,
    status: "uploading",
    message: "等待上传报价单",
    log: "",
    quoteText: "",
    extraInfo: "",
    fieldPreview: null,
    paymentTermsOverrideText: "",
    itemsContentOverrideText: "",
    attachmentMode: null,
    tableMode: "auto",
    upload: null,
    download: null,
    downloadState: "ready",
    failedStep: null,
  };
}

function createManualTask() {
  const selected = templateType.selectedOptions?.[0];
  const templateName = selected?.textContent || templateType.value;
  return {
    id: `task_${Date.now()}_${Math.random().toString(16).slice(2, 8)}`,
    file: null,
    fileName: `手工填写 · ${templateName}`,
    templateType: templateType.value,
    templateName,
    manualEntry: true,
    status: "needs_fields",
    message: "请在字段确认稿中手工补充合同字段。",
    log: "",
    quoteText: "",
    extraInfo: "",
    fieldPreview: null,
    paymentTermsOverrideText: "",
    itemsContentOverrideText: "",
    attachmentMode: { enabled: false, tableMode: "template" },
    tableMode: "template",
    upload: null,
    download: null,
    downloadState: "ready",
    failedStep: null,
  };
}

async function startManualTask() {
  if (!sessionReady) {
    setStatus("请先完成钉钉免登后再创建任务。", "error");
    return false;
  }
  if (incompleteTaskCount() >= MAX_TASKS) {
    setStatus("未完成任务已达到 5 个，请先完成或删除任务。", "error");
    return false;
  }

  const task = createManualTask();
  task.fieldPreview = await buildManualFieldPreview(task.templateType);
  tasks.unshift(task);
  selectTask(task.id);
  closeCreatePanel({ clearFile: true, keepStatus: true });
  setStatus("已创建手工填写任务，请在字段确认稿中补充合同字段。", "success");
  return true;
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
  if (!sessionReady) {
    setStatus("请先完成钉钉免登后再创建任务。", "error");
    updateActionAvailability();
    return;
  }
  if (incompleteTaskCount() >= MAX_TASKS) {
    setStatus("未完成任务已达到 5 个，请先完成或删除任务。", "error");
    updateActionAvailability();
    return;
  }
  if (pendingQuoteFile) {
    startTaskFromFile(pendingQuoteFile);
    return;
  }
  void startManualTask();
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
    createEl("strong", "", hasTasks ? "+ 新建报价单任务" : "开始第一份合同"),
    createEl("span", "", createCard.disabled
      ? uploadDisabledReason()
      : "选模板 → 可选上传报价单 → 确认字段后生成"),
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

    const stage = createEl("p", "task-stage", taskNextAction(task));
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

    card.append(header, stage);
    if (task.status === "failed" && task.message) {
      card.append(createEl("p", "task-message-failed", task.message));
    }
    card.append(actions);
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

  const taskHasWorkbenchContent = taskHasWorkbench(task);
  const shouldOpenDrawer = taskHasWorkbenchContent || taskIsBusy(task) || task.status === "failed" || task.status === "completed";
  syncDrawerVisibility(shouldOpenDrawer);
  setDrawerBusy(task);
  setDrawerStep(drawerStepForTask(task), task);
  syncProcessingPanel(task);
  syncDrawerDownload(task);
  syncTaskLogPanel(task);

  if (activeTaskTitle) {
    activeTaskTitle.textContent = `${task.fileName} · ${statusLabel(task.status)}`;
  }
  if (activeTaskHint) {
    const helperHint = task.manualEntry && task.status === "needs_fields"
      ? "未上传报价单，请直接在字段确认稿中手工补充合同字段。"
      : task.status === "needs_text"
        ? "AI 已整理出报价单文本，请先校对识别内容；有问题直接修改，再识别字段。"
        : task.status === "needs_fields"
          ? "AI 已按模板匹配字段，红色内容代表还需要人工补充或确认，可直接修改。"
          : task.message || "请按当前阶段继续处理任务。";
    activeTaskHint.textContent = `${task.templateName}。${helperHint}`;
  }
  if (generateButton) {
    generateButton.hidden = !(taskHasWorkbenchContent && task.status === "needs_fields");
    const generatingTask = activeGeneratingTask(task.id);
    generateButton.disabled = Boolean(generatingTask);
    generateButton.textContent = generatingTask ? "已有合同生成中，请稍候" : "确认识别结果并生成合同";
  }
  if (identifyFieldsButton) {
    identifyFieldsButton.hidden = task.manualEntry || !(task.quoteText && task.status === "needs_text");
    identifyFieldsButton.textContent = "识别当前任务字段";
  }

  previewCard.hidden = task.manualEntry || !task.quoteText;
  if (!taskHasWorkbenchContent) {
    quoteTextPreview.value = "";
    if (extraInfoText) extraInfoText.value = "";
    resetFieldPreviewUi();
    updateActionAvailability();
    return;
  }

  quoteTextPreview.value = task.quoteText || "";
  if (extraInfoText) extraInfoText.value = task.extraInfo || "";
  syncTableModeControls(task);

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
    task.tableMode = quoteIsExcelTask(task) ? defaultTableMode(task.attachmentMode) : "auto";
    const attachmentHint = taskAttachmentModeText(task);
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
    task.fieldPreview = await previewQuoteFields(task.upload.id, task.quoteText.trim(), task.extraInfo, task.templateType, effectiveTableMode(task));
    task.tableMode = normalizeTableMode(task.fieldPreview.tableMode || task.tableMode);
    task.attachmentMode = task.fieldPreview.attachmentMode || task.attachmentMode;
    await renderFieldPreview(task);
    const missing = task.fieldPreview.missingFields?.length || 0;
    const supplierPatched = task.fieldPreview.supplierPatch?.overwrittenFields?.length || task.fieldPreview.supplierPatch?.appliedFields?.length || 0;
    const supplierHint = supplierPatched ? ` 已从用友供应商档案回填 ${supplierPatched} 项乙方信息。` : "";
    const previewSchema = templateSchemaCache.get(templateSchemaFiles[task.templateType] || templateSchemaFiles[DEFAULT_TEMPLATE_TYPE]);
    const attachmentHint = taskAttachmentModeText(task);
    const supplierStatus = supplierPatched
      ? `AI 已整理字段，并从用友供应商档案回填 ${supplierPatched} 项乙方信息。`
      : (missing > 0 ? "AI 已整理字段，请重点确认红色提示。" : "AI 已整理字段，未发现缺失字段。");
    if (shouldShowSupplierPatchModal(task.fieldPreview.supplierPatch)) {
      openSupplierPatchModal("result", task.fieldPreview.supplierPatch, previewSchema);
    }
    setTaskStatus(
      task,
      "needs_fields",
      missing > 0
        ? `AI 已识别主字段，仍有 ${missing} 项需要人工确认。${supplierHint}${attachmentHint ? ` ${attachmentHint}` : ""}`
        : `AI 已识别字段，未发现缺失字段。${supplierHint}${attachmentHint ? ` ${attachmentHint}` : ""}`,
    );
    setStatus(
      attachmentHint || supplierStatus,
      attachmentHint || missing > 0 ? "info" : "success",
    );
  } catch (error) {
    const message = formatError(error);
    setTaskStatus(task, "failed", `字段识别失败：${message}`, "identify");
    setStatus(message, "error");
  }
}

async function runGenerateTask(task) {
  if (!task.fieldPreview?.extractedData) return;
  if (!task.manualEntry && !task.upload) return;
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
    const schema = await loadTemplateSchema(task.templateType);
    const previewSchema = tableModeUsesAttachment(task) ? { ...schema, tables: {} } : schema;
    await generateContract(task, task.quoteText, task.extraInfo, buildExtractedDataForGenerate(task, previewSchema));
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
  if (!task.fieldPreview?.extractedData) {
    setStatus("请先识别并确认合同字段。", "error");
    return;
  }
  const quoteText = quoteTextPreview.value.trim();
  if (!task.manualEntry && !quoteText) {
    setStatus("解析文本为空，请补充后再生成合同。", "error");
    return;
  }
  if (quoteText) task.quoteText = quoteText;
  await runGenerateTask(task);
});

closeTaskDrawerButton?.addEventListener("click", closeTaskDrawer);
taskDrawerBackdrop?.addEventListener("click", closeTaskDrawer);
closeAccessModalButton?.addEventListener("click", closeAccessModal);
closeSupplierPatchModalButton?.addEventListener("click", closeSupplierPatchModal);
supplierPatchModal?.addEventListener("click", (event) => {
  if (event.target === supplierPatchModal) closeSupplierPatchModal();
});
tableModeInputs.forEach((input) => {
  input.addEventListener("change", () => {
    setTaskTableMode(activeTask(), input.checked ? "attachment" : "template");
  });
});
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
  if (accessModal && !accessModal.hidden) {
    closeAccessModal();
    return;
  }
  if (supplierPatchModal && !supplierPatchModal.hidden) closeSupplierPatchModal();
});

updateSelectedFile();
renderTaskList();
clearActiveEditor();
updateActionAvailability();
void initAuth();
