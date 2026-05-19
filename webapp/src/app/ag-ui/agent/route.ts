import { writeFile } from "fs/promises";
import path from "path";
import { appLog } from "@/lib/app-log";
import { extractTextFromFile } from "@/lib/extract-text";
import { extractTemplateRenderData } from "@/lib/llm-extract";
import { mergeLlmPatchIntoRenderData } from "@/lib/merge-render-data";
import { normalizeRenderDataFromQuote } from "@/lib/normalize-render-from-quote";
import { renderContract } from "@/lib/render-docx";
import { saveDraft } from "@/lib/draft-store";
import { getTemplateConfig } from "@/lib/template-config";
import { ensureStorage, newId, safeFileName } from "@/lib/storage";
import { uploadsDir } from "@/lib/paths";
import { validateDraft } from "@/lib/validate-draft";
import type { ContractDraft } from "@/lib/types";

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

type SourceFile = ContractDraft["sourceFile"];

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

async function saveTextQuote(text: string): Promise<SourceFile> {
  const buffer = Buffer.from(text, "utf8");
  return persistBuffer(buffer, "agui-quote.txt", "text/plain");
}

function getTemplateType(input: RunAgentInput) {
  const fromForwardedProps = input.forwardedProps?.templateType;
  const fromState = input.state?.templateType;
  if (typeof fromForwardedProps === "string" && fromForwardedProps.trim()) return fromForwardedProps.trim();
  if (typeof fromState === "string" && fromState.trim()) return fromState.trim();
  return "caigouhetong";
}

async function createDraft(sourceFile: SourceFile, quoteText: string, templateType: string) {
  const config = getTemplateConfig(templateType);
  const extractedData = await extractTemplateRenderData(quoteText, config);
  let renderData = mergeLlmPatchIntoRenderData(extractedData, config);
  const normalized = normalizeRenderDataFromQuote(renderData, quoteText, config);
  renderData = normalized.renderData;
  const validation = validateDraft(renderData, config);
  const warnings = [...normalized.warnings, ...validation.warnings];
  const now = new Date().toISOString();

  const draft: ContractDraft = {
    id: newId("draft"),
    templateType: config.type,
    sourceFile,
    ocrText: quoteText,
    extractedData,
    renderData,
    missingFields: validation.missingFields,
    warnings,
    createdAt: now,
    updatedAt: now,
  };

  return saveDraft(draft);
}

function absoluteUrl(request: Request, pathOrUrl: string) {
  if (/^https?:\/\//i.test(pathOrUrl)) return pathOrUrl;
  const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host") ?? "";
  const proto = request.headers.get("x-forwarded-proto") ?? "https";
  return host ? `${proto}://${host}${pathOrUrl}` : pathOrUrl;
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

  if (isHealthCheck(input)) {
    yield textEvent(messageId, "AGUI 合同生成服务正常。");
    yield { type: "TEXT_MESSAGE_END", messageId };
    yield { type: "RUN_FINISHED", threadId, runId, result: { ok: true } };
    return;
  }

  const { text, filePart } = getTextAndFileContent(getLastUserMessage(input.messages));
  if (!filePart && !text) {
    throw new Error("请上传报价单文件，或直接发送报价单文本");
  }

  yield textEvent(messageId, "已收到报价单，开始解析。\n");

  const parseToolCallId = newId("tool_parse");
  yield { type: "TOOL_CALL_START", toolCallId: parseToolCallId, toolCallName: "parse_quote_file", parentMessageId: messageId };
  const sourceFile = filePart ? await saveInputFile(filePart) : await saveTextQuote(text);
  const quoteText = filePart ? await extractTextFromFile(sourceFile.storedPath, sourceFile.mimeType) : text;
  yield {
    type: "TOOL_CALL_RESULT",
    messageId: newId("tool_result"),
    toolCallId: parseToolCallId,
    role: "tool",
    content: JSON.stringify({ fileName: sourceFile.originalName, textLength: quoteText.length }),
  };
  yield { type: "TOOL_CALL_END", toolCallId: parseToolCallId };
  yield textEvent(messageId, "报价单解析完成，开始生成合同。\n");

  const renderToolCallId = newId("tool_render");
  yield { type: "TOOL_CALL_START", toolCallId: renderToolCallId, toolCallName: "render_contract", parentMessageId: messageId };
  const draft = await createDraft(sourceFile, quoteText, getTemplateType(input));
  const result = await renderContract(draft);
  const downloadUrl = absoluteUrl(request, result.downloadUrl);
  yield {
    type: "TOOL_CALL_RESULT",
    messageId: newId("tool_result"),
    toolCallId: renderToolCallId,
    role: "tool",
    content: JSON.stringify({ draftId: draft.id, contractId: result.id, downloadUrl }),
  };
  yield { type: "TOOL_CALL_END", toolCallId: renderToolCallId };

  yield textEvent(messageId, `合同已生成，点击下载：${downloadUrl}`);
  yield {
    type: "CUSTOM",
    name: "contract_generated",
    value: {
      draftId: draft.id,
      contractId: result.id,
      fileName: `${result.id}.docx`,
      downloadUrl,
    },
  };
  yield { type: "TEXT_MESSAGE_END", messageId };
  yield { type: "RUN_FINISHED", threadId, runId, result: { draftId: draft.id, contractId: result.id, downloadUrl } };
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
