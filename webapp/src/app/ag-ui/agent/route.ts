import { writeFile } from "fs/promises";
import path from "path";
import { appLog } from "@/lib/app-log";
import { ensureStorage, newId, safeFileName } from "@/lib/storage";
import { uploadsDir } from "@/lib/paths";

export const runtime = "nodejs";

type InputContentSource =
  | {
      type: "data";
      value: string;
      mimeType: string;
    }
  | {
      type: "url";
      value: string;
      mimeType?: string;
    };

type InputContent = {
  type: "text" | "document" | "image" | "audio" | "video";
  text?: string;
  source?: InputContentSource;
  metadata?: Record<string, unknown>;
};

type Message = {
  id: string;
  role: string;
  content?: string | InputContent[];
};

type RunAgentInput = {
  threadId?: string;
  runId?: string;
  state?: Record<string, unknown>;
  messages?: Message[];
  forwardedProps?: Record<string, unknown>;
};

type SourceFile = {
  originalName: string;
  storedPath: string;
  mimeType: string;
  size: number;
};

type AguiEvent = Record<string, unknown> & {
  type: string;
};

const encoder = new TextEncoder();

function encodeEvent(event: AguiEvent) {
  return encoder.encode(`data: ${JSON.stringify({ timestamp: Date.now(), ...event })}\n\n`);
}

function textEvent(messageId: string, delta: string): AguiEvent {
  return {
    type: "TEXT_MESSAGE_CONTENT",
    messageId,
    delta,
  };
}

function getLastUserMessage(messages: Message[] = []) {
  return [...messages].reverse().find((message) => message.role === "user");
}

function getTextAndFileContent(message: Message | undefined) {
  const content = message?.content;
  if (typeof content === "string") {
    return { text: content.trim(), filePart: undefined as InputContent | undefined };
  }

  if (!Array.isArray(content)) {
    return { text: "", filePart: undefined as InputContent | undefined };
  }

  const text = content
    .filter((part) => part.type === "text" && typeof part.text === "string")
    .map((part) => part.text?.trim())
    .filter(Boolean)
    .join("\n");
  const filePart = content.find((part) => (part.type === "document" || part.type === "image") && part.source);
  return { text, filePart };
}

function summarizeInput(input: RunAgentInput) {
  const lastMessage = getLastUserMessage(input.messages);
  const content = lastMessage?.content;
  return {
    messageCount: input.messages?.length ?? 0,
    lastUserMessageRole: lastMessage?.role,
    contentKind: Array.isArray(content) ? "multimodal" : typeof content,
    contentTypes: Array.isArray(content) ? content.map((part) => part.type) : undefined,
    stateKeys: input.state ? Object.keys(input.state) : [],
    forwardedPropKeys: input.forwardedProps ? Object.keys(input.forwardedProps) : [],
  };
}

function metadataFileName(metadata: Record<string, unknown> | undefined) {
  const candidate = metadata?.fileName ?? metadata?.filename ?? metadata?.name;
  return typeof candidate === "string" && candidate.trim() ? candidate.trim() : undefined;
}

function fileNameFromUrl(value: string) {
  try {
    const url = new URL(value);
    const base = path.basename(url.pathname);
    return base && base !== "/" ? decodeURIComponent(base) : undefined;
  } catch {
    return undefined;
  }
}

function extensionFromMime(mimeType: string) {
  if (mimeType.includes("spreadsheetml")) return ".xlsx";
  if (mimeType.includes("ms-excel")) return ".xls";
  if (mimeType.includes("pdf")) return ".pdf";
  if (mimeType.includes("png")) return ".png";
  if (mimeType.includes("jpeg") || mimeType.includes("jpg")) return ".jpg";
  if (mimeType.includes("webp")) return ".webp";
  if (mimeType.startsWith("text/")) return ".txt";
  return "";
}

function parseDataSource(value: string, fallbackMimeType: string) {
  const match = value.match(/^data:([^;,]+);base64,/);
  if (match && value.startsWith(match[0])) {
    return {
      mimeType: match[1],
      buffer: Buffer.from(value.slice(match[0].length), "base64"),
    };
  }

  return {
    mimeType: fallbackMimeType,
    buffer: Buffer.from(value, "base64"),
  };
}

async function persistBuffer(buffer: Buffer, originalName: string, mimeType: string): Promise<SourceFile> {
  await ensureStorage();
  const id = newId("upload");
  const fileName = `${id}_${safeFileName(originalName)}`;
  const storedPath = path.join(uploadsDir, fileName);
  await writeFile(storedPath, buffer);
  return {
    originalName,
    storedPath,
    mimeType,
    size: buffer.length,
  };
}

