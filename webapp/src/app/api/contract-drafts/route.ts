import { NextResponse } from "next/server";
import { appLog } from "@/lib/app-log";
import { extractTextFromFile } from "@/lib/extract-text";
import { extractTemplateRenderData } from "@/lib/llm-extract";
import { mergeLlmPatchIntoRenderData } from "@/lib/merge-render-data";
import { normalizeRenderDataFromQuote } from "@/lib/normalize-render-from-quote";
import { getTemplateConfig } from "@/lib/template-config";
import { saveDraft } from "@/lib/draft-store";
import { newId, saveUpload } from "@/lib/storage";
import { validateDraft } from "@/lib/validate-draft";
import type { ContractDraft } from "@/lib/types";

export const runtime = "nodejs";

type SourceFile = ContractDraft["sourceFile"];

function isSourceFile(value: unknown): value is SourceFile {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<SourceFile>;
  return (
    typeof candidate.originalName === "string" &&
    typeof candidate.storedPath === "string" &&
    typeof candidate.mimeType === "string" &&
    typeof candidate.size === "number"
  );
}

async function createDraft(sourceFile: SourceFile, ocrText: string, templateType: string) {
  const config = getTemplateConfig(templateType);
  appLog.info("contract-drafts", "createDraft: llm extract start", {
    templateType: config.type,
    quoteTextLength: ocrText.length,
    sourceFileName: sourceFile.originalName,
  });
  const extractedData = await extractTemplateRenderData(ocrText, config);
  appLog.info("contract-drafts", "createDraft: llm extract done", {
    templateType: config.type,
    topLevelKeys: Object.keys(extractedData),
    itemsRowCount: Array.isArray(extractedData.items) ? extractedData.items.length : 0,
  });
  let renderData = mergeLlmPatchIntoRenderData(extractedData, config);
  const normalized = normalizeRenderDataFromQuote(renderData, ocrText, config);
  renderData = normalized.renderData;
  const validation = validateDraft(renderData, config);
  const warnings = [...normalized.warnings, ...validation.warnings];
  appLog.info("contract-drafts", "createDraft: merged + validated", {
    templateType: config.type,
    missingFieldCount: validation.missingFields.length,
    warningCount: warnings.length,
    quoteNormalizeWarnings: normalized.warnings.length,
    renderItemsRowCount: Array.isArray(renderData.items) ? renderData.items.length : 0,
  });
  const now = new Date().toISOString();

  const draft: ContractDraft = {
    id: newId("draft"),
    templateType: config.type,
    sourceFile,
    ocrText,
    extractedData,
    renderData,
    missingFields: validation.missingFields,
    warnings,
    createdAt: now,
    updatedAt: now,
  };

  await saveDraft(draft);
  appLog.info("contract-drafts", "createDraft: saved", { draftId: draft.id, templateType: draft.templateType });
  return draft;
}

export async function POST(request: Request) {
  const contentType = request.headers.get("content-type") ?? "";

  if (contentType.includes("application/json")) {
    try {
      const body = (await request.json()) as {
        sourceFile?: unknown;
        quoteText?: unknown;
        templateType?: unknown;
      };
      if (!isSourceFile(body.sourceFile)) {
        appLog.warn("contract-drafts", "json POST reject: bad sourceFile");
        return NextResponse.json({ error: "缺少已解析的报价单文件信息" }, { status: 400 });
      }
      if (typeof body.quoteText !== "string" || !body.quoteText.trim()) {
        appLog.warn("contract-drafts", "json POST reject: empty quoteText");
        return NextResponse.json({ error: "请先确认报价单解析文本" }, { status: 400 });
      }

      appLog.info("contract-drafts", "POST json: confirmed quote + template", {
        templateType: body.templateType ? String(body.templateType) : "caigouhetong",
        quoteTextLength: body.quoteText.trim().length,
      });
      const templateType = body.templateType ? String(body.templateType) : "caigouhetong";
      const draft = await createDraft(body.sourceFile, body.quoteText.trim(), templateType);
      return NextResponse.json(draft);
    } catch (error) {
      const message = error instanceof Error ? error.message : "创建草稿失败";
      appLog.error("contract-drafts", "POST json failed", error);
      return NextResponse.json({ error: message }, { status: 502 });
    }
  }

  const formData = await request.formData();
  const file = formData.get("quote");
  const templateTypeRaw = String(formData.get("templateType") ?? "");
  const templateType = templateTypeRaw || "caigouhetong";

  if (!(file instanceof File)) {
    appLog.warn("contract-drafts", "form POST reject: no file");
    return NextResponse.json({ error: "请上传报价单文件" }, { status: 400 });
  }

  const config = getTemplateConfig(templateType);
  try {
    appLog.info("contract-drafts", "POST form: upload + full pipeline", {
      templateType: config.type,
      fileName: file.name,
      mimeType: file.type || "unknown",
    });
    const sourceFile = await saveUpload(file);
    const ocrText = await extractTextFromFile(sourceFile.storedPath, sourceFile.mimeType);
    const draft = await createDraft(sourceFile, ocrText, config.type);
    return NextResponse.json(draft);
  } catch (error) {
    const message = error instanceof Error ? error.message : "创建草稿失败";
    appLog.error("contract-drafts", "POST form failed", error, { templateType: config.type });
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
