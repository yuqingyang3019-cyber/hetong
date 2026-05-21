const statusEl = document.querySelector("#status");
const logEl = document.querySelector("#log");
const downloadLink = document.querySelector("#downloadLink");
const generateButton = document.querySelector("#generateButton");
const quoteFile = document.querySelector("#quoteFile");
const templateType = document.querySelector("#templateType");
const agentEndpoint = (window.__AGENT_ENDPOINT__ || "").replace(/\/$/, "");

function apiUrl(path) {
  return `${agentEndpoint}${path}`;
}

function appendLog(text) {
  logEl.textContent += text;
  logEl.scrollTop = logEl.scrollHeight;
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

async function generateContract(uploadId) {
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
        downloadLink.href = event.value.downloadUrl;
        downloadLink.hidden = false;
      }
      if (event.type === "RUN_ERROR") throw new Error(event.message || "生成失败");
    }
  }
}

generateButton.addEventListener("click", async () => {
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
  generateButton.disabled = true;
  logEl.textContent = "";
  downloadLink.hidden = true;
  try {
    statusEl.textContent = "正在上传报价单...";
    const upload = await uploadQuote(file);
    appendLog(`已上传：${upload.originalName}\n`);
    statusEl.textContent = "正在生成合同...";
    await generateContract(upload.id);
    statusEl.textContent = "合同已生成。";
  } catch (error) {
    const message = error instanceof Error ? error.message : "处理失败";
    statusEl.textContent = message;
    appendLog(`\n处理失败：${message}`);
  } finally {
    generateButton.disabled = false;
  }
});

void loginWithDingTalk();
