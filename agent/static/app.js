const statusEl = document.querySelector("#status");
const logEl = document.querySelector("#log");
const downloadLink = document.querySelector("#downloadLink");
const parseButton = document.querySelector("#parseButton");
const generateButton = document.querySelector("#generateButton");
const quoteFile = document.querySelector("#quoteFile");
const previewCard = document.querySelector("#previewCard");
const quoteTextPreview = document.querySelector("#quoteTextPreview");
const templateType = document.querySelector("#templateType");
const userBar = document.querySelector("#userBar");
const userAvatar = document.querySelector("#userAvatar");
const userNameEl = document.querySelector("#userName");
const userDeptEl = document.querySelector("#userDept");
const userMobileEl = document.querySelector("#userMobile");
const userTitleEl = document.querySelector("#userTitle");
const loginHintEl = document.querySelector("#loginHint");

const agentEndpoint = (window.__AGENT_ENDPOINT__ || "").replace(/\/$/, "");
const corpIdFromConfig = (window.__DINGTALK_CORP_ID__ || "").trim();

let parsedUpload = null;
let authContext = { skipAuth: false, dingtalkConfigured: false, corpId: "" };
/** 是否允许使用上传、解析、生成（免登成功或开发跳过鉴权） */
let sessionReady = false;

function apiUrl(path) {
  return `${agentEndpoint}${path}`;
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

function setBusy(disabled) {
  parseButton.disabled = disabled;
  generateButton.disabled = disabled;
}

function setInteractionEnabled(enabled) {
  parseButton.disabled = !enabled;
  generateButton.disabled = !enabled;
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

async function initAuth() {
  sessionReady = false;
  if (!agentEndpoint) {
    setInteractionEnabled(false);
    statusEl.textContent = "缺少 Agent endpoint 配置。";
    return;
  }

  const statusResponse = await fetchAuth(apiUrl("/api/auth/status"));
  if (!statusResponse.ok) {
    setInteractionEnabled(false);
    statusEl.textContent = "无法获取鉴权状态。";
    return;
  }
  authContext = await statusResponse.json();

  if (authContext.skipAuth) {
    sessionReady = true;
    setInteractionEnabled(true);
    showUserBar(
      { name: "开发模式", deptNames: [], mobile: "", title: "" },
      "后端未启用登录鉴权（未配置 APP_SESSION_SECRET 或已开启跳过）。",
    );
    statusEl.textContent = "等待上传报价单。";
    return;
  }

  if (!authContext.dingtalkConfigured) {
    sessionReady = false;
    setInteractionEnabled(false);
    hideUserBar();
    statusEl.textContent = "服务端未配置钉钉应用，无法免登。";
    if (loginHintEl) loginHintEl.textContent = "请联系管理员配置 DINGTALK_APP_KEY / DINGTALK_APP_SECRET。";
    return;
  }

  const me = await refreshAuthMe();
  if (me?.loggedIn && me.user) {
    sessionReady = true;
    try {
      sessionStorage.setItem("hetong_user_preview", JSON.stringify(me.user));
    } catch {
      /* ignore */
    }
    setInteractionEnabled(true);
    showUserBar(me.user, "已通过钉钉免登。");
    statusEl.textContent = "等待上传报价单。";
    return;
  }

  sessionReady = false;
  setInteractionEnabled(false);
  hideUserBar();
  statusEl.textContent = "正在钉钉内免登…";
  if (loginHintEl) loginHintEl.textContent = "正在获取免登授权码…";

  const corpId =
    corpIdFromConfig ||
    new URLSearchParams(window.location.search).get("corpId") ||
    authContext.corpId ||
    "";

  if (!window.dd) {
    sessionReady = false;
    statusEl.textContent = "请在钉钉客户端内打开本应用以完成免登。";
    if (loginHintEl) loginHintEl.textContent = "当前环境未注入钉钉 JSAPI。";
    return;
  }

  if (!corpId) {
    sessionReady = false;
    statusEl.textContent = "缺少 corpId：请在微应用首页 URL 附带 corpId= 或在服务端配置 DINGTALK_CORP_ID。";
    if (loginHintEl) loginHintEl.textContent = "config.js 可注入 __DINGTALK_CORP_ID__。";
    return;
  }

  await new Promise((resolve) => {
    if (window.dd.ready) {
      window.dd.ready(resolve);
    } else {
      resolve();
    }
  });

  await new Promise((resolve, reject) => {
    try {
      window.dd.requestAuthCode({
        corpId,
        onSuccess: resolve,
        onFail: (err) => reject(new Error(err?.errorMessage || err?.message || "免登失败")),
      });
    } catch (error) {
      reject(error instanceof Error ? error : new Error("免登失败"));
    }
  }).then(async (result) => {
    const code = result && result.code;
    if (!code) {
      throw new Error("未获取到免登授权码");
    }
    const loginResponse = await fetchAuth(apiUrl("/api/dingtalk/login"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code, corpId }),
    });
    const body = await loginResponse.json().catch(() => ({}));
    if (!loginResponse.ok) {
      throw new Error(body.detail || body.message || "登录失败");
    }
    if (!body.configured) {
      throw new Error(body.message || "钉钉未配置");
    }
    if (body.user) {
      try {
        sessionStorage.setItem("hetong_user_preview", JSON.stringify(body.user));
      } catch {
        /* ignore */
      }
      showUserBar(body.user, "已通过钉钉免登。");
    }
    sessionReady = true;
    setInteractionEnabled(true);
    statusEl.textContent = "等待上传报价单。";
    if (loginHintEl) loginHintEl.textContent = "";
  }).catch((error) => {
    sessionReady = false;
    const message = error instanceof Error ? error.message : "免登失败";
    statusEl.textContent = `免登失败：${message}`;
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

async function generateContract(uploadId, quoteText) {
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

function resetPreview() {
  parsedUpload = null;
  previewCard.hidden = true;
  quoteTextPreview.value = "";
  downloadLink.hidden = true;
  downloadLink.removeAttribute("download");
  downloadLink.dataset.needsAuth = "";
  downloadLink.dataset.downloadPath = "";
  downloadLink.onclick = null;
}

quoteFile.addEventListener("change", () => {
  resetPreview();
  statusEl.textContent = "等待上传报价单。";
  logEl.textContent = "";
});

templateType.addEventListener("change", () => {
  resetPreview();
  statusEl.textContent = "模板已切换，请重新解析报价单。";
});

parseButton.addEventListener("click", async () => {
  const file = quoteFile.files?.[0];
  if (!agentEndpoint) {
    statusEl.textContent = "缺少 Agent endpoint 配置。";
    return;
  }
  if (!file) {
    statusEl.textContent = "请先选择报价单文件。";
    return;
  }
  if (file.size === 0) {
    statusEl.textContent = "报价单文件为空，请重新选择文件。";
    return;
  }
  setBusy(true);
  logEl.textContent = "";
  downloadLink.hidden = true;
  previewCard.hidden = true;
  try {
    statusEl.textContent = "正在上传报价单...";
    const upload = await uploadQuote(file);
    appendLog(`已上传：${upload.originalName}\n`);
    statusEl.textContent = "正在解析报价单...";
    const parsed = await parseUploadedQuote(upload.id);
    parsedUpload = upload;
    quoteTextPreview.value = parsed.quoteText || "";
    previewCard.hidden = false;
    appendLog(`已解析：${parsed.textLength || 0} 字符\n`);
    statusEl.textContent = "请确认报价单解析文本。";
  } catch (error) {
    const message = error instanceof Error ? error.message : "处理失败";
    statusEl.textContent = message;
    appendLog(`\n处理失败：${message}`);
  } finally {
    parseButton.disabled = !sessionReady;
    generateButton.disabled = !sessionReady;
  }
});

generateButton.addEventListener("click", async () => {
  if (!parsedUpload) {
    statusEl.textContent = "请先上传并解析报价单。";
    return;
  }
  const quoteText = quoteTextPreview.value.trim();
  if (!quoteText) {
    statusEl.textContent = "解析文本为空，请补充后再生成合同。";
    return;
  }
  setBusy(true);
  downloadLink.hidden = true;
  logEl.textContent = "";
  try {
    statusEl.textContent = "正在生成合同...";
    await generateContract(parsedUpload.id, quoteText);
    statusEl.textContent = "合同已生成。";
  } catch (error) {
    const message = error instanceof Error ? error.message : "处理失败";
    statusEl.textContent = message;
    appendLog(`\n处理失败：${message}`);
  } finally {
    parseButton.disabled = !sessionReady;
    generateButton.disabled = !sessionReady;
  }
});

void initAuth();
