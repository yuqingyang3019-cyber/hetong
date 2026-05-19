import { NextResponse } from "next/server";
import { appLog } from "@/lib/app-log";
import { getDraft, updateDraft } from "@/lib/draft-store";
import { mergeLlmPatchIntoRenderData } from "@/lib/merge-render-data";
import { normalizeRenderDataFromQuote } from "@/lib/normalize-render-from-quote";
import { getTemplateConfig } from "@/lib/template-config";
import { validateDraft } from "@/lib/validate-draft";

export const runtime = "nodejs";

type RouteContext = {
  params: Promise<{ id: string }>;
};

export async function GET(_request: Request, context: RouteContext) {
  const { id } = await context.params;
  appLog.info("contract-draft", "GET", { draftId: id });
  const draft = await getDraft(id);
  return NextResponse.json(draft);
}

export async function PATCH(request: Request, context: RouteContext) {
  const { id } = await context.params;
  try {
    appLog.info("contract-draft", "PATCH start", { draftId: id });
    const current = await getDraft(id);
    let body: { extractedData?: Record<string, unknown> };
    try {
      body = (await request.json()) as { extractedData?: Record<string, unknown> };
    } catch {
      return NextResponse.json({ error: "请求体不是合法 JSON" }, { status: 400 });
    }
    const extractedData = body.extractedData ?? current.extractedData;
    const config = getTemplateConfig(current.templateType);
    let renderData = mergeLlmPatchIntoRenderData(extractedData, config);
    const normalized = normalizeRenderDataFromQuote(renderData, current.ocrText, config);
    renderData = normalized.renderData;
    const validation = validateDraft(renderData, config);
    const warnings = [...normalized.warnings, ...validation.warnings];
    const draft = await updateDraft(id, {
      extractedData,
      renderData,
      missingFields: validation.missingFields,
      warnings,
    });
    appLog.info("contract-draft", "PATCH ok", {
      draftId: id,
      missingFieldCount: validation.missingFields.length,
      warningCount: warnings.length,
    });
    return NextResponse.json(draft);
  } catch (error) {
    const message = error instanceof Error ? error.message : "更新草稿失败";
    appLog.error("contract-draft", "PATCH failed", error, { draftId: id });
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
