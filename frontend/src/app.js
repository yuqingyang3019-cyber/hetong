const statusEl = document.querySelector("#status");
const logEl = document.querySelector("#log");
const downloadLink = document.querySelector("#downloadLink");
const parseButton = document.querySelector("#parseButton");
const generateButton = document.querySelector("#generateButton");
const quoteFile = document.querySelector("#quoteFile");
const previewCard = document.querySelector("#previewCard");
const quoteTextPreview = document.querySelector("#quoteTextPreview");
const templateType = document.querySelector("#templateType");
const agentEndpoint = (window.__AGENT_ENDPOINT__ || "").replace(/\/$/, "");

let parsedUpload = null;

function apiUrl(path) {
  return `${agentEndpoint}${path}`;
}

function appendLog(text) {
  logEl.textContent += text;
  logEl.scrollTop = logEl.scrollHeight;
}

function applyDownloadLink(value) {
  if (value.downloadDataUrl) {
    downloadLink.href = value.downloadDataUrl;
    downloadLink.download = value.fileName || `${value.contractId || "contract"}.docx`;
  } else if (value.downloadPath) {
    downloadLink.href = apiUrl(value.downloadPath);
    downloadLink.removeAttribute("download");
  } else {
    downloadLink.href = value.downloadUrl;
    downloadLink.removeAttribute("download");
  }
  downloadLink.hidden = false;
}

async function loginWithDingTalk() {
  if (!window.dd || !window.location.search.includes("corpId=")) return;
  const corpId = new URLSearchParams(window.location.search).get("corpId");
  try {
    window.dd.requestAuthCode({
      corpId,
      onSuccess: async (result) => {
        await fetch(apiUrl("/api/dingtalk/login"), {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ code: result.code, corpId }),
        });
      },
    });
  } catch {
    // 免登失败不阻塞合同生成；后端后续可根据审计需求强化。
  }
}

async function uploadQuote(file) {
  const data = await fileToDataUrl(file);
  const response = await fetch(apiUrl("/api/uploads"), {
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
  const response = await fetch(apiUrl(`/api/uploads/${encodeURIComponent(uploadId)}/quote-text`), {
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
  const response = await fetch(apiUrl("/ag-ui/agent"), {
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
      context: [],
      forwardedProps: {
        uploadId,
        templateType: templateType.value,
        quoteText,
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
  parseButton.disabled = true;
  generateButton.disabled = true;
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
    parseButton.disabled = false;
    generateButton.disabled = false;
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
  parseButton.disabled = true;
  generateButton.disabled = true;
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
    parseButton.disabled = false;
    generateButton.disabled = false;
  }
});

void loginWithDingTalk();