async function saveInputFile(part: InputContent): Promise<SourceFile> {
  if (!part.source) {
    throw new Error("AGUI 文件输入缺少 source");
  }

  if (part.source.type === "url") {
    const response = await fetch(part.source.value);
    if (!response.ok) {
      throw new Error(`下载报价单文件失败：HTTP ${response.status}`);
    }
    const mimeType = part.source.mimeType ?? response.headers.get("content-type") ?? "application/octet-stream";
    const fileName =
      metadataFileName(part.metadata) ??
      fileNameFromUrl(part.source.value) ??
      `quote${extensionFromMime(mimeType) || ".bin"}`;
    return persistBuffer(Buffer.from(await response.arrayBuffer()), fileName, mimeType);
  }

  const parsed = parseDataSource(part.source.value, part.source.mimeType);
  const fileName = metadataFileName(part.metadata) ?? `quote${extensionFromMime(parsed.mimeType) || ".bin"}`;
  return persistBuffer(parsed.buffer, fileName, parsed.mimeType);
}

function absoluteUrl(request: Request, pathOrUrl: string) {
  if (/^https?:\/\//i.test(pathOrUrl)) return pathOrUrl;
  const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host") ?? "";
  const proto = request.headers.get("x-forwarded-proto") ?? "https";
  return host ? `${proto}://${host}${pathOrUrl}` : pathOrUrl;
}

function uploadDownloadUrl(request: Request, sourceFile: SourceFile) {
  const fileName = path.basename(sourceFile.storedPath);
  return absoluteUrl(request, `/api/uploads/${encodeURIComponent(fileName)}/download`);
}

function isHealthCheck(input: RunAgentInput) {
  return input.forwardedProps?.healthCheck === true;
}

async function* runContractAgent(input: RunAgentInput, request: Request): AsyncGenerator<AguiEvent> {
  const threadId = input.threadId ?? newId("thread");
  const runId = input.runId ?? newId("run");
  const messageId = newId("msg");

  yield { type: "RUN_STARTED", threadId, runId };
  yield { type: "TEXT_MESSAGE_START", messageId, role: "assistant" };

  try {
    appLog.info("ag-ui-agent", "run input", summarizeInput(input));

    if (isHealthCheck(input)) {
      yield textEvent(messageId, "AGUI 合同生成服务正常。");
      yield { type: "TEXT_MESSAGE_END", messageId };
      yield { type: "RUN_FINISHED", threadId, runId, result: { ok: true } };
      return;
    }

    const { filePart } = getTextAndFileContent(getLastUserMessage(input.messages));
    if (!filePart) {
      const summary = summarizeInput(input);
      yield textEvent(
        messageId,
        `未收到 AGUI 附件。请在钉钉里发送 PDF/Excel/图片附件后重试。\n\n输入摘要：${JSON.stringify(summary)}`,
      );
      yield { type: "TEXT_MESSAGE_END", messageId };
      yield { type: "RUN_FINISHED", threadId, runId, result: { needsAttachment: true, inputSummary: summary } };
      return;
    }

    yield textEvent(messageId, "已收到 AGUI 附件，开始保存。\n");

    const saveToolCallId = newId("tool_save_attachment");
    yield { type: "TOOL_CALL_START", toolCallId: saveToolCallId, toolCallName: "save_agui_attachment", parentMessageId: messageId };
    const sourceFile = await saveInputFile(filePart);
    const downloadUrl = uploadDownloadUrl(request, sourceFile);
    yield {
      type: "TOOL_CALL_RESULT",
      messageId: newId("tool_result"),
      toolCallId: saveToolCallId,
      role: "tool",
      content: JSON.stringify({
        fileName: sourceFile.originalName,
        mimeType: sourceFile.mimeType,
        size: sourceFile.size,
        downloadUrl,
      }),
    };
    yield { type: "TOOL_CALL_END", toolCallId: saveToolCallId };

    yield textEvent(
      messageId,
      `附件已收到并保存。\n文件名：${sourceFile.originalName}\n类型：${sourceFile.mimeType}\n大小：${sourceFile.size} 字节\n下载链接：${downloadUrl}`,
    );
    yield {
      type: "CUSTOM",
      name: "attachment_received",
      value: {
        fileName: sourceFile.originalName,
        mimeType: sourceFile.mimeType,
        size: sourceFile.size,
        downloadUrl,
      },
    };
    yield { type: "TEXT_MESSAGE_END", messageId };
    yield { type: "RUN_FINISHED", threadId, runId, result: { attachmentReceived: true, downloadUrl } };
  } catch (error) {
    const message = error instanceof Error ? error.message : "AGUI 运行失败";
    appLog.error("ag-ui-agent", "run failed", error);
    yield textEvent(messageId, `处理失败：${message}`);
    yield { type: "TEXT_MESSAGE_END", messageId };
    yield { type: "RUN_ERROR", message };
  }
}

export async function POST(request: Request) {
  let input: RunAgentInput;
  try {
    input = (await request.json()) as RunAgentInput;
  } catch {
    return Response.json({ error: "请求体不是合法 JSON" }, { status: 400 });
  }

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        for await (const event of runContractAgent(input, request)) {
          controller.enqueue(encodeEvent(event));
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : "AGUI 运行失败";
        appLog.error("ag-ui-agent", "run failed", error);
        controller.enqueue(encodeEvent({ type: "RUN_ERROR", message }));
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
